// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Command, Flags } from '@oclif/core';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { printHeader, printKV, printStep, printError } from '../utils/format.js';

/**
 * `objectstack start` — zero-config quick boot.
 *
 * Three escalating modes, picked automatically:
 *
 *   1. **Empty boot** (no artifact, no config in cwd)
 *      Boots a bare kernel with Studio mounted at `/_studio/`. The user
 *      can then browse the marketplace and install apps into the home
 *      directory at runtime. Perfect for "I just want to try it".
 *
 *   2. **Artifact boot** (an `objectstack.json` is reachable)
 *      Boots from the compiled artifact, same as today.
 *
 *   3. **Explicit overrides** (`--artifact`, `--database`, ...)
 *      Highest precedence — the user is in control.
 *
 * The HOME directory (default `~/.objectstack`) is where the default
 * sqlite database, downloaded marketplace apps and plugin cache all live
 * — independent of the current working directory, so the same `os start`
 * gives you the same instance no matter where you run it.
 */
export default class Start extends Command {
  static override description = 'Quick-start an ObjectStack server (auto-falls back to an empty kernel with Studio + marketplace when no artifact is present)';

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
      description: 'Mount Studio / Account / Console portals at /_studio/, /_account/, /_console/ (default: true so you can install marketplace apps)',
      default: true,
      allowNo: true,
    }),
    verbose: Flags.boolean({ char: 'v', description: 'Verbose output' }),

    // Home directory — where persistent runtime state lives.
    home: Flags.string({
      description: 'Home directory for persistent state (default ~/.objectstack; overrides $OS_HOME)',
    }),

    // Artifact source
    artifact: Flags.string({
      char: 'a',
      description: 'Path or http(s):// URL to the compiled objectstack.json (overrides $OS_ARTIFACT_PATH; auto-detected from ./dist/objectstack.json or <home>/dist/objectstack.json)',
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

    printHeader('ObjectStack');

    // ── Home directory ──────────────────────────────────────────────
    // Priority: --home > $OS_HOME > ~/.objectstack
    const homeDir = resolveHome(flags.home);
    try {
      fs.mkdirSync(path.join(homeDir, 'data'), { recursive: true });
    } catch (err: any) {
      printError(`Cannot create home directory at ${homeDir}: ${err?.message ?? err}`);
      process.exit(1);
    }

    // ── Artifact resolution ────────────────────────────────────────
    // Priority: --artifact > $OS_ARTIFACT_PATH > ./dist/objectstack.json
    //         > <home>/dist/objectstack.json > none (empty boot)
    const artifactSource = resolveArtifactSource(flags.artifact, homeDir);

    // ── Database resolution ─────────────────────────────────────────
    // Priority: --database > $OS_DATABASE_URL > file:<home>/data/objectstack.db
    const databaseUrl = flags.database
      ?? process.env.OS_DATABASE_URL
      ?? `file:${path.join(homeDir, 'data', 'objectstack.db')}`;

    const environmentId = flags['environment-id']
      ?? process.env.OS_ENVIRONMENT_ID
      ?? 'env_local';

    // ── Banner ──────────────────────────────────────────────────────
    printKV('Home', homeDir, '🏠');
    if (artifactSource) {
      printKV('Artifact', artifactSource.display, '📦');
    } else {
      printKV('Artifact', 'none (empty kernel — install apps via Studio marketplace)', '📦');
    }
    printKV('Database', redactDbUrl(databaseUrl), '🗄️');
    printKV('Environment', environmentId, '🎯');
    if (flags.ui) printKV('Studio', `http://localhost:${flags.port ?? 3000}/_studio/`, '🎨');

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
      ...(flags['auth-secret'] ? { AUTH_SECRET: flags['auth-secret'] } : {}),
      ...(artifactSource ? { OS_ARTIFACT_PATH: artifactSource.path } : { OS_BOOT_EMPTY: '1' }),
    };
    // NODE_ENV is only forced to production when the user has not set it.
    // Allows `NODE_ENV=development objectstack start` to work for debugging.
    if (!localEnv.NODE_ENV) localEnv.NODE_ENV = 'production';

    const binPath = process.argv[1];
    const child = spawn(
      process.execPath,
      [
        binPath,
        'serve',
        flags.ui ? '--ui' : '--no-ui',
        ...(flags.verbose ? ['--verbose'] : []),
      ],
      { stdio: 'inherit', env: localEnv },
    );
    child.on('exit', (code) => process.exit(code ?? 0));
  }
}

function resolveHome(flagValue?: string): string {
  const raw = flagValue ?? process.env.OS_HOME;
  if (raw && raw.trim().length > 0) {
    const v = raw.trim();
    if (v.startsWith('~')) return path.resolve(os.homedir(), v.slice(1).replace(/^[/\\]/, ''));
    return path.resolve(v);
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
