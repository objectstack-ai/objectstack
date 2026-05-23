// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Console UI Integration Utilities
 *
 * Mirrors `studio.ts` / `account.ts` but for the opinionated, fork-ready
 * runtime console — published as `@object-ui/console` from the
 * objectstack-ai/objectui monorepo. The Console SPA is mounted at
 * `/_console/` by every deployment that opts in (CLI dev server,
 * self-host, Vercel) — exactly the same convention as `_studio` and
 * `_account`. The Console is built with `base: '/_console/'`, so its
 * pre-built `dist/` is served verbatim.
 *
 * History:
 *   - Was previously consumed as a workspace package (`@objectstack/console`
 *     at `apps/console`) in this monorepo.
 *   - Was renamed and moved upstream to `@object-ui/console` (see
 *     https://github.com/objectstack-ai/objectui/tree/main/apps/console).
 *   - We now resolve it from `node_modules` like any other npm dep.
 */
import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';

// ─── Constants ──────────────────────────────────────────────────────

/** URL mount path for the Console portal inside the ObjectStack server */
export const CONSOLE_PATH = '/_console';

/** npm package name for the upstream Console SPA. */
const CONSOLE_PACKAGE = '@object-ui/console';

// ─── Path Resolution ────────────────────────────────────────────────

/**
 * Resolve the filesystem path to the @object-ui/console package.
 *
 * Resolution order:
 *   1. `require.resolve` from the consumer cwd (typical app install).
 *   2. `require.resolve` from this CLI's own location (pnpm workspace).
 *   3. Direct `<cwd>/node_modules/@object-ui/console` filesystem check.
 *   4. Sibling-repo dev fallback — `../objectui/apps/console` — so the
 *      framework monorepo can be developed against an in-tree checkout
 *      of objectui without publishing every change. Matched by checking
 *      `package.json.name === "@object-ui/console"`.
 */
export function resolveConsolePath(): string | null {
  const cwd = process.cwd();

  // 1 + 2: node module resolution from cwd and from the CLI itself.
  const resolutionBases = [
    pathToFileURL(path.join(cwd, 'package.json')).href, // consumer workspace
    import.meta.url,                                      // CLI package itself
  ];

  for (const base of resolutionBases) {
    try {
      const req = createRequire(base);
      // Resolve the bare package (uses `main`/`exports`) and walk up
      // to find the package root. Avoids `./package.json` subpath which
      // is gated by the `exports` field in newer packages.
      const resolved = req.resolve(CONSOLE_PACKAGE);
      let dir = path.dirname(resolved);
      // Walk up until we find a package.json whose `name` matches.
      for (let i = 0; i < 8; i++) {
        const pkgPath = path.join(dir, 'package.json');
        if (fs.existsSync(pkgPath)) {
          try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
            if (pkg.name === CONSOLE_PACKAGE) return dir;
          } catch {
            // ignore parse errors and keep walking
          }
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
    } catch {
      // Not resolvable from this base — try next.
    }
  }

  // 3: direct filesystem check in cwd/node_modules.
  const directPath = path.join(cwd, 'node_modules', '@object-ui', 'console');
  if (fs.existsSync(path.join(directPath, 'package.json'))) {
    return directPath;
  }

  // 4: sibling-repo dev fallback. Useful when iterating on the Console
  // source inside `objectui` while running the framework CLI here.
  const siblingCandidates = [
    path.resolve(cwd, '../objectui/apps/console'),
    path.resolve(cwd, '../../objectui/apps/console'),
  ];
  for (const candidate of siblingCandidates) {
    const pkgPath = path.join(candidate, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg.name === CONSOLE_PACKAGE) return candidate;
      } catch {
        // Skip invalid package.json
      }
    }
  }

  return null;
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
 * Identical SPA-fallback semantics to `createStudioStaticPlugin` and
 * `createAccountStaticPlugin`:
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

      const readIndexHtml = () => fs.readFileSync(indexPath, 'utf-8');

      // The Console is the default end-user surface — root `/` redirects
      // here whenever the Console is mounted (`rootRedirect !== false`).
      // Mirrors the studio plugin's `rootRedirect` option. The CLI's
      // serve.ts gates whether the Console mounts at all via `--no-console`
      // / `OS_DISABLE_CONSOLE=1`; once mounted, claiming `/` is the
      // intended behaviour in both dev and production deployments.
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

        // Try serving the exact file
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
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
