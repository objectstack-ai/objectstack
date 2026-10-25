// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Console UI Integration Utilities — an INTERNAL module (#16046).
 *
 * ⚠️ This module is not a published entry point. Until #16046 the `./console`
 * subpath pointed straight at this file's build output, so all 13 of its
 * top-level exports were public API and any export it gained became public on
 * landing. The published face is now `src/console.ts`, which re-exports three
 * of them by name; the other ten are reachable only from inside this package.
 * Adding an export here no longer publishes anything, and ⛔ moving one into
 * the public face means editing that barrel and its pin
 * (`test/published-subpath-console.pin.test.ts`) on purpose, with a changeset.
 *
 * Mirrors `studio.ts` / `account.ts` but for the opinionated, fork-ready
 * runtime console. The Console SPA is mounted at `/_console/` by every
 * deployment that opts in (CLI dev server, self-host, Vercel). The
 * Console is built with `base: '/_console/'`, so its pre-built `dist/`
 * is served verbatim.
 *
 * Resolution strategy, in priority order:
 *
 *   1. `@objectstack/console` — the framework-vendored, version-locked
 *      build. Shipped as a dist-only npm package frozen at the objectui
 *      SHA recorded in `<framework>/.objectui-sha`. This is what a
 *      fresh `@objectstack/cli` install gets: the CLI declares this
 *      package as a dependency and both ship at one version from the
 *      Changesets `fixed` group, so no app installs it by hand. Cloud /
 *      objectos Docker builds overlay their own `cloud/.objectui-sha`
 *      build into this package's `dist/` so the same package name
 *      always wins regardless of who built the image.
 *
 *   2. Sibling-repo dev fallback — `../objectui/apps/console` — so the
 *      framework monorepo can be developed against an in-tree checkout
 *      of objectui without publishing every change.
 *
 * NOTE: the legacy `@object-ui/console` npm package was the upstream
 * source-of-truth before the framework started vendoring its own copy.
 * It is no longer consulted — cloud's Docker overlay and self-hosted
 * installs both target `@objectstack/console` exclusively now.
 *
 * Pure static-asset dependency: there are zero JS imports against
 * this package anywhere in the framework — we only need to find a
 * directory containing `dist/index.html`.
 */
import path from 'path';
import fs from 'fs';
import { createHash, randomBytes } from 'crypto';
import { createRequire } from 'module';
import { pathToFileURL, fileURLToPath } from 'url';

// ─── Constants ──────────────────────────────────────────────────────

/** URL mount path for the Console portal inside the ObjectStack server */
export const CONSOLE_PATH = '/_console';

/**
 * The anonymous form door the Console's public form page (`/f/:slug`) reads:
 * the page fetches `GET /api/v1/forms/<slug>` and renders what it answers.
 * The `/forms/:slug` redirect below asks this same door, so it redirects
 * exactly when the page it redirects to would be served the form.
 */
const PUBLIC_FORM_DOOR = '/api/v1/forms';

/**
 * The Console's public form page, `/f/<slug>` under {@link CONSOLE_PATH}: the
 * page the `/forms/:slug` redirect lands on, and the one page the Console's
 * public-forms screen offers as an `<iframe>` snippet for other sites.
 */
const PUBLIC_FORM_PAGE = '/f';

/**
 * The anonymous door that serves the Console's branding. The shell's inline
 * early-branding script fetches `GET /api/v1/runtime/config` and sets
 * `document.title` from its `branding.productName`. The shell's server-written
 * `<title>`, description and Open Graph tags read this same door, so a link
 * preview and the browser tab show the same name.
 */
const RUNTIME_CONFIG_DOOR = '/api/v1/runtime/config';

/** Canonical npm package name that ships the Console SPA. */
const CONSOLE_PACKAGE = '@objectstack/console';

// ─── Version Guard ──────────────────────────────────────────────────

/**
 * The vendored `@objectstack/console` package is version-locked to the
 * framework release, so a healthy install always carries the same major
 * as the CLI. Node module resolution from the consumer cwd, however,
 * climbs `node_modules` directories all the way up the filesystem — a
 * stray install outside the workspace (e.g. a leftover
 * `~/node_modules/@objectstack/console` from an old npm experiment) can
 * shadow the bundled build and silently serve a stale Console.
 *
 * Guard: skip any candidate whose major version differs from the CLI's
 * own, and warn so the stray install is discoverable.
 */
export function isConsoleVersionCompatible(
  candidateVersion: unknown,
  cliVersion: string,
): boolean {
  if (typeof candidateVersion !== 'string') return false;
  const candidateMajor = majorOf(candidateVersion);
  const cliMajor = majorOf(cliVersion);
  return candidateMajor !== null && candidateMajor === cliMajor;
}

function majorOf(version: string): number | null {
  const match = /^v?(\d+)[.-]/.exec(version.trim()) ?? /^v?(\d+)$/.exec(version.trim());
  return match ? Number(match[1]) : null;
}

let cachedCliVersion: string | null | undefined;

/**
 * Read this CLI's own version by walking up from the compiled module to
 * the nearest `package.json`. Returns null (guard disabled, fail open)
 * if it can't be determined — never let the version check break
 * resolution outright.
 */
function getCliVersion(): string | null {
  if (cachedCliVersion !== undefined) return cachedCliVersion;
  let version: string | null = null;
  try {
    let dir = path.dirname(fileURLToPath(import.meta.url));
    for (let depth = 0; depth < 6; depth++) {
      const pkgPath = path.join(dir, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (typeof pkg.version === 'string') version = pkg.version;
        break;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    // Unreadable own package.json — leave the guard disabled.
  }
  cachedCliVersion = version;
  return version;
}

// ─── Path Resolution ────────────────────────────────────────────────

/**
 * Resolve the filesystem path to a Console SPA package.
 *
 * Two-pass strategy:
 *   - Pass 1: walk candidates in priority order and return the first
 *     whose `dist/index.html` exists. This is what the CLI actually
 *     wants — a usable build to serve.
 *   - Pass 2: if no candidate has a built dist, return the first
 *     candidate that resolves at all, so `hasConsoleDist()` can surface
 *     a clear "package present but unbuilt" warning instead of "package
 *     not installed".
 *
 * Candidates are located via, in order:
 *   1. `require.resolve('@objectstack/console/package.json')` from the
 *      consumer cwd and from this CLI's own location. We resolve the
 *      `package.json` subpath (not the bare specifier) because
 *      `@objectstack/console` is a static-asset-only package with no
 *      JS `main` / `"."` export — bare resolution would throw
 *      `ERR_PACKAGE_PATH_NOT_EXPORTED`.
 *   2. Direct `<cwd>/node_modules/@objectstack/console` filesystem check.
 *   3. Sibling-repo dev fallback — `../objectui/apps/console` — matched
 *      by the package name on disk so an unrelated `apps/console`
 *      doesn't get picked up by accident.
 *
 * Strategies 1 and 2 additionally require the candidate's major version
 * to match the CLI's own (see `isConsoleVersionCompatible`) — node
 * resolution climbs past the workspace root, so a stale install higher
 * up the filesystem must not shadow the version-locked bundle.
 * Mismatches are skipped with a warning. The sibling-repo fallback is
 * exempt: the objectui workspace versions independently and is an
 * explicit dev opt-in.
 */
export interface ResolveConsoleOptions {
  /** Resolution origin; defaults to `process.cwd()`. */
  cwd?: string;
  /** Override the CLI's own version (tests). */
  cliVersion?: string;
  /** Warning sink; defaults to `console.warn`. */
  warn?: (message: string) => void;
  /**
   * Called when the dist about to be served was built from a different
   * objectui SHA than the repo pins. Defaults to emitting the advisory
   * one-liner on `warn`. A caller that enforces the pin itself — the dev
   * server refuses to mount a drifted console, see `decideConsoleMount` —
   * passes a collector instead, so the drift is reported exactly once and
   * by whoever decides what to do about it.
   */
  onDrift?: (drift: ConsoleShaDrift) => void;
}

export function resolveConsolePath(options?: ResolveConsoleOptions): string | null {
  const cwd = options?.cwd ?? process.cwd();
  const cliVersion = options?.cliVersion ?? getCliVersion();
  const warn = options?.warn ?? ((message: string) => console.warn(message));
  const onDrift =
    options?.onDrift ?? ((drift: ConsoleShaDrift) => warn(formatConsoleShaDriftWarning(drift)));

  /** Version guard for vendored-package candidates (strategies 1 & 2). */
  const versionOk = (dir: string, candidateVersion: unknown): boolean => {
    if (!cliVersion) return true; // own version unknown — fail open
    if (isConsoleVersionCompatible(candidateVersion, cliVersion)) return true;
    const shown = typeof candidateVersion === 'string' ? candidateVersion : 'unknown';
    warn(
      `  ⚠ Ignoring ${CONSOLE_PACKAGE}@${shown} at ${dir} — major version does not match this CLI (${cliVersion}). ` +
      `This is usually a stale install outside your workspace (e.g. a leftover ~/node_modules); remove it or install a matching version.`,
    );
    return false;
  };

  const resolutionBases = [
    pathToFileURL(path.join(cwd, 'package.json')).href, // consumer workspace
    import.meta.url,                                      // CLI package itself
  ];

  /** Collect every existing candidate dir, preserving priority order. */
  const candidates: string[] = [];

  // 1: node module resolution from cwd and from the CLI itself, via
  //    the package.json subpath (always exported, even by dist-only pkgs).
  for (const base of resolutionBases) {
    try {
      const req = createRequire(base);
      const resolvedPkgJson = req.resolve(`${CONSOLE_PACKAGE}/package.json`);
      const dir = path.dirname(resolvedPkgJson);
      try {
        const pkg = JSON.parse(fs.readFileSync(resolvedPkgJson, 'utf-8'));
        if (
          pkg.name === CONSOLE_PACKAGE &&
          versionOk(dir, pkg.version) &&
          !candidates.includes(dir)
        ) {
          candidates.push(dir);
        }
      } catch {
        // package.json unreadable — fall through to next strategy
      }
    } catch {
      // Not resolvable from this base — try next.
    }
  }

  // 2: direct filesystem check in cwd/node_modules.
  const directPath = path.join(cwd, 'node_modules', ...CONSOLE_PACKAGE.split('/'));
  const directPkgJson = path.join(directPath, 'package.json');
  if (fs.existsSync(directPkgJson) && !candidates.includes(directPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(directPkgJson, 'utf-8'));
      if (pkg.name === CONSOLE_PACKAGE && versionOk(directPath, pkg.version)) {
        candidates.push(directPath);
      }
    } catch {
      // Skip invalid package.json
    }
  }

  // 3: sibling-repo dev fallback. Useful when iterating on the Console
  //    source inside `objectui` while running the framework CLI here.
  //    The objectui repo still names its workspace package
  //    `@object-ui/console` (that npm name is now upstream-only — the
  //    framework no longer consumes it as a dep), so we match either
  //    the new vendored name or the historical upstream name.
  for (const candidate of [
    path.resolve(cwd, '../objectui/apps/console'),
    path.resolve(cwd, '../../objectui/apps/console'),
  ]) {
    const pkgPath = path.join(candidate, 'package.json');
    if (!fs.existsSync(pkgPath)) continue;
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (
        (pkg.name === CONSOLE_PACKAGE || pkg.name === '@object-ui/console') &&
        !candidates.includes(candidate)
      ) {
        candidates.push(candidate);
      }
    } catch {
      // Skip invalid package.json
    }
  }

  if (candidates.length === 0) return null;

  // Pass 1: prefer a candidate that actually has a built dist.
  for (const dir of candidates) {
    if (hasConsoleDist(dir)) {
      // Report a dist built from a different objectui SHA than the framework
      // pins — the silent-drift case the npm-major guard above can't see.
      // No-op for published installs / unstamped dists. What happens next is
      // the caller's call: advisory by default, fail-closed under `os dev`.
      const drift = detectConsoleShaDrift(dir);
      if (drift) onDrift(drift);
      return dir;
    }
  }

  // Pass 2: nothing built yet — return the highest-priority candidate so
  // the caller can surface a "console package present but no dist found"
  // warning rather than "console not installed".
  return candidates[0];
}

/**
 * Check whether the Console portal has a pre-built `dist/` directory.
 */
export function hasConsoleDist(consolePath: string): boolean {
  return fs.existsSync(path.join(consolePath, 'dist', 'index.html'));
}

// ─── "No dist" remedy — named for where the server runs ─────────────

/** The framework repo's root script that builds `packages/console/dist`. */
const CONSOLE_BUILD_SCRIPT = 'console:build';

/**
 * The directory whose `package.json` declares `console:build` for this
 * console package, or `null`.
 *
 * Only the NEAREST `package.json` above `consolePath` is asked. In the
 * framework repo that is the root manifest (`packages/` carries none), which
 * declares the script. An installed `@objectstack/console` stops at the
 * consuming project's own manifest — including the pnpm store layout, whose
 * intermediate directories carry none — so a project that merely sits inside
 * a framework checkout is never told to run a script that does not build the
 * console it actually resolved. The signal is the script itself rather than
 * the repo's layout, so the remedy is named only where it exists.
 */
function findConsoleBuildRoot(consolePath: string): string | null {
  let dir = path.dirname(consolePath);
  for (let depth = 0; depth < 8; depth++) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        return typeof pkg?.scripts?.[CONSOLE_BUILD_SCRIPT] === 'string' ? dir : null;
      } catch {
        return null; // unreadable manifest — name the install remedy instead
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * What is missing and what fixes it, for a console package with no built
 * `dist/` — or no console package at all (`consolePath` is `null`) — the ONE
 * remedy picker, which both the boot warning and the HTTP answer render
 * ({@link formatConsoleDistMissingWarning}, {@link createConsoleNotBuiltPlugin}).
 *
 * Three places reach it, and each gets the remedy that works there:
 *
 *   - the framework repo, where `packages/console/dist` is a gitignored build
 *     that `pnpm build` never produces — `pnpm console:build`, run at the
 *     root it was found under (it is a root script, so it does not resolve
 *     from the example directory `pnpm dev` runs in);
 *   - anywhere else, where the Console arrives prebuilt as
 *     `@objectstack/console`, a dependency of `@objectstack/cli` — so the
 *     remedy is that package install. (An installed `@object-ui/console`,
 *     which this text used to name, is never consulted: that name is matched
 *     only as the workspace package of a sibling `../objectui` checkout.)
 *   - an install where `@objectstack/console` did not resolve at all, or only
 *     at a major version this CLI ignores ({@link resolveConsolePath} returned
 *     `null`). That is the same broken install as the arm above, one step
 *     further gone, so it gets the same reinstall sentence; only what is
 *     missing differs. Inside the framework repo the CLI always resolves its
 *     own workspace `packages/console`, so this arm is never reached there.
 *
 * `hostPaths` decides whether the text names absolute paths on this host. The
 * terminal's reader is the operator, who is told exactly where to look. The
 * HTTP answer's reader is whoever requests `/_console/`, with no credential, so
 * that form names no absolute path: the remedy (the script or the package to
 * reinstall) is the same sentence either way, and the repository-relative
 * `packages/console/dist` stays because it is the repository's public layout.
 */
function describeConsoleDistMissing(consolePath: string | null, hostPaths: boolean): string {
  const reinstall =
    `the Console ships prebuilt in \`${CONSOLE_PACKAGE}\`, ` +
    `a dependency of \`@objectstack/cli\`; reinstall it at the same version as the CLI.`;
  if (consolePath === null) return `Console package \`${CONSOLE_PACKAGE}\` not found — ${reinstall}`;
  const dist = path.join(consolePath, 'dist');
  const buildRoot = findConsoleBuildRoot(consolePath);
  if (buildRoot) {
    return (
      `Console dist not found at ${path.relative(buildRoot, dist)} — \`pnpm build\` does not produce it. ` +
      `Build it with \`pnpm ${CONSOLE_BUILD_SCRIPT}\` in ${hostPaths ? buildRoot : 'the root of the ObjectStack checkout this server runs from'} ` +
      `(builds ui/apps/console, then copies its dist into packages/console).`
    );
  }
  return `Console dist not found${hostPaths ? ` at ${dist}` : ''} — ${reinstall}`;
}

/**
 * The boot warning for a console package with no built `dist/`, or for no
 * console package at all (`null`, see {@link describeConsoleDistMissing}).
 */
export function formatConsoleDistMissingWarning(consolePath: string | null): string {
  return `  ⚠ ${describeConsoleDistMissing(consolePath, true)}`;
}

// ─── objectui-SHA Drift Guard (dev monorepo only) ───────────────────

/**
 * The vendored console `dist/` is a locally-built, gitignored artifact
 * rebuilt only by `scripts/build-console.sh` (pnpm objectui:build /
 * objectui:refresh / release) — never by `turbo run build`. When a
 * developer pulls a branch that bumps the framework's `.objectui-sha` pin
 * without re-running `pnpm objectui:build`, the dist stays frozen at the
 * previous objectui commit and would be served silently. The npm-major
 * version guard above can't catch this: the objectui SHA moves underneath a
 * single `@objectstack/console` version.
 *
 * build-console.sh stamps the built SHA into `dist/.objectui-sha`. Here we
 * compare it against the framework's committed `.objectui-sha` pin, located
 * by walking up from the resolved console package. This is inherently a
 * monorepo/dev concern: a published install ships no `.objectui-sha` pin
 * (so the stamped dist is authoritative), and the sibling-repo dev fallback
 * writes no stamp — both cases are skipped silently.
 */
function findObjectuiPin(startDir: string): { pin: string; file: string } | null {
  let dir = startDir;
  for (let depth = 0; depth < 8; depth++) {
    const file = path.join(dir, '.objectui-sha');
    if (fs.existsSync(file)) {
      try {
        const pin = fs.readFileSync(file, 'utf-8').trim();
        return pin ? { pin, file } : null;
      } catch {
        return null; // unreadable pin — fail open
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** A dist proven to be built from a different objectui commit than the pin. */
export interface ConsoleShaDrift {
  /** objectui SHA the dist was built from (`dist/.objectui-sha`). */
  stamp: string;
  /** objectui SHA the repo pins (`<root>/.objectui-sha`). */
  pin: string;
  /** Absolute path of the pin file the comparison used. */
  pinFile: string;
}

/**
 * Compare a resolved console package's dist stamp against the repo pin.
 * Returns `null` for every unprovable case — no monorepo pin (published
 * install), no stamp (pre-guard build or the sibling-repo dev fallback),
 * unreadable files — and only reports drift it can prove.
 */
export function detectConsoleShaDrift(consoleDir: string): ConsoleShaDrift | null {
  const found = findObjectuiPin(consoleDir);
  if (!found) return null; // published install / no monorepo pin — nothing to compare

  const stampFile = path.join(consoleDir, 'dist', '.objectui-sha');
  let stamp: string | null = null;
  try {
    if (fs.existsSync(stampFile)) stamp = fs.readFileSync(stampFile, 'utf-8').trim();
  } catch {
    return null; // unreadable stamp — fail open
  }
  // Unstamped dist: can't prove drift; `pnpm check:console-sha` surfaces it.
  if (!stamp || stamp === found.pin) return null;

  return { stamp, pin: found.pin, pinFile: found.file };
}

/** Advisory one-liner — used where the drifted console is still served. */
export function formatConsoleShaDriftWarning(drift: ConsoleShaDrift): string {
  return (
    `  ⚠ Console version drift: serving @objectstack/console built from objectui@${drift.stamp.slice(0, 12)}, ` +
    `but ${drift.pinFile} pins objectui@${drift.pin.slice(0, 12)}. ` +
    `packages/console/dist is a gitignored local build that 'turbo run build' does not refresh — ` +
    `rebuild it with 'pnpm objectui:build'.`
  );
}

/**
 * What the drift refusal says below its headline — the two SHAs, why the stale
 * build is refused, the remedy and the escape hatch. The ONE text both the
 * refusal block ({@link formatConsoleShaDriftRefusal}) and the HTTP answer
 * ({@link createConsoleShaDriftRefusalPlugin}) render, so the two cannot name
 * different fixes.
 *
 * `hostPaths` decides whether the pin file is named by its absolute path on
 * this host, by the rule {@link describeConsoleDistMissing} states: the
 * terminal's reader is the operator, the HTTP answer's reader is whoever
 * requests `/_console/`, with no credential. The SHAs stay in both: they name
 * commits of the public objectui repository, not anything about this host.
 */
function describeConsoleShaDrift(drift: ConsoleShaDrift, hostPaths: boolean): string {
  const pinFile = hostPaths ? drift.pinFile : '.objectui-sha at the checkout root';
  return (
    `      pinned  (${pinFile}):              objectui@${drift.pin.slice(0, 12)}\n` +
    `      built   (console/dist/.objectui-sha): objectui@${drift.stamp.slice(0, 12)}\n\n` +
    `    packages/console/dist is a gitignored local build that 'turbo run build' does NOT refresh,\n` +
    `    so this server would serve a Console SPA the repo no longer pins — and anything you\n` +
    `    observed in it would describe a different objectui commit.\n\n` +
    `    Rebuild the console at the pinned SHA:\n\n` +
    `        pnpm objectui:build\n\n` +
    `    (Use 'pnpm objectui:refresh' only when you intend to move the pin to your local ../objectui HEAD.)\n` +
    `    To boot anyway with the stale bundle: ${DRIFT_OVERRIDE_ENV}=1 — the API still serves either way.\n`
  );
}

/**
 * The refusal block — `os dev` declines to mount a drifted console. Mirrors
 * the remediation of `scripts/check-console-sha.mjs` verbatim (rebuild at the
 * *pinned* SHA with `pnpm objectui:build`; `objectui:refresh` would re-bump
 * the pin to the local ../objectui HEAD, which is the opposite of the fix).
 */
export function formatConsoleShaDriftRefusal(drift: ConsoleShaDrift): string {
  return `\n  ✗ Console version drift — refusing to serve /_console in dev.\n\n${describeConsoleShaDrift(drift, true)}`;
}

/** Env switch that downgrades the dev refusal back to a warning. */
export const DRIFT_OVERRIDE_ENV = 'OS_ALLOW_CONSOLE_DRIFT';

function driftOverridden(env: NodeJS.ProcessEnv): boolean {
  const v = String(env[DRIFT_OVERRIDE_ENV] ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/**
 * Decide whether the Console SPA may mount, given what resolution found.
 *
 * The drift guard has two seats and this is the second one. The first —
 * `pnpm check:console-sha` — is wired into the root `pnpm dev` /
 * `dev:showcase` / `dev:crm` / `dev:todo` scripts, and every boot that does
 * not go through those scripts misses it: `objectstack dev` run directly in
 * an example dir, an example's own `dev` script, a `.claude/launch.json`
 * config, `pnpm exec objectstack dev`. That is how a QA sweep came to measure
 * a console two days behind the pin (#7752) — the pin had moved, the local
 * dist had not, and the boot path carried no guard. So the dev server itself
 * refuses to mount a console it can prove is not a build of the pin: the
 * stale bundle is unreachable rather than silently authoritative, and the API
 * keeps serving so api/cli work is unaffected.
 *
 * Scope is deliberately narrow — `isDev` only, and only on proven drift
 * (see `detectConsoleShaDrift`). Published installs carry no pin, so no
 * production or cloud deployment can reach the refusal.
 */
export function decideConsoleMount(input: {
  /** Whether the resolved package has a built `dist/index.html`. */
  hasDist: boolean;
  /** Proven drift, or null. */
  drift: ConsoleShaDrift | null;
  /** True under `objectstack dev` (`serve --dev`). */
  isDev: boolean;
  /** Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
}): { mount: boolean; refusedForDrift: boolean } {
  const { hasDist, drift, isDev } = input;
  if (!hasDist) return { mount: false, refusedForDrift: false };
  if (drift && isDev && !driftOverridden(input.env ?? process.env)) {
    return { mount: false, refusedForDrift: true };
  }
  return { mount: true, refusedForDrift: false };
}

// ─── Plugin Factory ─────────────────────────────────────────────────

/**
 * Resolve the `http.server` service from a plugin context, tolerating both
 * ways it can be registered:
 *
 *   - **synchronously** — the runtime `serve` path, where `Runtime` registers
 *     the concrete server instance; and
 *   - as an **async factory** — the console / schema-migration boot path,
 *     for which the *synchronous* `getService` throws
 *     `Service 'http.server' is async - use await`. Without this the throw
 *     escaped these static-asset plugins' `start()` and aborted kernel
 *     bootstrap (`com.objectstack.runtime-assets` failed to start), taking
 *     down the CONSOLE/migration boot entirely.
 *
 * Prefer the async accessor (`getServiceAsync`, which resolves either kind),
 * falling back to the sync one — mirroring plugin-auth's async `cache` lookup.
 * Never throws: an unavailable server resolves to `undefined`, so these
 * optional static-asset plugins skip cleanly instead of crashing boot.
 */
async function resolveHttpServer(ctx: any): Promise<any> {
  try {
    const svc = await ctx.getServiceAsync?.('http.server');
    if (svc) return svc;
  } catch {
    // fall through to the synchronous accessor
  }
  try {
    return ctx.getService?.('http.server');
  } catch {
    return undefined;
  }
}

// ─── Console static-file caching ────────────────────────────────────

/**
 * `cache-control` for a console file whose NAME carries its content hash
 * ({@link isContentHashedConsoleAsset}). Its bytes can never change under that
 * name, so the browser keeps it for a year and never revalidates it. A rebuild
 * that changes the bytes emits a new name, and the HTML shell, which is always
 * revalidated, points at the new name.
 */
const HASHED_ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/**
 * `cache-control` for every other non-HTML console file. These names are copied
 * into the build unchanged, so the next console release can ship different
 * bytes under the same name. objectui copies maplibre's `maplibre-gl-worker.mjs`
 * and `maplibre-gl-shared.mjs` into `assets/` this way, and `favicon.svg` and
 * the root JSON files are `public/` copies. The short lifetime limits how long
 * an upgraded deployment can leave a browser on the old bytes. The `etag` sent
 * with it ({@link contentEtag}) turns each revalidation into a `304` instead of
 * a full download.
 */
const STABLE_FILE_CACHE_CONTROL = 'public, max-age=300';

/**
 * Vite's name for an emitted file: `assets/[name]-[hash][extname]`, its default
 * `chunkFileNames` and `assetFileNames`. The hash is 8 characters of rollup's
 * base64url alphabet, so `-` and `_` can appear inside it
 * (`vendor-icon-calendar-sync-Ccwp9IC-.js`).
 */
const CONTENT_HASHED_ASSET_NAME = /^[^/]+-([A-Za-z0-9_-]{8})\.[A-Za-z0-9]+$/;

/**
 * Whether a console dist file is a content-hashed build output. It is judged
 * from the dist-relative path alone: the file sits directly under `assets/`, is
 * named `<name>-<hash>.<ext>`, and the hash contains at least one uppercase
 * letter, digit or `_`.
 *
 * The rule comes from a real build, not from memory. Measured over the
 * published dist of `@objectstack/console@17.7.0` (2457 files under `assets/`),
 * it matches all 2455 hashed chunks and neither stable-named file
 * (`maplibre-gl-worker.mjs`, `maplibre-gl-shared.mjs`).
 *
 * The character condition narrows the match. Going by shape alone, an
 * eight-letter lowercase word after a dash (`-renderer.js`) looks like a hash,
 * and a stable file mistaken for a hashed one stays pinned in browsers for a
 * year. Every measured hash contains such a character. A real hash that
 * happens not to is only revalidated like a stable file; it is never served
 * stale.
 */
function isContentHashedConsoleAsset(distRelativePath: string): boolean {
  const segments = distRelativePath.split('/').filter(Boolean);
  if (segments.length !== 2 || segments[0] !== 'assets') return false;
  const match = CONTENT_HASHED_ASSET_NAME.exec(segments[1]);
  return match !== null && /[A-Z0-9_]/.test(match[1]);
}

/**
 * A strong `etag` computed from the file's BYTES. ⛔ It is not computed from
 * the file's stat, because the stat records how the dist was laid down, not
 * what it contains. Measured on `@objectstack/console@17.7.0`: `npm install`
 * stamps every file with the install time, but plain `tar` extraction of the
 * same tarball keeps npm's fixed pack mtime (1985-10-26T08:15:00Z, on every
 * file). Under `tar`, two releases' different `maplibre-gl-worker.mjs` would
 * carry the same `last-modified`, and a validator built from the stat would
 * answer `304` for bytes the browser has never seen.
 */
function contentEtag(content: Buffer): string {
  return `"${createHash('sha256').update(content).digest('base64url')}"`;
}

/**
 * RFC 9110 §13.1.2: `If-None-Match` hits on `*` or on any listed tag, using
 * weak comparison.
 */
function ifNoneMatchHits(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header.split(',').some((candidate) => {
    const tag = candidate.trim();
    return tag === '*' || tag.replace(/^W\//, '') === etag;
  });
}

/**
 * The env var an operator names extra `connect-src` sources in, separated by
 * whitespace: a scheme (`https:`) or a scheme with a host
 * (`https://tiles.example.com`, `wss://*.example.com:8443/path/`). The Console
 * fetches a map view's authored `mapStyle` (and the tiles, sprites and glyphs
 * it names) straight from that host, and the server cannot know those hosts
 * ahead of the request.
 */
const CONSOLE_CSP_CONNECT_SRC_ENV = 'OS_CONSOLE_CSP_CONNECT_SRC';

/**
 * One source the operator may name in {@link CONSOLE_CSP_CONNECT_SRC_ENV}. The
 * character set leaves out whitespace, `;`, `,` and quotes, so a value can add
 * a source and nothing else: never a keyword such as `'unsafe-inline'`, and
 * never a second directive.
 */
const CONNECT_SOURCE = /^(?:https?|wss?):(?:\/\/(?:\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*(?::(?:\d{1,5}|\*))?(?:\/[a-z0-9._~!$&()*+=:@%/-]*)?)?$/i;

/** The sources named in {@link CONSOLE_CSP_CONNECT_SRC_ENV}; a malformed one refuses the boot. */
function readExtraConnectSources(env: NodeJS.ProcessEnv): string[] {
  const sources = String(env[CONSOLE_CSP_CONNECT_SRC_ENV] ?? '').split(/\s+/).filter(Boolean);
  const malformed = sources.filter((source) => !CONNECT_SOURCE.test(source));
  if (malformed.length > 0) {
    throw new Error(
      `${CONSOLE_CSP_CONNECT_SRC_ENV} names ${malformed.map((m) => JSON.stringify(m)).join(', ')}, which is not a `
      + 'connect-src source this server accepts. Name each source as a scheme (https:) or as a scheme and host '
      + '(https://tiles.example.com), separated by spaces.',
    );
  }
  return sources;
}

/**
 * The default map style the Console's map view loads when the view names none
 * (objectui `plugin-map`, `DEFAULT_MAP_STYLE`). Its style, tiles and glyphs are
 * all on this host.
 */
const DEFAULT_MAP_STYLE_ORIGIN = 'https://demotiles.maplibre.org';

/**
 * The `content-security-policy` the Console document is served with. Each
 * allowance below was measured against the published Console build: its
 * `index.html`, its `assets/` and the objectui source that produced them.
 *
 * - `script-src 'self' 'nonce-…'` is the boundary this policy exists for. The
 *   Console keeps its session token where any script on the page can read it,
 *   so only the build's own files and the document's own inline scripts (the
 *   early-branding, process-polyfill, crypto-shim and boot-splash scripts, and
 *   the server's react-pages disable global) may run: a script element that
 *   markup injected later carries no nonce, and an inline event handler never
 *   matches one. No public CDN is listed. A CDN host in `script-src` admits
 *   every file that CDN serves, so the Studio's Monaco editor, which loads its
 *   core from jsdelivr, shows its built-in plain-text fallback under this
 *   policy instead.
 * - `'wasm-unsafe-eval'`: the AI chat's code blocks are highlighted by shiki,
 *   whose grammar engine is WebAssembly compiled in the page. It permits
 *   compiling WebAssembly and nothing else; JavaScript `eval` stays refused.
 * - `'unsafe-eval'` only while the `kind:'react'` page tier is on (ADR-0081;
 *   on unless `OS_PAGE_REACT=off`). That runtime evaluates the author's
 *   transpiled page source with `Function`, which nothing but `'unsafe-eval'`
 *   permits. With the tier off, the policy refuses it.
 * - `style-src 'self' 'unsafe-inline'`: the document's own `<style>` (the boot
 *   splash), the `style` attributes React and Radix write on every positioned
 *   element, and the `<style>` elements that toasts, maps and diagrams insert
 *   at run time, which carry no nonce.
 * - `img-src 'self' data: blob: https:`: the stylesheets' inline SVG icons
 *   (`data:`), previews of files picked for upload (`blob:`), and images whose
 *   host is data, not code: branding logos and favicons, avatars, image field
 *   values, and images inside an email template preview.
 * - `connect-src`: the server itself (`'self'`, which also covers the
 *   same-origin realtime WebSocket and the metadata event stream), the default
 *   map style's host, the error-reporting endpoint when the runtime serves a
 *   DSN (`telemetry.errorReporting.dsn` from `GET /api/v1/runtime/config`), and
 *   the hosts an operator names in `OS_CONSOLE_CSP_CONNECT_SRC`.
 * - `default-src 'self'` covers the rest the Console uses: the module workers
 *   maplibre starts from its own file, the PWA manifest, and the same-origin
 *   frames (the Studio's live canvas). The build ships no web fonts.
 * - `object-src 'none'` and `base-uri 'self'`: no plugins, and only the
 *   server's own `<base href>`.
 * - `frame-ancestors 'self'`, except on the public form page: the Console's
 *   public-forms screen hands authors an `<iframe>` snippet to embed that page
 *   on their own site, so it keeps loading in any frame.
 */
function consoleContentSecurityPolicy(input: {
  nonce: string;
  reactPages: boolean;
  errorReportingOrigin: string | undefined;
  extraConnectSources: readonly string[];
  embeddable: boolean;
}): string {
  const scriptSrc = ["'self'", `'nonce-${input.nonce}'`, "'wasm-unsafe-eval'"];
  if (input.reactPages) scriptSrc.push("'unsafe-eval'");
  const connectSrc = ["'self'", DEFAULT_MAP_STYLE_ORIGIN];
  if (input.errorReportingOrigin !== undefined) connectSrc.push(input.errorReportingOrigin);
  connectSrc.push(...input.extraConnectSources);
  const directives: string[][] = [
    ['default-src', "'self'"],
    ['script-src', ...scriptSrc],
    ['style-src', "'self'", "'unsafe-inline'"],
    ['img-src', "'self'", 'data:', 'blob:', 'https:'],
    ['connect-src', ...new Set(connectSrc)],
    ['object-src', "'none'"],
    ['base-uri', "'self'"],
  ];
  if (!input.embeddable) directives.push(['frame-ancestors', "'self'"]);
  return directives.map((directive) => directive.join(' ')).join('; ');
}

/**
 * Every `<script>` start tag in `html` with `nonce` added, unless it already
 * carries one. Only start tags match: `</script>` and escaped text do not.
 */
function stampScriptNonce(html: string, nonce: string): string {
  return html.replace(/<script\b(?![^>]*\snonce=)/gi, (tag) => `${tag} nonce="${nonce}"`);
}

/**
 * Create a lightweight kernel plugin that serves the pre-built Console
 * portal static files at `/_console/*`.
 *
 * SPA-fallback semantics:
 *   - `index.html` is read fresh on every fallback hit (so a rebuild
 *     producing new hashed asset names doesn't leave the browser
 *     pointing at stale URLs).
 *   - Hashed asset paths under `/_console/assets/*` never SPA-fallback —
 *     a real 404 surfaces a rebuild/deploy mismatch instead of the
 *     dreaded "asset returns text/html" silent failure.
 *
 * Caching, per file: a content-hashed build output is `immutable` for a
 * year; every other non-HTML file gets a short lifetime and a content `etag`
 * answered with `304`; HTML (the shell and the SPA fallback) carries neither,
 * so the browser fetches it again every time.
 *
 * The HTML is written per request: besides the `<base>` tag, its `<title>`,
 * description and Open Graph tags carry the runtime branding this request is
 * served by `GET /api/v1/runtime/config` (`readShellConfig`,
 * `writeBrandedHead`), so a link preview, which runs no script, shows the
 * product's name.
 *
 * Every HTML answer carries a `content-security-policy` header with a fresh
 * script nonce, and every `<script>` the build ships is stamped with it
 * (`consoleContentSecurityPolicy`, `stampScriptNonce`). This plugin is the one
 * place the document is served from: `os dev` and `os start` (and the Docker
 * image, whose command is `os start`) all spawn `os serve`, which mounts it.
 *
 * It also answers the path an author writes as a public form's
 * `sharing.publicLink`: `GET /forms/<slug>` redirects (302) to the Console's
 * public form page, `/_console/f/<slug>` with the request's query string, when
 * the anonymous form door serves that slug, and otherwise gets the same
 * not-found answer as before. Mounted
 * only with the Console, because without it there is no page to send anyone to.
 */
export function createConsoleStaticPlugin(distPath: string, options?: { isDev?: boolean; rootRedirect?: boolean }) {
  return {
    name: 'com.objectstack.console-static',

    init: async () => {},

    start: async (ctx: any) => {
      const httpServer = await resolveHttpServer(ctx);
      if (!httpServer?.getRawApp) {
        ctx.logger?.warn?.('Console static: http.server service not found — skipping');
        return;
      }

      const app = httpServer.getRawApp();
      const absoluteDist = path.resolve(distPath);
      // Read once, at boot: a malformed value refuses here, loudly, rather
      // than reaching the header of every document.
      const extraConnectSources = readExtraConnectSources(process.env);

      const indexPath = path.join(absoluteDist, 'index.html');
      if (!fs.existsSync(indexPath)) {
        ctx.logger?.warn?.(`Console static: dist not found at ${absoluteDist}`);
        return;
      }

      // The `kind:'react'` page tier (executes author JS in the main React
      // tree) is ON by default. A deployment that does not trust its page
      // authors turns it off with `OS_PAGE_REACT=off`; we then inject the
      // disable global the console's capability gate reads. Read per request
      // (env can change without a rebuild — index.html is re-read on every
      // fallback hit too).
      const reactPagesDisabled = (): boolean => {
        const v = String(process.env.OS_PAGE_REACT ?? '').trim().toLowerCase();
        return v === 'off' || v === '0' || v === 'false' || v === 'no' || v === 'disabled';
      };

      // A runtime-config read that fails leaves the shell's head as the build
      // shipped it, which is a smaller page, not a broken one: said once, at
      // `warn`.
      let reportedShellConfigReadFailure = false;
      const reportShellConfigReadFailure = (cause: string) => {
        if (reportedShellConfigReadFailure) return;
        reportedShellConfigReadFailure = true;
        ctx.logger?.warn?.(
          `Console static: the branding read from ${RUNTIME_CONFIG_DOOR} failed (${cause}), so the console `
          + 'document is served without its server-written title, description and Open Graph tags, and link '
          + 'previews show a blank title. Its content-security-policy does not name a configured error-reporting '
          + 'endpoint either, so browser error reports from that page are blocked. The page itself still loads '
          + 'and sets its title in the browser. Reported once; every later console document retries the read.',
        );
      };

      const readIndexHtml = (reactPages: boolean, nonce: string): string => {
        const raw = fs.readFileSync(indexPath, 'utf-8');
        // Inject <base href="${CONSOLE_PATH}/"> so:
        //   1. Relative asset URLs ('./assets/...') resolve to the
        //      correct mount path regardless of where the user navigated.
        //   2. The SPA can derive its React Router basename from
        //      `document.baseURI` at runtime, freeing the published
        //      build from being pinned to a specific mount.
        //
        // Idempotent — bails if the build already shipped a <base>.
        let html = raw;
        if (!/<base\s/i.test(html)) {
          const baseTag = `<base href="${CONSOLE_PATH}/">`;
          html = html.replace(/<head(\s[^>]*)?>/i, (m) => `${m}\n    ${baseTag}`);
        }
        if (!reactPages) {
          const capTag =
            `<script>window.__OBJECTUI_CAPABILITIES_DISABLED__=(window.__OBJECTUI_CAPABILITIES_DISABLED__||[]).concat('react-pages');</script>`;
          html = html.replace(/<head(\s[^>]*)?>/i, (m) => `${m}\n    ${capTag}`);
        }
        // Stamped while the document holds only the build's markup and the
        // server's own tags: nothing read at request time is written yet, so
        // no runtime value can ever carry the nonce.
        return stampScriptNonce(html, nonce);
      };

      const serveDocument = async (c: any, reqPath: string): Promise<Response> => {
        const nonce = randomBytes(16).toString('base64');
        // One read per document, so the injected disable global and the
        // policy's `'unsafe-eval'` always agree.
        const reactPages = !reactPagesDisabled();
        const html = readIndexHtml(reactPages, nonce);
        const shell = await readShellConfig(app, c, reportShellConfigReadFailure);
        const policy = consoleContentSecurityPolicy({
          nonce,
          reactPages,
          errorReportingOrigin: shell?.errorReportingOrigin,
          extraConnectSources,
          embeddable: reqPath.startsWith(`${PUBLIC_FORM_PAGE}/`),
        });
        // The title, description and Open Graph tags, written here because a
        // link-preview crawler runs no script: the early-branding script sets
        // the same title in the browser, from the same door.
        return new Response(writeBrandedHead(html, shell?.branding, requestOrigin(c)), {
          headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': policy },
        });
      };

      // The Console is the default end-user surface — root `/` redirects
      // here whenever the Console is mounted (`rootRedirect !== false`).
      // The CLI's serve.ts gates whether the Console mounts at all via
      // `--no-console` / `OS_DISABLE_CONSOLE=1`; once mounted, claiming
      // `/` is the intended behaviour in both dev and production
      // deployments.
      if (options?.rootRedirect !== false) {
        app.get('/', (c: any) => c.redirect(`${CONSOLE_PATH}/`));
      }

      // Redirect bare path to trailing-slash (SPA convention)
      app.get(CONSOLE_PATH, (c: any) => c.redirect(`${CONSOLE_PATH}/`));

      // The path an author writes as a public form's `sharing.publicLink`
      // (`/forms/<slug>`) is served by the Console at `/f/<slug>`. Redirect it
      // there only when the anonymous form door serves that slug to this
      // request; anything else falls through to the unmatched-request answer
      // every other unrouted path gets.
      //
      // The request's query string travels with it: the public form page reads
      // `?prefill_<field>=` to seed its fields, so a link that carries one must
      // land with it. The path is built from `CONSOLE_PATH` and the encoded
      // slug alone; the query, as the URL parser holds it (it cannot carry a
      // `#`, a control character or a path), is appended after it, so it can
      // change nothing but the query of the page the visitor lands on.
      app.get('/forms/:slug', async (c: any, next: () => Promise<void>) => {
        const slug = String(c.req.param('slug') ?? '');
        if (slug && (await anonymousFormDoorServes(app, c, slug))) {
          const query = new URL(c.req.url).search;
          return c.redirect(`${CONSOLE_PATH}${PUBLIC_FORM_PAGE}/${encodeURIComponent(slug)}${query}`, 302);
        }
        await next();
      });

      // Serve static files with SPA fallback
      app.get(`${CONSOLE_PATH}/*`, async (c: any) => {
        const reqPath = c.req.path.substring(CONSOLE_PATH.length) || '/';
        const filePath = path.join(absoluteDist, reqPath);

        // Security: prevent path traversal
        if (!filePath.startsWith(absoluteDist)) {
          return c.text('Forbidden', 403);
        }

        // Try serving the exact file (HTML files go through the base-tag
        // injection path so all entry points stay path-portable).
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          if (filePath.endsWith('.html')) return serveDocument(c, reqPath);
          const content = fs.readFileSync(filePath);
          if (isContentHashedConsoleAsset(reqPath)) {
            return new Response(content, {
              headers: { 'content-type': mimeType(filePath), 'cache-control': HASHED_ASSET_CACHE_CONTROL },
            });
          }
          const etag = contentEtag(content);
          const validated = { 'cache-control': STABLE_FILE_CACHE_CONTROL, etag };
          if (ifNoneMatchHits(c.req.header('if-none-match'), etag)) {
            return new Response(null, { status: 304, headers: validated });
          }
          return new Response(content, {
            headers: { 'content-type': mimeType(filePath), ...validated },
          });
        }

        // Hashed-asset paths must never SPA-fallback.
        if (reqPath.startsWith('/assets/')) {
          return c.text('Not Found', 404);
        }

        // SPA fallback
        return serveDocument(c, reqPath);
      });

      // Suppress unused-parameter lint when isDev isn't needed.
      void options;
    },
  };
}

/**
 * The ONE route-mounting body for a Console that `os serve` decided not to
 * serve: what `/_console/` answers instead of the router's bare 404. Mounted in
 * place of {@link createConsoleStaticPlugin} by the responder for each refused
 * position — {@link createConsoleNotBuiltPlugin} (no built `dist/`, or no
 * console package) and {@link createConsoleShaDriftRefusalPlugin} (a dev build
 * that is not the repo's pin). Each responder brings its `answer`, rendered from
 * the same text its boot message prints; this body decides nothing about it.
 *
 * Without a responder nothing was mounted, so `GET /_console/` got the router's
 * bare `ENDPOINT_NOT_FOUND` and `GET /` an empty 404: a refused Console read
 * exactly like a wrong URL, and only the terminal said why (AGENTS.md, Route &
 * surface ownership rule 3, "Absence must be loud"). It mounts the same three
 * routes the static plugin would, so who owns each path does not change with
 * the build:
 *
 *   - `GET /` and `GET /_console` redirect to `/_console/`, as they do once the
 *     Console is served — so `/` keeps one owner and one answer, the Console's;
 *   - `GET /_console/*` answers `503` with the responder's `text/plain` answer.
 *
 * `503`, not `404`: the address is right and the server is missing a Console
 * build it can serve, which the operator fixes and a caller cannot — and a
 * caller reading only the status still tells it apart from a wrong URL. Plain
 * text rather than a JSON envelope: these are the Console's static-asset
 * routes, not API surface (`console-route-ledger.ts`), read by a browser or by
 * `curl`. `no-store`, so a browser never keeps the answer past the restart that
 * serves the real Console.
 *
 * `--no-ui` and `--no-console` mount none of this: the operator chose to serve
 * no Console, and those routes stay the router's 404.
 */
function createConsoleUnavailablePlugin(name: string, what: string, answer: string) {
  return {
    name,

    init: async () => {},

    start: async (ctx: any) => {
      const httpServer = await resolveHttpServer(ctx);
      if (!httpServer?.getRawApp) {
        ctx.logger?.warn?.(`Console ${what} answer: http.server service not found — skipping`);
        return;
      }

      const app = httpServer.getRawApp();
      app.get('/', (c: any) => c.redirect(`${CONSOLE_PATH}/`));
      app.get(CONSOLE_PATH, (c: any) => c.redirect(`${CONSOLE_PATH}/`));
      app.get(`${CONSOLE_PATH}/*`, (c: any) => c.text(answer, 503, { 'cache-control': 'no-store' }));
    },
  };
}

/**
 * The responder for a console package with no built `dist/`, or with no
 * console package at all (`consolePath` is `null`): mounted by `os serve` on
 * the boot that prints {@link formatConsoleDistMissingWarning}. Its answer says
 * the Console is not built (or not installed), then the remedy
 * {@link describeConsoleDistMissing} picked for the warning, rendered without
 * host paths. The routes are {@link createConsoleUnavailablePlugin}'s.
 */
export function createConsoleNotBuiltPlugin(consolePath: string | null) {
  const answer =
    `The ObjectStack Console is ${consolePath === null ? 'not installed' : 'not built'}, ` +
    `so this server has no Console to serve at ${CONSOLE_PATH}/.\n\n` +
    `${describeConsoleDistMissing(consolePath, false)}\n\n` +
    'Then restart the server. The API is served either way.\n';
  return createConsoleUnavailablePlugin('com.objectstack.console-not-built', 'not-built', answer);
}

/**
 * The responder for a dev boot that refused a drifted Console
 * ({@link decideConsoleMount} answered `refusedForDrift`): mounted by `os serve`
 * on the boot that prints {@link formatConsoleShaDriftRefusal}. Its answer says
 * the Console's build is not the repo's pin, then the refusal's own text
 * ({@link describeConsoleShaDrift}) without the pin file's absolute path. The
 * routes are {@link createConsoleUnavailablePlugin}'s.
 */
export function createConsoleShaDriftRefusalPlugin(drift: ConsoleShaDrift) {
  const answer =
    `The ObjectStack Console here was built from a different objectui commit than this checkout pins, ` +
    `so this dev server refuses to serve it at ${CONSOLE_PATH}/.\n\n` +
    `${describeConsoleShaDrift(drift, false)}\n` +
    'Then restart the server.\n';
  return createConsoleUnavailablePlugin('com.objectstack.console-sha-drift-refused', 'drift-refusal', answer);
}

// ─── Runtime Assets Plugin ──────────────────────────────────────────

/** The URL prefix the runtime assets route is mounted under. */
const RUNTIME_ASSETS_URL_PREFIX = '/runtime/assets/';

/**
 * Where the host found the directory it handed {@link createRuntimeAssetsPlugin}:
 * named by `OS_RUNTIME_ASSETS_DIR`, or the `<cwd>/assets` default taken because
 * that variable is unset. Only the boot warning reads it, to name the remedy.
 * Not exported: this module's export set is pinned
 * (`test/published-subpath-console.pin.test.ts`), and the union is spelled out
 * structurally in the plugin's signature.
 */
type RuntimeAssetsDirSource = 'OS_RUNTIME_ASSETS_DIR' | 'cwd';

/**
 * The ONE resolution of a `/runtime/assets/:filename` parameter to a path on
 * disk. The route serves through it and the boot check judges through it
 * (#22071), so the two cannot disagree about which file a name means or which
 * names are refused. `null` means the name escapes `assetsDir`, which the route
 * answers 403.
 */
function resolveRuntimeAssetPath(assetsDir: string, filename: string): string | null {
  const filePath = path.join(assetsDir, filename.replace(/[/\\]+/g, ''));
  // Path-traversal guard: reject any path that escapes assetsDir.
  if (!path.resolve(filePath).startsWith(path.resolve(assetsDir))) return null;
  return filePath;
}

/**
 * Whether the route answers 200 for this `:filename`: the same resolution, then
 * what the route's `readFileSync` needs, a readable regular file. A directory,
 * a missing file and a refused name all answer no.
 */
function runtimeAssetIsServable(assetsDir: string, filename: string): boolean {
  const filePath = resolveRuntimeAssetPath(assetsDir, filename);
  if (filePath === null) return false;
  try {
    if (!fs.statSync(filePath).isFile()) return false;
    fs.accessSync(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * What a branding URL asks the runtime assets route for, read the way a browser
 * resolves an `<img src>` on this origin (dot segments, query and fragment
 * removed). `undefined` when the value is not this route's URL: an absolute or
 * protocol-relative URL, a data URI, a relative path or any other root path
 * names something this plugin does not serve, so it is not checked.
 * `filename: null` is a path below a subdirectory, which the route's single
 * `:filename` segment never matches.
 */
function runtimeAssetRequest(value: unknown): { url: string; filename: string | null } | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  // A root path only: a relative one resolves against the console page, not `/`.
  if (!trimmed.startsWith('/')) return undefined;
  const thisOrigin = 'http://runtime-assets.invalid';
  let resolved: URL;
  try {
    resolved = new URL(trimmed, thisOrigin);
  } catch {
    return undefined;
  }
  // `//host/…`, and `/\host/…` which a browser reads the same way, name another host.
  if (resolved.origin !== thisOrigin) return undefined;
  const pathname = resolved.pathname;
  if (!pathname.startsWith(RUNTIME_ASSETS_URL_PREFIX)) return undefined;
  const segment = pathname.slice(RUNTIME_ASSETS_URL_PREFIX.length);
  if (segment === '') return undefined;
  if (segment.includes('/')) return { url: pathname, filename: null };
  // The route reads its parameter decoded; an undecodable one stays raw here.
  let filename = segment;
  try {
    filename = decodeURIComponent(segment);
  } catch {
    /* keep the raw segment */
  }
  return { url: pathname, filename };
}

/** The branding keys whose value the console draws as an image URL. */
const BRANDING_IMAGE_KEYS = ['logo', 'favicon'] as const;

/**
 * The apps the console is served: the same `protocol.getMetaItems({ type:
 * 'app' })` read `GET /api/v1/meta/app` answers from, which the console's app
 * list and chrome (logo, favicon) are drawn from. It covers config boots and
 * artifact boots alike, because both register their apps with that protocol.
 */
async function readServedApps(ctx: any): Promise<any[]> {
  const protocol = ctx.getService('protocol');
  if (typeof protocol?.getMetaItems !== 'function') return [];
  const answer = await protocol.getMetaItems({ type: 'app' });
  const items = Array.isArray(answer) ? answer : answer?.items;
  return Array.isArray(items) ? items : [];
}

/**
 * One line per branding URL under `/runtime/assets/` that this boot will not
 * serve, naming every app and key that uses it, the file, the directory
 * searched, `OS_RUNTIME_ASSETS_DIR`, and whether that directory exists at all.
 * Empty when every such URL resolves to a servable file.
 */
function describeUnservedBrandingAssets(
  apps: any[],
  assetsDir: string,
  mounted: boolean,
  dirSource: RuntimeAssetsDirSource,
): string[] {
  const unserved = new Map<string, { filename: string | null; uses: Map<string, string[]> }>();
  for (const app of apps) {
    const appName = String(app?.name ?? app?.id ?? '(unnamed)');
    for (const key of BRANDING_IMAGE_KEYS) {
      const request = runtimeAssetRequest(app?.branding?.[key]);
      if (!request) continue;
      if (mounted && request.filename !== null && runtimeAssetIsServable(assetsDir, request.filename)) continue;
      const entry = unserved.get(request.url) ?? { filename: request.filename, uses: new Map<string, string[]>() };
      entry.uses.set(appName, [...(entry.uses.get(appName) ?? []), `branding.${key}`]);
      unserved.set(request.url, entry);
    }
  }

  const searched = dirSource === 'OS_RUNTIME_ASSETS_DIR'
    ? `${assetsDir} (named by OS_RUNTIME_ASSETS_DIR)`
    : `${assetsDir} (the <cwd>/assets default, since OS_RUNTIME_ASSETS_DIR is unset)`;
  const lines: string[] = [];
  for (const [url, { filename, uses }] of unserved) {
    const users = [...uses].map(([appName, keys]) => `app '${appName}' (${keys.join(', ')})`).join(' and ');
    const file = filename ?? url.slice(RUNTIME_ASSETS_URL_PREFIX.length);
    const reason = !mounted
      ? `the directory searched, ${searched}, does not exist, so ${RUNTIME_ASSETS_URL_PREFIX} is not mounted this run`
      : filename === null
        ? `${RUNTIME_ASSETS_URL_PREFIX} serves only files directly inside the directory searched, ${searched}, never a subdirectory`
        : `${file} is not a readable file in the directory searched, ${searched}`;
    const remedy = filename === null
      ? `move the file to the top of that directory and drop the subdirectory from the URL, or set OS_RUNTIME_ASSETS_DIR to a directory that holds it at the top`
      : `put ${file} in that directory${mounted ? '' : ' and restart'}, or set OS_RUNTIME_ASSETS_DIR to the directory that holds it`;
    lines.push(
      `Branding asset not served: ${users} → ${url}, but ${reason}; the console will draw a broken image. To fix, ${remedy}.`,
    );
  }
  return lines;
}

/**
 * Create a plugin that serves static runtime assets at /runtime/assets/*.
 * Decoupled from the console plugin so branding assets (logos, favicons) are
 * served even when the console dist hasn't been built yet.
 *
 * The `distPath` should point at the host project's `runtime/assets` directory
 * (i.e. `path.resolve(process.cwd(), 'assets')` when the CLI cwd is the
 * `runtime/` package); `dirSource` says which of the two it came from.
 *
 * When the directory is absent the route is not mounted. Either way, once the
 * boot has settled (`kernel:bootstrapped`), every loaded app's `branding.logo`
 * / `branding.favicon` that names a file under `/runtime/assets/` which this
 * route will not serve is reported ONCE, through this plugin's logger at
 * `warn` (#22071): an artifact booted outside its project directory otherwise
 * drew a broken logo and favicon with nothing said on either side. That is the
 * one channel: under `serve`'s boot-quiet window the line is replayed in the
 * banner's *Boot diagnostics* block, and at `--log-level debug|info` it streams
 * live. It changes nothing about what the route serves.
 */
export function createRuntimeAssetsPlugin(distPath: string, dirSource: 'OS_RUNTIME_ASSETS_DIR' | 'cwd') {
  return {
    name: 'com.objectstack.runtime-assets',

    init: async () => {},

    start: async (ctx: any) => {
      const httpServer = await resolveHttpServer(ctx);
      if (!httpServer?.getRawApp) return;

      const app = httpServer.getRawApp();
      const assetsDir = path.resolve(distPath);
      const mounted = fs.existsSync(assetsDir);

      // After every `kernel:ready` handler has settled, so an app a later
      // plugin registers on that hook is read too. A best-effort report: it
      // must never fail the boot it reports on.
      ctx.hook('kernel:bootstrapped', async () => {
        let apps: any[];
        try {
          apps = await readServedApps(ctx);
        } catch (err: any) {
          ctx.logger.debug(`Branding asset check skipped: the served app list could not be read (${err?.message ?? err})`);
          return;
        }
        for (const line of describeUnservedBrandingAssets(apps, assetsDir, mounted, dirSource)) {
          ctx.logger.warn(line);
        }
      });

      if (!mounted) return;

      app.get('/runtime/assets/:filename', async (c: any) => {
        const filePath = resolveRuntimeAssetPath(assetsDir, String(c.req.param?.('filename') ?? ''));
        if (filePath === null) {
          return c.text('Forbidden', 403);
        }
        try {
          const content = fs.readFileSync(filePath);
          return new Response(content, {
            headers: {
              'content-type': mimeType(filePath),
              'cache-control': 'public, max-age=3600',
            },
          });
        } catch {
          return c.text('Not Found', 404);
        }
      });
    },
  };
}

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Does the anonymous form door serve `slug` to this request?
 *
 * The door is asked, not copied. Whether a slug is open is one decision, made
 * inside `@objectstack/rest`'s form doors: the form's `sharing` switches, a
 * withdrawal in another metadata layer, the organization an anonymous request
 * reads, and whether the deployment's tenancy posture lets the form take an
 * anonymous submission. A second copy of any of that here would drift from the
 * doors, and the redirect would then send a visitor to a page that answers
 * not-found. So the visitor's own request is re-addressed to the door and
 * dispatched in-process through the same app: same headers (the host and
 * cookies that pick the environment), same connection (`c.env`), same
 * middleware. Only a `200` counts as served; any other answer, a thrown
 * dispatch included, is not.
 */
async function anonymousFormDoorServes(app: any, c: any, slug: string): Promise<boolean> {
  let res: Response;
  try {
    const url = new URL(`${PUBLIC_FORM_DOOR}/${encodeURIComponent(slug)}`, c.req.url);
    const probe = new Request(url, { method: 'GET', headers: new Headers(c.req.raw.headers) });
    res = await app.fetch(probe, c.env);
  } catch {
    return false;
  }
  try {
    await res.body?.cancel();
  } catch {
    // The body is never read; a stream that cannot be cancelled changes nothing.
  }
  return res.status === 200;
}

/** What the console document is written from, read from {@link RUNTIME_CONFIG_DOOR}. */
interface ConsoleShellConfig {
  branding?: ConsoleShellBranding;
  /** The origin of `telemetry.errorReporting.dsn`, for the document's `connect-src`. */
  errorReportingOrigin?: string;
}

/** The branding values the console document's head tags are written from. */
interface ConsoleShellBranding {
  /** `branding.productName`: the `<title>` and `og:title`. */
  productName?: string;
  /** `branding.pwaDescription`: `<meta name="description">` and `og:description`. */
  description?: string;
  /** `branding.logoUrl`, absolute or relative: `og:image`. */
  logoUrl?: string;
}

/**
 * Request headers that would change the ENCODING or the STATUS of the branding
 * door's answer rather than its content: a compressed body, or a `304` with
 * none, is not a JSON this read can take. They are dropped from the probe.
 */
const BRANDING_PROBE_DROPPED_HEADERS = ['accept-encoding', 'if-none-match', 'if-modified-since', 'range'];

/**
 * The branding, and the error-reporting endpoint, the runtime serves to THIS
 * request, read from the door the console's early-branding script reads
 * ({@link RUNTIME_CONFIG_DOOR}). The endpoint is the DSN's origin, the one
 * host the browser's error reports are sent to; the console document's
 * `connect-src` names it.
 *
 * The door is asked, not copied, for the reason {@link anonymousFormDoorServes}
 * gives: which product name a request is served is decided inside
 * `RuntimeConfigPlugin` (a saved Branding setting, then the host's option, then
 * `OS_PRODUCT_NAME`, per hostname on a hosted runtime, and whatever a
 * distribution's subclass adds), and a second resolution here would drift from
 * the one the browser tab shows. So the visitor's own request is re-addressed
 * to the door and dispatched in-process through the same app, with the same
 * host and cookies.
 *
 * `undefined` means there is nothing to read. A composition that mounts no
 * branding door answers `404`, which is not a failure. Any other answer that
 * is not a `200` JSON body, a thrown dispatch included, is reported through
 * `onFailure`.
 */
async function readShellConfig(
  app: any,
  c: any,
  onFailure: (cause: string) => void,
): Promise<ConsoleShellConfig | undefined> {
  let res: Response;
  try {
    const url = new URL(RUNTIME_CONFIG_DOOR, c.req.url);
    const headers = new Headers(c.req.raw.headers);
    for (const name of BRANDING_PROBE_DROPPED_HEADERS) headers.delete(name);
    headers.set('accept', 'application/json');
    res = await app.fetch(new Request(url, { method: 'GET', headers }), c.env);
  } catch (e: any) {
    onFailure(`the dispatch threw: ${e?.message ?? String(e)}`);
    return undefined;
  }
  if (res.status !== 200) {
    try {
      await res.body?.cancel();
    } catch {
      // The body is never read; a stream that cannot be cancelled changes nothing.
    }
    if (res.status !== 404) onFailure(`it answered ${res.status}`);
    return undefined;
  }
  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    onFailure('it answered a body that is not JSON');
    return undefined;
  }
  const body = payload as { branding?: unknown; telemetry?: { errorReporting?: { dsn?: unknown } } } | null;
  return { branding: shellBranding(body?.branding), errorReportingOrigin: dsnOrigin(body?.telemetry?.errorReporting?.dsn) };
}

/** The served `branding` block's head-tag values; `undefined` when there is no block. */
function shellBranding(branding: unknown): ConsoleShellBranding | undefined {
  if (branding === null || typeof branding !== 'object') return undefined;
  const text = (key: string): string | undefined => {
    const value = (branding as Record<string, unknown>)[key];
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
  };
  return { productName: text('productName'), description: text('pwaDescription'), logoUrl: text('logoUrl') };
}

/**
 * The `http(s)` origin a served DSN sends reports to, without the DSN's key.
 * The runtime refuses a malformed DSN before serving it, so this only keeps a
 * value that is not an `http(s)` URL out of the header.
 */
function dsnOrigin(dsn: unknown): string | undefined {
  if (typeof dsn !== 'string') return undefined;
  try {
    const url = new URL(dsn);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The origin the visitor addressed: the request URL's host, and its scheme
 * unless a proxy in front stated the original one in `x-forwarded-proto` (the
 * same header the REST discovery document's `servers[0]` reads). Only `http`
 * and `https` are taken from that header.
 */
function requestOrigin(c: any): string | undefined {
  try {
    const url = new URL(c.req.url);
    const forwarded = String(c.req.header('x-forwarded-proto') ?? '').split(',')[0].trim().toLowerCase();
    const protocol = forwarded === 'http' || forwarded === 'https' ? `${forwarded}:` : url.protocol;
    return `${protocol}//${url.host}`;
  } catch {
    return undefined;
  }
}

/** `value` as an absolute `http(s)` URL, a relative one resolved against `origin`. */
function absoluteHttpUrl(value: string, origin: string | undefined): string | undefined {
  try {
    const url = origin === undefined ? new URL(value) : new URL(value, `${origin}/`);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** Text escaped for an HTML element body or a double-quoted attribute value. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Write the console document's `<title>`, `<meta name="description">` and the
 * `og:title`, `og:description`, `og:image` and `og:url` tags from `branding`.
 *
 * - The title is the name the early-branding script sets as `document.title`,
 *   so the document and the tab agree. It replaces the build's `<title>`
 *   element (the shell ships it empty), or is added when there is none.
 * - A branding value that is absent writes no tag; an empty one is never
 *   written. With no branding value at all, `og:url` is not written either and
 *   the document is returned exactly as given.
 * - `og:image` is the logo resolved against the request origin, and is written
 *   only when that gives an `http(s)` URL.
 * - The meta tags go directly after `<head>`, ahead of any the build ships,
 *   which a crawler reads first.
 *
 * Every value is HTML-escaped.
 */
function writeBrandedHead(html: string, branding: ConsoleShellBranding | undefined, origin: string | undefined): string {
  const productName = branding?.productName;
  const description = branding?.description;
  const image = branding?.logoUrl === undefined ? undefined : absoluteHttpUrl(branding.logoUrl, origin);
  if (productName === undefined && description === undefined && image === undefined) return html;

  const head = /<head(\s[^>]*)?>/i;
  const tags: string[] = [];
  if (productName !== undefined) {
    const title = `<title>${escapeHtml(productName)}</title>`;
    const existing = /<title(\s[^>]*)?>[\s\S]*?<\/title>/i;
    if (existing.test(html)) html = html.replace(existing, () => title);
    else tags.push(title);
  }
  const meta = (attribute: 'name' | 'property', key: string, value: string) =>
    `<meta ${attribute}="${key}" content="${escapeHtml(value)}">`;
  if (description !== undefined) tags.push(meta('name', 'description', description));
  if (productName !== undefined) tags.push(meta('property', 'og:title', productName));
  if (description !== undefined) tags.push(meta('property', 'og:description', description));
  if (image !== undefined) tags.push(meta('property', 'og:image', image));
  if (origin !== undefined) tags.push(meta('property', 'og:url', origin));
  if (tags.length === 0) return html;
  return html.replace(head, (m) => `${m}\n    ${tags.join('\n    ')}`);
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf':  'font/ttf',
  '.map':  'application/json',
};

function mimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}
