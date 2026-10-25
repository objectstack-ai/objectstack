/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { createServer, createLogger, type Logger } from 'vite';
import react from '@vitejs/plugin-react';
import { mkdirSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import { execSync } from 'child_process';
import { createTempAppWithRouting, createTempApp } from '../utils/app-generator.js';
import { reportProjectSource, resolveProjectSource } from '../utils/project-source.js';
import { isWorkspaceRoot, prepareWorkspaceTempApp } from '../utils/workspace-vite.js';

interface ServeOptions {
  port: string;
  host: string;
  open?: boolean;
}

/**
 * Mirrors `dev`'s existing `open: options.open !== false` (commander's
 * `--no-open` sets `options.open` to `false`; every other case — the flag
 * omitted, or `true` — must keep opening a browser, which is the default
 * `serve` has always had and must not change) — pulled out so it can be
 * unit-tested without booting a real Vite server (objectui#4924).
 */
export function resolveServeOpenOption(open?: boolean): boolean {
  return open !== false;
}

/**
 * Vite's own browser-open step (`startBrowserProcess` in
 * `src/node/server/openBrowser.ts`) already catches a failed `open(url)` —
 * but it reports it as `logger.error(err.stack || err.message)` with no
 * `{ timestamp: true }`, so the default logger prints the bare Node stack
 * with no `[vite]` prefix and no context. That promise chain is
 * fire-and-forget from `server.listen()`, so the message lands on a later
 * tick — after our own success banner — reading like a crash even though
 * the server is fine. There's nothing to try/catch: the error never leaves
 * Vite. `customLogger` is the supported interception point, so this wraps
 * Vite's default logger and replaces exactly that message with a short,
 * contextual line; every other log call passes through unchanged
 * (objectui#4924, reproduced live: `Error: spawn xdg-open ENOENT` after
 * "✓ Server started successfully!" with `BROWSER` pointed at a missing
 * binary).
 */
const BROWSER_OPEN_SPAWN_ENOENT = /^Error: spawn (\S+) ENOENT/;

export function createServeLogger(base: Logger): Logger {
  return {
    info: (msg, opts) => base.info(msg, opts),
    warn: (msg, opts) => base.warn(msg, opts),
    warnOnce: (msg, opts) => base.warnOnce(msg, opts),
    error(msg, opts) {
      const match = BROWSER_OPEN_SPAWN_ENOENT.exec(msg);
      if (match) {
        const [, command] = match;
        console.log(
          chalk.dim(
            `  (could not open the browser automatically — '${command}' is not available in this environment; open the URL above manually)`
          )
        );
        return;
      }
      base.error(msg, opts);
    },
    clearScreen: (type) => base.clearScreen(type),
    hasErrorLogged: (error) => base.hasErrorLogged(error),
    get hasWarned() {
      return base.hasWarned;
    },
  };
}

export async function serve(schemaPath: string, options: ServeOptions) {
  const cwd = process.cwd();

  // What this invocation names — the project root, the routes, the app config —
  // resolved by the helper all three commands share. This command used to look
  // for a pages/ directory under cwd and nowhere else, so the same invocation
  // `dev` served as a routed project fell through to single-schema mode here
  // (objectui#4923; the history is in `utils/project-source.ts`).
  const source = resolveProjectSource(cwd, schemaPath);
  reportProjectSource(source, cwd);

  // Create temporary app directory
  const tmpDir = join(cwd, '.objectui-tmp');
  mkdirSync(tmpDir, { recursive: true });

  // Create temporary app files
  if (source.mode === 'routes') {
    createTempAppWithRouting(tmpDir, source.routes, source.appConfig);
  } else {
    createTempApp(tmpDir, source.schema);
  }

  // Install dependencies
  const isMonorepo = isWorkspaceRoot(cwd);

  if (isMonorepo) {
    console.log(chalk.blue('📦 Detected monorepo - using root node_modules'));
  } else {
    console.log(chalk.blue('📦 Installing dependencies...'));
    console.log(chalk.dim('  This may take a moment on first run...'));
    try {
      execSync('npm install --silent --prefer-offline', {
        cwd: tmpDir,
        stdio: 'inherit',
      });
      console.log(chalk.green('✓ Dependencies installed'));
    } catch {
      throw new Error('Failed to install dependencies. Please check your internet connection and try again.');
    }
  }

  console.log(chalk.green('✓ Schema loaded successfully'));
  console.log(chalk.blue('🚀 Starting development server...\n'));

  // Everything the temp app needs to resolve platform packages from workspace
  // source — the alias table, and the PostCSS pipeline that replaces the
  // generated config file. Shared with `dev` and `build` so the three cannot
  // drift apart (objectui#3890); see `utils/workspace-vite.ts`.
  if (isMonorepo) {
    console.log(chalk.blue('📦 Detected monorepo - configuring workspace aliases'));
  }
  const workspaceConfig = isMonorepo ? await prepareWorkspaceTempApp(cwd, tmpDir) : {};

  // Create Vite config
  const viteConfig = {
    root: tmpDir,
    server: {
      port: parseInt(options.port),
      host: options.host,
      open: resolveServeOpenOption(options.open),
      fs: {
        // Allow serving the workspace sources the aliases point at
        allow: [cwd],
      },
    },
    plugins: [react()],
    customLogger: createServeLogger(createLogger()),
    ...workspaceConfig,
  };

  // Create Vite server
  const server = await createServer(viteConfig);

  await server.listen();

  const { port, host } = server.config.server;
  const protocol = server.config.server.https ? 'https' : 'http';
  const displayHost = host === '0.0.0.0' ? 'localhost' : host;

  console.log();
  console.log(chalk.green('✓ Server started successfully!'));
  console.log();
  console.log(chalk.bold('  Local:   ') + chalk.cyan(`${protocol}://${displayHost}:${port}`));
  console.log();
  console.log(chalk.dim('  Press Ctrl+C to stop the server'));
  console.log();
}
