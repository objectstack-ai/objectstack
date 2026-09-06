// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `@objectstack/cli/console` is a public subpath of the PUBLISHED package —
 * pinned against the packed tarball, from a consumer directory outside the
 * workspace, because that is the only place the defect this file pins can exist.
 *
 * ## The defect (#16046)
 *
 * 17.3.0 gave this package an `exports` map (#13123) and ratified `./console`
 * for cloud's `objectos-runtime` (#13662). The subpath pointed straight at
 * `dist/utils/console.js` — an INTERNAL module — and it had **no surface pin at
 * all**, neither names nor shapes.
 *
 * Two assertion families did exist — re-measured at `0ea5f9d9f79`, because an
 * earlier draft of this header claimed there was exactly one and that was
 * wrong. `published-subpath-hook-body.pin.test.ts` held `./console` among the
 * declared `exports` KEYS, and
 * `packages/qa/downstream-contract/test/consumer-specifier-ledger.test.ts` held
 * `@objectstack/cli/console` to RESOLVING from the packed tarball under both
 * conditions with the file behind it shipped. Both answer *is the door open*.
 * Neither can answer *what is behind it* — which is the question this file
 * adds, and the reason the correction changes nothing about the defect.
 *
 * So all 13 of that module's top-level exports were public API, and every export
 * it gained afterwards was published the moment it landed: an accidental
 * `export *` widening, or a symbol added for an internal reason, became a
 * permanent public contract silently, with nothing that would notice. That is
 * strictly weaker than the position #15630 repaired on `./hook-body`, where a
 * pin at least held the ratified names.
 *
 * The remedy is the one #15630 applied one door over: the subpath stays — cloud
 * depends on it, and sealing it would be #13662 and #15325 a third time — but it
 * now points at `src/console.ts`, a barrel that re-exports the intended public
 * face BY NAME, and this file holds the packed `.d.ts` to exactly those names
 * AND their shapes.
 *
 * ## Why the packed tarball and not the source tree
 *
 * An `exports` map is a PACKAGING contract. Inside the monorepo nothing is
 * sealed — a relative import, a vitest alias or a `paths` entry reaches any file
 * — so a test that resolves through the workspace proves nothing about what a
 * dependent can reach. Every assertion below is taken from a `pnpm pack`ed
 * tarball unpacked into a consumer's `node_modules`, which is what a downstream
 * `npm install` actually receives.
 *
 * ## The two halves, and why BOTH are here
 *
 * A name pin alone would have passed #15630's defect green, so the shapes are
 * compiled by a real consumer against the packed `.d.ts`. And a shape pin alone
 * would say nothing about the ten names this card RETIRED, so their absence is
 * asserted too — at run time, in the shipped types, and in the compiler. A
 * retirement nothing holds down is a retirement that reverts on the next
 * refactor that finds the barrel convenient.
 */

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { childEnv } from './helpers/serve-process.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
/** `packages/cli` — this package's own root, never another package's. */
const PACKAGE_ROOT = resolve(HERE, '..');

type ExportsMap = Record<string, string | { types?: string; default?: string; import?: string }>;
interface Manifest {
  name: string;
  version: string;
  exports: ExportsMap;
}

const MANIFEST = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as Manifest;
const PACKAGE_NAME = MANIFEST.name;

const CONSOLE_SUBPATH = './console';
const CONSOLE_SPECIFIER = `${PACKAGE_NAME}/console`;
/** The pre-17.3.0 spelling cloud used — the door that is gone and STAYS gone. */
const DEEP_PATH_SPECIFIER = `${PACKAGE_NAME}/dist/utils/console.js`;

/**
 * The whole public face, by name. Three names, not a barrel over an internal
 * module: `src/console.ts` re-exports these and nothing else, so an export
 * `utils/console.ts` gains tomorrow is NOT public until someone edits both that
 * file and this list.
 *
 * These three and no others because the one ledgered out-of-repo consumer
 * (`packages/qa/downstream-contract/consumer-specifiers.ledger.json` — cloud's
 * `objectos-runtime` node server) mounts the Console through exactly them.
 */
const PUBLIC_SURFACE = ['createConsoleStaticPlugin', 'hasConsoleDist', 'resolveConsolePath'];

/**
 * The ten names #16046 retired from this subpath — every remaining top-level
 * export of `utils/console.ts`, which had 13.
 *
 * ⛔ Nothing here was DELETED. `utils/console.ts` still exports all thirteen and
 * every in-package caller still imports it directly; what these ten lost is only
 * the ability to be named through a PUBLISHED specifier. Re-admitting one is a
 * deliberate act — edit `src/console.ts`, edit `PUBLIC_SURFACE` above, and write
 * the changeset — never a side effect.
 *
 * `decideConsoleMount` and `createRuntimeAssetsPlugin` are here because the
 * #16046 ruling admitted them "only if the implementer finds an intended
 * external caller", and the measurement found none: every reference to either
 * name in this repo is inside `packages/cli/`, the consumer-specifier ledger
 * names neither, and `decideConsoleMount`'s own docblock says no cloud
 * deployment can reach the refusal it exists to produce.
 */
const RETIRED_FROM_THIS_SUBPATH = [
  'CONSOLE_PATH',
  'ConsoleShaDrift',
  'DRIFT_OVERRIDE_ENV',
  'ResolveConsoleOptions',
  'createRuntimeAssetsPlugin',
  'decideConsoleMount',
  'detectConsoleShaDrift',
  'formatConsoleShaDriftRefusal',
  'formatConsoleShaDriftWarning',
  'isConsoleVersionCompatible',
];

/** The eight of those that exist at run time as VALUES (the other two are types). */
const RETIRED_RUNTIME_NAMES = [
  'CONSOLE_PATH',
  'DRIFT_OVERRIDE_ENV',
  'createRuntimeAssetsPlugin',
  'decideConsoleMount',
  'detectConsoleShaDrift',
  'formatConsoleShaDriftRefusal',
  'formatConsoleShaDriftWarning',
  'isConsoleVersionCompatible',
];

/**
 * Every subpath the published package resolves, in full. A subpath removed here
 * is a consumer broken in the exact shape of #15325 and #13662; a subpath added
 * here is a `minor` bump. Either way this list is edited on purpose, in the same
 * PR, with a changeset.
 */
const RATIFIED_SUBPATHS = ['.', CONSOLE_SUBPATH, './hook-body', './package.json'];

/**
 * The probe the consumer directory runs. Plain ESM, no transform, no import of
 * anything but Node built-ins and the packed package: `require.resolve` for the
 * `require` condition, `import.meta.resolve` for the `import` condition, and a
 * real `import()` that CALLS two of the three helpers so the answer is about the
 * code that ships, not about a path string.
 *
 * The calls are chosen to need no console dist and to touch no network or
 * filesystem state: `hasConsoleDist` on a path that cannot exist must answer
 * `false`, and `createConsoleStaticPlugin` must hand back a plugin object whose
 * `start` is never invoked here.
 */
const PROBE_SOURCE = `
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const [subpath, deep] = process.argv.slice(2);
const tryRequire = (spec) => {
  try { return { ok: true, path: require.resolve(spec) }; }
  catch (e) { return { ok: false, code: e?.code ?? String(e) }; }
};
const tryImport = (spec) => {
  try { return { ok: true, path: import.meta.resolve(spec) }; }
  catch (e) { return { ok: false, code: e?.code ?? String(e) }; }
};
const out = {
  require: { subpath: tryRequire(subpath), deep: tryRequire(deep) },
  import: { subpath: tryImport(subpath), deep: tryImport(deep) },
  runtime: null,
};
try {
  const mod = await import(subpath);
  const plugin = mod.createConsoleStaticPlugin('/nonexistent-console-dist');
  out.runtime = {
    keys: Object.keys(mod).sort(),
    hasConsoleDistOnAMissingPath: mod.hasConsoleDist('/nonexistent-console-dist'),
    pluginName: plugin?.name,
    pluginMembers: Object.keys(plugin ?? {}).sort(),
  };
} catch (e) {
  out.runtime = { error: e?.code ?? String(e) };
}
process.stdout.write(JSON.stringify(out));
`;

/**
 * The consumer's `tsconfig.json`. Three options carry the whole question:
 *
 *   - `moduleResolution: nodenext` is what makes this a test of the PUBLISHED
 *     door — it reads the `exports` map's `types` condition, so a condition that
 *     stops resolving is `TS2307` here, exactly as it would be for a real
 *     dependent. `bundler` would answer a laxer question under the same name.
 *   - `strict` — a shape assertion under a non-strict program is a weaker
 *     assertion, and `strictNullChecks` in particular is load-bearing for
 *     `resolveConsolePath`'s `string | null` return.
 *   - `skipLibCheck` — the consumer directory installs this ONE tarball, so the
 *     `.d.ts` files of the workspace dependencies it references are absent by
 *     construction. Checking them would report their absence, which is a fact
 *     about the fixture's cupboard and not about the public surface. It does not
 *     weaken anything asserted below: `conformance.ts` is not a declaration
 *     file, so every diagnostic in IT is still reported.
 *
 * `types: []` keeps `@types/node` out of the program — the fixture reaches for
 * no Node global, and a missing ambient package would otherwise red for a reason
 * that has nothing to do with this surface.
 */
const CONSUMER_TSCONFIG = JSON.stringify(
  {
    compilerOptions: {
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      target: 'es2022',
      lib: ['ES2022'],
      module: 'nodenext',
      moduleResolution: 'nodenext',
      types: [],
    },
    include: ['conformance.ts'],
  },
  null,
  2,
);

/**
 * The consumer the `.d.ts` is compiled for (#15630's shape). Written into the
 * consumer directory rather than checked in under `test/` — this file's header
 * says why.
 *
 * `Equals` is the invariant identity check, not an assignability check: two
 * types satisfy it only when tsc considers them THE SAME, so a member added to
 * an options bag reds as loudly as one removed. An assignability pin would let
 * every widening through, and a widening on a published surface is the half this
 * card exists to stop being silent.
 *
 * ⛔ Every `@ts-expect-error` below is a CONTROL and must stay unsatisfiable-on
 * -purpose. If a real change makes one of them legal, the directive goes unused
 * and tsc reports TS2578 — which is the pin telling you the contract moved, not
 * a lint to silence. The ten retirement controls are the load-bearing ones here:
 * they are the only thing standing between this subpath and the barrel it used
 * to be.
 */
const CONFORMANCE_FIXTURE = `
import { createConsoleStaticPlugin, hasConsoleDist, resolveConsolePath } from '@objectstack/cli/console';

type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

// --- The options bag, reached the only way a consumer still can ------------
// \`ResolveConsoleOptions\` is retired from this subpath, so it has no importable
// NAME here. It is still \`resolveConsolePath\`'s parameter type, which means the
// shape stays reachable STRUCTURALLY — and that is exactly what a consumer who
// passes an object literal depends on. Pinning it through \`Parameters\` asserts
// the half that survived the retirement without re-publishing the name.
type ResolveOptions = NonNullable<Parameters<typeof resolveConsolePath>[0]>;
type DriftArgument = Parameters<NonNullable<ResolveOptions['onDrift']>>[0];

type ResolveOptionsHasExactlyTheseFourFields = Expect<Equals<keyof ResolveOptions, 'cwd' | 'cliVersion' | 'warn' | 'onDrift'>>;
type ResolveOptionsMembersKeepTheirRatifiedTypes = Expect<
  Equals<
    ResolveOptions,
    {
      cwd?: string;
      cliVersion?: string;
      warn?: (message: string) => void;
      onDrift?: (drift: DriftArgument) => void;
    }
  >
>;
type DriftShapeIsStillTheThreeStrings = Expect<Equals<DriftArgument, { stamp: string; pin: string; pinFile: string }>>;

// --- The three ratified signatures, exactly --------------------------------
type ResolveConsolePathKeepsItsRatifiedSignature = Expect<Equals<typeof resolveConsolePath, (options?: ResolveOptions) => string | null>>;
type HasConsoleDistKeepsItsRatifiedSignature = Expect<Equals<typeof hasConsoleDist, (consolePath: string) => boolean>>;
type CreateConsoleStaticPluginKeepsItsRatifiedSignature = Expect<
  Equals<
    typeof createConsoleStaticPlugin,
    (
      distPath: string,
      options?: { isDev?: boolean; rootRedirect?: boolean },
    ) => { name: string; init: () => Promise<void>; start: (ctx: any) => Promise<void> }
  >
>;

// --- The consumer limb: code a real dependent writes, compiled for real ----
// The assertions above answer "did the shape move". This answers the question
// the shape exists for — can cloud's node server still WRITE what it writes.
export async function mountConsole(app: { use: (p: unknown) => Promise<void> }): Promise<string> {
  const consolePath: string | null = resolveConsolePath({ cwd: '/srv/app', warn: (m: string) => void m });
  if (consolePath === null) return 'unresolved';
  if (!hasConsoleDist(consolePath)) return 'no-dist';
  const plugin = createConsoleStaticPlugin(consolePath + '/dist', { isDev: false, rootRedirect: true });
  await app.use(plugin);
  return plugin.name;
}

// --- Controls: the ten names this card RETIRED from this subpath -----------
// Each directive MUST fire. An unused one is TS2578, which is this pin saying a
// retired name came back onto the published surface.
// @ts-expect-error CONTROL — CONSOLE_PATH is retired from this subpath
import { CONSOLE_PATH } from '@objectstack/cli/console';
// @ts-expect-error CONTROL — isConsoleVersionCompatible is retired from this subpath
import { isConsoleVersionCompatible } from '@objectstack/cli/console';
// @ts-expect-error CONTROL — ResolveConsoleOptions is retired from this subpath
import type { ResolveConsoleOptions } from '@objectstack/cli/console';
// @ts-expect-error CONTROL — ConsoleShaDrift is retired from this subpath
import type { ConsoleShaDrift } from '@objectstack/cli/console';
// @ts-expect-error CONTROL — detectConsoleShaDrift is retired from this subpath
import { detectConsoleShaDrift } from '@objectstack/cli/console';
// @ts-expect-error CONTROL — formatConsoleShaDriftWarning is retired from this subpath
import { formatConsoleShaDriftWarning } from '@objectstack/cli/console';
// @ts-expect-error CONTROL — formatConsoleShaDriftRefusal is retired from this subpath
import { formatConsoleShaDriftRefusal } from '@objectstack/cli/console';
// @ts-expect-error CONTROL — DRIFT_OVERRIDE_ENV is retired from this subpath
import { DRIFT_OVERRIDE_ENV } from '@objectstack/cli/console';
// @ts-expect-error CONTROL — decideConsoleMount is retired from this subpath (no intended external caller found)
import { decideConsoleMount } from '@objectstack/cli/console';
// @ts-expect-error CONTROL — createRuntimeAssetsPlugin is retired from this subpath (no intended external caller found)
import { createRuntimeAssetsPlugin } from '@objectstack/cli/console';

// --- Controls: the shapes that stayed --------------------------------------
// @ts-expect-error CONTROL — the deep dist/ path is sealed and stays sealed
import { resolveConsolePath as viaDeepPath } from '@objectstack/cli/dist/utils/console.js';
// @ts-expect-error CONTROL — a field the options bag does not declare
const unknownOption = resolveConsolePath({ nope: 1 });
// @ts-expect-error CONTROL — hasConsoleDist takes a required string
const distWithoutAPath = hasConsoleDist();
// @ts-expect-error CONTROL — resolveConsolePath returns string | null, never a bare string
const nullabilityDropped: string = resolveConsolePath();
`;

/** The fixture, line-numbered, so a tsc diagnostic's line points at something. */
function numbered(source: string): string {
  const lines = source.split('\n');
  const width = String(lines.length).length;
  return lines.map((line, i) => `${String(i + 1).padStart(width, ' ')} | ${line}`).join('\n');
}

interface Resolution {
  ok: boolean;
  path?: string;
  code?: string;
}
interface ProbeResult {
  require: { subpath: Resolution; deep: Resolution };
  import: { subpath: Resolution; deep: Resolution };
  runtime:
    | {
        keys: string[];
        hasConsoleDistOnAMissingPath: boolean;
        pluginName: string;
        pluginMembers: string[];
      }
    | { error: string };
}

/**
 * Pack the way the release does. `pnpm pack` applies the same manifest rewrites
 * as `pnpm publish` (`workspace:*` -> concrete versions, `publishConfig`
 * overlay), so the tarball is what a downstream `npm install` receives.
 */
function pnpmPack(destination: string): { filename: string; files: string[] } {
  const execpath = process.env.npm_execpath;
  const viaExecpath = typeof execpath === 'string' && /pnpm/.test(basename(execpath));
  const [command, prefix]: [string, string[]] = viaExecpath ? [process.execPath, [execpath as string]] : ['pnpm', []];
  // `childEnv()` — every child spawned from this directory declares its
  // environment (check:cli-test-child-env): the vitest worker's `TEST`/`VITEST*`
  // family and `NODE_PATH` are stripped, everything pnpm needs (PATH, HOME) stays.
  const res = spawnSync(command, [...prefix, 'pack', '--pack-destination', destination, '--json'], {
    cwd: PACKAGE_ROOT,
    encoding: 'utf8',
    env: childEnv(),
  });
  if (res.error) throw new Error(`pnpm pack could not start (${command}): ${res.error.message}`);
  if (res.status !== 0) {
    throw new Error(`pnpm pack exited ${res.status}\n--- stdout ---\n${res.stdout}\n--- stderr ---\n${res.stderr}`);
  }
  const jsonStart = res.stdout.search(/^\{/m);
  if (jsonStart < 0) throw new Error(`pnpm pack --json printed no report\n${res.stdout}`);
  const report = JSON.parse(res.stdout.slice(jsonStart)) as { filename: string; files: { path: string }[] };
  return { filename: report.filename, files: report.files.map((f) => f.path) };
}

/**
 * The names a `.d.ts` exports, read off its AST — no resolution, no program.
 *
 * ⛔ An export form this walk does not recognise is REPORTED in `unrecognized`,
 * never skipped, and every caller asserts that list is empty. The difference is
 * not theoretical: the silent-skip version of this function saw **2 of 4**
 * exports on a probe `.d.ts` carrying a function, an `export declare enum`, an
 * `export declare namespace` and an `export default` — the enum and the
 * namespace were invisible to it. A 14th export of either form could then have
 * landed in neither `PUBLIC_SURFACE` nor `RETIRED_FROM_THIS_SUBPATH` with the
 * census below still green: this file's own defect, reproduced inside the
 * instrument meant to catch it. Reporting the kind rather than enumerating more
 * of them closes the CLASS — a form nobody has thought of yet reds too.
 */
function declaredExports(dtsPath: string): { names: string[]; starReExports: number; unrecognized: string[] } {
  const sf = ts.createSourceFile(dtsPath, readFileSync(dtsPath, 'utf8'), ts.ScriptTarget.Latest, true);
  const names: string[] = [];
  const unrecognized: string[] = [];
  let starReExports = 0;
  for (const stmt of sf.statements) {
    if (ts.isExportDeclaration(stmt)) {
      if (!stmt.exportClause) starReExports += 1;
      else if (ts.isNamedExports(stmt.exportClause)) for (const el of stmt.exportClause.elements) names.push(el.name.text);
      else unrecognized.push(ts.SyntaxKind[stmt.exportClause.kind]);
      continue;
    }
    // `export default …` and `export = …` are neither a named declaration nor
    // an export declaration; both put something on the public surface.
    if (ts.isExportAssignment(stmt)) {
      unrecognized.push(ts.SyntaxKind[stmt.kind]);
      continue;
    }
    const exported = ts.canHaveModifiers(stmt) && ts.getModifiers(stmt)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    if (
      (ts.isFunctionDeclaration(stmt) ||
        ts.isClassDeclaration(stmt) ||
        ts.isInterfaceDeclaration(stmt) ||
        ts.isTypeAliasDeclaration(stmt) ||
        ts.isEnumDeclaration(stmt) ||
        ts.isModuleDeclaration(stmt)) &&
      stmt.name &&
      ts.isIdentifier(stmt.name)
    ) {
      names.push(stmt.name.text);
    } else if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) names.push(d.name.text);
        else unrecognized.push(ts.SyntaxKind[d.name.kind]);
      }
    } else {
      unrecognized.push(ts.SyntaxKind[stmt.kind]);
    }
  }
  return { names: names.sort(), starReExports, unrecognized };
}

/** Every export of `path` was named — the census over it means what it says. */
function expectEveryExportNamed(what: string, read: { unrecognized: string[] }): void {
  expect(
    read.unrecognized,
    `${what} carries an export form this file cannot name, so any census over it UNDERCOUNTS and the ` +
      'surface it reports is smaller than the one that ships. Teach `declaredExports` the form — do not ' +
      'delete this assertion.',
  ).toEqual([]);
}

let scratch: string;
let packedFiles: string[];
let installedRoot: string;
let probe: ProbeResult;
let typecheckDir: string;
let conformance: { status: number; diagnostics: string; programFiles: string[] };

beforeAll(() => {
  const rootEntry = MANIFEST.exports['.'];
  const rootJs = typeof rootEntry === 'string' ? rootEntry : rootEntry?.default;
  if (!rootJs || !existsSync(join(PACKAGE_ROOT, rootJs))) {
    // Loud, naming the remedy: a missing build must not read as a sealed door.
    throw new Error(
      `packages/cli is not built (${rootJs ?? '<no "." export>'} is absent), so the tarball would carry no dist ` +
        'and every resolution below would fail for the wrong reason. Run: pnpm --filter @objectstack/cli build',
    );
  }

  scratch = mkdtempSync(join(tmpdir(), 'os-cli-console-subpath-'));
  const packed = pnpmPack(scratch);
  packedFiles = packed.files;

  // Unpack into a consumer's node_modules. The tarball root is `package/`.
  const extractDir = join(scratch, 'extract');
  mkdirSync(extractDir);
  const tar = spawnSync('tar', ['-xzf', packed.filename, '-C', extractDir], { encoding: 'utf8', env: childEnv() });
  if (tar.status !== 0) throw new Error(`tar -xzf failed (${tar.status}): ${tar.stderr}`);
  const consumer = join(scratch, 'consumer');
  const scope = join(consumer, 'node_modules', ...PACKAGE_NAME.split('/').slice(0, -1));
  mkdirSync(scope, { recursive: true });
  installedRoot = join(consumer, 'node_modules', ...PACKAGE_NAME.split('/'));
  renameSync(join(extractDir, 'package'), installedRoot);

  // ⛔ No dependency is borrowed from this workspace. The barrel and the module
  // behind it import Node built-ins only, so what executes below executes with
  // exactly the cupboard a real consumer of the tarball has. (`./hook-body`'s
  // pin has to symlink `ts-morph`; this surface needs nothing, and helping it
  // to something would be the same mistake that pin's own comment warns about.)
  const probePath = join(consumer, 'probe.mjs');
  writeFileSync(probePath, PROBE_SOURCE);
  // `childEnv()` already strips `NODE_PATH`, so nothing of this workspace's
  // resolution base reaches the probe: what resolves, resolves from `consumer`.
  const run = spawnSync(process.execPath, [probePath, CONSOLE_SPECIFIER, DEEP_PATH_SPECIFIER], {
    cwd: consumer,
    encoding: 'utf8',
    env: childEnv(),
  });
  if (run.status !== 0) throw new Error(`probe exited ${run.status}\n--- stderr ---\n${run.stderr}\n--- stdout ---\n${run.stdout}`);
  probe = JSON.parse(run.stdout) as ProbeResult;

  // The SHAPE half (#15630). A sibling directory, not `consumer` itself: its own
  // `package.json` declares `type: module` so `nodenext` classifies the fixture
  // as ESM (this package IS ESM-only, and a CJS-classified fixture would red
  // with TS1479 — a fact about the fixture's own manifest, not about the public
  // surface). Nothing of the probe's environment changes.
  typecheckDir = join(consumer, 'typecheck');
  mkdirSync(typecheckDir);
  writeFileSync(
    join(typecheckDir, 'package.json'),
    JSON.stringify({ name: 'objectstack-cli-console-consumer', private: true, type: 'module' }, null, 2),
  );
  writeFileSync(join(typecheckDir, 'tsconfig.json'), CONSUMER_TSCONFIG);
  writeFileSync(join(typecheckDir, 'conformance.ts'), CONFORMANCE_FIXTURE);
  // The compiler is resolved from THIS package (a consumer brings its own tsc;
  // the version question is not what this file pins), but it is spawned with the
  // consumer directory as cwd, so what it RESOLVES it resolves from there.
  const tscEntry = createRequire(import.meta.url).resolve('typescript/lib/tsc.js');
  // `--listFiles` is not decoration: a clean tsc run and a tsc run that compiled
  // NOTHING both print nothing and both exit 0, so "no diagnostics" is only
  // evidence once the program is known to contain the fixture AND the packed
  // `.d.ts` it is supposed to be judging. The file list is what separates those
  // two, and it is asserted below rather than assumed here.
  const tsc = spawnSync(process.execPath, [tscEntry, '--pretty', 'false', '--listFiles', '-p', 'tsconfig.json'], {
    cwd: typecheckDir,
    encoding: 'utf8',
    env: childEnv(),
  });
  if (tsc.error) throw new Error(`tsc could not start: ${tsc.error.message}`);
  // tsc interleaves the file list with the diagnostics on stdout. A listed file
  // is a path that EXISTS; a diagnostic is `path(l,c): error TSxxxx: …`, which
  // never does — so the split is by disk, not by a regex over prose.
  const lines = `${tsc.stdout ?? ''}${tsc.stderr ?? ''}`.split('\n').map((l) => l.trim()).filter((l) => l !== '');
  const listed = new Set(lines.filter((l) => existsSync(l)));
  conformance = {
    status: tsc.status ?? -1,
    diagnostics: lines.filter((l) => !listed.has(l)).join('\n'),
    programFiles: [...listed].map((p) => realpathSync(p)),
  };
}, 120_000);

afterAll(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

describe('the exports map still opens ./console, and opens it onto the barrel (#16046)', () => {
  it('declares exactly the ratified subpaths — the root, ./console, ./hook-body and ./package.json', () => {
    expect(Object.keys(MANIFEST.exports).sort()).toEqual([...RATIFIED_SUBPATHS].sort());
  });

  it('points ./console at the dedicated barrel, NOT at the internal module it used to name', () => {
    const entry = MANIFEST.exports[CONSOLE_SUBPATH];
    expect(entry, `${CONSOLE_SUBPATH} is not declared`).toBeTypeOf('object');
    expect(
      entry,
      'pointing this subpath back at dist/utils/console.js republishes all 13 exports of an internal module, ' +
        'which is #16046 verbatim.',
    ).toEqual({ types: './dist/console.d.ts', default: './dist/console.js' });
  });
});

describe('the tarball ships what the door opens onto', () => {
  it('carries the barrel, the internal module behind it and the manifest', () => {
    expect(packedFiles).toEqual(
      expect.arrayContaining(['dist/console.js', 'dist/console.d.ts', 'dist/utils/console.js', 'dist/utils/console.d.ts', 'package.json']),
    );
  });
});

describe('resolution from a consumer directory outside the workspace', () => {
  it(`resolves ${CONSOLE_SPECIFIER} under the require condition to the barrel`, () => {
    expect(probe.require.subpath).toEqual({ ok: true, path: join(installedRoot, 'dist', 'console.js') });
  });

  it(`resolves ${CONSOLE_SPECIFIER} under the import condition to the same file`, () => {
    expect(probe.import.subpath.ok, JSON.stringify(probe.import.subpath)).toBe(true);
    expect(fileURLToPath(probe.import.subpath.path as string)).toBe(join(installedRoot, 'dist', 'console.js'));
  });

  it('keeps the deep dist/ path sealed under both conditions — the door is the subpath, not the file', () => {
    expect(probe.require.deep).toEqual({ ok: false, code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
    expect(probe.import.deep).toEqual({ ok: false, code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
  });
});

describe('the public surface is exactly three names', () => {
  it('at run time: the three helpers, nothing else', () => {
    expect(probe.runtime, 'the barrel did not import from the packed copy').not.toHaveProperty('error');
    expect((probe.runtime as { keys: string[] }).keys).toEqual(PUBLIC_SURFACE);
  });

  it('in the shipped types: the same three, and no star re-export that would make it a barrel over the module', () => {
    const read = declaredExports(join(installedRoot, 'dist', 'console.d.ts'));
    expectEveryExportNamed('the packed barrel `.d.ts`', read);
    const { names, starReExports } = read;
    expect(
      starReExports,
      'a star re-export ratifies whatever utils/console.ts grows next — which is the whole of #16046',
    ).toBe(0);
    expect(names).toEqual(PUBLIC_SURFACE);
  });

  it('publishes NONE of the ten names this card retired — neither as a value nor in the types', () => {
    const runtimeKeys = new Set((probe.runtime as { keys: string[] }).keys);
    const stillRuntime = RETIRED_RUNTIME_NAMES.filter((n) => runtimeKeys.has(n));
    expect(stillRuntime, 'retired names reachable at run time through the published subpath').toEqual([]);

    const typed = declaredExports(join(installedRoot, 'dist', 'console.d.ts'));
    expectEveryExportNamed('the packed barrel `.d.ts`', typed);
    const declared = new Set(typed.names);
    const stillTyped = RETIRED_FROM_THIS_SUBPATH.filter((n) => declared.has(n));
    expect(stillTyped, 'retired names reachable at type level through the published subpath').toEqual([]);
  });

  it('retires exactly the names that are NOT public — the two lists partition the module, with nothing dropped', () => {
    // The census is taken from the packed INTERNAL module rather than from a
    // constant here, so a 14th export added to `utils/console.ts` lands in
    // neither list and fails this — instead of silently being neither published
    // nor recorded as retired.
    const internal = declaredExports(join(installedRoot, 'dist', 'utils', 'console.d.ts'));
    // ⛔ First: the census is only a partition if every export was NAMEABLE. An
    // export form this walk cannot name is missing from both lists, and the
    // equality below would still hold — green, over a surface read short.
    expectEveryExportNamed('the packed internal module `.d.ts`', internal);
    expect(internal.starReExports).toBe(0);
    expect(internal.names).toEqual([...PUBLIC_SURFACE, ...RETIRED_FROM_THIS_SUBPATH].sort());
  });
});

describe('the helpers that answer from the packed copy are the platform\'s own', () => {
  it('answers hasConsoleDist(false) for a path that cannot exist, from the tarball', () => {
    const runtime = probe.runtime as Extract<ProbeResult['runtime'], { pluginName: string }>;
    expect(runtime.hasConsoleDistOnAMissingPath).toBe(false);
  });

  it('builds the console static plugin with the id the host kernel registers', () => {
    const runtime = probe.runtime as Extract<ProbeResult['runtime'], { pluginName: string }>;
    expect(runtime.pluginName).toBe('com.objectstack.console-static');
    expect(runtime.pluginMembers).toEqual(['init', 'name', 'start']);
  });
});

describe('the public surface still has the SHAPES a consumer compiles against (#15630)', () => {
  // ⛔ This assertion comes FIRST on purpose. Zero diagnostics is the verdict the
  // next test reads, and zero diagnostics is also what a program that compiled
  // nothing prints — so the population has to be established before the silence
  // over it means anything.
  it('put the fixture AND the packed .d.ts in the program — not the workspace source, not nothing', () => {
    const real = (p: string): string => realpathSync(p);
    expect(conformance.programFiles, 'the fixture itself was never compiled').toContain(real(join(typecheckDir, 'conformance.ts')));
    expect(
      conformance.programFiles,
      'the barrel was not reached — a `types` condition that stops resolving lands here',
    ).toContain(real(join(installedRoot, 'dist', 'console.d.ts')));
    expect(
      conformance.programFiles,
      'the shapes were read from somewhere other than the PACKED tarball',
    ).toContain(real(join(installedRoot, 'dist', 'utils', 'console.d.ts')));
    // Nothing of this workspace may be in that program: a source-tree file would
    // make every shape below a verdict about the checkout instead of about what
    // ships.
    expect(conformance.programFiles.filter((p) => p.startsWith(`${realpathSync(PACKAGE_ROOT)}/`))).toEqual([]);
  });

  it('compiles a real consumer against the PACKED .d.ts, reached through the exports map', () => {
    expect(
      conformance.diagnostics,
      'tsc reported diagnostics compiling the conformance fixture against the packed .d.ts. Either the public ' +
        'shape moved — in which case this is a BREAKING change to a published surface and the fixture is updated ' +
        'deliberately, with a changeset — or a CONTROL stopped firing (TS2578), which says the same thing from the ' +
        `other side. A retirement control that stops firing means a retired name is public again. The fixture, ` +
        `numbered:\n${numbered(CONFORMANCE_FIXTURE)}`,
    ).toBe('');
    expect(conformance.status, 'tsc exited non-zero').toBe(0);
  });
});
