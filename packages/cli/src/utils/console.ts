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
import { createRequire } from 'module';
import { pathToFileURL, fileURLToPath } from 'url';

// ─── Constants ──────────────────────────────────────────────────────

/** URL mount path for the Console portal inside the ObjectStack server */
export const CONSOLE_PATH = '/_console';

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
 * The refusal block — `os dev` declines to mount a drifted console. Mirrors
 * the remediation of `scripts/check-console-sha.mjs` verbatim (rebuild at the
 * *pinned* SHA with `pnpm objectui:build`; `objectui:refresh` would re-bump
 * the pin to the local ../objectui HEAD, which is the opposite of the fix).
 */
export function formatConsoleShaDriftRefusal(drift: ConsoleShaDrift): string {
  return (
    `\n  ✗ Console version drift — refusing to serve /_console in dev.\n\n` +
    `      pinned  (${drift.pinFile}):              objectui@${drift.pin.slice(0, 12)}\n` +
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

      const readIndexHtml = () => {
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
        if (reactPagesDisabled()) {
          const capTag =
            `<script>window.__OBJECTUI_CAPABILITIES_DISABLED__=(window.__OBJECTUI_CAPABILITIES_DISABLED__||[]).concat('react-pages');</script>`;
          html = html.replace(/<head(\s[^>]*)?>/i, (m) => `${m}\n    ${capTag}`);
        }
        return html;
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
          if (filePath.endsWith('.html')) {
            return new Response(readIndexHtml(), {
              headers: { 'content-type': 'text/html; charset=utf-8' },
            });
          }
          const content = fs.readFileSync(filePath);
          return new Response(content, {
            headers: { 'content-type': mimeType(filePath) },
          });
        }

        // Hashed-asset paths must never SPA-fallback.
        if (reqPath.startsWith('/assets/')) {
          return c.text('Not Found', 404);
        }

        // SPA fallback
        return new Response(readIndexHtml(), {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      });

      // Suppress unused-parameter lint when isDev isn't needed.
      void options;
    },
  };
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
