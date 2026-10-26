/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import express from 'express';
import rateLimit from 'express-rate-limit';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import chalk from 'chalk';

interface StartOptions {
  port: string;
  host: string;
  dir?: string;
}

export async function start(options: StartOptions) {
  const cwd = process.cwd();
  const distDir = options.dir || 'dist';
  const distPath = resolve(cwd, distDir);

  // Check if dist directory exists
  if (!existsSync(distPath)) {
    throw new Error(
      `Build directory not found: ${distDir}\n` +
      `Run 'objectui build' first to create a production build.`
    );
  }

  // Check if index.html exists
  const indexPath = join(distPath, 'index.html');
  if (!existsSync(indexPath)) {
    throw new Error(
      `index.html not found in ${distDir}/\n` +
      `Make sure you have a valid production build.`
    );
  }

  console.log(chalk.blue('🚀 Starting production server...\n'));

  const app = express();
  const port = parseInt(options.port);
  const host = options.host;

  // Configure rate limiting to prevent abuse
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // Limit each IP to 1000 requests per windowMs
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  });

  // Apply rate limiting to all routes
  app.use(limiter);

  // Serve static files from dist directory
  app.use(express.static(distPath));

  // SPA fallback - serve index.html for all routes
  app.get('*', (_req, res) => {
    res.sendFile(indexPath);
  });

  // Start server
  app.listen(port, host, () => {
    const protocol = 'http';
    const displayHost = host === '0.0.0.0' ? 'localhost' : host;

    console.log(chalk.green('✓ Production server started successfully!'));
    console.log();
    console.log(chalk.bold('  Local:   ') + chalk.cyan(`${protocol}://${displayHost}:${port}`));
    console.log(chalk.bold('  Serving: ') + chalk.dim(distDir + '/'));
    console.log();
    console.log(chalk.dim('  Press Ctrl+C to stop the server'));
    console.log();
  });
}
