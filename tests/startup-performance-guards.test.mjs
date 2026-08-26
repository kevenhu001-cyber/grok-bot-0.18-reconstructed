import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Windows rendering is not forced into software mode", async () => {
  const source = await read("source/electron-main/main.ts");
  assert.match(source, /platform !== "win32" \|\| env\.SAND_DISABLE_HARDWARE_ACCELERATION === "1"/);
  assert.match(source, /disableHardwareAcceleration\(\)/);
  assert.match(source, /appendSwitch\("disable-gpu"\)/);
});

test("settings reads use a short-lived cache", async () => {
  const source = await read("source/shared/node/settings/sand-settings-store.ts");
  assert.match(source, /SETTINGS_READ_CACHE_MS = 500/);
  assert.match(source, /private cached:/);
  assert.match(source, /structuredClone\(this\.cached\.value\)/);
});

test("renderer serving does not synthesize an initial transport-down", async () => {
  const source = await read("source/node-agent-coordinator/main.ts");
  assert.match(source, /onServing: \(\) => \{ toolRelay\.replay\(\); \}/);
  assert.doesNotMatch(source, /onServing:[^\n]*state: "down"/);
});
