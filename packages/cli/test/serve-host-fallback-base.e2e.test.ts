// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #11157 — `serve`'s host importer resolves the UNDECLARED leg from
 * `packages/cli`, because it hands `createHostImporter` its own base.
 *
 * ── The defect ───────────────────────────────────────────────────────────
 *
 * `createHostImporter` has two legs. The DECLARED leg resolves out of the served
 * app's `node_modules` (#4719; #11185 fixed WHICH app that is). The UNDECLARED
 * leg falls back to "the importing package's own resolution" — and which package
 * that is depends entirely on where the `import()` is physically WRITTEN,
 * because Node ESM resolves a bare specifier against the module containing the
 * call. #10943 made that an explicit parameter, `options.fallbackImport`, so a
 * caller can hand in its own `import()`. `@objectstack/verify` (`bootStack`) and
 * the `packages/qa/dogfood` enterprise probe both pass theirs; `serve`'s
 * `importFromHost` did not, so the CLI advertised its own resolution and
 * actually used `@objectstack/types`', which under a pnpm-isolated layout sees
 * only `@objectstack/spec`.
 *
 * ── WHY THIS FILE SPAWNS A REAL NODE PROCESS — measured, not stylistic ──────
 *
 * This is the whole reason the card's pin does not live in
 * `src/commands/serve-host-fallback-base.test.ts` beside the other unit pins.
 *
 * `@objectstack/types` is a LINKED workspace package, so Vite processes it as
 * source rather than externalising it, and the `import()` inside
 * `packages/types/dist/node.mjs` is rewritten to Vite's own resolver — which
 * resolves from the vitest root, `packages/cli`. MEASURED in this checkout: an
 * in-process `createHostImporter(appRoot)('chalk')`, with NO caller base at all,
 * RESOLVES under vitest and THROWS `Cannot find package 'chalk'` under Node.
 *
 * So under vitest the two bases are the same base, and every in-process
 * assertion about which one is in use is green either way. That is not a
 * weakness of one test — it silently makes the anti-vacuity control itself
 * vacuous, which is the failure mode the card was filed to avoid. Only a real
 * process measures it.
 *
 * ── Why a probe script and not a full `serve` boot ─────────────────────────
 *
 * The base is a property of `serve.ts`'s module identity, which a spawned
 * `import()` of that file reproduces exactly — the same file, the same realpath,
 * the same `node_modules` walk as the shipped `dist/commands/serve.js`. Booting
 * a whole server to observe it would add a database, a port and ~40s per case
 * and measure nothing extra. `test/serve-app-anchored-optional-import.e2e.test.ts`
 * spawns the real CLI because #11185's base is computed inside `run()` and is
 * unobservable from outside it; this card's base is not.
 *
 * One spawn covers every case, because the expensive part is loading
 * `serve.ts`'s module graph once.
 *
 * ── The anti-vacuity floor ───────────────────────────────────────────────
 *
 * `chalk` is DECLARED by `packages/cli` and resolvable from it, and NOT
 * resolvable from `@objectstack/types`. Re-measured with `import.meta.resolve`
 * from a probe inside each package:
 *
 *     specifier                    from packages/cli   from packages/types
 *     chalk                        OK                  MISS
 *     @objectstack/plugin-auth     OK                  MISS
 *     @objectstack/plugin-audit    OK                  MISS
 *     @objectstack/spec            OK                  OK    ← types' one dep
 *     @objectstack/service-cluster MISS                MISS  ← app-supplied
 *
 * The `control` case below builds the importer the way `importFromHost` used to
 * — `createHostImporter(root)`, no base — and shows it failing on the very
 * specifier the pin loads. Delete that and the pin degrades to "chalk is
 * installed somewhere".
 *
 * `@objectstack/plugin-auth` would have worked equally well and is deliberately
 * NOT used: this package's `vitest.config.ts` aliases it to source.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));

/** The module under test, loaded by the child exactly as the CLI's own dist is. */
const SERVE_TS = resolve(HERE, '../src/commands/serve.ts');
/** The workspace `tsx` binary (an installed dependency, not a repo source input). */
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');

/**
 * ⚠️ `@objectstack/types` is reached by SPECIFIER, resolved inside the child from
 * `serve.ts`'s own location — never as `resolve(HERE, '../../types/dist/…')`.
 * Both spellings land on the same file; only one of them is honest about what it
 * is naming. `check:cross-package-test-inputs` states the rule and the reason:
 * a filesystem climb names a repo SOURCE input that no turbo glob covers, so a
 * change to it would not re-run this package's tests, while a bare specifier is
 * an installed dependency — and `@objectstack/cli` already declares
 * `@objectstack/types`, so turbo's task graph carries that edge already.
 *
 * The child gets the CJS twin (`dist/node.js`) because that is what
 * `createRequire().resolve()` selects, and for THIS measurement the twins are
 * interchangeable: both sit in `packages/types/dist/`, so the `node_modules`
 * walk their fallback `import()` performs starts from the same directory. The
 * control below asserts the reported origin, so a future layout change that made
 * them differ would show up as a failure rather than as a quiet pass.
 */

/** Declared by `packages/cli`; not resolvable from `@objectstack/types`. */
const CLI_DECLARED = 'chalk';
/** App-supplied: resolvable from NEITHER base. The class `serve` actually loads. */
const APP_SUPPLIED = '@objectstack/service-cluster';
/** Satisfiable by nothing anywhere, so no result can be an accident. */
const NOWHERE = '@os-fixture/host-fallback-base-probe';
/** Written into the app's `node_modules` and never declared (#4719). */
const REACHABLE_UNDECLARED = '@os-fixture/reachable-but-undeclared';

const SENTINEL = '===os-11157-probe===';

/**
 * Everything measured, in one child. Each entry is either `RESOLVED` or the
 * first line / full text of what was thrown, so an unexpected outcome shows up
 * as itself rather than as a bare boolean.
 */
const PROBE = `
const [servePath, appRoot] = process.argv.slice(2);
const { pathToFileURL } = await import('node:url');
const { createRequire } = await import('node:module');
const { default: Serve } = await import(pathToFileURL(servePath).href);
// The helper as SERVE.TS itself reaches it — by specifier, from serve.ts's own
// location — so the control measures the real dependency edge and this file
// never names a path outside its own package.
const typesPath = createRequire(servePath).resolve('@objectstack/types/node');
const { createHostImporter } = await import(pathToFileURL(typesPath).href);

const attempt = async (fn) => {
  try { await fn(); return 'RESOLVED'; }
  catch (e) { return e && e.message ? e.message : String(e); }
};

const out = {
  controlNoBase: await attempt(() => createHostImporter(appRoot)(${JSON.stringify(CLI_DECLARED)})),
  cliDeclared: await attempt(() => Serve.importConfigPlugin(${JSON.stringify(CLI_DECLARED)}, appRoot)),
  appSupplied: await attempt(() => Serve.importConfigPlugin(${JSON.stringify(APP_SUPPLIED)}, appRoot)),
  nowhere: await attempt(() => Serve.importConfigPlugin(${JSON.stringify(NOWHERE)}, appRoot)),
  reachableUndeclared: await attempt(() =>
    Serve.importConfigPlugin(${JSON.stringify(REACHABLE_UNDECLARED)}, appRoot),
  ),
};
console.log(${JSON.stringify(SENTINEL)});
console.log(JSON.stringify(out));
`;

/** A served app that declares nothing, and a CWD that is not it. */
let appRoot: string;
let neutralCwd: string;
let probeFile: string;
let probe: Record<string, string>;

beforeAll(async () => {
  appRoot = mkdtempSync(join(tmpdir(), 'os-11157-app-'));
  neutralCwd = mkdtempSync(join(tmpdir(), 'os-11157-cwd-'));
  writeFileSync(
    join(appRoot, 'package.json'),
    JSON.stringify({ name: 'fixture-app', version: '1.0.0', type: 'module' }),
  );
  // Present in the app's node_modules, absent from its package.json: the #4719
  // shape that must stay refused however the fallback base moves.
  const reachable = join(appRoot, 'node_modules', ...REACHABLE_UNDECLARED.split('/'));
  mkdirSync(reachable, { recursive: true });
  writeFileSync(
    join(reachable, 'package.json'),
    JSON.stringify({
      name: REACHABLE_UNDECLARED,
      version: '1.0.0',
      type: 'module',
      main: 'index.js',
    }),
  );
  writeFileSync(join(reachable, 'index.js'), 'export const loadedFrom = "app-node_modules";\n');

  probeFile = join(neutralCwd, 'probe.mjs');
  writeFileSync(probeFile, PROBE, 'utf8');

  const { stdout } = await execFileAsync(TSX, [probeFile, SERVE_TS, appRoot], {
    cwd: neutralCwd,
    env: { ...process.env, NO_COLOR: '1' },
    maxBuffer: 16 * 1024 * 1024,
  });
  const payload = stdout.slice(stdout.indexOf(SENTINEL) + SENTINEL.length);
  probe = JSON.parse(payload.trim()) as Record<string, string>;
}, 180_000);

afterAll(() => {
  for (const dir of [appRoot, neutralCwd]) {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('os serve → the undeclared fallback resolves from packages/cli (#11157)', () => {
  it('CONTROL: the same importer with NO caller base cannot reach a CLI-declared package', () => {
    // The floor. This is `createHostImporter(root)` exactly as `importFromHost`
    // built it before this card, failing on the specifier the next case loads.
    expect(probe.controlNoBase).not.toBe('RESOLVED');
    expect(probe.controlNoBase).toContain(`Cannot find package '${CLI_DECLARED}'`);
    expect(probe.controlNoBase).toContain('does not declare it');
    // Named, not just failed: the no-base leg really does resolve from
    // `packages/types`, which is the sentence this whole card is about.
    expect(probe.controlNoBase).toMatch(/imported from .*[/\\]packages[/\\]types[/\\]/);
    // …and it says exactly why, which is the branch #11157 moves `serve` off.
    expect(probe.controlNoBase).toContain('the caller did not pass `fallbackImport`');
  });

  it('loads a package the served app does NOT declare but packages/cli DOES', () => {
    // The load-bearing pin: the undeclared leg now runs serve.ts's own
    // `import()`. Remove `fallbackImport` from `importFromHost` and this reads
    // like the control above — measured.
    expect(
      probe.cliDeclared,
      `the undeclared fallback did not reach packages/cli:\n${probe.cliDeclared}`,
    ).toBe('RESOLVED');
  });
});

describe('os serve → the accept-set delta is exactly "what packages/cli declares"', () => {
  it('still refuses a package NEITHER the app nor packages/cli declares', () => {
    // The bound the card requires stated. The fallback moved from what
    // `@objectstack/types` declares to what `packages/cli` declares — it did not
    // become "anything reachable". Every specifier `serve` itself routes through
    // this helper is in THIS class, which is why the card is "harmless today".
    expect(probe.appSupplied).not.toBe('RESOLVED');
    expect(probe.appSupplied).toContain(`Failed to import plugin '${APP_SUPPLIED}':`);
    expect(probe.appSupplied).toContain('does not declare it');
  });

  it('leaves the #4719 gate alone: reachable-but-undeclared is still refused', () => {
    // The package IS in the app's node_modules. Moving a resolution base must
    // never turn "declared" into "resolvable from somewhere".
    expect(probe.reachableUndeclared).not.toBe('RESOLVED');
    expect(probe.reachableUndeclared).toContain('does not declare it');
    expect(probe.reachableUndeclared).toMatch(/merely REACHABLE is not enough/);
  });
});

describe('os serve → the undeclared diagnostic reports the base actually used', () => {
  it('names the APP (#11185) and the CLI as the fallback origin (#11157)', () => {
    expect(probe.nowhere).toContain(`Cannot find package '${NOWHERE}'`);
    // #11185: the app being served, never the process CWD.
    expect(probe.nowhere).toContain(`host app: ${appRoot}`);
    expect(probe.nowhere).not.toContain(`host app: ${neutralCwd}`);
    // #11157: the fallback that failed is now THIS package's, so the path Node
    // reports is inside packages/cli and not inside packages/types.
    expect(probe.nowhere).toMatch(/fallback resolution also failed: .*imported from /);
    expect(probe.nowhere).toMatch(/imported from .*[/\\]packages[/\\]cli[/\\]/);
    expect(probe.nowhere).not.toMatch(/imported from .*[/\\]packages[/\\]types[/\\]/);
    // `undeclaredMessage` composes two different texts depending on
    // `fallbackImport !== undefined`; `serve` is now on the other branch.
    expect(probe.nowhere).not.toContain('the caller did not pass `fallbackImport`');
  });
});
