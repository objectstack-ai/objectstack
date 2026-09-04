// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `@objectstack/cli/hook-body` and `@objectstack/cli/package.json` are public
 * subpaths of the PUBLISHED package — pinned against the packed tarball, from a
 * consumer directory outside the workspace, because that is the only place the
 * defect this file pins has ever existed.
 *
 * ## The defect (#15325)
 *
 * 17.3.0 gave this package an `exports` map (#13123) and ratified exactly one
 * subpath beside the root — `./console`, for cloud's `objectos-runtime`. The
 * hook-body extractor was reachable as a deep `dist/utils/extract-hook-body.js`
 * import until that day, and an app's hook-body fidelity harness (hotcrm's
 * `test/helpers/action-sandbox.ts`) reached it that way on purpose: it runs a
 * hook through the SAME lowering `os build` ships, so a test executes what
 * production will execute rather than a lookalike. After the seal the specifier
 * was dead at type level (`TS2307`) and at run time
 * (`ERR_PACKAGE_PATH_NOT_EXPORTED`) — while the file still shipped in the
 * tarball. Only the door was gone. `@objectstack/cli/package.json` was sealed
 * by the same map, breaking the ordinary idiom of reading a dependency's own
 * manifest, with no upside.
 *
 * The remedy is the one #13123's own body prescribes for an out-of-repo
 * consumer — ratify the subpath as public surface rather than read `dist/`
 * paths — applied to the second consumer. ⛔ NOT a local reimplementation: a
 * hand-rolled extractor passes its own tests while diverging from the rule the
 * build actually applies, which is the failure mode #13651 was filed about.
 *
 * ## Why the packed tarball and not the source tree
 *
 * An `exports` map is a PACKAGING contract. Inside the monorepo nothing is
 * sealed — a relative import, a vitest alias or a `paths` entry reaches any
 * file — so a test that resolves through the workspace proves nothing about
 * what an installed copy can reach. #14874 measured the other half of the same
 * lesson: the packaging layer lies to source-tree tests (npm ships a `bin`
 * target regardless of `files`). So this file packs the package the way
 * `pnpm publish` would, unpacks it into a throwaway `node_modules` under the OS
 * temp dir, and asks a child Node process — with that directory as its cwd and
 * nothing of this workspace on its resolution path — the three questions the
 * card measured. The one thing borrowed from the workspace is the tarball's own
 * runtime dependency `ts-morph`, symlinked in so the extractor can be EXECUTED
 * from the packed copy and not merely resolved; resolution never consults it.
 *
 * ## What this file deliberately does NOT do
 *
 * It does not assert the extractor's behaviour beyond one clean body and two
 * classified refusals — `test/extract-hook-body.test.ts` owns that, over the
 * source. What this file owns is the DOOR: that the ratified subpath resolves
 * under both `require` and `import` conditions, that it exposes exactly the
 * four ratified names and nothing the internal module may grow next, that the
 * deep `dist/` path STAYS sealed, and that the extractor which answers from the
 * packed copy is the platform's own (its refusal is a `HookBodyExtractionError`
 * carrying `kind`, not a bare `Error`). ⚠️ That refusal is a build-time class,
 * not an ADR-0112 envelope — it carries no `code`/`status` — so the assertions
 * below name `kind`, `name` and `originLabel`, never a bare `toThrow()`.
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
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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

/** The subpath this card ratifies, in the three spellings a consumer meets. */
const HOOK_BODY_SUBPATH = './hook-body';
const HOOK_BODY_SPECIFIER = `${PACKAGE_NAME}/hook-body`;
const MANIFEST_SPECIFIER = `${PACKAGE_NAME}/package.json`;
/** The pre-17.3.0 spelling the harness used — the door that is gone and STAYS gone. */
const DEEP_PATH_SPECIFIER = `${PACKAGE_NAME}/dist/utils/extract-hook-body.js`;

/**
 * The whole ratified surface, by name. Four names, not a barrel: the entry
 * re-exports these and nothing else, so an export the internal module gains
 * tomorrow is NOT public until someone edits both the entry and this list.
 */
const RATIFIED_SURFACE = ['ExtractedBody', 'HookBodyExtractionError', 'HookBodyRefusalKind', 'extractHookBody'];
/** The two of those that exist at run time (the other two are types). */
const RATIFIED_RUNTIME_SURFACE = ['HookBodyExtractionError', 'extractHookBody'];

/**
 * Every subpath the published package resolves, in full. A subpath removed
 * here is a consumer broken in the exact shape of #15325 and #13662; a subpath
 * added here is a `minor` bump (a new accepted key on a published surface).
 * Either way this list is edited on purpose, in the same PR, with a changeset.
 */
const RATIFIED_SUBPATHS = ['.', './console', HOOK_BODY_SUBPATH, './package.json'];

/**
 * The probe the consumer directory runs. Plain ESM, no transform, no import of
 * anything but Node built-ins and the packed package: `require.resolve` for the
 * `require` condition, `import.meta.resolve` for the `import` condition, and a
 * real `import()` that CALLS the extractor so the answer is about the code that
 * ships, not about a path string.
 */
const PROBE_SOURCE = `
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const [hookBody, manifest, deep] = process.argv.slice(2);
const tryRequire = (spec) => {
  try { return { ok: true, path: require.resolve(spec) }; }
  catch (e) { return { ok: false, code: e?.code ?? String(e) }; }
};
const tryImport = (spec) => {
  try { return { ok: true, path: import.meta.resolve(spec) }; }
  catch (e) { return { ok: false, code: e?.code ?? String(e) }; }
};
const out = {
  require: { hookBody: tryRequire(hookBody), manifest: tryRequire(manifest), deep: tryRequire(deep) },
  import: { hookBody: tryImport(hookBody), manifest: tryImport(manifest), deep: tryImport(deep) },
  runtime: null,
};
try {
  const mod = await import(hookBody);
  const refuse = (fn, label) => {
    try { mod.extractHookBody(fn, label); return null; }
    catch (e) {
      return {
        isInstance: e instanceof mod.HookBodyExtractionError,
        name: e?.name, kind: e?.kind, originLabel: e?.originLabel,
        freeIdentifiers: e?.freeIdentifiers, nodeOnlyIdentifiers: e?.nodeOnlyIdentifiers,
      };
    }
  };
  out.runtime = {
    keys: Object.keys(mod).sort(),
    lowered: mod.extractHookBody((ctx) => { ctx.input.x = 1; return ctx.input; }, 'probe:clean'),
    forbidden: refuse((ctx) => { fetch('https://example.invalid'); }, 'probe:forbidden'),
    free: refuse((ctx) => { helper(ctx); }, 'probe:free'),
  };
} catch (e) {
  out.runtime = { error: e?.code ?? String(e) };
}
process.stdout.write(JSON.stringify(out));
`;

interface Resolution {
  ok: boolean;
  path?: string;
  code?: string;
}
interface Refusal {
  isInstance: boolean;
  name?: string;
  kind?: string;
  originLabel?: string;
  freeIdentifiers?: string[];
  nodeOnlyIdentifiers?: string[];
}
interface ProbeResult {
  require: { hookBody: Resolution; manifest: Resolution; deep: Resolution };
  import: { hookBody: Resolution; manifest: Resolution; deep: Resolution };
  runtime:
    | {
        keys: string[];
        lowered: { source: string; capabilities: string[]; isExpression: boolean };
        forbidden: Refusal | null;
        free: Refusal | null;
      }
    | { error: string };
}

/**
 * Pack the way the release does. `pnpm pack` applies the same manifest
 * rewrites as `pnpm publish` (`workspace:*` → concrete versions, `publishConfig`
 * overlay), so the tarball is what a downstream `npm install` receives;
 * `scripts/publish-smoke-pack.mjs` packs the release candidate with it for the
 * same reason. Under `pnpm test` the runner is on `PATH`; `npm_execpath` is
 * honoured first when it names pnpm, so a nested invocation packs with the
 * pnpm that is running it.
 */
function pnpmPack(destination: string): { filename: string; files: string[] } {
  const execpath = process.env.npm_execpath;
  const viaExecpath = typeof execpath === 'string' && /pnpm/.test(basename(execpath));
  const [command, prefix]: [string, string[]] = viaExecpath ? [process.execPath, [execpath as string]] : ['pnpm', []];
  const res = spawnSync(command, [...prefix, 'pack', '--pack-destination', destination, '--json'], {
    cwd: PACKAGE_ROOT,
    encoding: 'utf8',
  });
  if (res.error) throw new Error(`pnpm pack could not start (${command}): ${res.error.message}`);
  if (res.status !== 0) {
    throw new Error(`pnpm pack exited ${res.status}\n--- stdout ---\n${res.stdout}\n--- stderr ---\n${res.stderr}`);
  }
  // pnpm prints the JSON report last; anything a lifecycle script logged
  // before it is not JSON, so parse from the first `{` at line start.
  const jsonStart = res.stdout.search(/^\{/m);
  if (jsonStart < 0) throw new Error(`pnpm pack --json printed no report\n${res.stdout}`);
  const report = JSON.parse(res.stdout.slice(jsonStart)) as { filename: string; files: { path: string }[] };
  return { filename: report.filename, files: report.files.map((f) => f.path) };
}

/** The names a `.d.ts` exports, read off its AST — no resolution, no program. */
function declaredExports(dtsPath: string): { names: string[]; starReExports: number } {
  const sf = ts.createSourceFile(dtsPath, readFileSync(dtsPath, 'utf8'), ts.ScriptTarget.Latest, true);
  const names: string[] = [];
  let starReExports = 0;
  for (const stmt of sf.statements) {
    if (ts.isExportDeclaration(stmt)) {
      if (!stmt.exportClause) starReExports += 1;
      else if (ts.isNamedExports(stmt.exportClause)) for (const el of stmt.exportClause.elements) names.push(el.name.text);
      continue;
    }
    const exported = ts.canHaveModifiers(stmt) && ts.getModifiers(stmt)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    if (
      (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt) || ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)) &&
      stmt.name
    ) {
      names.push(stmt.name.text);
    } else if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) if (ts.isIdentifier(d.name)) names.push(d.name.text);
    }
  }
  return { names: names.sort(), starReExports };
}

let scratch: string;
let packedFiles: string[];
let installedRoot: string;
let probe: ProbeResult;

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

  scratch = mkdtempSync(join(tmpdir(), 'os-cli-subpath-'));
  const packed = pnpmPack(scratch);
  packedFiles = packed.files;

  // Unpack into a consumer's node_modules. The tarball root is `package/`.
  const extractDir = join(scratch, 'extract');
  mkdirSync(extractDir);
  const tar = spawnSync('tar', ['-xzf', packed.filename, '-C', extractDir], { encoding: 'utf8' });
  if (tar.status !== 0) throw new Error(`tar -xzf failed (${tar.status}): ${tar.stderr}`);
  const consumer = join(scratch, 'consumer');
  const scope = join(consumer, 'node_modules', ...PACKAGE_NAME.split('/').slice(0, -1));
  mkdirSync(scope, { recursive: true });
  installedRoot = join(consumer, 'node_modules', ...PACKAGE_NAME.split('/'));
  renameSync(join(extractDir, 'package'), installedRoot);

  // The extractor's one runtime dependency, so `import()` can EXECUTE it from
  // the packed copy. A real-path symlink: pnpm's store keeps ts-morph's own
  // dependencies beside the real directory, and Node resolves from there.
  symlinkSync(realpathSync(join(PACKAGE_ROOT, 'node_modules', 'ts-morph')), join(consumer, 'node_modules', 'ts-morph'), 'dir');

  const probePath = join(consumer, 'probe.mjs');
  writeFileSync(probePath, PROBE_SOURCE);
  const run = spawnSync(process.execPath, [probePath, HOOK_BODY_SPECIFIER, MANIFEST_SPECIFIER, DEEP_PATH_SPECIFIER], {
    cwd: consumer,
    encoding: 'utf8',
    env: { ...process.env, NODE_PATH: '' },
  });
  if (run.status !== 0) throw new Error(`probe exited ${run.status}\n--- stderr ---\n${run.stderr}\n--- stdout ---\n${run.stdout}`);
  probe = JSON.parse(run.stdout) as ProbeResult;
}, 120_000);

afterAll(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

describe('the exports map of the published package (#15325)', () => {
  it('declares exactly the ratified subpaths — the root, ./console, ./hook-body and ./package.json', () => {
    expect(Object.keys(MANIFEST.exports).sort()).toEqual([...RATIFIED_SUBPATHS].sort());
  });

  it('points ./hook-body at a dedicated entry with a types condition, in the shape ./console uses', () => {
    const entry = MANIFEST.exports[HOOK_BODY_SUBPATH];
    expect(entry, `${HOOK_BODY_SUBPATH} is not declared`).toBeTypeOf('object');
    expect(entry).toEqual({ types: './dist/hook-body.d.ts', default: './dist/hook-body.js' });
  });

  it('points ./package.json at the manifest itself, as @objectstack/console spells it', () => {
    expect(MANIFEST.exports['./package.json']).toBe('./package.json');
  });
});

describe('the tarball ships what the doors open onto (the card\'s premise, re-derived)', () => {
  it('carries the extractor, the ratified entry and the manifest', () => {
    expect(packedFiles).toEqual(
      expect.arrayContaining([
        'dist/utils/extract-hook-body.js',
        'dist/utils/extract-hook-body.d.ts',
        'dist/hook-body.js',
        'dist/hook-body.d.ts',
        'package.json',
      ]),
    );
  });
});

describe('resolution from a consumer directory outside the workspace', () => {
  it(`resolves ${HOOK_BODY_SPECIFIER} under the require condition to the ratified entry`, () => {
    expect(probe.require.hookBody).toEqual({ ok: true, path: join(installedRoot, 'dist', 'hook-body.js') });
  });

  it(`resolves ${HOOK_BODY_SPECIFIER} under the import condition to the same file`, () => {
    expect(probe.import.hookBody.ok, JSON.stringify(probe.import.hookBody)).toBe(true);
    expect(fileURLToPath(probe.import.hookBody.path as string)).toBe(join(installedRoot, 'dist', 'hook-body.js'));
  });

  it(`resolves ${MANIFEST_SPECIFIER} under both conditions`, () => {
    expect(probe.require.manifest).toEqual({ ok: true, path: join(installedRoot, 'package.json') });
    expect(probe.import.manifest.ok, JSON.stringify(probe.import.manifest)).toBe(true);
    expect(fileURLToPath(probe.import.manifest.path as string)).toBe(join(installedRoot, 'package.json'));
  });

  it(`keeps the deep dist/ path sealed under both conditions — the door is the subpath, not the file`, () => {
    expect(probe.require.deep).toEqual({ ok: false, code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
    expect(probe.import.deep).toEqual({ ok: false, code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
  });
});

describe('the ratified surface is exactly four names', () => {
  it('at run time: the two values, nothing else', () => {
    expect(probe.runtime, 'the entry did not import from the packed copy').not.toHaveProperty('error');
    expect((probe.runtime as { keys: string[] }).keys).toEqual(RATIFIED_RUNTIME_SURFACE);
  });

  it('in the shipped types: the two values and the two types, and no star re-export that would make it a barrel', () => {
    const { names, starReExports } = declaredExports(join(installedRoot, 'dist', 'hook-body.d.ts'));
    expect(starReExports, 'a star re-export ratifies whatever the internal module grows next').toBe(0);
    expect(names).toEqual(RATIFIED_SURFACE);
  });
});

describe('the extractor that answers from the packed copy is the platform\'s own', () => {
  it('lowers a clean body to the metadata-only source os build ships', () => {
    const runtime = probe.runtime as Extract<ProbeResult['runtime'], { lowered: unknown }>;
    expect(runtime.lowered.source).toContain('ctx.input.x = 1');
    expect(runtime.lowered.source).toContain('return ctx.input');
    expect(runtime.lowered.isExpression).toBe(false);
    expect(runtime.lowered.capabilities).toEqual([]);
  });

  it('refuses a forbidden token with a HookBodyExtractionError classified forbidden-token', () => {
    const runtime = probe.runtime as Extract<ProbeResult['runtime'], { forbidden: unknown }>;
    expect(runtime.forbidden).not.toBeNull();
    expect(runtime.forbidden).toMatchObject({
      isInstance: true,
      name: 'HookBodyExtractionError',
      kind: 'forbidden-token',
      originLabel: 'probe:forbidden',
    });
  });

  it('refuses a scope leak with the free identifier named — the ts-morph path runs from the tarball too', () => {
    const runtime = probe.runtime as Extract<ProbeResult['runtime'], { free: unknown }>;
    expect(runtime.free).not.toBeNull();
    expect(runtime.free).toMatchObject({
      isInstance: true,
      name: 'HookBodyExtractionError',
      kind: 'free-identifiers',
      originLabel: 'probe:free',
      freeIdentifiers: ['helper'],
      nodeOnlyIdentifiers: [],
    });
  });
});
