import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Server-only (node imports). The agnostic runtimes career-ops can delegate to
// in headless mode (AGENTS.md). Install URLs from career-ops-docs.
export type CliSpec = {
  id: string;
  name: string;
  bin: string;
  run: string;
  url: string;
  /** headless invocation args for a single prompt */
  args: (prompt: string) => string[];
};

export const KNOWN: CliSpec[] = [
  { id: "claude", name: "Claude Code", bin: "claude", run: "claude -p", url: "https://claude.ai/code", args: (p) => ["-p", p] },
  { id: "codex", name: "Codex", bin: "codex", run: "codex exec", url: "https://github.com/openai/codex", args: (p) => ["exec", p] },
  { id: "gemini", name: "Gemini CLI", bin: "gemini", run: "gemini -p", url: "https://github.com/google-gemini/gemini-cli", args: (p) => ["-p", p] },
  // --auto: without it, every file read/write/bash call needs interactive
  // permission approval; headless (no TTY to answer) auto-rejects them all,
  // so the CLI "runs" but can't actually do anything (confirmed via
  // opencode's own log — every tool call showed "auto-rejecting").
  { id: "opencode", name: "OpenCode", bin: "opencode", run: "opencode run", url: "https://opencode.ai", args: (p) => ["run", "--auto", p] },
  { id: "copilot", name: "GitHub Copilot CLI", bin: "copilot", run: "copilot -p", url: "https://docs.github.com/en/copilot/github-copilot-in-the-cli", args: (p) => ["-p", p] },
  { id: "qwen", name: "Qwen CLI", bin: "qwen", run: "qwen -p", url: "https://qwen.ai/qwencode", args: (p) => ["-p", p] },
  // Antigravity CLI (`agy`) is REMOVED from this instance on purpose. Upstream
  // ships it first in the list and first in the default order because of its
  // free tier, but this fork is configured end-to-end for OpenCode:
  // config/profile.yml's `opencode_models` routes scan / triage / evaluate to
  // specific models, and /api/run only applies that routing when the engine is
  // OpenCode — so any run that landed on agy silently ignored every model
  // choice. It stayed selected because it was the first preference in two
  // separate places, so removing it here is what actually stops that.
  // To restore it, re-add:
  //   { id: "antigravity", name: "Antigravity CLI", bin: "agy", run: "agy -p",
  //     url: "https://antigravity.google",
  //     args: (p) => ["--model", "Gemini 3.5 Flash (High)", "--dangerously-skip-permissions", "--add-dir", ".", "-p", p] },
];

function searchDirs(): string[] {
  const home = os.homedir();
  const extra = [
    path.join(home, ".local/bin"),
    path.join(home, ".npm-global/bin"),
    path.join(home, ".bun/bin"),
    path.join(home, ".deno/bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
  ];
  if (process.platform === "win32") {
    // Windows CLIs frequently install under per-user AppData roots and don't
    // reliably add themselves to PATH (e.g. Antigravity → %LOCALAPPDATA%\agy\bin).
    const localAppData = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
    extra.push(
      path.join(localAppData, "agy", "bin"), // Antigravity CLI
      path.join(localAppData, "Microsoft", "WindowsApps"), // winget/Store shims
      path.join(appData, "npm"), // npm global prefix on Windows
    );
  }
  const fromPath = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  return [...new Set([...fromPath, ...extra])];
}

// On Windows, executables carry an extension (claude.exe, claude.cmd, ...).
// Mirror the shell's PATHEXT resolution so a native-installer claude.exe is
// found, not just an extensionless npm shim. On POSIX, "" keeps the bare name.
function binCandidates(bin: string): string[] {
  if (process.platform !== "win32") return [bin];
  const pathext = process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD";
  const exts = pathext
    .split(";")
    .map((e) => e.trim())
    .filter(Boolean)
    // Only include extensions that `child_process.spawn()` can execute directly.
    .filter((e) => [".com", ".exe", ".bat", ".cmd"].includes(e.toLowerCase()));

  // Try the bare name too (some environments provide an extensionless shim).
  return [bin, ...exts.map((ext) => bin + ext)];
}

export function findBin(bin: string, dirs = searchDirs()): string | null {
  for (const dir of dirs) {
    for (const candidate of binCandidates(bin)) {
      const p = path.join(dir, candidate);
      try {
        fs.accessSync(p, fs.constants.X_OK);
        return p;
      } catch {
        /* not here */
      }
    }
  }
  return null;
}

export function detectClis() {
  const dirs = searchDirs();
  return KNOWN.map((c) => {
    const found = findBin(c.bin, dirs);
    return { id: c.id, name: c.name, run: c.run, url: c.url, installed: !!found, path: found };
  });
}

export function resolveCli(id: string): { spec: CliSpec; binPath: string } | null {
  const spec = KNOWN.find((c) => c.id === id);
  if (!spec) return null;
  const binPath = findBin(spec.bin);
  if (!binPath) return null;
  return { spec, binPath };
}

// Default engine when the user hasn't picked one in Config, in preference
// order. An explicit Config selection always wins — this only fills the gap.
//
// OpenCode first, ahead of upstream's Antigravity-first (free-tier) ordering.
// The Config choice is stored in the BROWSER (localStorage), so it is absent
// on every new browser, private window, cleared cache, and remote/tunnel
// session — and each of those silently fell back to Antigravity, which reads
// as the setting "resetting itself". This ordering is also what matches the
// rest of the setup: `opencode_models` in config/profile.yml routes scan /
// triage / evaluate to specific OpenCode models, which only takes effect when
// the engine is actually OpenCode.
const DEFAULT_ORDER = ["opencode", "claude"];

export function defaultCliId(): string | null {
  const dirs = searchDirs();
  const installed = KNOWN.filter((c) => findBin(c.bin, dirs));
  for (const id of DEFAULT_ORDER) {
    const hit = installed.find((c) => c.id === id);
    if (hit) return hit.id;
  }
  return installed[0]?.id ?? null;
}
