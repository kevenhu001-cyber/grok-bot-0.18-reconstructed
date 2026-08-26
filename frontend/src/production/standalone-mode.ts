import type {
  CursorAccountDesktopBridge,
  CursorAuthStatus,
  DesktopBridge,
} from "../recovered/contracts/desktop-bridge";

type LoggedInCursorStatus = Extract<CursorAuthStatus, { kind: "logged-in" }>;

/**
 * Local identity used by the reconstructed client when no Cursor session exists.
 *
 * This is deliberately renderer-only. It does not mint, persist, or expose a
 * Cursor token, and provider-specific transports continue to enforce their own
 * authentication requirements.
 */
export const LOCAL_GUEST_AUTH_STATUS: LoggedInCursorStatus = Object.freeze({
  kind: "logged-in",
  authId: "local-guest",
  displayName: "Local",
  isAnysphereUser: false,
});

export const LOCAL_GUEST_SAND_ACCESS = Object.freeze({
  state: "granted",
  reason: "none",
});

function projectCursorStatus(status: CursorAuthStatus): CursorAuthStatus {
  return status.kind === "logged-in" ? status : LOCAL_GUEST_AUTH_STATUS;
}

async function readActualCursorStatus(account: CursorAccountDesktopBridge): Promise<CursorAuthStatus> {
  try {
    return await account.getStatus();
  } catch {
    return { kind: "logged-out" };
  }
}

function readBoundProperty(target: object, property: PropertyKey, receiver: unknown): unknown {
  const value = Reflect.get(target, property, receiver);
  return typeof value === "function" ? value.bind(target) : value;
}

function createStandaloneCursorAccount(account: CursorAccountDesktopBridge): CursorAccountDesktopBridge {
  return new Proxy(account, {
    get(target, property, receiver) {
      if (property === "getStatus") {
        return async (): Promise<CursorAuthStatus> => projectCursorStatus(await readActualCursorStatus(target));
      }
      if (property === "onStatusChanged") {
        return (listener: (status: CursorAuthStatus) => void) =>
          target.onStatusChanged((status) => listener(projectCursorStatus(status)));
      }
      if (property === "login") {
        return async (): Promise<CursorAuthStatus> => projectCursorStatus(await target.login());
      }
      if (property === "cancelLogin") {
        return async (): Promise<CursorAuthStatus> => projectCursorStatus(await target.cancelLogin());
      }
      if (property === "logout") {
        return async (): Promise<CursorAuthStatus> => {
          await target.logout();
          return LOCAL_GUEST_AUTH_STATUS;
        };
      }
      if (property === "updateName") {
        return async (name: string): Promise<CursorAuthStatus> => {
          const status = await readActualCursorStatus(target);
          return status.kind === "logged-in" ? await target.updateName(name) : LOCAL_GUEST_AUTH_STATUS;
        };
      }
      if (property === "getSandAccess") {
        return async (): Promise<unknown> => {
          const status = await readActualCursorStatus(target);
          return status.kind === "logged-in" ? await target.getSandAccess() : LOCAL_GUEST_SAND_ACCESS;
        };
      }
      if (property === "getSandAccessFresh") {
        return async (): Promise<unknown> => {
          const status = await readActualCursorStatus(target);
          return status.kind === "logged-in" ? await target.getSandAccessFresh() : LOCAL_GUEST_SAND_ACCESS;
        };
      }
      return readBoundProperty(target, property, receiver);
    },
  }) as CursorAccountDesktopBridge;
}

export function createStandaloneDesktopBridge(bridge: DesktopBridge): DesktopBridge {
  const rawAccount = bridge.cursorAccount;
  const cursorAccount = createStandaloneCursorAccount(rawAccount);

  const onboarding = new Proxy(bridge.onboarding, {
    get(target, property, receiver) {
      if (property === "getSeen") {
        return async (): Promise<boolean> => {
          const status = await readActualCursorStatus(rawAccount);
          return status.kind === "logged-in" ? await target.getSeen() : true;
        };
      }
      if (property === "setSeen") {
        return async (seen: boolean): Promise<void> => {
          const status = await readActualCursorStatus(rawAccount);
          if (status.kind === "logged-in") await target.setSeen(seen);
        };
      }
      return readBoundProperty(target, property, receiver);
    },
  }) as DesktopBridge["onboarding"];

  return new Proxy(bridge, {
    get(target, property, receiver) {
      if (property === "cursorAccount") return cursorAccount;
      if (property === "onboarding") return onboarding;
      return readBoundProperty(target, property, receiver);
    },
  }) as DesktopBridge;
}
