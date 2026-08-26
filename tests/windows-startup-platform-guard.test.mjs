import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

test("Windows startup avoids Electron APIs that are unavailable off macOS/Linux", async () => {
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

  const startupSource = await readFile(
    path.join(root, "source", "electron-main", "startup", "cross-platform-startup-binding.ts"),
    "utf8",
  );
  assert.match(startupSource, /platform === "darwin"/);
  assert.match(startupSource, /isInApplicationsFolder: platform === "darwin"[\s\S]*?: \(\) => true/);
  assert.match(startupSource, /moveToApplicationsFolder: platform === "darwin"[\s\S]*?: \(\) => false/);
  assert.match(startupSource, /platform === "win32"/);
  assert.match(startupSource, /startup-error\.log/);
  assert.match(startupSource, /showErrorBox\(/);

  const notifications = manifest.bindings.find((binding) => binding.path === "adapters.notifications");
  assert.ok(notifications);
  assert.equal(
    notifications.module,
    "../../source/electron-main/notifications/cross-platform-notifications-binding.ts",
  );
  assert.equal(
    notifications.export,
    "createElectronProductionCrossPlatformNotificationsBinding",
  );

  const notificationsSource = await readFile(
    path.join(root, "source", "electron-main", "notifications", "cross-platform-notifications-binding.ts"),
    "utf8",
  );
  assert.match(notificationsSource, /platform === "win32"/);
  assert.match(notificationsSource, /\(_count: number\): boolean => false/);
  assert.match(notificationsSource, /app\.setBadgeCount\.bind/);
});
