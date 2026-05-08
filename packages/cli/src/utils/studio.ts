// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Studio UI Integration Utilities
 *
 * Handles resolving, spawning, and proxying the @objectstack/studio
 * frontend when the CLI is started with --ui or via the `studio` command.
 */
import path from 'path';
import fs from 'fs';
import net from 'net';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import { spawn, type ChildProcess } from 'child_process';
import chalk from 'chalk';

// ─── Constants ──────────────────────────────────────────────────────

/** URL mount path for the Console UI inside the ObjectStack server */
export const STUDIO_PATH = '/_studio';

/** Internal port range start for the Vite dev server */
const VITE_PORT_START = 24678;

// ─── Path Resolution ────────────────────────────────────────────────

/**
 * Resolve the filesystem path to the @objectstack/studio package.
 * Searches workspace locations first, then falls back to node_modules.
 */
export function resolveStudioPath(): string | null {
  const cwd = process.cwd();

  // Workspace candidates (monorepo layouts)
  const candidates = [
    path.resolve(cwd, 'apps/studio'),
    path.resolve(cwd, '../../apps/studio'),
    path.resolve(cwd, '../apps/studio'),
  ];

  for (const candidate of candidates) {
    const pkgPath = path.join(candidate, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg.name === '@objectstack/studio') return candidate;
      } catch {
        // Skip invalid package.json
      }
    }
  }

  // Fallback: resolve from node_modules via createRequire.
  // Try the consumer's cwd first (pnpm strict isolation means the CLI's own
  // import.meta.url cannot see the consumer's dependencies), then the CLI itself.
  const resolutionBases = [
    pathToFileURL(path.join(cwd, 'package.json')).href,  // consumer workspace
    import.meta.url,                                       // CLI package itself
  ];

  for (const base of resolutionBases) {
    try {
      const req = createRequire(base);
      const resolved = req.resolve('@objectstack/studio/package.json');
      return path.dirname(resolved);
    } catch {
      // Not resolvable from this base — try next
    }
  }

  // Last resort: direct filesystem check in cwd/node_modules
  const directPath = path.join(cwd, 'node_modules', '@objectstack', 'studio');
  if (fs.existsSync(path.join(directPath, 'package.json'))) {
    return directPath;
  }

  return null;
}

/**
 * Check whether the Studio has a pre-built `dist/` directory.
 */
export function hasStudioDist(studioPath: string): boolean {
  return fs.existsSync(path.join(studioPath, 'dist', 'index.html'));
}

// ─── Port Utilities ─────────────────────────────────────────────────

/**
 * Find the next available TCP port starting from `start`.
 */
export function findAvailablePort(start: number = VITE_PORT_START): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () => {
      // Port in use — try next
      findAvailablePort(start + 1).then(resolve, reject);
    });
    server.once('listening', () => {
      server.close(() => resolve(start));
    });
    server.listen(start);
  });
}

// ─── Vite Dev Server ────────────────────────────────────────────────

export interface ViteDevResult {
  /** Port the Vite dev server is listening on */
  port: number;
  /** Child process handle */
  process: ChildProcess;
}

/**
 * Spawn a Vite dev server for the Console application.
 *
 * Sets environment variables so the Console runs in server mode and
 * connects to the ObjectStack API on the same origin.
 *
 * @param studioPath - Absolute path to the @objectstack/studio package
 * @param options.serverPort - The main ObjectStack server port (for display only)
 */
export async function spawnViteDevServer(
  studioPath: string,
  options: { serverPort?: number } = {},
): Promise<ViteDevResult> {
  const vitePort = await findAvailablePort(VITE_PORT_START);

  // Resolve the Vite binary from the Studio's own dependencies
  const viteBinCandidates = [
    path.join(studioPath, 'node_modules', '.bin', 'vite'),
    path.join(studioPath, '..', '..', 'node_modules', '.bin', 'vite'),
  ];

  let viteBin: string | null = null;
  for (const candidate of viteBinCandidates) {
    if (fs.existsSync(candidate)) {
      viteBin = candidate;
      break;
    }
  }

  const command = viteBin || 'npx';
  const args = viteBin
    ? ['--port', String(vitePort), '--strictPort']
    : ['vite', '--port', String(vitePort), '--strictPort'];

  const child = spawn(command, args, {
    cwd: studioPath,
    env: {
      ...process.env,
      VITE_BASE: `${STUDIO_PATH}/`,
      VITE_PORT: String(vitePort),
      VITE_HMR_PORT: String(vitePort),
      VITE_RUNTIME_MODE: 'server',
      VITE_SERVER_URL: '',             // Same-origin API
      NODE_ENV: 'development',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Accumulate stderr for error reporting
  let stderr = '';
  child.stderr?.on('data', (data: Buffer) => {
    stderr += data.toString();
  });

  // Wait for Vite to signal readiness
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Vite dev server timed out after 30 s.\n${stderr}`));
    }, 30_000);

    child.stdout?.on('data', (data: Buffer) => {
      const output = data.toString();
      // Vite prints "ready in Xms" or "Local: http://..." when ready
      if (output.includes('Local:') || output.includes('ready in')) {
        clearTimeout(timeout);
        resolve();
      }
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    child.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        clearTimeout(timeout);
        reject(new Error(`Vite exited with code ${code}.\n${stderr}`));
      }
    });
  });

  return { port: vitePort, process: child };
}

// ─── Console Plugin Factories ───────────────────────────────────────

/**
 * Create a lightweight kernel plugin that proxies `/_studio/*` requests
 * to the Vite dev server. Used in development mode.
 */
export function createStudioProxyPlugin(vitePort: number) {
  return {
    name: 'com.objectstack.studio-proxy',

    init: async () => {},

    start: async (ctx: any) => {
      const httpServer = ctx.getService?.('http.server');
      if (!httpServer?.getRawApp) {
        ctx.logger?.warn?.('Studio proxy: http.server service not found — skipping');
        return;
      }

      const app = httpServer.getRawApp();

      // Redirect bare path to trailing-slash (SPA convention)
      app.get(STUDIO_PATH, (c: any) => c.redirect(`${STUDIO_PATH}/`));

      // Proxy all /_studio/* requests to the Vite dev server
      app.all(`${STUDIO_PATH}/*`, async (c: any) => {
        const targetUrl = `http://localhost:${vitePort}${c.req.path}`;

        try {
          const headers = new Headers(c.req.raw.headers);
          headers.delete('host');

          const isBodyAllowed = !['GET', 'HEAD'].includes(c.req.method);

          const resp = await fetch(targetUrl, {
            method: c.req.method,
            headers,
            body: isBodyAllowed ? c.req.raw.body : undefined,
            duplex: isBodyAllowed ? 'half' : undefined,
          } as RequestInit);

          // Forward the full response (status, headers, body)
          return new Response(resp.body, {
            status: resp.status,
            headers: resp.headers,
          });
        } catch {
          return c.text('Console dev server is starting…', 502);
        }
      });
    },
  };
}

/**
 * Create a lightweight kernel plugin that serves the pre-built Studio
 * static files at `/_studio/*`. Used in production mode.
 *
 * Uses Node.js built-in fs for static file serving to avoid external
 * bundling dependencies.
 */
export function createStudioStaticPlugin(distPath: string, options?: { isDev?: boolean; rootRedirect?: boolean }) {
  return {
    name: 'com.objectstack.studio-static',

    init: async () => {},

    start: async (ctx: any) => {
      const httpServer = ctx.getService?.('http.server');
      if (!httpServer?.getRawApp) {
        ctx.logger?.warn?.('Studio static: http.server service not found — skipping');
        return;
      }

      const app = httpServer.getRawApp();
      const absoluteDist = path.resolve(distPath);

      const indexPath = path.join(absoluteDist, 'index.html');
      if (!fs.existsSync(indexPath)) {
        ctx.logger?.warn?.(`Studio static: dist not found at ${absoluteDist}`);
        return;
      }

      // Studio is always built with `base: '/_studio/'`, so its asset URLs
      // (and runtime router basepath) are already absolute and correct. We
      // can serve the pre-built dist verbatim.
      //
      // IMPORTANT: read index.html fresh on every fallback hit. Caching the
      // bytes at startup means a Studio rebuild (which mints new hashed asset
      // names) yields a server that points the browser at non-existent assets,
      // and the SPA fallback then re-serves the stale HTML with text/html MIME
      // — producing the "Failed to load module script" browser error.
      const readIndexHtml = () => fs.readFileSync(indexPath, 'utf-8');

      // In dev mode, redirect root to Studio for convenience — but only
      // when no other UI (e.g. the runtime Console) has claimed `/`. The
      // Console is the preferred default in modern deployments, so the
      // orchestrator (CLI `serve`) passes `rootRedirect: false` whenever
      // the Console is also mounted.
      if (options?.isDev && options?.rootRedirect !== false) {
        app.get('/', (c: any) => c.redirect(`${STUDIO_PATH}/`));
      }
      // Redirect bare path
      app.get(STUDIO_PATH, (c: any) => c.redirect(`${STUDIO_PATH}/`));

      // Serve static files with SPA fallback
      app.get(`${STUDIO_PATH}/*`, async (c: any) => {
        const reqPath = c.req.path.substring(STUDIO_PATH.length) || '/';
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

        // Hashed-asset paths must never SPA-fallback. Otherwise a stale HTML
        // pointing at a removed asset name silently degrades into "asset URL
        // returns text/html" and the browser refuses to execute the module.
        // Returning a real 404 surfaces the rebuild/redeploy mismatch instead.
        if (reqPath.startsWith('/assets/')) {
          return c.text('Not Found', 404);
        }

        // SPA fallback: serve index.html for non-file, non-asset routes
        return new Response(readIndexHtml(), {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
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
