/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { build as viteBuild } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync, mkdirSync, cpSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import chalk from 'chalk';
import { execSync } from 'child_process';
import { createTempAppWithRouting, createTempApp } from '../utils/app-generator.js';
import { reportProjectSource, resolveProjectSource } from '../utils/project-source.js';
import { isWorkspaceRoot, prepareWorkspaceTempApp } from '../utils/workspace-vite.js';

interface BuildOptions {
  outDir?: string;
  clean?: boolean;
}

export async function buildApp(schemaPath: string, options: BuildOptions) {
  const cwd = process.cwd();
  const outDir = options.outDir || 'dist';
  const outputPath = resolve(cwd, outDir);
  
  console.log(chalk.blue('🔨 Building application for production...'));
  console.log();
  
  // What this invocation names — the project root, the routes, the app config —
  // resolved by the helper all three commands share. This command used to look
  // for a pages/ directory under cwd and nowhere else, so from any directory
  // above the project it emitted a bundle with the app config rendered as the
  // page schema, exit 0 (objectui#4923).
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
    try {
      execSync('npm install --silent --prefer-offline', {
        cwd: tmpDir,
        stdio: 'pipe',
      });
      console.log(chalk.green('✓ Dependencies installed'));
    } catch {
      throw new Error('Failed to install dependencies. Please check your internet connection and try again.');
    }
  }

  // Everything the temp app needs to resolve platform packages from workspace
  // source — the alias table, and the PostCSS pipeline that replaces the
  // generated config file. Shared with `dev` and `serve` so the three cannot
  // drift apart (objectui#3890); see `utils/workspace-vite.ts`.
  if (isMonorepo) {
    console.log(chalk.blue('📦 Detected monorepo - configuring workspace aliases'));
  }
  const workspaceConfig = isMonorepo ? await prepareWorkspaceTempApp(cwd, tmpDir) : {};

  console.log(chalk.blue('⚙️  Building with Vite...'));
  console.log();

  // Clean output directory if requested
  if (options.clean && existsSync(outputPath)) {
    console.log(chalk.dim(`  Cleaning ${outDir}/ directory...`));
    rmSync(outputPath, { recursive: true, force: true });
  }

  // Build with Vite
  try {
    await viteBuild({
      root: tmpDir,
      build: {
        outDir: join(tmpDir, 'dist'),
        emptyOutDir: true,
        reportCompressedSize: true,
      },
      plugins: [react()],
      logLevel: 'info',
      ...workspaceConfig,
    });

    // Copy built files to output directory
    mkdirSync(outputPath, { recursive: true });
    cpSync(join(tmpDir, 'dist'), outputPath, { recursive: true });

    console.log();
    console.log(chalk.green('✓ Build completed successfully!'));
    console.log();
    console.log(chalk.bold('  Output: ') + chalk.cyan(outDir + '/'));
    console.log();
    console.log(chalk.dim('  To serve the production build, run:'));
    console.log(chalk.cyan(`  objectui start --dir ${outDir}`));
    console.log();
  } catch (error) {
    // The caught error's message is inlined below. We can't pass it as the
    // `Error` `cause` option because this package targets ES2020, whose lib
    // types the 1-arg `Error` constructor only; hence the scoped disable.
    // eslint-disable-next-line preserve-caught-error
    throw new Error(`Build failed: ${error instanceof Error ? error.message : error}`);
  }
}
