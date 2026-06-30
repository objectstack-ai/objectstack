// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Console UI Integration Utilities
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
 *      fresh `pnpm add @objectstack/framework` install gets. Cloud /
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
}

export function resolveConsolePath(options?: ResolveConsoleOptions): string | null {
  const cwd = options?.cwd ?? process.cwd();
  const cliVersion = options?.cliVersion ?? getCliVersion();
  const warn = options?.warn ?? ((message: string) => console.warn(message));

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
    if (hasConsoleDist(dir)) return dir;
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

// ─── Plugin Factory ─────────────────────────────────────────────────

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
      const httpServer = ctx.getService?.('http.server');
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
