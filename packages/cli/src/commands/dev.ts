// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Args, Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { spawnSync, spawn } from 'child_process';
import dotenvFlow from 'dotenv-flow';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { printHeader, printKV, printStep, printError } from '../utils/format.js';
import { readEnvWithDeprecation } from '@objectstack/types';

export default class Dev extends Command {
  static override description = 'Start development mode with hot-reload';

  static override args = {
    package: Args.string({ description: 'Package name or filter pattern', default: 'all', required: false }),
  };

  static override flags = {
    watch: Flags.boolean({ char: 'w', description: 'Enable watch mode (default)', default: true }),
    ui: Flags.boolean({ description: 'Enable the bundled Console portal at /_console/' }),
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
    'environment-id': Flags.string({
      description: 'Environment identifier (overrides $OS_ENVIRONMENT_ID, default env_local)',
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

    // ── Ephemeral / fresh-environment helpers ────────────────────────
    // `--fresh` creates an isolated tempdir for OS_HOME / DB / uploads
    // so every run starts from a clean slate. Combine with `--seed-admin`
    // (default-on when --fresh) to also provision a logged-in admin
    // account, so backend debugging never blocks on first-run wizards.
    // The seeded admin uses FIXED, well-known credentials by default
    // (admin@objectos.ai / admin123) so tooling never has to guess them —
    // override with --admin-email / --admin-password when needed.
    fresh: Flags.boolean({
      description: 'Start with an ephemeral OS_HOME under the OS tempdir (clean DB, uploads, storage); auto-deletes on exit. Implies --seed-admin (admin@objectos.ai / admin123) unless --no-seed-admin is given.',
      default: false,
    }),
    'seed-admin': Flags.boolean({
      description: 'Seed a known, loginable dev admin (admin@objectos.ai / admin123) in-process via the runtime on an EMPTY DB, then promote it to platform admin. Default: on (idempotent — only acts on a zero-user DB, never overwrites an existing account). Disable with --no-seed-admin.',
      allowNo: true,
    }),
    'admin-email': Flags.string({
      description: 'Email for the seeded admin account.',
      default: 'admin@objectos.ai',
    }),
    'admin-password': Flags.string({
      description: 'Password for the seeded admin account (min 8 chars).',
      default: 'admin123',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Dev);
    const packageName = args.package;

    // Load .env files following Vite/Next.js convention (mirrors `serve`).
    // `dev` is always development mode, so prefer `.env.development*` over
    // `.env.production*`. Loaded BEFORE any env lookups.
    dotenvFlow.config({ node_env: 'development', silent: true });

    printHeader('Development Mode');

    // ── Single-Environment Mode ──────────────────────────────────────────────────
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

      const environmentId = flags['environment-id'] ?? process.env.OS_ENVIRONMENT_ID ?? 'env_local';

      // ── --fresh: ephemeral OS_HOME under the OS tempdir ─────────────
      // Creates a unique scratch dir that owns ALL persistent state for
      // this run: the SQLite DB (via OS_HOME → <home>/data/...), the
      // storage-service uploads root (OS_STORAGE_ROOT), and any other
      // state plugins keyed off OS_HOME. Auto-deleted on exit.
      let freshHome: string | undefined;
      let freshDbUrl: string | undefined;
      let freshStorageRoot: string | undefined;
      if (flags.fresh) {
        freshHome = fs.mkdtempSync(path.join(os.tmpdir(), 'objectstack-dev-'));
        fs.mkdirSync(path.join(freshHome, 'data'), { recursive: true });
        freshDbUrl = `file:${path.join(freshHome, 'data', 'dev.db')}`;
        freshStorageRoot = path.join(freshHome, 'uploads');
        fs.mkdirSync(freshStorageRoot, { recursive: true });
        printKV('Fresh OS_HOME', freshHome, '🧪');
        const cleanup = () => {
          try { fs.rmSync(freshHome!, { recursive: true, force: true }); } catch { /* noop */ }
        };
        process.on('exit', cleanup);
        process.on('SIGINT', () => { cleanup(); process.exit(130); });
        process.on('SIGTERM', () => { cleanup(); process.exit(143); });
      }

      // NOTE: Do NOT set NODE_ENV='development' here. Oclif's tsx-based
      // TypeScript source loader (activated when NODE_ENV is 'test' or
      // 'development') currently mis-handles `.json` requires inside
      // CommonJS deps (e.g. dotenv's `require('../package.json')` is
      // transformed as JS, then JSON.parse fails) — which causes the
      // child process to report `command serve not found`. The `--dev`
      // flag below already opts the serve command into dev semantics,
      // and serve.ts will set NODE_ENV='development' internally before
      // any runtime modules are imported.
      // ── Dev admin seeding (in-process) ──────────────────────────────
      // Seeding is performed IN-PROCESS by the runtime
      // (@objectstack/plugin-auth → maybeSeedDevAdmin) on an empty DB — no
      // HTTP POST, no port, no readiness race. The CLI's only job is to pass
      // the toggle + credentials through to the serve child via env.
      // Default ON in dev; `--no-seed-admin` disables it. The seed is
      // idempotent (empty-DB only) and never overwrites an existing account.
      const seedAdmin = flags['seed-admin'] ?? true;

      const effectiveDb = flags.database ?? freshDbUrl;
      const localEnv: NodeJS.ProcessEnv = {
        ...process.env,
        OS_ENVIRONMENT_ID: environmentId,
        OS_ARTIFACT_PATH: artifactPath,
        OS_SEED_ADMIN: seedAdmin ? '1' : '0',
        ...(seedAdmin && flags['admin-email'] ? { OS_SEED_ADMIN_EMAIL: flags['admin-email'] } : {}),
        ...(seedAdmin && flags['admin-password'] ? { OS_SEED_ADMIN_PASSWORD: flags['admin-password'] } : {}),
        ...(freshHome ? { OS_HOME: freshHome } : {}),
        ...(freshStorageRoot ? { OS_STORAGE_ROOT: freshStorageRoot } : {}),
        ...(effectiveDb ? { OS_DATABASE_URL: effectiveDb } : {}),
        ...(flags['database-driver'] ? { OS_DATABASE_DRIVER: flags['database-driver'] } : {}),
        ...(flags['database-auth-token'] ? { OS_DATABASE_AUTH_TOKEN: flags['database-auth-token'] } : {}),
        ...(flags['auth-secret'] ? { OS_AUTH_SECRET: flags['auth-secret'] } : {}),
      };
      printKV('Environment ID', environmentId, '🎯');
      printKV('Artifact', isUrl ? artifactPath : path.relative(process.cwd(), artifactPath), '📦');
      if (effectiveDb) printKV('Database', redactDbUrl(effectiveDb), '🗄️');

      const port = flags.port ?? readEnvWithDeprecation('OS_PORT', 'PORT');
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
        // 'ipc' adds a message channel so the serve child can report the
        // port it ACTUALLY bound (dev auto-shifts off a busy port). Without
        // this, the parent only knows the requested port.
        { stdio: ['inherit', 'inherit', 'inherit', 'ipc'], env: localEnv },
      );

      // ── Learn the actually-bound port from the serve child ──────────
      // The child emits `{ type: 'objectstack:listening', port, url }` once
      // its HTTP server is up. We surface it so the printed URL is correct
      // even when the port was auto-shifted (e.g. 3000 busy → 3001).
      const requestedPort = port ?? '3000';
      serveChild.on('message', (msg: any) => {
        if (msg?.type === 'objectstack:listening' && msg.port) {
          const actual = String(msg.port);
          if (actual !== requestedPort) {
            console.log(chalk.dim(`  ↪ server bound to port ${actual} (requested ${requestedPort})`));
          }
        }
      });

      // ── Watch-recompile loop ────────────────────────────────────────
      // When the agent edits an objectstack source file (config or
      // src/**), debounce-rebuild dist/objectstack.json. The server
      // (MetadataPlugin) watches the artifact path directly and
      // broadcasts the HMR event to UI consumers (ADR-0008 PR-8); no POST
      // ping required.
      //
      // Skipped when:
      //   - --watch=false (user opted out)
      //   - --artifact was passed (no source to watch)
      //   - the environment has no objectstack.config.ts
      if (flags.watch !== false && !flags.artifact && configExists) {
        this.startWatchRecompile({
          cwd: process.cwd(),
          configPath,
          artifactPath,
          binPath,
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
   * directly and broadcasts the HMR event to UI consumers (ADR-0008 PR-8);
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
        // Use polling to avoid `fs.watch` EMFILE on macOS when other
        // long-running node processes (VS Code, parallel dev servers)
        // saturate the native file-descriptor pool. Polling at 750ms
        // is fast enough for human-perceived HMR.
        usePolling: true,
        interval: 750,
        binaryInterval: 1500,
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
