import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const autoUpdate = await import("../../src/lib/system/autoUpdate.ts");

// Turbopack inlines `__dirname` in Next.js server bundles as a placeholder rooted at
// `/ROOT/` (e.g. "/ROOT/src/lib/system"). Walking up from that path finds nothing, so
// PROJECT_ROOT fell back to $HOME. On a machine where `$HOME/.git` exists (a `bd init`,
// a dotfiles repo) the npm install was then misclassified as a *source checkout* and the
// updater ran `git fetch --tags origin` in the home directory:
//   fatal: 'origin' does not appear to be a git repository
const TURBOPACK_PLACEHOLDER = "/ROOT/src/lib/system";

function makeFakeGlobalInstall(): { base: string; dist: string; chunks: string } {
  const base = mkdtempSync(path.join(os.tmpdir(), "omniroute-bundled-dirname-"));
  const dist = path.join(base, "lib", "node_modules", "omniroute", "dist");
  const chunks = path.join(dist, ".build", "next", "server", "chunks");
  mkdirSync(chunks, { recursive: true });
  // Real npm layout: dist/package.json carries the package name; the synthetic
  // .build/next/package.json has no name and must be skipped (#8956).
  writeFileSync(path.join(dist, "package.json"), JSON.stringify({ name: "omniroute" }));
  writeFileSync(
    path.join(dist, ".build", "next", "package.json"),
    JSON.stringify({ type: "commonjs" })
  );
  return { base, dist, chunks };
}

test("isBundledDirnamePlaceholder flags the Turbopack /ROOT placeholder (and no __dirname)", () => {
  assert.equal(autoUpdate.isBundledDirnamePlaceholder(TURBOPACK_PLACEHOLDER), true);
  assert.equal(autoUpdate.isBundledDirnamePlaceholder("/ROOT"), true);
  assert.equal(autoUpdate.isBundledDirnamePlaceholder("\\ROOT\\src\\lib\\system"), true);
  assert.equal(autoUpdate.isBundledDirnamePlaceholder(undefined), true);
  assert.equal(autoUpdate.isBundledDirnamePlaceholder(""), true);
  // Real (or merely unusual) paths are never placeholders — a missing dir still walks up and
  // falls back exactly as before, so `/proc/1`-style probes keep their behaviour.
  assert.equal(autoUpdate.isBundledDirnamePlaceholder(os.tmpdir()), false);
  assert.equal(autoUpdate.isBundledDirnamePlaceholder("/proc/1"), false);
  assert.equal(autoUpdate.isBundledDirnamePlaceholder("/opt/ROOT/omniroute"), false);
  assert.equal(autoUpdate.isBundledDirnamePlaceholder("/ROOTFS/app"), false);
});

test("resolveProjectRoot ignores the bundled placeholder and resolves from the server cwd", () => {
  const { base, dist, chunks } = makeFakeGlobalInstall();
  try {
    const homeLike = path.join(base, "home");
    mkdirSync(path.join(homeLike, ".git"), { recursive: true });

    // Before the fix: the walk from /ROOT/... found nothing and returned the fallback ($HOME).
    const root = autoUpdate.resolveProjectRoot(homeLike, TURBOPACK_PLACEHOLDER, chunks);
    assert.equal(
      root,
      dist,
      `expected the npm package dist dir, got ${root} (fallback leak → git ran in $HOME)`
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("resolveProjectRoot still honours a real start dir when one is given", () => {
  const { base, dist, chunks } = makeFakeGlobalInstall();
  try {
    assert.equal(autoUpdate.resolveProjectRoot("/fallback", chunks, "/unused-cwd"), dist);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("isSourceCheckout: a .git dir without an OmniRoute package.json is NOT a source checkout", () => {
  const base = mkdtempSync(path.join(os.tmpdir(), "omniroute-home-git-"));
  try {
    // $HOME after `bd init` / dotfiles repo: has .git, no package.json.
    mkdirSync(path.join(base, ".git"));
    assert.equal(autoUpdate.isSourceCheckout(base), false);

    // A real checkout has both.
    writeFileSync(path.join(base, "package.json"), JSON.stringify({ name: "omniroute" }));
    assert.equal(autoUpdate.isSourceCheckout(base), true);

    // A git worktree uses a `.git` *file* — still a checkout.
    const wt = path.join(base, "wt");
    mkdirSync(wt);
    writeFileSync(path.join(wt, ".git"), "gitdir: ../.git/worktrees/wt\n");
    writeFileSync(path.join(wt, "package.json"), JSON.stringify({ name: "omniroute" }));
    assert.equal(autoUpdate.isSourceCheckout(wt), true);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("getAutoUpdateConfig: global npm install under a git-tracked $HOME resolves to npm mode", () => {
  const { base, dist, chunks } = makeFakeGlobalInstall();
  try {
    const homeLike = path.join(base, "home");
    mkdirSync(path.join(homeLike, ".git"), { recursive: true });
    const config = autoUpdate.getAutoUpdateConfig(
      {},
      {
        projectRoot: autoUpdate.resolveProjectRoot(homeLike, TURBOPACK_PLACEHOLDER, chunks),
        currentDir: TURBOPACK_PLACEHOLDER,
      }
    );
    assert.equal(config.mode, "npm");
    assert.equal(autoUpdate.resolveProjectRoot(homeLike, TURBOPACK_PLACEHOLDER, chunks), dist);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
