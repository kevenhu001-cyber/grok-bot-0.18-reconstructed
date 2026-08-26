import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

test("Windows startup uses a cross-platform binding instead of requiring macOS app APIs", async () => {
  const manifest = JSON.parse(await readFile(
    path.join(root, "manifests", "reconstruction", "electron-main-production-bindings-manifest.json"),
    "utf8",
  ));
  const startup = manifest.bindings.find((binding) => binding.path === "startup");
  assert.ok(startup);
  assert.equal(
    startup.module,
    "../../source/electron-main/startup/cross-platform-startup-binding.ts",
  );
  assert.equal(startup.export, "createElectronProductionCrossPlatformStartupBinding");

  const source = await readFile(
    path.join(root, "source", "electron-main", "startup", "cross-platform-startup-binding.ts"),
    "utf8",
  );

  assert.match(source, /platform === "darwin"/);
  assert.match(source, /isInApplicationsFolder: platform === "darwin"[\s\S]*?: \(\) => true/);
  assert.match(source, /moveToApplicationsFolder: platform === "darwin"[\s\S]*?: \(\) => false/);
  assert.match(source, /platform === "win32"/);
  assert.match(source, /startup-error\.log/);
  assert.match(source, /showErrorBox\(/);
});
