// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Args, Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { spawnSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { printHeader, printKV, printStep, printError } from '../utils/format.js';

export default class Dev extends Command {
  static override description = 'Start development mode with hot-reload';

  static override args = {
    package: Args.string({ description: 'Package name or filter pattern', default: 'all', required: false }),
  };

  static override flags = {
    watch: Flags.boolean({ char: 'w', description: 'Enable watch mode (default)', default: true }),
    ui: Flags.boolean({ description: 'Enable Studio UI at /_studio/' }),
    verbose: Flags.boolean({ char: 'v', description: 'Verbose output' }),
    port: Flags.string({ char: 'p', description: 'Server port (overrides $PORT)' }),
    preset: Flags.string({
      description: 'Plugin tier preset forwarded to `serve`: minimal | default | full',
    }),
    compile: Flags.boolean({
      description: 'Compile objectstack.config.ts to dist/objectstack.json before starting (auto if artifact missing). Ignored when --artifact is set.',
      default: false,
      allowNo: true,
    }),

    // ── Runtime overrides (mirror `os start`) ────────────────────────
    // These let `os dev` consume a pre-built artifact and arbitrary
    // storage/auth without an `objectstack.config.ts` in the cwd. When
    // `--artifact` is set the auto-compile path is skipped — there's no
    // source to compile from. All flags override the matching env var.
    artifact: Flags.string({
      char: 'a',
      description: 'Path or http(s):// URL to a compiled objectstack.json (skips auto-compile; overrides $OS_ARTIFACT_PATH)',
    }),
    'project-id': Flags.string({
      description: 'Project identifier (overrides $OS_PROJECT_ID, default proj_local)',
    }),
    database: Flags.string({
      char: 'd',
      description: 'Database URL: file:./db.sqlite | libsql://... | postgres://... | mongodb://... | memory:// (overrides $OS_DATABASE_URL)',
    }),
    'database-driver': Flags.string({
      description: 'Force driver kind: sqlite | turso | postgres | mongodb | memory (overrides $OS_DATABASE_DRIVER)',
      options: ['sqlite', 'turso', 'postgres', 'mongodb', 'memory'],
    }),
    'database-auth-token': Flags.string({
      description: 'Auth token for libsql/Turso connections (overrides $OS_DATABASE_AUTH_TOKEN / $TURSO_AUTH_TOKEN)',
    }),
    'auth-secret': Flags.string({
      description: 'Secret for @objectstack/plugin-auth (overrides $AUTH_SECRET; dev mode injects an insecure default if neither is set)',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Dev);
    const packageName = args.package;

    printHeader('Development Mode');

    // ── Single-Project Mode ──────────────────────────────────────────────────
    const configPath = path.resolve(process.cwd(), 'objectstack.config.ts');
    const configExists = fs.existsSync(configPath);

    // `--artifact` lets `os dev` boot a pre-built artifact without any
    // local config — semantically the same as `os start` but with the
    // dev conveniences (NODE_ENV=development, dev-fallback AUTH_SECRET,
    // --ui default-on, dev-mode error formatting).
    const isUrl = !!flags.artifact && /^https?:\/\//i.test(flags.artifact);
    const inferredArtifact = flags.artifact
      ?? process.env.OS_ARTIFACT_PATH
      ?? path.resolve(process.cwd(), 'dist/objectstack.json');
    const artifactPath = isUrl ? flags.artifact! : path.resolve(process.cwd(), inferredArtifact);
    const useArtifactDirect = !!flags.artifact || !configExists;

    if (packageName === 'all' && (configExists || flags.artifact)) {
      if (configExists && !flags.artifact) {
        printKV('Config', configPath, '📂');
      }

      // Auto-compile only when we have a config AND no explicit artifact.
      // Explicit `--artifact` means "use this, don't rebuild".
      const needsCompile = !flags.artifact && (flags.compile || !fs.existsSync(artifactPath));
      if (needsCompile) {
        if (!configExists) {
          printError('No objectstack.config.ts and no --artifact given — nothing to start.');
          console.error(chalk.yellow('  Run `objectstack init`, `objectstack build`, or pass `--artifact <path|url>`.'));
          process.exit(1);
        }
        printStep('Compiling objectstack.config.ts → dist/objectstack.json...');
        const binPath = process.argv[1];
        const compileResult = spawnSync(
          process.execPath,
          [binPath, 'compile', '--output', artifactPath],
          { stdio: 'inherit', env: { ...process.env, NODE_ENV: 'development' } },
        );
        if (compileResult.status !== 0) {
          printError('Compile failed — fix errors above before starting dev server');
          process.exit(1);
        }
      }

      printStep('Starting dev server (local mode)...');

      const projectId = flags['project-id'] ?? process.env.OS_PROJECT_ID ?? 'proj_local';
      // NOTE: Do NOT set NODE_ENV='development' here. Oclif's tsx-based
      // TypeScript source loader (activated when NODE_ENV is 'test' or
      // 'development') currently mis-handles `.json` requires inside
      // CommonJS deps (e.g. dotenv's `require('../package.json')` is
      // transformed as JS, then JSON.parse fails) — which causes the
      // child process to report `command serve not found`. The `--dev`
      // flag below already opts the serve command into dev semantics,
      // and serve.ts will set NODE_ENV='development' internally before
      // any runtime modules are imported.
      const localEnv: NodeJS.ProcessEnv = {
        ...process.env,
        OS_PROJECT_ID: projectId,
        OS_ARTIFACT_PATH: artifactPath,
        ...(flags.database ? { OS_DATABASE_URL: flags.database } : {}),
        ...(flags['database-driver'] ? { OS_DATABASE_DRIVER: flags['database-driver'] } : {}),
        ...(flags['database-auth-token'] ? { OS_DATABASE_AUTH_TOKEN: flags['database-auth-token'] } : {}),
        ...(flags['auth-secret'] ? { AUTH_SECRET: flags['auth-secret'] } : {}),
      };
      printKV('Project ID', projectId, '🎯');
      printKV('Artifact', isUrl ? artifactPath : path.relative(process.cwd(), artifactPath), '📦');
      if (flags.database) printKV('Database', redactDbUrl(flags.database), '🗄️');

      const port = flags.port ?? process.env.PORT;
      const binPath = process.argv[1];
      const serveChild = spawn(
        process.execPath,
        [
          binPath,
          'serve',
          '--dev',
          ...(port ? ['--port', port] : []),
          ...(flags.ui ? ['--ui'] : []),
          ...(flags.verbose ? ['--verbose'] : []),
          ...(flags.preset ? ['--preset', flags.preset] : []),
        ],
        { stdio: 'inherit', env: localEnv },
      );

      // ── Watch-recompile loop ────────────────────────────────────────
      // When the agent edits an objectstack source file (config or
      // src/**), debounce-rebuild dist/objectstack.json. The server
      // (MetadataPlugin) watches the artifact path directly and
      // broadcasts the HMR event to Studio (ADR-0008 PR-8); no POST
      // ping required.
      //
      // Skipped when:
      //   - --watch=false (user opted out)
      //   - --artifact was passed (no source to watch)
      //   - the project has no objectstack.config.ts
      if (flags.watch !== false && !flags.artifact && configExists) {
        this.startWatchRecompile({
          cwd: process.cwd(),
          configPath,
          artifactPath,
          binPath,
          port: port ?? '3000',
          verbose: flags.verbose,
        });
      }

      serveChild.on('exit', (code) => {
        process.exit(code ?? 0);
      });
      return;
    }

    // ── Monorepo Orchestration Mode ──────────────────────────────────────────
    try {
      const cwd = process.cwd();
      const workspaceConfigPath = path.resolve(cwd, 'pnpm-workspace.yaml');
      const isWorkspaceRoot = fs.existsSync(workspaceConfigPath);

      if (packageName === 'all' && !isWorkspaceRoot) {
        printError(`Config file not found in ${cwd}`);
        console.error(chalk.yellow('  Run in a directory with objectstack.config.ts, pass --artifact <path|url>, or run from the monorepo root.'));
        process.exit(1);
      }

      const filter = packageName === 'all' ? '' : `--filter ${packageName}`;
      printKV('Package', packageName === 'all' ? 'All packages' : packageName, '📦');
      printKV('Watch', 'enabled', '🔄');

      const { execSync } = await import('child_process');
      const command = `pnpm ${filter} dev`.trim();
      console.log(chalk.dim(`$ ${command}`));
      console.log('');
      execSync(command, { stdio: 'inherit', cwd });
    } catch (error: any) {
      printError(`Development mode failed: ${error.message || error}`);
      process.exit(1);
    }
  }

  /**
   * Watch objectstack source files (config + src/**) and on change:
   *   1. Debounce 250ms
   *   2. Run `os compile` to rebuild `dist/objectstack.json`
   *
   * The server (MetadataPlugin) watches `dist/objectstack.json`
   * directly and broadcasts the HMR event to Studio (ADR-0008 PR-8);
   * the CLI no longer POSTs `/api/v1/dev/metadata-events`. That POST
   * endpoint remains available for external trigger sources (cloud
   * webhooks, git hooks, ad-hoc curl) but is not used here.
   *
   * The watcher runs in this parent process; the serve child stays untouched.
   */
  private startWatchRecompile(opts: {
    cwd: string;
    configPath: string;
    artifactPath: string;
    binPath: string;
    port: string;
    verbose?: boolean;
  }): void {
    void (async () => {
      const chokidar = (await import('chokidar')).default;
      const srcDir = path.resolve(opts.cwd, 'src');
      const watchPaths: string[] = [opts.configPath];
      if (fs.existsSync(srcDir)) watchPaths.push(srcDir);

      const watcher = chokidar.watch(watchPaths, {
        ignored: [
          /node_modules/,
          /\.git/,
          /\.objectstack\//,
          /\bdist\b/,
          /\.test\.[jt]sx?$/,
        ],
        ignoreInitial: true,
        persistent: true,
      });

      let timer: ReturnType<typeof setTimeout> | null = null;
      let pending = new Set<string>();
      let inFlight = false;
      let queued = false;

      const compileAndPing = async () => {
        if (inFlight) { queued = true; return; }
        inFlight = true;
        const changed = Array.from(pending);
        pending = new Set();
        const label = changed.length === 1
          ? path.relative(opts.cwd, changed[0])
          : `${changed.length} files`;
        console.log(chalk.dim(`\n  ↻ recompiling (${label})...`));
        const t0 = Date.now();
        const r = spawnSync(
          process.execPath,
          [opts.binPath, 'compile', '--output', opts.artifactPath],
          { stdio: opts.verbose ? 'inherit' : ['ignore', 'ignore', 'pipe'], env: process.env },
        );
        const dt = Date.now() - t0;
        if (r.status !== 0) {
          const stderr = r.stderr?.toString().trim();
          console.log(chalk.red(`  ✗ compile failed (${dt}ms)${stderr ? '\n' + stderr : ''}`));
        } else {
          // ADR-0008 PR-8: the server now watches the artifact file
          // directly via MetadataPlugin and reloads + broadcasts
          // HMR events autonomously. The CLI no longer needs to POST
          // /api/v1/dev/metadata-events. The endpoint remains
          // available for external trigger sources (cloud webhooks,
          // git hooks, ad-hoc curl).
          console.log(chalk.green(`  ✓ recompiled in ${dt}ms — server will auto-reload`));
        }
        inFlight = false;
        if (queued) { queued = false; setTimeout(compileAndPing, 50); }
      };

      const schedule = (filePath: string) => {
        pending.add(filePath);
        if (timer) clearTimeout(timer);
        timer = setTimeout(compileAndPing, 250);
      };

      watcher.on('change', schedule);
      watcher.on('add', schedule);
      watcher.on('unlink', schedule);
      watcher.on('ready', () => {
        console.log(chalk.dim(`  👁  watching ${watchPaths.map(p => path.relative(opts.cwd, p) || '.').join(', ')} for changes`));
      });

      // Clean up on process exit
      const stop = async () => {
        try { await watcher.close(); } catch { /* noop */ }
      };
      process.on('SIGINT', () => { void stop(); });
      process.on('SIGTERM', () => { void stop(); });
    })().catch((e) => {
      console.error(chalk.yellow(`  ⚠ watch-recompile failed to start: ${e?.message ?? e}`));
    });
  }
}

function redactDbUrl(url: string): string {
  try {
    return url.replace(/(\/\/[^/@:]+):[^/@]+@/, '$1:****@');
  } catch {
    return url;
  }
}
