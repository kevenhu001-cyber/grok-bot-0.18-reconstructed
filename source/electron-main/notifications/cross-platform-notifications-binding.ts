import {
  createProductionNotificationsBinding,
  type ElectronNotificationsProviderPorts,
} from "../production-binding-providers.js";

type RuntimeNotification = ElectronNotificationsProviderPorts["Notification"];

type RuntimeElectronApp = {
  setBadgeCount?: (count: number) => unknown;
};

/**
 * Electron exposes app.setBadgeCount() on macOS/Linux, not Windows.
 * Notifications themselves are supported on Windows, so keep the native
 * Notification implementation and make only the unsupported dock/taskbar
 * badge edge inert there.
 */
export function createElectronProductionCrossPlatformNotificationsBinding() {
  const electron = require("electron") as {
    readonly Notification: RuntimeNotification;
    readonly app: RuntimeElectronApp;
  };
  const platform = process.platform;

  const setBadgeCount = platform === "win32"
    ? (_count: number): boolean => false
    : (() => {
        if (typeof electron.app.setBadgeCount !== "function") {
          throw new Error(`Electron ${platform} runtime is missing app.setBadgeCount().`);
        }
        return electron.app.setBadgeCount.bind(electron.app);
      })();

  return createProductionNotificationsBinding({
    Notification: electron.Notification,
    app: { setBadgeCount },
  });
}
