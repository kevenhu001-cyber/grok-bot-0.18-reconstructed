import { existsSync, lstatSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

export interface LocalInferenceCliStatus {
  readonly installed: boolean;
  readonly authenticated: boolean;
  readonly executablePath: string | null;
}

type LocalInferenceStatus = { readonly codex: LocalInferenceCliStatus; readonly "claude-code": LocalInferenceCliStatus };

const LOCAL_INFERENCE_STATUS_CACHE_MS = 3_000;
let cachedCodexCliPath: string | null | undefined;
let cachedClaudeCodeCliPath: string | null | undefined;
let cachedStatus: { readonly expiresAtMs: number; readonly value: LocalInferenceStatus } | undefined;

function firstExecutable(candidates: readonly (string | undefined)[]): string | null {
  for (const candidate of candidates) if (candidate != null && candidate.length > 0 && existsSync(candidate)) return candidate;
  return null;
}

function executableNames(name: string): string[] {
  return process.platform === "win32" ? [`${name}.exe`, `${name}.cmd`, `${name}.bat`, name] : [name];
}

function pathCandidates(name: string): string[] {
  const directories = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  return directories.flatMap(directory => executableNames(name).map(executable => join(directory, executable)));
}

export function resolveCodexCliPath(): string | null {
  if (cachedCodexCliPath !== undefined) return cachedCodexCliPath;
  const home = homedir();
  cachedCodexCliPath = firstExecutable([
    process.env.CODEX_PATH,
    join(home, ".local", "bin", "codex"),
    join(home, ".codex", "bin", "codex"),
    ...pathCandidates("codex"),
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
  ]);
  return cachedCodexCliPath;
}

export function resolveClaudeCodeCliPath(): string | null {
  if (cachedClaudeCodeCliPath !== undefined) return cachedClaudeCodeCliPath;
  const home = homedir();
  cachedClaudeCodeCliPath = firstExecutable([
    process.env.CLAUDE_CODE_PATH,
    join(home, ".local", "bin", "claude"),
    join(home, ".claude", "local", "claude"),
    ...pathCandidates("claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
  ]);
  return cachedClaudeCodeCliPath;
}

function hasUsableCodexLogin(path: string): boolean {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) return false;
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, any>;
    return parsed.auth_mode === "chatgpt"
      && typeof parsed.tokens?.access_token === "string" && parsed.tokens.access_token.length > 0
      && typeof parsed.tokens?.refresh_token === "string" && parsed.tokens.refresh_token.length > 0
      && typeof parsed.tokens?.id_token === "string" && parsed.tokens.id_token.length > 0
      && typeof parsed.tokens?.account_id === "string" && parsed.tokens.account_id.length > 0;
  } catch { return false; }
}

export function getLocalInferenceCliStatus(): LocalInferenceStatus {
  const now = Date.now();
  if (cachedStatus != null && now < cachedStatus.expiresAtMs) return cachedStatus.value;

  const home = homedir();
  const codexPath = resolveCodexCliPath();
  const claudePath = resolveClaudeCodeCliPath();
  const codexAuthPath = join(process.env.CODEX_HOME?.trim() || join(home, ".codex"), "auth.json");
  const hasCodexAuthFile = existsSync(codexAuthPath);
  const hasCodexLogin = hasUsableCodexLogin(codexAuthPath);
  const value: LocalInferenceStatus = {
    // Codex inference is a Grok Bot-owned HTTP transport authenticated by the
    // existing Codex login. The CLI binary is not in the request path.
    codex: { installed: hasCodexAuthFile, authenticated: hasCodexLogin, executablePath: codexPath },
    "claude-code": { installed: claudePath != null, authenticated: existsSync(join(home, ".claude", ".credentials.json")) || (process.env.ANTHROPIC_API_KEY?.length ?? 0) > 0, executablePath: claudePath },
  };
  cachedStatus = { expiresAtMs: now + LOCAL_INFERENCE_STATUS_CACHE_MS, value };
  return value;
}
