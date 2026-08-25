import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { getRawHeader } from "@electron/asar";
import { packStagedAppWithIntegrity } from "./lib/asar-integrity.mjs";
import { repoRoot } from "./lib/config.mjs";
import { run } from "./lib/process.mjs";

const windowsInstallerSha256 = "464079a15ef5fa8b61ccea8fffcc78f63cfcf6df65fb0ad5e725d8b95f7e437e";
const archivedInstaller = path.join(
  repoRoot,
  "research-archives",
  "original",
  "0.18.0",
  "windows-x64",
  "Grok_Bot_0.18.0_Setup.exe",
);
const stageRoot = path.resolve(
  process.env.GROK_BOT_WINDOWS_STAGE_ROOT?.trim() || path.join(repoRoot, ".build", "fidelity", "app"),
);
const buildRoot = path.join(repoRoot, ".build", "windows");
const portableRoot = path.join(buildRoot, "portable");
const windowsAsar = path.join(buildRoot, "app.asar");
const windowsAsarUnpacked = `${windowsAsar}.unpacked`;
const outputDir = path.join(repoRoot, "dist");
const outputZip = path.join(outputDir, "Grok-Bot-0.18-Reconstructed-win32-x64.zip");
const outputInstaller = path.join(outputDir, "Grok-Bot-0.18-Reconstructed-Setup-x64.exe");
const outputManifest = path.join(outputDir, "windows-package-manifest.json");
const sevenZip = process.env.SEVEN_ZIP?.trim() || "7z";
const makensis = process.env.MAKENSIS?.trim() || "makensis";

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function sha256(target) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(target)) hash.update(chunk);
  return hash.digest("hex");
}

function asarHeaderSha256(target) {
  return createHash("sha256").update(getRawHeader(target).headerString).digest("hex");
}

async function assertPinnedInstaller(installer) {
  if (!(await exists(installer))) {
    throw new Error(`Missing pinned Windows installer at ${installer}. Run git lfs pull for the windows-x64 archive first.`);
  }
  const digest = await sha256(installer);
  if (digest !== windowsInstallerSha256) {
    throw new Error(`Windows installer checksum mismatch: expected ${windowsInstallerSha256}, got ${digest}`);
  }
}

async function childDirectories(root) {
  const directories = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory()) directories.push(path.join(root, entry.name));
  }
  return directories;
}

async function findRuntimeRoot(searchRoot) {
  const queue = [searchRoot];
  while (queue.length > 0) {
    const current = queue.shift();
    const resources = path.join(current, "resources");
    const appAsar = path.join(resources, "app.asar");
    if (await exists(appAsar)) {
      const files = await readdir(current, { withFileTypes: true });
      const executables = files
        .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith(".exe"))
        .map(entry => entry.name)
        .filter(name => !name.toLowerCase().startsWith("uninstall"));
      const executableName = executables.find(name => name.toLowerCase() === "grok bot.exe") ?? executables[0];
      if (executableName != null) return { root: current, executableName };
    }
    queue.push(...await childDirectories(current));
  }
  return null;
}

async function collectNestedArchives(searchRoot) {
  const found = [];
  const queue = [searchRoot];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) queue.push(target);
      else if (entry.isFile() && /\.(7z|nupkg|zip)$/i.test(entry.name)) found.push(target);
    }
  }
  return found.sort((left, right) => {
    const score = value => /app[-_]?(64|x64)/i.test(path.basename(value)) ? 0 : /full\.nupkg$/i.test(value) ? 1 : 2;
    return score(left) - score(right) || left.localeCompare(right);
  });
}

async function extractOfficialRuntime(installer) {
  const extractionRoot = await mkdtemp(path.join(tmpdir(), "grok-bot-018-windows-"));
  const outerRoot = path.join(extractionRoot, "outer");
  await mkdir(outerRoot, { recursive: true });
  await run(sevenZip, ["x", "-y", `-o${outerRoot}`, installer]);

  const direct = await findRuntimeRoot(outerRoot);
  if (direct != null) return { ...direct, extractionRoot };

  const archives = await collectNestedArchives(outerRoot);
  for (let index = 0; index < Math.min(archives.length, 32); index += 1) {
    const nestedRoot = path.join(extractionRoot, `nested-${index}`);
    await mkdir(nestedRoot, { recursive: true });
    try {
      await run(sevenZip, ["x", "-y", `-o${nestedRoot}`, archives[index]]);
    } catch (error) {
      console.warn(`Skipping nested archive ${archives[index]}: ${String(error)}`);
      continue;
    }
    const runtime = await findRuntimeRoot(nestedRoot);
    if (runtime != null) return { ...runtime, extractionRoot };
  }

  await rm(extractionRoot, { recursive: true, force: true });
  throw new Error(`Could not locate a Windows Electron runtime in ${installer}. Nested archives inspected: ${archives.length}.`);
}

async function replaceWindowsNativeClosure(runtimeRoot) {
  const upstreamUnpackedDist = path.join(runtimeRoot, "resources", "app.asar.unpacked", "dist");
  const replaced = [];
  for (const directory of ["deps", "native", "node-deps"]) {
    const source = path.join(upstreamUnpackedDist, directory);
    const destination = path.join(stageRoot, "dist", directory);
    if (await exists(source)) {
      await rm(destination, { recursive: true, force: true });
      await cp(source, destination, { recursive: true, dereference: false, preserveTimestamps: true });
      replaced.push(directory);
      continue;
    }
    if (await exists(destination)) {
      throw new Error(`Pinned Windows runtime is missing required unpacked runtime directory dist/${directory}.`);
    }
  }
  if (replaced.length === 0) throw new Error("Pinned Windows runtime did not provide any unpacked native runtime directories.");
  return replaced;
}

async function markWindowsPackageIdentity() {
  const packagePath = path.join(stageRoot, "package.json");
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  packageJson.productName = "Grok Bot 0.18 Reconstructed";
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

async function assertPortableRuntime(executableName) {
  const executable = path.join(portableRoot, executableName);
  const resources = path.join(portableRoot, "resources");
  const asar = path.join(resources, "app.asar");
  const unpacked = path.join(resources, "app.asar.unpacked");
  if (!(await stat(executable)).isFile()) throw new Error(`Missing packaged Windows executable: ${executable}`);
  if (!(await stat(asar)).isFile()) throw new Error(`Missing packaged ASAR: ${asar}`);
  if (!(await stat(unpacked)).isDirectory()) throw new Error(`Missing packaged ASAR unpacked tree: ${unpacked}`);
  const pe = await readFile(executable);
  if (pe[0] !== 0x4d || pe[1] !== 0x5a) throw new Error(`Packaged executable is not a PE image: ${executable}`);
  return { executable, asar, unpacked };
}

async function buildArchives(executableName) {
  await rm(outputZip, { force: true });
  await run(sevenZip, ["a", "-tzip", "-mx=9", outputZip, path.join(portableRoot, "*")]);

  const nsisScript = path.join(repoRoot, "scripts", "windows", "installer.nsi");
  await rm(outputInstaller, { force: true });
  await run(makensis, [
    `/DAPP_DIR=${portableRoot}`,
    `/DOUT_FILE=${outputInstaller}`,
    `/DAPP_EXE=${executableName}`,
    nsisScript,
  ]);
}

if (process.platform !== "win32") {
  throw new Error("Windows packaging must run on Windows because it patches the PE integrity resource and builds an NSIS installer.");
}
if (!(await exists(stageRoot))) {
  throw new Error(`Missing reconstructed staging tree at ${stageRoot}. Build it on macOS with npm run bootstrap && npm run build, then transfer .build/fidelity/app to the Windows job.`);
}

await mkdir(outputDir, { recursive: true });
await rm(buildRoot, { recursive: true, force: true });
await mkdir(buildRoot, { recursive: true });
await assertPinnedInstaller(archivedInstaller);

const runtime = await extractOfficialRuntime(archivedInstaller);
try {
  await cp(runtime.root, portableRoot, { recursive: true, dereference: false, preserveTimestamps: true });
  const nativeDirectories = await replaceWindowsNativeClosure(runtime.root);
  await markWindowsPackageIdentity();
  await packStagedAppWithIntegrity({
    stageRoot,
    archivePath: windowsAsar,
    unpackedRoot: windowsAsarUnpacked,
  });

  const resources = path.join(portableRoot, "resources");
  const packagedAsar = path.join(resources, "app.asar");
  const packagedUnpacked = path.join(resources, "app.asar.unpacked");
  await rm(packagedAsar, { force: true });
  await rm(packagedUnpacked, { recursive: true, force: true });
  await cp(windowsAsar, packagedAsar);
  await cp(windowsAsarUnpacked, packagedUnpacked, {
    recursive: true,
    dereference: false,
    preserveTimestamps: true,
  });

  const verified = await assertPortableRuntime(runtime.executableName);
  const headerSha256 = asarHeaderSha256(verified.asar);
  await run("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    path.join(repoRoot, "scripts", "windows", "set-asar-integrity.ps1"),
    "-ExePath",
    verified.executable,
    "-HeaderHash",
    headerSha256,
  ]);
  await buildArchives(runtime.executableName);

  const manifest = {
    schemaVersion: 1,
    platform: "win32",
    arch: "x64",
    upstreamVersion: "0.18.0",
    upstreamInstallerSha256: windowsInstallerSha256,
    nativeDirectories,
    executableName: runtime.executableName,
    appAsarSha256: await sha256(verified.asar),
    appAsarHeaderSha256: headerSha256,
    executableSha256: await sha256(verified.executable),
    portableZip: path.basename(outputZip),
    portableZipSha256: await sha256(outputZip),
    installer: path.basename(outputInstaller),
    installerSha256: await sha256(outputInstaller),
    signing: "unsigned",
  };
  await writeFile(outputManifest, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Windows portable package: ${outputZip}`);
  console.log(`Windows installer: ${outputInstaller}`);
  console.log(`Windows package manifest: ${outputManifest}`);
} finally {
  await rm(runtime.extractionRoot, { recursive: true, force: true });
}
