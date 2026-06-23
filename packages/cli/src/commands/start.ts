// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { spawn, spawnSync } from 'child_process';
import crypto from 'crypto';
import dotenvFlow from 'dotenv-flow';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { printHeader, printKV, printStep, printError } from '../utils/format.js';
import { readEnvWithDeprecation } from '@objectstack/types';

/**
 * `objectstack start` — zero-config quick boot.
 *
 * Four escalating modes, picked automatically:
 *
 *   1. **Empty boot** (no artifact, no config in cwd)
 *      Boots a bare kernel with the Console mounted at `/_console/`. The
 *      user can then browse the marketplace and install apps into the
 *      home directory at runtime. Perfect for "I just want to try it".
 *
 *   2. **Project boot** (`objectstack.config.ts` in cwd)
 *      Auto-compiles the project config to `./dist/objectstack.json`
 *      (if no fresher artifact exists) and boots from it. The home
 *      directory defaults to **`<cwd>/.objectstack`** so the project's
 *      sqlite database, uploads and runtime cache stay alongside the
 *      project source rather than in `~/.objectstack`.
 *
 *   3. **Artifact boot** (an `objectstack.json` is reachable)
 *      Boots from the compiled artifact, same as today.
 *
 *   4. **Explicit overrides** (`--artifact`, `--database`, ...)
 *      Highest precedence — the user is in control.
 *
 * The HOME directory layout:
 *   - With a project config in cwd → `<cwd>/.objectstack` (project-local).
 *   - Without a project config     → `~/.objectstack` (global, shared
 *     across `os start` invocations from any directory).
 *   - Always overridable with `--home` or `$OS_HOME`.
 */
export default class Start extends Command {
  static override description = 'Quick-start an ObjectStack server (auto-falls back to an empty kernel with the Console + marketplace when no artifact is present)';

  static override examples = [
    '<%= config.bin %> start',
    '<%= config.bin %> start --home ~/my-objectstack',
    '<%= config.bin %> start --artifact ./build/myapp.json',
    '<%= config.bin %> start --artifact https://cdn.example.com/app.json --port 8080',
    '<%= config.bin %> start --database file:./data/prod.db',
    '<%= config.bin %> start --database postgres://user:pass@host:5432/mydb',
    '<%= config.bin %> start --database libsql://my-db.turso.io --database-auth-token $TURSO_TOKEN',
    '<%= config.bin %> start --no-ui',
  ];

  static override flags = {
    // Server
    port: Flags.integer({ char: 'p', description: 'Port to listen on (overrides $PORT, default 3000)' }),
    ui: Flags.boolean({
      description: 'Mount the Console portal at /_console/ (default: true so you can install marketplace apps)',
      default: true,
      allowNo: true,
    }),
    verbose: Flags.boolean({ char: 'v', description: 'Verbose output (shortcut for --log-level debug)' }),
    'log-level': Flags.string({
      description: 'Kernel logger level forwarded to `serve` (overrides $OS_LOG_LEVEL / $LOG_LEVEL; default `warn`). One of: debug | info | warn | error | fatal | silent.',
      options: ['debug', 'info', 'warn', 'error', 'fatal', 'silent'],
    }),

    // Home directory — where persistent runtime state lives.
    home: Flags.string({
      description: 'Home directory for persistent state (default <cwd>/.objectstack when an objectstack.config.ts is present, otherwise ~/.objectstack; overrides $OS_HOME)',
    }),

    // Artifact source
    artifact: Flags.string({
      char: 'a',
      description: 'Path or http(s):// URL to the compiled objectstack.json (overrides $OS_ARTIFACT_PATH; auto-detected from ./dist/objectstack.json or <home>/dist/objectstack.json; when an objectstack.config.ts is present and no artifact exists, it is compiled automatically)',
    }),

    compile: Flags.boolean({
      description: 'Force-compile objectstack.config.ts → dist/objectstack.json before booting (auto when artifact is missing). Ignored when --artifact is set.',
      default: false,
      allowNo: true,
    }),

    // Project identity
    'environment-id': Flags.string({
      description: 'Environment identifier (overrides $OS_ENVIRONMENT_ID, default env_local)',
    }),

    // Storage
    database: Flags.string({
      char: 'd',
      description: 'Database URL: file:./db.sqlite | libsql://... | postgres://... | mongodb://... | memory:// (overrides $OS_DATABASE_URL; defaults to file:<home>/data/objectstack.db)',
    }),
    'database-driver': Flags.string({
      description: 'Force driver kind when URL is ambiguous: sqlite | turso | postgres | mongodb | memory (overrides $OS_DATABASE_DRIVER)',
      options: ['sqlite', 'turso', 'postgres', 'mongodb', 'memory'],
    }),
    'database-auth-token': Flags.string({
      description: 'Auth token for libsql/Turso connections (overrides $OS_DATABASE_AUTH_TOKEN / $TURSO_AUTH_TOKEN)',
    }),

    // Authentication
    'auth-secret': Flags.string({
      description: 'Secret for @objectstack/plugin-auth — required to mount /api/v1/auth/* (overrides $AUTH_SECRET; without it auth is silently skipped)',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Start);

    // Load .env files following Vite/Next.js convention (mirrors `serve`).
    // Loaded BEFORE any env lookups so OS_DATABASE_URL/OS_HOME/AUTH_SECRET
    // from `.env`, `.env.production`, `.env.local`, etc. are picked up.
    const mode = process.env.NODE_ENV === 'test' ? 'test'
      : (process.env.NODE_ENV || 'production');
    dotenvFlow.config({ node_env: mode, silent: true });

    printHeader('ObjectStack');

    // ── Project mode detection ─────────────────────────────────────
    // If the cwd contains an `objectstack.config.ts`, treat the cwd as
    // the project root: the home directory defaults to project-local
    // (./.objectstack) and the config is compiled to ./dist/objectstack.json
    // automatically when no artifact is available.
    const cwd = process.cwd();
    const projectConfigPath = path.resolve(cwd, 'objectstack.config.ts');
    const hasProjectConfig = fs.existsSync(projectConfigPath);

    // ── Home directory ──────────────────────────────────────────────
    // Priority: --home > $OS_HOME > <cwd>/.objectstack (project mode)
    //         > ~/.objectstack (global mode)
    const homeDir = resolveHome(flags.home, { hasProjectConfig, cwd });
    try {
      fs.mkdirSync(path.join(homeDir, 'data'), { recursive: true });
    } catch (err: any) {
      printError(`Cannot create home directory at ${homeDir}: ${err?.message ?? err}`);
      process.exit(1);
    }

    // ── Artifact resolution ────────────────────────────────────────
    // Priority: --artifact > $OS_ARTIFACT_PATH > ./dist/objectstack.json
    //         > <home>/dist/objectstack.json > none
    //
    // In project mode (objectstack.config.ts present) we additionally
    // auto-compile the config to ./dist/objectstack.json when no
    // artifact has been built yet, so `os start` works on a fresh
    // clone without needing a separate `os build`.
    let artifactSource = resolveArtifactSource(flags.artifact, homeDir);

    const shouldAutoCompile = hasProjectConfig
      && !flags.artifact
      && !process.env.OS_ARTIFACT_PATH
      && (flags.compile || !artifactSource);

    if (shouldAutoCompile) {
      const outputPath = path.resolve(cwd, 'dist/objectstack.json');
      printStep('Compiling objectstack.config.ts → dist/objectstack.json...');
      const binPath = process.argv[1];
      const compileResult = spawnSync(
        process.execPath,
        [binPath, 'compile', '--output', outputPath],
        { stdio: 'inherit', env: process.env },
      );
      if (compileResult.status !== 0) {
        printError('Compile failed — fix errors above before starting the server');
        console.error(chalk.yellow('  Hint: run `objectstack start --artifact <path>` to skip the compile step.'));
        process.exit(1);
      }
      artifactSource = {
        path: outputPath,
        display: path.relative(cwd, outputPath),
      };
    }

    // ── Database resolution ─────────────────────────────────────────
    // Priority: --database > $OS_DATABASE_URL > $DATABASE_URL (legacy) > file:<home>/data/objectstack.db
    const databaseUrl = flags.database
      ?? readEnvWithDeprecation('OS_DATABASE_URL', 'DATABASE_URL')
      ?? `file:${path.join(homeDir, 'data', 'objectstack.db')}`;

    const environmentId = flags['environment-id']
      ?? process.env.OS_ENVIRONMENT_ID
      ?? 'env_local';

    // ── Auth secret ─────────────────────────────────────────────────
    // Priority: --auth-secret > $AUTH_SECRET > $OS_AUTH_SECRET > persisted
    // <home>/auth-secret (auto-generated on first run).
    //
    // Without this, `serve` runs in production mode and silently skips
    // AuthPlugin when no secret is set — which makes /api/v1/auth/*
    // return 404 and breaks the Console's login flow.
    // Quick-start should "just work" without the user having to
    // export AUTH_SECRET.
    const authSecret = flags['auth-secret']
      ?? readEnvWithDeprecation('OS_AUTH_SECRET', ['AUTH_SECRET', 'BETTER_AUTH_SECRET'])
      ?? readOrCreateAuthSecret(homeDir);

    // ── Banner ──────────────────────────────────────────────────────
    if (hasProjectConfig) {
      printKV('Config', path.relative(cwd, projectConfigPath) || 'objectstack.config.ts', '📂');
    }
    printKV('Home', homeDir, '🏠');
    if (artifactSource) {
      printKV('Artifact', artifactSource.display, '📦');
    } else {
      printKV('Artifact', 'none (empty kernel — install apps via the Console marketplace)', '📦');
    }
    printKV('Database', redactDbUrl(databaseUrl), '🗄️');
    printKV('Environment', environmentId, '🎯');
    // Resolve the port the child `serve` will actually bind, matching its
    // flag default (`--port` > $OS_PORT/$PORT > 3000). Using `flags.port`
    // alone printed the wrong URL whenever the port came from the env.
    const bannerPort = flags.port ?? readEnvWithDeprecation('OS_PORT', 'PORT', { silent: true }) ?? 3000;
    if (flags.ui) printKV('Console', `http://localhost:${bannerPort}/_console/`, '🖥️');

    printStep('Starting server...');

    // ── Child env ───────────────────────────────────────────────────
    // Flags win over inherited env. When no artifact was located, signal
    // serve.ts to boot an empty kernel via OS_BOOT_EMPTY=1.
    const localEnv: NodeJS.ProcessEnv = {
      ...process.env,
      OS_HOME: homeDir,
      OS_ENVIRONMENT_ID: environmentId,
      OS_DATABASE_URL: databaseUrl,
      ...(flags.port ? { PORT: String(flags.port) } : {}),
      ...(flags['database-driver'] ? { OS_DATABASE_DRIVER: flags['database-driver'] } : {}),
      ...(flags['database-auth-token'] ? { OS_DATABASE_AUTH_TOKEN: flags['database-auth-token'] } : {}),
      AUTH_SECRET: authSecret,
      ...(artifactSource ? { OS_ARTIFACT_PATH: artifactSource.path } : { OS_BOOT_EMPTY: '1' }),
    };
    // NODE_ENV is only forced to production when the user has not set it.
    // Allows `NODE_ENV=development objectstack start` to work for debugging.
    if (!localEnv.NODE_ENV) localEnv.NODE_ENV = 'production';

    // Single-node self-host quickstart: forcing production above would make
    // LocalCryptoProvider refuse to boot without OS_SECRET_KEY, breaking the
    // documented zero-config `os start`. Opt the crypto provider into minting
    // + persisting a key file (~/.objectstack/dev-crypto-key) so it works out
    // of the box. A multi-node deploy (OS_CLUSTER_DRIVER set) must provision a
    // shared OS_SECRET_KEY instead — each node minting its own key would
    // diverge — so we do NOT opt in there; the provider still fails loud.
    if (!localEnv.OS_CLUSTER_DRIVER && !localEnv.OS_SECRET_KEY) {
      localEnv.OS_CRYPTO_AUTOKEY = '1';
    }

    const binPath = process.argv[1];
    const child = spawn(
      process.execPath,
      [
        binPath,
        'serve',
        flags.ui ? '--ui' : '--no-ui',
        ...(flags.verbose ? ['--verbose'] : []),
        ...(flags['log-level'] ? ['--log-level', flags['log-level']] : []),
      ],
      { stdio: 'inherit', env: localEnv },
    );
    child.on('exit', (code) => process.exit(code ?? 0));
  }
}

function resolveHome(
  flagValue: string | undefined,
  opts: { hasProjectConfig: boolean; cwd: string },
): string {
  const raw = flagValue ?? process.env.OS_HOME;
  if (raw && raw.trim().length > 0) {
    const v = raw.trim();
    if (v.startsWith('~')) return path.resolve(os.homedir(), v.slice(1).replace(/^[/\\]/, ''));
    return path.resolve(v);
  }
  // Project mode: keep state next to the source so each project is
  // self-contained and `os start` from another cwd doesn't reuse it.
  if (opts.hasProjectConfig) {
    return path.resolve(opts.cwd, '.objectstack');
  }
  return path.resolve(os.homedir(), '.objectstack');
}

interface ResolvedArtifact {
  /** Absolute path or URL passed to OS_ARTIFACT_PATH. */
  path: string;
  /** Human-friendly form for the banner. */
  display: string;
}

function resolveArtifactSource(flagValue: string | undefined, homeDir: string): ResolvedArtifact | undefined {
  const cwd = process.cwd();

  // Explicit flag wins, including URLs.
  if (flagValue) {
    if (/^https?:\/\//i.test(flagValue)) return { path: flagValue, display: flagValue };
    const abs = path.resolve(cwd, flagValue);
    if (!fs.existsSync(abs)) {
      // We don't exit here — the user asked for this file. Defer to
      // serve.ts which already prints a precise error.
      return { path: abs, display: path.relative(cwd, abs) };
    }
    return { path: abs, display: path.relative(cwd, abs) };
  }

  // Explicit env var wins next.
  const envPath = process.env.OS_ARTIFACT_PATH;
  if (envPath) {
    if (/^https?:\/\//i.test(envPath)) return { path: envPath, display: envPath };
    const abs = path.resolve(cwd, envPath);
    return { path: abs, display: path.relative(cwd, abs) };
  }

  // Auto-detect — cwd first, then home.
  const cwdCandidate = path.resolve(cwd, 'dist/objectstack.json');
  if (fs.existsSync(cwdCandidate)) {
    return { path: cwdCandidate, display: path.relative(cwd, cwdCandidate) };
  }
  const homeCandidate = path.resolve(homeDir, 'dist/objectstack.json');
  if (fs.existsSync(homeCandidate)) {
    return { path: homeCandidate, display: homeCandidate };
  }

  return undefined;
}

function redactDbUrl(url: string): string {
  try {
    return url.replace(/(\/\/[^/@:]+):[^/@]+@/, '$1:****@');
  } catch {
    return url;
  }
}

/**
 * Read the persisted AUTH_SECRET from `<home>/auth-secret`, or generate
 * one on first run and persist it so subsequent restarts keep existing
 * sessions valid. Mode 0o600 to keep the secret reasonably private.
 */
function readOrCreateAuthSecret(homeDir: string): string {
  const secretPath = path.join(homeDir, 'auth-secret');
  try {
    const existing = fs.readFileSync(secretPath, 'utf8').trim();
    if (existing.length >= 32) return existing;
  } catch {
    // file missing or unreadable — fall through to generation
  }
  const secret = crypto.randomBytes(32).toString('hex');
  try {
    fs.mkdirSync(homeDir, { recursive: true });
    fs.writeFileSync(secretPath, secret + '\n', { mode: 0o600 });
  } catch {
    // best-effort persist; secret is still returned for this process
  }
  return secret;
}
