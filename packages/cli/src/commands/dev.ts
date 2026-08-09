// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Args, Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { spawnSync, spawn } from 'child_process';
import dotenvFlow from 'dotenv-flow';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { printHeader, printKV, printStep, printError } from '../utils/format.js';
import { redactConnectionUrl } from '../utils/connection-display.js';
import { databaseDriverFlag } from '../utils/database-driver-flag.js';
import {
  DEV_WATCH_IGNORED,
  ServeRestartCoordinator,
  assessArtifactStaleness,
  formatMtimeGap,
} from '../utils/dev-restart.js';
import { readEnvWithDeprecation, isMcpServerEnabled } from '@objectstack/types';
import type { ResolvedProjectDatabaseUrl } from '@objectstack/runtime';

/**
 * Resolve the database URL for `objectstack dev` — dev's flag surface mapped
 * onto the ONE shared resolution (`resolveProjectDatabaseUrl`, #6469) that
 * `os start` and `os migrate` resolve through too. Priority: `--database` /
 * `--fresh`'s ephemeral file → `OS_DATABASE_URL` / `DATABASE_URL` /
 * `TURSO_DATABASE_URL` → explicit in-memory driver (`--database-driver memory`
 * / `OS_DATABASE_DRIVER=memory`) → the config-declared default datasource →
 * the unified default `<state dir>/data/objectstack.db` (legacy `dev.db` /
 * `standalone.db` still compat-read, with the loud `notice` line).
 *
 * `dev` keeps a persistent default on purpose — the historical serve default
 * of `:memory:` wipes all data (and AI-authored metadata) on every restart,
 * which makes local app-building unusable.
 *
 * This wrapper is dev's ONE resolution seam (pinned, together with start's and
 * migrate's, by `unified-db-resolution.pin.test.ts`): it maps inputs, it never
 * re-implements any fallback. The runtime import is lazy so oclif's
 * import-every-command startup (#5726) does not pay for the runtime graph.
 */
export async function resolveDevDatabase(opts: {
  databaseFlag?: string;
  freshDbUrl?: string;
  databaseDriverFlag?: string;
  env: Record<string, string | undefined>;
  cwd: string;
  artifactPath?: string;
}): Promise<ResolvedProjectDatabaseUrl> {
  const { resolveProjectDatabaseUrl } = await import('@objectstack/runtime');
  return resolveProjectDatabaseUrl({
    explicitUrl: opts.databaseFlag ?? opts.freshDbUrl,
    explicitDriver: opts.databaseDriverFlag,
    env: opts.env,
    projectRoot: opts.cwd,
    artifactPath: opts.artifactPath,
  });
}

export default class Dev extends Command {
  static override description =
    'Start development mode — watch sources, rebuild the artifact, and restart the server on change';

  static override args = {
    package: Args.string({ description: 'Package name or filter pattern', default: 'all', required: false }),
  };

  static override flags = {
    watch: Flags.boolean({ char: 'w', description: 'Enable watch mode (default)', default: true }),
    ui: Flags.boolean({ description: 'Enable the bundled Console portal at /_console/' }),
    verbose: Flags.boolean({ char: 'v', description: 'Verbose output (shortcut for --log-level debug)' }),
    'log-level': Flags.string({
      description: 'Kernel logger level forwarded to `serve` (overrides $OS_LOG_LEVEL / $LOG_LEVEL; default `warn`). One of: debug | info | warn | error | fatal | silent.',
      options: ['debug', 'info', 'warn', 'error', 'fatal', 'silent'],
    }),
    port: Flags.string({ char: 'p', description: 'Server port (overrides $PORT)' }),
    preset: Flags.string({
      description: 'Plugin tier preset forwarded to `serve`: minimal | default | full',
    }),
    compile: Flags.boolean({
      description: 'Compile objectstack.config.ts to dist/objectstack.json before starting (auto if artifact missing). Ignored when --artifact is set.',
      default: false,
      allowNo: true,
    }),
    restart: Flags.boolean({
      description:
        'Restart the server after each successful rebuild so the running server always matches dist/objectstack.json (#5148). With --no-restart the watcher only rebuilds the artifact — the running server keeps the build it booted with until you restart it yourself, and every rebuild says so.',
      default: true,
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
    // Enforced allowlist, not a help string — see `utils/database-driver-flag.ts`.
    // Both the choices and the enumerated list in the description come from the
    // shared driver table (#6969), so this declaration and `start.ts`'s cannot
    // drift from each other or from the table; `database-driver-allowlist.pin.test.ts`
    // (#6860) still pins the agreement with `resolveStorageDefinition`.
    'database-driver': databaseDriverFlag('Force driver kind'),
    'database-auth-token': Flags.string({
      description: 'Auth token for libsql/Turso connections (overrides $OS_DATABASE_AUTH_TOKEN / $TURSO_AUTH_TOKEN)',
    }),
    'auth-secret': Flags.string({
      description: 'Secret for @objectstack/plugin-auth (overrides $AUTH_SECRET; dev mode injects an insecure default if neither is set)',
    }),

    // ── Ephemeral / fresh-environment helpers ────────────────────────
    // `--fresh` creates an isolated tempdir for OS_HOME / DB / uploads, so
    // every run starts from a clean slate for the OS_HOME-keyed state the
    // CLI itself places (see the block in `run()` for the exact covered
    // surface, and for what an app-declared relative path escapes — #5594).
    // Combine with `--seed-admin`
    // (default-on when --fresh) to also provision a logged-in admin
    // account, so backend debugging never blocks on first-run wizards.
    // The seeded admin uses FIXED, well-known credentials by default
    // (admin@objectos.ai / admin123) so tooling never has to guess them —
    // override with --admin-email / --admin-password when needed.
    fresh: Flags.boolean({
      description: 'Start with an ephemeral OS_HOME under the OS tempdir — clean DB, uploads root and other OS_HOME-keyed state for this run, auto-deleted on exit. State an app reaches by its own cwd-relative path (e.g. a datasource `filename: .objectstack/...`) is NOT covered and survives exit. Implies --seed-admin (admin@objectos.ai / admin123) unless --no-seed-admin is given.',
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

      // ── Startup staleness warning (#5148 startup variant) ───────────
      // Without --compile, `os dev` boots whatever dist/objectstack.json
      // holds. When the sources are NEWER than the artifact (edited while
      // the server was down, stale checkout), the boot silently serves the
      // old build — measured in #5148: the config had gained a capability
      // and dev still printed `Plugins: 38 loaded` until a manual build.
      // Warn loudly and name the remedy; never gate the boot (per triage:
      // remove the silence, not the start).
      const watchActive = flags.watch !== false && !flags.artifact && configExists;
      if (!needsCompile && !flags.artifact && configExists) {
        const stale = assessArtifactStaleness({
          artifactPath,
          configPath,
          srcDir: path.resolve(process.cwd(), 'src'),
        });
        if (stale) {
          const relArtifact = path.relative(process.cwd(), artifactPath);
          const relSource = path.relative(process.cwd(), stale.newestSourcePath);
          const gap = formatMtimeGap(stale.newestSourceMtimeMs - stale.artifactMtimeMs);
          console.log(chalk.yellow.bold(`  ⚠ ${relArtifact} is OLDER than your sources — this boot serves the STALE build.`));
          console.log(chalk.yellow(`     newest source: ${relSource} (${gap} newer than the artifact)`));
          console.log(chalk.yellow(
            '     fix: run `objectstack build` or start with `--compile`'
            + (watchActive ? ', or save a watched file to trigger a rebuild' + (flags.restart ? ' + restart' : '') : '')
            + '.',
          ));
        }
      }

      printStep('Starting dev server (local mode)...');

      const environmentId = flags['environment-id'] ?? process.env.OS_ENVIRONMENT_ID ?? 'env_local';

      // ── --fresh: ephemeral OS_HOME under the OS tempdir ─────────────
      // Creates a unique scratch dir that owns the state this command can
      // actually place, and nothing more. What it covers, exactly:
      //   - the dev SQLite DB the CLI resolves for the run
      //     (OS_HOME → <home>/data/objectstack.db, published as OS_DATABASE_URL),
      //   - the storage-service uploads root, published on the settings
      //     service's own env name OS_STORAGE_LOCAL_ROOT (#4968),
      //   - any other state a plugin keys off OS_HOME.
      // In one sentence: framework-owned, OS_HOME-keyed state plus the env
      // channels this block publishes below. Auto-deleted on exit.
      //
      // NOT covered — state reached by an app-declared RELATIVE path (#5594).
      // Such a path is resolved by its own consumer against the process cwd,
      // which `--fresh` does not move, so it is written into the project tree
      // and survives exit. The live specimen is deliberate authoring, not a
      // bug: examples/app-showcase's `showcase-external` datasource declares
      // `filename: '.objectstack/data/showcase_external.db'` and says in its
      // own comment that the path resolves against the project cwd — so a
      // `--fresh` run of the showcase leaves that file (+ -wal/-shm) behind.
      // Re-anchoring app-declared relative paths on OS_HOME would be a
      // behaviour change resting on an open contract question ("relative to
      // cwd" vs "relative to this run's home"); it is deliberately NOT taken
      // here, and this comment states the covered surface instead of an
      // unqualified promise a reader would rely on for isolation.
      //
      // The uploads root MUST be published under the name the settings
      // service derives for it — `envKeyOf('storage','local_root')` (#4968).
      // Under the CLI's old private spelling (`OS_STORAGE_ROOT`) the settings
      // side saw no env value, fell back to the manifest default, and swapped
      // the adapter to `./.objectstack/data/uploads` at kernel:ready — so
      // `--fresh` uploads landed in the PROJECT CWD and outlived the run,
      // which is the opposite of what this block promises.
      let freshHome: string | undefined;
      let freshDbUrl: string | undefined;
      let freshStorageRoot: string | undefined;
      if (flags.fresh) {
        freshHome = fs.mkdtempSync(path.join(os.tmpdir(), 'objectstack-dev-'));
        fs.mkdirSync(path.join(freshHome, 'data'), { recursive: true });
        // The unified default filename (#6469) — the same name every command
        // resolves, just anchored on this run's ephemeral OS_HOME.
        freshDbUrl = `file:${path.join(freshHome, 'data', 'objectstack.db')}`;
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

      // Resolve the database through the ONE shared resolution (#6469) —
      // `os dev`, `os start` and `os migrate` all land on the same URL for the
      // same project directory. `dev` keeps a PERSISTENT default on purpose:
      // the historical serve default is `:memory:`, which silently wipes
      // everything on every restart — fine for throwaway demos, but it makes
      // local app-building unusable (build an app, restart, it's gone). See
      // {@link resolveDevDatabase} for the priority ladder.
      const resolvedDb = await resolveDevDatabase({
        databaseFlag: flags.database,
        freshDbUrl,
        databaseDriverFlag: flags['database-driver'],
        env: process.env,
        cwd: process.cwd(),
        artifactPath,
      });
      if (resolvedDb.notice) {
        // Legacy-file compat-read — one loud line naming the file being read
        // and how to converge on the unified default. Never an interactive
        // prompt (CI-safe), never silent (#6469).
        console.log(chalk.yellow(`  ⚠ ${resolvedDb.notice}`));
      }
      if (resolvedDb.source === 'unified-default') {
        fs.mkdirSync(path.dirname(resolvedDb.url.replace(/^file:/, '')), { recursive: true });
      }
      const effectiveDb = resolvedDb.url;
      const localEnv: NodeJS.ProcessEnv = {
        ...process.env,
        OS_ENVIRONMENT_ID: environmentId,
        OS_ARTIFACT_PATH: artifactPath,
        OS_SEED_ADMIN: seedAdmin ? '1' : '0',
        ...(seedAdmin && flags['admin-email'] ? { OS_SEED_ADMIN_EMAIL: flags['admin-email'] } : {}),
        ...(seedAdmin && flags['admin-password'] ? { OS_SEED_ADMIN_PASSWORD: flags['admin-password'] } : {}),
        ...(freshHome ? { OS_HOME: freshHome } : {}),
        ...(freshStorageRoot ? { OS_STORAGE_LOCAL_ROOT: freshStorageRoot } : {}),
        OS_DATABASE_URL: effectiveDb,
        ...(flags['database-driver'] ? { OS_DATABASE_DRIVER: flags['database-driver'] } : {}),
        ...(flags['database-auth-token'] ? { OS_DATABASE_AUTH_TOKEN: flags['database-auth-token'] } : {}),
        ...(flags['auth-secret'] ? { OS_AUTH_SECRET: flags['auth-secret'] } : {}),
      };
      printKV('Environment ID', environmentId, '🎯');
      printKV('Artifact', isUrl ? artifactPath : path.relative(process.cwd(), artifactPath), '📦');
      printKV('Database', redactConnectionUrl(effectiveDb), '🗄️');

      const port = flags.port ?? readEnvWithDeprecation('OS_PORT', 'PORT', { silent: true });
      const binPath = process.argv[1];
      const requestedPort = port ?? '3000';

      // ── Serve child under restart supervision (#5148) ───────────────
      // The watcher below rebuilds dist/objectstack.json, but a running
      // server only PARTIALLY receives a rebuilt artifact: MetadataPlugin's
      // own artifact watcher re-ingests the registry, syncs DDL + seeds for
      // new objects and broadcasts the SSE HMR event — while hook bodies
      // and already-registered view metadata from the compiled bundle are
      // applied at boot only (#5148 measured both staying stale). Boot-time
      // load is the one path that applies the whole artifact, so the
      // coordinator restarts the serve child after each successful rebuild
      // (nodemon-style, default-on; opt out with --no-restart).
      const spawnServeChild = (info: { restartIndex: number }) => {
        const child = spawn(
          process.execPath,
          [
            binPath,
            'serve',
            '--dev',
            ...(port ? ['--port', port] : []),
            ...(flags.ui ? ['--ui'] : []),
            ...(flags.verbose ? ['--verbose'] : []),
            ...(flags['log-level'] ? ['--log-level', flags['log-level']] : []),
            ...(flags.preset ? ['--preset', flags.preset] : []),
          ],
          // 'ipc' adds a message channel so the serve child can report the
          // port it ACTUALLY bound (dev auto-shifts off a busy port). Without
          // this, the parent only knows the requested port.
          { stdio: ['inherit', 'inherit', 'inherit', 'ipc'], env: localEnv },
        );

        // ── Learn the actually-bound port from the serve child ────────
        // The child emits `{ type: 'objectstack:listening', port, url }` once
        // its HTTP server is up. We surface it so the printed URL is correct
        // even when the port was auto-shifted (e.g. 3000 busy → 3001).
        child.on('message', (msg: any) => {
          if (msg?.type === 'objectstack:listening' && msg.port) {
            const actual = String(msg.port);
            if (actual !== requestedPort) {
              console.log(chalk.dim(`  ↪ server bound to port ${actual} (requested ${requestedPort})`));
            }
            if (info.restartIndex > 0) {
              // A restarted child is listening — the running server matches
              // dist/objectstack.json again. The MCP hint below is boot
              // noise on a restart, so it prints on the initial boot only.
              console.log(chalk.green('  ✓ server restarted — the new build is live'));
              return;
            }
            // ── MCP connect hint (#3167) ────────────────────────────────
            // The app IS an MCP server: the dispatcher serves /api/v1/mcp
            // per-request, default-on (isMcpServerEnabled). Print how a
            // coding agent (Claude Code, Cursor, any MCP client) attaches so
            // the "AI builds the app it's running" loop is discoverable at the
            // moment it's most useful — dev boot. An opted-out deployment
            // (OS_MCP_SERVER_ENABLED=false) advertises nothing, mirroring the
            // connect-UI / discovery gates that follow the same switch.
            if (isMcpServerEnabled()) {
              const base =
                typeof msg.url === 'string' && msg.url ? msg.url.replace(/\/+$/, '') : `http://localhost:${actual}`;
              const name = path.basename(process.cwd()) || 'objectstack';
              console.log();
              console.log(chalk.cyan('  🤖 MCP server — connect a coding agent:'));
              console.log(`     Endpoint  ${base}/api/v1/mcp`);
              console.log(`     Skill     ${base}/api/v1/mcp/skill`);
              console.log(chalk.dim(`     Connect   claude mcp add --transport http ${name} ${base}/api/v1/mcp`));
              console.log(chalk.dim('     Disable   OS_MCP_SERVER_ENABLED=false'));
            }
          }
        });
        return child;
      };

      const coordinator = new ServeRestartCoordinator({
        spawnChild: spawnServeChild,
        exitParent: (code) => process.exit(code),
        log: (line) => {
          const trimmed = line.trimStart();
          if (trimmed.startsWith('✗')) console.log(chalk.red(line));
          else if (trimmed.startsWith('⚠')) console.log(chalk.yellow(line));
          else console.log(chalk.dim(line));
        },
      });
      // Forward parent signals to the child (covers non-TTY parents where no
      // process group delivers Ctrl-C to the child for us), and never leave
      // an orphaned serve child behind whatever path ends the parent — e.g.
      // --fresh's SIGINT handler calls process.exit before later SIGINT
      // listeners run, but 'exit' listeners still do.
      process.on('SIGINT', () => coordinator.beginShutdown('SIGINT'));
      process.on('SIGTERM', () => coordinator.beginShutdown('SIGTERM'));
      process.on('exit', () => coordinator.killChildOnParentExit());
      coordinator.start();

      // ── Watch-recompile loop ────────────────────────────────────────
      // When the agent edits an objectstack source file (config or
      // src/**), debounce-rebuild dist/objectstack.json, then ask the
      // coordinator to restart the serve child so the running server
      // matches the artifact (#5148). With --no-restart the rebuild still
      // lands on disk and the messaging says, on every rebuild, that the
      // running server keeps the old build.
      //
      // Skipped when:
      //   - --watch=false (user opted out)
      //   - --artifact was passed (no source to watch)
      //   - the environment has no objectstack.config.ts
      if (watchActive) {
        this.startWatchRecompile({
          cwd: process.cwd(),
          configPath,
          artifactPath,
          binPath,
          verbose: flags.verbose,
          autoRestart: flags.restart,
          onRebuildLanded: flags.restart
            ? (label) => coordinator.requestRestart(label)
            : undefined,
        });
      }
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
   *   3. Report the rebuild via `onRebuildLanded` so the restart
   *      coordinator can restart the serve child (#5148)
   *
   * Why a restart and not in-place reload: the server (MetadataPlugin)
   * does watch `dist/objectstack.json` directly (ADR-0008 PR-8) — but that
   * reload path only re-ingests the metadata registry, syncs DDL + seeds
   * for NEW objects, and broadcasts the SSE HMR event to UI consumers.
   * Hook bodies and already-registered view metadata from the compiled
   * bundle are applied at boot only, so #5148 measured a rebuilt artifact
   * with the running server still executing the old hooks and serving the
   * old views — silently. Until the runtime can apply a full artifact
   * in-place (ADR-0008's target state), the restart is what keeps the
   * running server and the artifact from disagreeing without a word.
   * The `/api/v1/dev/metadata-events` POST endpoint remains available for
   * external trigger sources (cloud webhooks, git hooks, ad-hoc curl) but
   * is not used here.
   *
   * The watcher runs in this parent process, across serve child restarts.
   */
  private startWatchRecompile(opts: {
    cwd: string;
    configPath: string;
    artifactPath: string;
    binPath: string;
    verbose?: boolean;
    /** Whether a successful rebuild auto-restarts the serve child (#5148). */
    autoRestart: boolean;
    /** Called after a rebuild landed on disk (label = what changed). */
    onRebuildLanded?: (label: string) => void;
  }): void {
    void (async () => {
      const chokidar = (await import('chokidar')).default;
      const srcDir = path.resolve(opts.cwd, 'src');
      const watchPaths: string[] = [opts.configPath];
      if (fs.existsSync(srcDir)) watchPaths.push(srcDir);

      const watcher = chokidar.watch(watchPaths, {
        // Shared with the boot-time staleness check (#5148) so both judge
        // the same source surface.
        ignored: DEV_WATCH_IGNORED,
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

      // Object-name inventory of the artifact, diffed across recompiles so a
      // newly added *.object.ts is called out explicitly (15.1 third-party
      // eval: "recompiled" alone read as all-green while the new object's
      // table/seed sync was invisible to the user).
      const readArtifactObjects = (): Set<string> | null => {
        try {
          const raw = JSON.parse(fs.readFileSync(opts.artifactPath, 'utf8'));
          const meta = raw?.metadata ?? raw?.data?.metadata ?? raw;
          const objects = Array.isArray(meta?.objects) ? meta.objects : [];
          return new Set(
            objects
              .map((o: any) => o?.name)
              .filter((n: any): n is string => typeof n === 'string'),
          );
        } catch {
          return null;
        }
      };
      let knownObjects = readArtifactObjects();

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
          // A failed compile writes no artifact — the running server still
          // matches dist/objectstack.json, so no restart and no warning.
        } else {
          if (opts.autoRestart) {
            console.log(chalk.green(`  ✓ recompiled in ${dt}ms`));
          } else {
            // --no-restart: the artifact and the running server now
            // disagree — say so on EVERY rebuild (#5148: the old
            // "server will auto-reload" line advertised a hot reload the
            // runtime only partially performs).
            console.log(chalk.green(`  ✓ recompiled in ${dt}ms — artifact updated on disk`));
            console.log(chalk.yellow(
              '  ⚠ auto-restart is off (--no-restart): the running server keeps the build it booted with — restart dev to apply',
            ));
          }
          const objectsNow = readArtifactObjects();
          if (objectsNow) {
            const prior = knownObjects;
            const fresh = prior ? [...objectsNow].filter((n) => !prior.has(n)) : [];
            knownObjects = objectsNow;
            if (fresh.length > 0) {
              console.log(
                chalk.cyan(
                  `  ✚ new object(s): ${fresh.join(', ')} — table & seeds sync on ${opts.autoRestart ? 'restart' : 'reload'}`,
                ),
              );
            }
          }
          opts.onRebuildLanded?.(label);
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
        // Honest banner (#5148): say what a rebuild actually does to the
        // running server in the current mode, instead of implying a hot
        // reload the runtime only partially performs.
        const what = opts.autoRestart
          ? 'rebuild + restart on change'
          : 'rebuild on change (auto-restart off — running server keeps its build)';
        console.log(chalk.dim(`  👁  watching ${watchPaths.map(p => path.relative(opts.cwd, p) || '.').join(', ')} — ${what}`));
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
