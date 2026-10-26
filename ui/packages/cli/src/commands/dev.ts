/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { mkdirSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import { execSync } from 'child_process';
import { createTempAppWithRouting, createTempApp } from '../utils/app-generator.js';
import { reportProjectSource, resolveProjectSource } from '../utils/project-source.js';
import { isWorkspaceRoot, prepareWorkspaceTempApp } from '../utils/workspace-vite.js';

interface DevOptions {
  port: string;
  host: string;
  open?: boolean;
}

export async function dev(schemaPath: string, options: DevOptions) {
  const cwd = process.cwd();

  // What this invocation names — the project root, the routes, the app config —
  // resolved by the helper all three commands share, so `dev`, `serve` and
  // `build` cannot answer the same invocation differently (objectui#4923).
  const source = resolveProjectSource(cwd, schemaPath);
  reportProjectSource(source, cwd);

  // Create temporary app directory (always in cwd to keep node_modules access)
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
  // generated config file. Shared with `serve` and `build` so the three cannot
  // drift apart (objectui#3890); see `utils/workspace-vite.ts`.
  if (isMonorepo) {
    console.log(chalk.blue('📦 Detected monorepo - configuring workspace aliases'));
  }
  const workspaceConfig = isMonorepo ? await prepareWorkspaceTempApp(cwd, tmpDir) : {};

  // Create Vite config
  const viteConfig: any = {
    root: tmpDir,
    server: {
      port: parseInt(options.port),
      host: options.host,
      open: options.open !== false,
      fs: {
        // Allow serving files from workspace root
        allow: [cwd],
      }
    },
    plugins: [react()],
    ...workspaceConfig,
  };

  // Create Vite server
  const server = await createServer(viteConfig);

  await server.listen();

  const { port, host } = server.config.server;
  const protocol = server.config.server.https ? 'https' : 'http';
  const displayHost = host === '0.0.0.0' ? 'localhost' : host;

  console.log();
  console.log(chalk.green('✓ Development server started successfully!'));
  console.log();
  console.log(chalk.bold('  Local:   ') + chalk.cyan(`${protocol}://${displayHost}:${port}`));
  console.log();
  console.log(chalk.dim('  Press Ctrl+C to stop the server'));
  console.log();
}
