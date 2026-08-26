import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import {
  createProductionStartupBinding,
  type ElectronStartupProviderPorts,
} from "../production-binding-providers.js";
import { captureSandDesktopStartupFailure } from "../telemetry/sentry.js";

export const WINDOWS_STARTUP_ERROR_LOG = "startup-error.log";

type ElectronStartupApp = ElectronStartupProviderPorts["app"];

type RuntimeElectronApp = Pick<
  ElectronStartupApp,
  "isPackaged" | "setPath" | "getPath" | "relaunch" | "exit"
> & Partial<Pick<ElectronStartupApp, "isInApplicationsFolder" | "moveToApplicationsFolder">>;

type RuntimeElectronDialog = ElectronStartupProviderPorts["dialog"] & {
  showErrorBox(title: string, content: string): void;
};

function formatStartupError(error: unknown): string {
  if (error instanceof Error) return error.stack ?? `${error.name}: ${error.message}`;
  return String(error);
}

function reportWindowsStartupFailure(
  app: RuntimeElectronApp,
  dialog: RuntimeElectronDialog,
  phase: string,
  error: unknown,
): void {
  const detail = formatStartupError(error);
  try {
    const userData = app.getPath("userData");
    mkdirSync(userData, { recursive: true });
    appendFileSync(
      join(userData, WINDOWS_STARTUP_ERROR_LOG),
      `[${new Date().toISOString()}] phase=${phase}\n${detail}\n\n`,
      "utf8",
    );
  } catch {
    // Diagnostics must never replace the original startup failure.
  }
  try {
    dialog.showErrorBox(
      "Grok Bot failed to start",
      `${detail}\n\nA diagnostic log was written to ${WINDOWS_STARTUP_ERROR_LOG} when possible.`,
    );
  } catch {
    // The error remains available through stderr/Sentry when native dialog creation fails.
  }
}

function bindStartupApp(app: RuntimeElectronApp, platform: NodeJS.Platform): ElectronStartupApp {
  const bound: ElectronStartupApp = {
    get isPackaged() { return app.isPackaged; },
    setPath: app.setPath.bind(app),
    getPath: app.getPath.bind(app),
    relaunch: app.relaunch.bind(app),
    exit: app.exit.bind(app),
    // These Electron APIs only exist on macOS. The startup move check returns
    // before calling them on every other platform, but the reconstructed
    // provider validates their presence during composition. Supplying inert
    // non-darwin bindings keeps that validation platform-correct.
    isInApplicationsFolder: platform === "darwin"
      ? app.isInApplicationsFolder!.bind(app)
      : () => true,
    moveToApplicationsFolder: platform === "darwin"
      ? app.moveToApplicationsFolder!.bind(app)
      : () => false,
  };
  return bound;
}

/**
 * Production startup binding for the reconstructed desktop app.
 *
 * Electron exposes app.isInApplicationsFolder()/moveToApplicationsFolder()
 * only on macOS. The original source reconstruction treated them as universal
 * APIs, which makes Windows fail during startup composition before a window is
 * created. This adapter preserves the strict macOS contract while supplying
 * inert bindings on Windows/Linux, where the move check is skipped anyway.
 */
export function createElectronProductionCrossPlatformStartupBinding() {
  const electron = require("electron") as {
    readonly app: RuntimeElectronApp;
    readonly dialog: RuntimeElectronDialog;
  };
  const platform = process.platform;

  if (platform === "darwin") {
    if (typeof electron.app.isInApplicationsFolder !== "function") {
      throw new Error("Electron macOS runtime is missing app.isInApplicationsFolder().");
    }
    if (typeof electron.app.moveToApplicationsFolder !== "function") {
      throw new Error("Electron macOS runtime is missing app.moveToApplicationsFolder().");
    }
  }

  return createProductionStartupBinding({
    app: bindStartupApp(electron.app, platform),
    dialog: electron.dialog,
    argv: process.argv,
    env: process.env,
    platform,
    captureFailure: (error, phase) => {
      captureSandDesktopStartupFailure(error, phase);
      if (platform === "win32") {
        reportWindowsStartupFailure(electron.app, electron.dialog, phase, error);
      }
    },
  });
}
