// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Command, Flags } from '@oclif/core';
import chalk, { chalkStderr } from 'chalk';
import { spawn, spawnSync } from 'child_process';
import crypto from 'crypto';
import dotenvFlow from 'dotenv-flow';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { printHeader, printKV, printStep, printError } from '../utils/format.js';
import { redirectStdoutToStderr } from '../utils/json-stdout.js';
import { redactConnectionUrl } from '../utils/connection-display.js';
import { databaseDriverFlag } from '../utils/database-driver-flag.js';
import { childEnvWithResolvedArtifact } from '../utils/internal-artifact-channel.js';
import { readEnvWithDeprecation } from '@objectstack/types';
// The ONE port contract, shared with `dev` and with the `serve` child this
// command spawns (#12673). ⛔ Nothing about ports is declared in this file —
// no range, no reader, no wording; a second copy of the bound is exactly what
// #12620 and #12662 protected against.
import { describePortSource, parseRequestedPort, formatInvalidPortNotice } from '../utils/port-contract.js';
import type { ResolvedProjectDatabaseUrl } from '@objectstack/runtime';

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
    {
      // #8368: artifact-pinned boot. One env var names the app; the integrity
      // pin is SRI-style INSIDE the fragment (a fragment is client-side by
      // standard and never sent to the artifact host), so there is no second
      // variable to keep in sync with the first.
      command: 'OS_ARTIFACT_URL="https://cdn.example.com/hotcrm-2.2.2.json#sha256=<64 hex chars>" <%= config.bin %> start',
      description: 'Boot a published artifact by reference, content-hash verified before boot',
    },
    '<%= config.bin %> start --database file:./data/prod.db',
    '<%= config.bin %> start --database postgres://user:pass@host:5432/mydb',
    {
      // #5602: `libsql://` IS inferred and built — through the OPTIONAL package
      // `@objectstack/driver-turso`, which the CLI does not bundle (it drags
      // `@libsql/client`). Without it installed the boot fails loudly with this
      // exact install command; it never degrades to SQLite. The note belongs in
      // the example because copy-pasting this line is precisely how an operator
      // meets the requirement.
      command: '<%= config.bin %> start --database libsql://my-db.turso.io --database-auth-token $TURSO_TOKEN',
      description: 'Turso / libSQL — requires the optional driver package: npm install @objectstack/driver-turso',
    },
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
      description: 'Path or http(s):// URL to the compiled objectstack.json (overrides $OS_ARTIFACT_URL and $OS_ARTIFACT_PATH; auto-detected from ./dist/objectstack.json or <home>/dist/objectstack.json; when an objectstack.config.ts is present and no artifact exists, it is compiled automatically)',
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
    // Choices AND the enumerated list in the description come from the shared
    // driver table in `@objectstack/spec` (#6969) — this command states no driver
    // vocabulary of its own. See `utils/database-driver-flag.ts` for which column
    // is read and why the contract-only spellings must not be offered;
    // `database-driver-allowlist.pin.test.ts` (#6860) pins the agreement with
    // `resolveStorageDefinition`.
    'database-driver': databaseDriverFlag('Force driver kind when URL is ambiguous'),
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

    // ── stdout belongs to the protocol, never to diagnostics (#7915) ──
    // `start` is a supervisor: it prints a header, a few resolved values and a
    // progress line, then spawns `serve` with INHERITED stdio. So its own
    // stdout is the same fd the child's stdio MCP transport writes JSON-RPC
    // frames to — and this is the invocation the stdio docs name
    // (`OS_MCP_STDIO_ENABLED=true OS_MCP_STDIO_API_KEY=osk_… os start`).
    // Everything on that fd from this process is a diagnostic, so it goes to
    // stderr, unconditionally, for the same reasons spelled out at the top of
    // `serve.run()`. The child installs the same policy for itself.
    redirectStdoutToStderr();
    // Colour follows the destination stream — see the same line in `serve`.
    chalk.level = chalkStderr.level;

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
    // This ladder resolves in the PARENT and is unchanged. What changed is how
    // the answer reaches the child: it travels on the CLI's own
    // `OS_INTERNAL_ARTIFACT_PATH` channel, never on `OS_ARTIFACT_PATH`, so an
    // `OS_ARTIFACT_PATH` visible to a downstream `objectstack.config.ts` means
    // an operator set it. See `utils/internal-artifact-channel.ts`.
    //
    // Note every read of `process.env.OS_ARTIFACT_PATH` in this command — the
    // ladder's second rung below, and the auto-compile guard — is a read of the
    // PARENT's environment, i.e. of the operator's own value. This command
    // never mutates `process.env`; it composes a separate child env. So those
    // guards see exactly what they saw before.
    //
    // In project mode (objectstack.config.ts present) we additionally
    // auto-compile the config to ./dist/objectstack.json when no
    // artifact has been built yet, so `os start` works on a fresh
    // clone without needing a separate `os build`.
    // ── Artifact-pinned boot (#8368) ────────────────────────────────
    // `OS_ARTIFACT_URL` names a published artifact by reference. `start` does
    // NOT resolve it — `serve` does, once, and owns the fetch, the `#sha256=`
    // verification, the protocol handshake and the migration gate. All `start`
    // does is get out of the way: no local lookup, no auto-compile, and no
    // resolved-artifact channel or OS_BOOT_EMPTY in the child env that would
    // contradict the reference. The variable itself is inherited by the child.
    //
    // That "nothing in the child env that contradicts the reference" intent is
    // now general rather than special-cased: the child env carries a resolved
    // artifact only when this command actually resolved one, on a channel of
    // the CLI's own — so the operator-facing knob says one thing and one thing
    // only.
    //
    // An explicit `--artifact` still wins (flags over env, as everywhere in
    // this command), and it wins by REMOVING the variable from the child env —
    // leaving both set would hand `serve` two answers and let it pick.
    const artifactUrl = flags.artifact ? undefined : process.env.OS_ARTIFACT_URL?.trim() || undefined;

    let artifactSource = artifactUrl ? undefined : resolveArtifactSource(flags.artifact, homeDir);

    const shouldAutoCompile = hasProjectConfig
      && !flags.artifact
      && !artifactUrl
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
    // The ONE shared resolution (#6469) — `os dev` / `os start` / `os migrate`
    // land on the same URL for the same project directory. Priority:
    // --database > $OS_DATABASE_URL / $DATABASE_URL / $TURSO_DATABASE_URL >
    // explicit memory driver > config-declared default datasource >
    // file:<home>/data/objectstack.db (legacy dev.db / standalone.db still
    // compat-read, with a loud notice).
    const resolvedDb = await resolveStartDatabase({
      databaseFlag: flags.database,
      databaseDriverFlag: flags['database-driver'],
      env: process.env,
      homeDir,
      projectRoot: cwd,
      artifactPath: artifactSource?.path,
    });
    if (resolvedDb.notice) {
      console.log(chalk.yellow(`  ⚠ ${resolvedDb.notice}`));
    }
    const databaseUrl = resolvedDb.url;

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
      ?? readEnvWithDeprecation('OS_AUTH_SECRET', ['AUTH_SECRET', 'BETTER_AUTH_SECRET'], { silent: true })
      ?? readOrCreateAuthSecret(homeDir);

    // ── Banner ──────────────────────────────────────────────────────
    if (hasProjectConfig) {
      printKV('Config', path.relative(cwd, projectConfigPath) || 'objectstack.config.ts', '📂');
    }
    printKV('Home', homeDir, '🏠');
    if (artifactUrl) {
      // Redacted: the reference may be a pre-signed URL whose query string IS
      // the credential (#8368 acceptance #6). The banner prints scheme, host
      // and path only — enough to recognise which artifact was named.
      const { redactArtifactUrl } = await import('@objectstack/runtime');
      printKV('Artifact', `${redactArtifactUrl(artifactUrl)} (OS_ARTIFACT_URL)`, '📦');
    } else if (artifactSource) {
      printKV('Artifact', artifactSource.display, '📦');
    } else {
      printKV('Artifact', 'none (empty kernel — install apps via the Console marketplace)', '📦');
    }
    printKV('Database', redactConnectionUrl(databaseUrl), '🗄️');
    printKV('Environment', environmentId, '🎯');
    // The port TEXT this command was given, for the refusal door below —
    // ⛔ never for a URL. Nothing in this parent may print a port: see
    // {@link childPortEnv} for the channel, and the spawn below for why the
    // address this command used to advertise is now the child's to state.
    const envPort = readEnvWithDeprecation('OS_PORT', 'PORT', { silent: true });

    // ── start's own door on the ONE port contract (#12673) ────────────────
    // The same module `dev` and the `serve` child call, so the range exists
    // once in the repository and all three doors enforce one set. What this
    // repairs, measured on `origin/main` before the door existed:
    // `os start --port 99999` was refused a process later as `PORT="99999"`,
    // because the spawn below hands `flags.port` to the child as `PORT` — the
    // operator typed `--port` and was told about an environment variable they
    // had never set.
    //
    // ⛔ NOT `Flags.integer({ min, max })` on the flag, though this is the one
    // command where that would have looked sufficient. Two measured reasons.
    // (1) It is inert on the environment: oclif runs neither a flag `parse`
    // nor an integer `min`/`max` over a value supplied by a `default`, and
    // `$PORT`/`$OS_PORT` reach the child through exactly such a default on
    // `serve`'s flag — so a bound declared here would guard `--port` and leave
    // both env spellings behaving as before. (2) The bound would be a SECOND
    // copy of the range, which is what #12620 and #12662 both declined to
    // create and what this card's ruling names as the thing to protect.
    //
    // ⚠️ The text validated is the text FORWARDED. `Flags.integer` has already
    // normalised argv by this point (`--port 08080` parses to `8080`), and
    // {@link childPortEnv} writes `String(flags.port)` — so `String(flags.port)`
    // is literally what the child will read, not a reconstruction of it. The env
    // branch needs no such care: when no flag is given `start` writes neither
    // port variable, the child inherits `$PORT`/`$OS_PORT` under their own
    // names, and this door refuses them under those same names one process
    // earlier.
    const portText = flags.port !== undefined ? String(flags.port) : envPort;
    if (portText !== undefined) {
      const portSource = describePortSource(flags.port === undefined);
      if (parseRequestedPort(portText) === null) {
        // stderr — `redirectStdoutToStderr()` above already routes this
        // command's stdout there; writing the refusal to stderr directly
        // states the channel instead of depending on that redirection.
        process.stderr.write(`${formatInvalidPortNotice(portText, portSource)}\n`);
        process.exit(1);
      }
    }

    // ── ⛔ NO `Console:` row here, and no other address either (#12992) ──────
    // This command used to print `http://localhost:${flags.port ?? envPort ??
    // 3000}/_console/` at exactly this point, and the line was wrong in TWO
    // independent ways at once — both measured on a real boot of
    // `OS_PORT=41077 os start --port 41078`:
    //
    //  1. The PORT. It was a SECOND resolution of a question the child answers
    //     for itself, and the two answers disagreed: this one ranked the flag
    //     first, the child ranks `$OS_PORT` first, so the banner said 41078
    //     while `curl` found the server on 41077.
    //  2. The MOUNT. `/_console/` was advertised unconditionally under
    //     `flags.ui`, but whether a Console is actually served depends on the
    //     `ConsoleUI` plugin loading in the CHILD. On the same boot that path
    //     answered **404** — the row promised a page that was never mounted.
    //
    // ⭐ Both facts belong to the child and neither is knowable here. `serve`
    // already states them together, AFTER its `listen()`, from the port it
    // really bound and gated on the plugin really loading: `printServerReady`
    // prints the `API:` row always and the `Console:` row when
    // `loadedPlugins.includes('ConsoleUI')`, addressing both through the
    // external-base resolver so they stay right behind a proxy too.
    //
    // ⛔ Do not reintroduce an address here fed from the child's `ipc`
    // `objectstack:listening` message (the channel `dev` opens, and which
    // `serve` publishes on unconditionally — so it IS available). It was
    // measured and declined: the message carries `{ port, url }` and NOT the
    // mount fact, so a row rebuilt from it would fix defect 1 and keep defect
    // 2, and on a healthy boot it would restate — two lines later, in a second
    // spelling — a row the child had already printed correctly. One process
    // knows both facts; that process prints them.
    printStep('Starting server...');

    // ── Child env ───────────────────────────────────────────────────
    // Flags win over inherited env. When no artifact was located, signal
    // serve.ts to boot an empty kernel via OS_BOOT_EMPTY=1.
    // #8368: with OS_ARTIFACT_URL in play, neither the resolved-artifact
    // channel nor OS_BOOT_EMPTY is set — the child resolves the reference
    // itself. OS_BOOT_EMPTY in particular must NOT be set there: it would tell
    // `serve` that booting an app-less kernel is an acceptable outcome, turning
    // an unreachable artifact host into a silently empty platform instead of
    // the loud refusal acceptance #2 asks for.
    //
    // The resolved path travels on `OS_INTERNAL_ARTIFACT_PATH`, so an
    // `OS_ARTIFACT_PATH` the child sees is the operator's own, inherited
    // verbatim and never written by this command.
    const localEnv: NodeJS.ProcessEnv = {
      ...childEnvWithResolvedArtifact(
        process.env,
        artifactUrl
          ? { kind: 'reference' }
          : artifactSource
            ? { kind: 'resolved', path: artifactSource.path }
            : { kind: 'empty' },
      ),
      OS_HOME: homeDir,
      OS_ENVIRONMENT_ID: environmentId,
      OS_DATABASE_URL: databaseUrl,
      ...childPortEnv(flags.port),
      ...(flags['database-driver'] ? { OS_DATABASE_DRIVER: flags['database-driver'] } : {}),
      ...(flags['database-auth-token'] ? { OS_DATABASE_AUTH_TOKEN: flags['database-auth-token'] } : {}),
      AUTH_SECRET: authSecret,
    };
    // Flags over env: an explicit --artifact removes the reference rather than
    // racing it (see the resolution note above).
    if (flags.artifact) delete localEnv.OS_ARTIFACT_URL;
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

/**
 * The port `start` hands its `serve` child, as environment (#12992).
 *
 * ## ⭐ The channel is the defect, not the value
 *
 * `start` used to write the flag as `{ PORT: String(flags.port) }` and leave an
 * inherited `$OS_PORT` in place beside it. The child resolves
 * `readEnvWithDeprecation('OS_PORT', 'PORT')` — `OS_PORT` FIRST — so an explicit
 * `--port` was handed down on the channel its own child ranks LAST and lost to
 * an environment variable the flag's help text says it overrides. Measured on a
 * real boot before this function existed:
 *
 * ```
 *   OS_PORT=41077 os start --port 41078   →  curl finds the server on 41077
 * ```
 *
 * The child's precedence is CORRECT and is not what changed. The parent now
 * writes the canonical name, so the explicit flag arrives first in the order the
 * child already reads.
 *
 * ## Why BOTH names, and why that is one statement rather than two channels
 *
 * `OS_PORT` alone would satisfy the CLI, because the CLI reads the pair through
 * one reader with a declared precedence. But the child's environment is read by
 * more than the CLI: app code and third-party libraries read `process.env.PORT`
 * directly, and this repo has such a consumer in
 * `examples/app-showcase/src/system/self-url.ts`
 * (`env.OS_PORT?.trim() || env.PORT?.trim()`). Leaving a stale `PORT` behind
 * would repair the bind and leave the app computing its own address from a port
 * nothing is listening on — this card's defect, one layer down. So the pair is
 * written together and always agrees: ONE value, on a canonical name and its own
 * documented alias, not two channels that could ever disagree.
 *
 * ⛔ NOT forwarded as `--port` on argv, though `dev` does exactly that and it
 * would also make the flag win. Argv and environment are two mechanisms with
 * DIFFERENT precedences, and a `start` that stated the same port on both would
 * be the shape this card is about: if they ever drifted, argv would silently win
 * while the environment — the thing the app reads — lied. `dev` forwards on argv
 * because it writes no port into the child's environment at all; one command,
 * one channel, in both cases.
 *
 * ## The deprecation hazard the card flagged: MEASURED ABSENT, and inverted
 *
 * The card warned that writing `OS_PORT` might surface a deprecation notice the
 * operator never caused. It cannot, for two independent reasons:
 *
 *  - `OS_PORT` is the **preferred** argument of `readEnvWithDeprecation`, not
 *    the legacy one. The warning branch fires only when the preferred name is
 *    `undefined` and a LEGACY alias supplies the value, so setting the preferred
 *    name is the one input that can never reach it. `PORT` — what this command
 *    used to write, and still writes beside it — is the legacy half of the pair.
 *  - Every read site of this pair in the repository passes `{ silent: true }`
 *    (`commands/dev.ts`, `commands/serve.ts`, and the door in this file), which
 *    `env.ts` documents as the setting for aliases that are "accepted
 *    conventions rather than true legacy names — e.g. `PORT`, which PaaS
 *    platforms inject automatically". So no spelling of this pair can warn.
 *
 * Driven through a real `serve` child, all four shapes were silent: today's
 * `PORT`-only write (bound the WRONG port, 41077), writing `OS_PORT`, deleting
 * `OS_PORT`, and argv — the last three all bound 41078 and none printed a
 * deprecation line.
 *
 * ## ⛔ `!== undefined`, never `flags.port ?`
 *
 * The falsy guard this replaces DROPPED `--port 0`, and 0 is a legal, useful
 * port: `utils/port-contract.ts` declares `MIN_PORT = 0` from a measurement and
 * states that 0 is "a REQUEST, not an error" — it asks the kernel for any free
 * port. Measured on the unrepaired command, `OS_PORT=41077 os start --port 0`
 * printed `http://localhost:0/_console/` and bound **41077**: the flag was never
 * forwarded at all. The refusal door a few lines up already spells the test
 * `flags.port !== undefined`; this is the same question asked the same way.
 *
 * @param flagPort `flags.port` — oclif has already normalised it to an integer.
 * @returns the keys to merge into the child env; EMPTY when no flag was given,
 *   so an operator's own `$PORT`/`$OS_PORT` are inherited untouched.
 */
export function childPortEnv(flagPort: number | undefined): Record<string, string> {
  if (flagPort === undefined) return {};
  const value = String(flagPort);
  return { OS_PORT: value, PORT: value };
}

/**
 * Resolve the database URL for `objectstack start` — start's flag surface
 * mapped onto the ONE shared resolution (`resolveProjectDatabaseUrl`, #6469)
 * that `os dev` and `os migrate` resolve through too.
 *
 * `homeDir` is start's already-resolved home (`--home` > `$OS_HOME` >
 * `<cwd>/.objectstack` in project mode > `~/.objectstack`), so it is passed as
 * the pre-resolved state dir — the same directory the other commands derive
 * from `OS_HOME` / the project root, which is what makes the three answers
 * identical (pinned by `unified-db-resolution.pin.test.ts`).
 *
 * This wrapper is start's ONE resolution seam: it maps inputs, it never
 * re-implements any fallback. The runtime import is lazy so oclif's
 * import-every-command startup (#5726) does not pay for the runtime graph.
 */
export async function resolveStartDatabase(opts: {
  databaseFlag?: string;
  databaseDriverFlag?: string;
  env: Record<string, string | undefined>;
  homeDir: string;
  /** The project root (start's cwd) — anchors a config-declared relative sqlite filename. */
  projectRoot?: string;
  artifactPath?: string;
}): Promise<ResolvedProjectDatabaseUrl> {
  const { resolveProjectDatabaseUrl } = await import('@objectstack/runtime');
  return resolveProjectDatabaseUrl({
    explicitUrl: opts.databaseFlag,
    explicitDriver: opts.databaseDriverFlag,
    env: opts.env,
    homeDir: opts.homeDir,
    projectRoot: opts.projectRoot,
    artifactPath: opts.artifactPath,
  });
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

export interface ResolvedArtifact {
  /**
   * Absolute path or URL handed to the child on the CLI's internal channel
   * (`OS_INTERNAL_ARTIFACT_PATH`) — never on the operator's `OS_ARTIFACT_PATH`.
   */
  path: string;
  /** Human-friendly form for the banner. */
  display: string;
}

/**
 * `start`'s artifact resolution ladder, in one place:
 *
 *   `--artifact` > `$OS_ARTIFACT_PATH` > `<cwd>/dist/objectstack.json`
 *   > `<home>/dist/objectstack.json` > none
 *
 * Exported (with `cwd` / `env` injectable) so the ladder itself is pinned
 * rather than inferred: moving the CLI's plumbing off `OS_ARTIFACT_PATH` must
 * not shift a single rung, and the operator's `$OS_ARTIFACT_PATH` in
 * particular must keep being honoured exactly where it is honoured today.
 */
export function resolveArtifactSource(
  flagValue: string | undefined,
  homeDir: string,
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): ResolvedArtifact | undefined {
  const cwd = opts.cwd ?? process.cwd();
  const env = opts.env ?? process.env;

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

  // Explicit env var wins next — the OPERATOR's value, read from the parent
  // environment. It is resolved here and passed down on the internal channel;
  // the variable itself is inherited by the child untouched.
  const envPath = env.OS_ARTIFACT_PATH;
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
