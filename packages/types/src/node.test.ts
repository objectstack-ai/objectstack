// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * cloud#1013 / #4700 — resolving a host-app package from a framework package.
 * #4719 — and only when the host app DECLARES it.
 *
 * The first defect: `serve` loaded `@objectstack/organizations` with a BARE
 * `import()`. Node ESM resolves that against the importer's own realpath — the
 * framework package's, inside the framework workspace — while the package is
 * cloud-private and only ever exists in the host app's `node_modules`. It could
 * therefore never resolve, and every walled tenancy posture died on the ADR-0093
 * D5 fail-fast. #4700 found the same bare import in two more framework packages
 * (`@objectstack/verify`'s `bootStack`, the dogfood multi-org probes), which is
 * why the resolver moved here from `packages/cli/src/utils/import-from-host.ts`:
 * one behaviour, one source.
 *
 * The second defect (#4719) is the fix's own: "resolve from the host app" was a
 * CJS `createRequire`, and CJS resolution honours `NODE_PATH` — which every pnpm
 * bin shim exports, pointing at the hoisted workspace store. So ANY package
 * transitively reachable from anywhere in the workspace resolved "from the host
 * app", whatever that app declared, and D5's "declare it in the app's
 * package.json" was advice about a thing nothing checked. The gate is now the
 * DECLARATION; reachability is refused.
 *
 * These cases run against REAL fixture apps on disk (a real `node_modules`, real
 * resolution, a real `NODE_PATH`, nothing mocked).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import * as NodeModule from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  createHostImporter,
  createHostRequire,
  hostImportFailureKind,
  isDeclaredByHost,
  packageNameFromSpecifier,
  readHostDeclaration,
} from './node.js';

/** The cloud-private package at the heart of cloud#1013. */
const ORGANIZATIONS = '@objectstack/organizations';
/** A package that fails while it EVALUATES — not while it resolves. */
const BROKEN = '@fixture/throws-on-load';
/**
 * Installed ONLY in the `NODE_PATH` store — i.e. exactly the shape a pnpm bin
 * shim puts every transitively-reachable workspace package into (#4719).
 */
const HOISTED_ONLY = '@fixture/hoisted-only';
/** Declared by the host app and installed nowhere at all. */
const DECLARED_MISSING = '@fixture/declared-but-missing';

/**
 * A directory inside the framework workspace — what a bare `import()` from a
 * framework package resolves against. (`import.meta` is unavailable here: this
 * package is CJS-typed, and `module: NodeNext` forbids it. The CWD is the
 * package root under vitest, and the assertion holds for any framework
 * directory anyway — none of them can see a cloud-private package.)
 */
const PACKAGE_ROOT = process.cwd();

/** Host app that declares (and installs) what it uses — the supported shape. */
let hostRoot: string;
/** Host app that declares NOTHING, used against the NODE_PATH store below. */
let undeclaringRoot: string;
/** A directory with no `package.json` at all. */
let manifestlessRoot: string;
/** Stands in for `<workspace>/node_modules/.pnpm/node_modules`. */
let nodePathStore: string;

const originalNodePath = process.env.NODE_PATH;

/** `Module.globalPaths` is derived from NODE_PATH once, at startup. */
function reloadNodePath(): void {
  (NodeModule as unknown as { _initPaths: () => void })._initPaths();
}

function writeFixturePackage(root: string, name: string, indexJs: string): void {
  const dir = join(root, 'node_modules', ...name.split('/'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name, version: '0.0.0-fixture', type: 'module', main: 'index.js' }),
    'utf8',
  );
  writeFileSync(join(dir, 'index.js'), indexJs, 'utf8');
}

beforeAll(() => {
  // A host app exactly as the fix expects one: it DECLARES the packages it uses
  // and has them installed in its own node_modules. The framework workspace this
  // package lives in has neither.
  hostRoot = mkdtempSync(join(tmpdir(), 'os-import-from-host-'));
  writeFileSync(
    join(hostRoot, 'package.json'),
    JSON.stringify({
      name: 'host-app-fixture',
      type: 'module',
      dependencies: { [ORGANIZATIONS]: '*' },
      // #4719 fixture amendment: the evaluation-crash case below imports this
      // package, and an undeclared name is no longer looked up in the host's
      // node_modules at all — so the crash it exists to prove would be masked by
      // an "undeclared" verdict. Declaring it is the correct fix (the fixture app
      // really does depend on it); loosening the gate would not be.
      devDependencies: { [BROKEN]: '*' },
      // Declared, deliberately never installed anywhere.
      optionalDependencies: { [DECLARED_MISSING]: '*' },
    }),
    'utf8',
  );
  writeFixturePackage(
    hostRoot,
    ORGANIZATIONS,
    'export class OrganizationsPlugin { name = "com.objectstack.organizations"; }\n',
  );
  writeFixturePackage(hostRoot, BROKEN, 'throw new Error("fixture package exploded on import");\n');

  undeclaringRoot = mkdtempSync(join(tmpdir(), 'os-import-undeclared-'));
  writeFileSync(
    join(undeclaringRoot, 'package.json'),
    JSON.stringify({ name: 'undeclaring-app-fixture', type: 'module', dependencies: {} }),
    'utf8',
  );

  manifestlessRoot = mkdtempSync(join(tmpdir(), 'os-import-no-manifest-'));

  // The hoisted store, and NODE_PATH pointed at it — the pnpm bin shim's first
  // act, reproduced. `Module.globalPaths` is rebuilt so an ALREADY-CREATED
  // `require` sees it, which is what makes this the issue's exact repro.
  nodePathStore = mkdtempSync(join(tmpdir(), 'os-node-path-store-'));
  const pkgDir = join(nodePathStore, ...HOISTED_ONLY.split('/'));
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(
    join(pkgDir, 'package.json'),
    JSON.stringify({
      name: HOISTED_ONLY,
      version: '0.0.0-fixture',
      type: 'module',
      main: 'index.js',
    }),
    'utf8',
  );
  writeFileSync(join(pkgDir, 'index.js'), 'export const hoisted = true;\n', 'utf8');
  process.env.NODE_PATH = originalNodePath ? `${nodePathStore}:${originalNodePath}` : nodePathStore;
  reloadNodePath();
});

afterAll(() => {
  if (originalNodePath === undefined) delete process.env.NODE_PATH;
  else process.env.NODE_PATH = originalNodePath;
  reloadNodePath();
  for (const dir of [hostRoot, undeclaringRoot, manifestlessRoot, nodePathStore]) {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('host-app package resolution (cloud#1013, #4700)', () => {
  it("the framework package's own resolution cannot see a host-only package — the defect", () => {
    // Literally the issue's repro, from a framework package:
    //   node -e "require.resolve('@objectstack/organizations')" -> MODULE_NOT_FOUND
    // A bare `import()` in serve.ts / harness.ts resolved from exactly here,
    // which is why declaring the dependency in the app changed nothing.
    expect(() => createHostRequire(PACKAGE_ROOT).resolve(ORGANIZATIONS)).toThrow(
      /Cannot find module/,
    );
  });

  it('resolves a package that exists ONLY in the host app', async () => {
    const importFromHost = createHostImporter(hostRoot);
    const mod = await importFromHost(ORGANIZATIONS);
    // The export `serve` and `bootStack` construct: `new mod.OrganizationsPlugin()`.
    expect(typeof mod.OrganizationsPlugin).toBe('function');
    expect(new mod.OrganizationsPlugin().name).toBe('com.objectstack.organizations');
  });

  it(
    'the DEFAULT fallback is this package\'s own resolution — @objectstack/spec and nothing else',
    async () => {
      // ⚠️ Read this case for what it measures, not for what it used to be
      // called (#10943). It was named "falls back to the importing package's
      // own resolution", which is the helper's DOCUMENTED contract — but it
      // passes because `@objectstack/spec` is the one dependency
      // `@objectstack/types` declares, so it is green whether the fallback
      // resolves from the caller or from here. It could never have failed on
      // the defect it appeared to guard, and it is why that defect survived to
      // be found by measurement instead.
      //
      // What it legitimately pins is the DEFAULT (no `fallbackImport`) base:
      // unchanged by #10943, so an out-of-tree caller keeps working. The
      // documented contract is pinned by the caller-anchored matrix below,
      // where every row can actually fail.
      const mod = await createHostImporter(undeclaringRoot)('@objectstack/spec');
      expect(mod).toBeTypeOf('object');
    },
    // Explicit testTimeout (#9311): this is the ONE case in this file that
    // actually loads `@objectstack/spec` — a real dynamic `import()` of a
    // multi-megabyte package, not the small on-disk fixtures its siblings use
    // (all <10ms). Measured unloaded on a 4-CPU box: ~0.9-1.1s. Under nothing
    // heavier than `turbo run test --concurrency=2` it was already observed at
    // 5061ms against the 5000ms default — margin, not correctness, is the
    // defect (#9311). 30s matches the #3662 precedent for subprocess/real-load
    // cases elsewhere in the repo (~30x the unloaded cost, ~6x the already-
    // observed loaded failure point) rather than a bare guess.
    30_000,
  );

  it('reports a package that neither can resolve as module-not-found', async () => {
    const importFromHost = createHostImporter(hostRoot);
    // Callers classify "missing vs crashed" off this error (Serve.
    // isModuleNotFoundError), so the absent case must stay recognisable.
    await expect(importFromHost('@fixture/nowhere-at-all')).rejects.toThrow(
      /Cannot find (module|package)|Failed to (load|resolve)/,
    );
  });

  it('propagates an evaluation crash instead of masking it as module-not-found', async () => {
    // A host-resolved package that THROWS while loading is a broken package,
    // not a missing one. Re-importing it bare (the shape this helper replaced)
    // would swap the real cause for a MODULE_NOT_FOUND, which every caller
    // reads as "not installed" — a crash silently downgraded to a skip, or a
    // fatal telling the operator to install what is already installed.
    const importFromHost = createHostImporter(hostRoot);
    await expect(importFromHost(BROKEN)).rejects.toThrow(/fixture package exploded on import/);
    const err = await importFromHost(BROKEN).catch((e: unknown) => e);
    expect(hostImportFailureKind(err)).toBeUndefined();
  });
});

describe('declaration gates the host lookup (#4719)', () => {
  it('PRECONDITION: NODE_PATH really does make an undeclared package resolvable', () => {
    // The whole defect in one assertion. This is the resolution the previous
    // implementation performed and trusted: a CJS `require` anchored at an app
    // that declares NOTHING, finding a package because the launcher exported
    // NODE_PATH. It succeeds — which is why the guard below has to exist.
    const resolved = createHostRequire(undeclaringRoot).resolve(HOISTED_ONLY);
    expect(resolved).toContain(nodePathStore);
    expect(isDeclaredByHost(HOISTED_ONLY, undeclaringRoot)).toBe(false);
  });

  it('REFUSES an undeclared package even though NODE_PATH resolves it', async () => {
    // THE case. Before #4719 this imported the hoisted copy and reported
    // success, so `objectstack serve` booted a walled posture for an app that
    // had never declared the enterprise runtime — but only when launched
    // through a pnpm shim. Now the manifest is the answer, in every launcher.
    const importFromHost = createHostImporter(undeclaringRoot);
    const err = await importFromHost(HOISTED_ONLY).catch((e: unknown) => e);
    expect(hostImportFailureKind(err)).toBe('undeclared');
    expect((err as Error).message).toMatch(/does not declare it/);
    expect((err as Error).message).toMatch(/Declare it in that app's package\.json/);
  });

  it('ACCEPTS the same package once the app declares it', async () => {
    // Same package, same NODE_PATH store, same process — only the manifest
    // differs. That is the contract: the declaration decides, not the layout.
    const declaringRoot = mkdtempSync(join(tmpdir(), 'os-import-declared-'));
    try {
      writeFileSync(
        join(declaringRoot, 'package.json'),
        JSON.stringify({ name: 'declaring-app', dependencies: { [HOISTED_ONLY]: '*' } }),
        'utf8',
      );
      const mod = await createHostImporter(declaringRoot)(HOISTED_ONLY);
      expect(mod.hoisted).toBe(true);
    } finally {
      rmSync(declaringRoot, { recursive: true, force: true });
    }
  });

  it('DECLARED but unresolvable is a broken install, worded as one', async () => {
    // The other half of the fail-fast contract: the two failures used to
    // collapse into one MODULE_NOT_FOUND with opposite remedies. An operator
    // who has already declared the package must not be sent back to the
    // package.json they just edited.
    const err = await createHostImporter(hostRoot)(DECLARED_MISSING).catch((e: unknown) => e);
    expect(hostImportFailureKind(err)).toBe('declared-unresolvable');
    expect((err as Error).message).toMatch(/DECLARES it \(optionalDependencies: "\*"\)/);
    expect((err as Error).message).toMatch(/INSTALL problem, not a declaration problem/);
    expect((err as Error).message).not.toMatch(/does not declare it/);
  });

  it('both failures stay classifiable as module-not-found for existing callers', async () => {
    // `serve`'s optional-plugin guards and the `requires` resolver branch on
    // `isModuleNotFoundError`; neither new error may fall out of that class.
    for (const [root, pkg] of [
      [undeclaringRoot, HOISTED_ONLY],
      [hostRoot, DECLARED_MISSING],
    ] as const) {
      const err = await createHostImporter(root)(pkg).catch((e: { code?: string }) => e);
      expect(err.code).toBe('MODULE_NOT_FOUND');
    }
  });

  it('a directory with no package.json declares nothing, and says so', async () => {
    const decl = readHostDeclaration(HOISTED_ONLY, manifestlessRoot);
    expect(decl).toMatchObject({ declared: false, manifestMissing: true });
    await expect(createHostImporter(manifestlessRoot)(HOISTED_ONLY)).rejects.toThrow(
      /no readable package\.json was found there/,
    );
  });
});

describe('what counts as a declaration (#4719)', () => {
  it('reads all four declaration fields, and names the one it found', () => {
    const root = mkdtempSync(join(tmpdir(), 'os-decl-fields-'));
    try {
      writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({
          name: 'fields-fixture',
          dependencies: { a: '^1.0.0' },
          devDependencies: { b: '^2.0.0' },
          optionalDependencies: { c: '^3.0.0' },
          peerDependencies: { d: '^4.0.0' },
        }),
        'utf8',
      );
      expect(readHostDeclaration('a', root)).toMatchObject({
        declared: true,
        field: 'dependencies',
      });
      expect(readHostDeclaration('b', root)).toMatchObject({
        declared: true,
        field: 'devDependencies',
      });
      expect(readHostDeclaration('c', root)).toMatchObject({
        declared: true,
        field: 'optionalDependencies',
      });
      expect(readHostDeclaration('d', root)).toMatchObject({
        declared: true,
        field: 'peerDependencies',
      });
      expect(readHostDeclaration('e', root).declared).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('accepts workspace / link / alias specifiers — the KEY is the declaration', () => {
    const root = mkdtempSync(join(tmpdir(), 'os-decl-specifiers-'));
    try {
      writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({
          name: 'specifier-fixture',
          dependencies: {
            '@objectstack/organizations': 'workspace:*',
            local: 'link:../local',
            aliased: 'npm:@acme/real@1.2.3',
          },
        }),
        'utf8',
      );
      // A `workspace:` / `link:` value is the package manager's business; the
      // authoring act this gate reads is the KEY.
      expect(readHostDeclaration('@objectstack/organizations', root)).toMatchObject({
        declared: true,
        specifier: 'workspace:*',
      });
      expect(isDeclaredByHost('local', root)).toBe(true);
      // Alias deps need no special case: `import('aliased')` is what the app can
      // write, and `aliased` is the key. The aliased TARGET is not importable by
      // that name, and correctly reads as undeclared.
      expect(isDeclaredByHost('aliased', root)).toBe(true);
      expect(isDeclaredByHost('@acme/real', root)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('strips subpaths and keeps scopes when finding the declared name', () => {
    expect(packageNameFromSpecifier('@objectstack/platform-objects/plugin')).toBe(
      '@objectstack/platform-objects',
    );
    expect(packageNameFromSpecifier('@objectstack/organizations')).toBe(
      '@objectstack/organizations',
    );
    expect(packageNameFromSpecifier('chalk/dist/x.js')).toBe('chalk');
    // Not bare package names — nothing a package.json can declare, so they
    // bypass the gate entirely rather than being refused.
    expect(packageNameFromSpecifier('./local.js')).toBeUndefined();
    expect(packageNameFromSpecifier('/abs/path.js')).toBeUndefined();
    expect(packageNameFromSpecifier('node:fs')).toBeUndefined();
    expect(packageNameFromSpecifier('file:///tmp/x.mjs')).toBeUndefined();
  });

  it('a declared subpath import is gated by its package NAME, not the subpath', async () => {
    const root = mkdtempSync(join(tmpdir(), 'os-decl-subpath-'));
    try {
      writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({ name: 'subpath-fixture', dependencies: { [HOISTED_ONLY]: '*' } }),
        'utf8',
      );
      // Declared by package name ⇒ the subpath IS looked up in the host. The
      // fixture has no such file, so this fails on the subpath — as a broken
      // install, never as an undeclared package.
      const err = await createHostImporter(root)(`${HOISTED_ONLY}/missing-subpath`).catch(
        (e: unknown) => e,
      );
      expect(hostImportFailureKind(err)).not.toBe('undeclared');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

/**
 * #10943 — the undeclared fallback resolves from the CALLER, not from
 * `@objectstack/types`.
 *
 * The card's own 4-row matrix, measured on `main` from an app declaring
 * nothing, is what these cases pin:
 *
 *                                via host importer    bare import() from packages/cli
 *   @objectstack/plugin-auth     MODULE_NOT_FOUND     OK
 *   @objectstack/plugin-audit    MODULE_NOT_FOUND     OK
 *   chalk                        MODULE_NOT_FOUND     OK
 *   @objectstack/spec            OK                   —
 *
 * Rows 1-3 are packages the CALLER resolves and this package does not — the
 * helper's docblock promised them and delivered a `MODULE_NOT_FOUND`. Row 4 is
 * the single dependency `@objectstack/types` declares, and it is the row that
 * made the defect look absent: it resolves under EITHER base, so a pin written
 * on it alone is green in both worlds (the `@objectstack/spec` case above says
 * so in place, which is what it now legitimately guards).
 *
 * ── Why fixture packages and not the real four ──────────────────────────────
 *
 * The real four would make this test read `packages/cli`'s `node_modules`,
 * which is a cross-package input (`pnpm check:cross-package-test-inputs`) and
 * would hold the matrix hostage to whether those packages are BUILT — measured
 * here: with only this package's own closure built, `@objectstack/plugin-auth`
 * reads MODULE_NOT_FOUND from `packages/cli` too, for the unrelated reason that
 * its `dist/` does not exist yet. The fixtures carry the same four facts with
 * none of that: three packages only the caller can see (two scoped, one
 * unscoped — `chalk`'s shape), and `@objectstack/spec` itself for row 4.
 *
 * ── Row 4 is the row that catches a WIDENED implementation ──────────────────
 *
 * Rows 1-3 fail if the base does not move. Row 4 fails if the base moves but
 * the old one is kept ALONGSIDE it — a fallback that tried the caller and then
 * this package would satisfy rows 1-3 while quietly leaving every caller able
 * to reach `@objectstack/spec` without declaring it. That is a second de-facto
 * contract (Prime Directive #12), not the documented one.
 *
 * ⚠️ ORDER IS LOAD-BEARING WITHIN EACH ROW, and here is the measurement that
 * makes it so. Under this runner a dynamic `import()` inside the module under
 * test is cached by SPECIFIER, not by resolved URL: probed with one fixture
 * package and one name, the default base threw MODULE_NOT_FOUND before the
 * caller base had loaded it and RESOLVED the same name afterwards. So a
 * "the default base cannot see this" assertion is only true before anything has
 * loaded that name — which is why each row asserts its LEFT column first and
 * its RIGHT column second, in one case, on a name no other case touches. Split
 * a row into two cases, or reorder them, and the left column starts passing for
 * a reason that has nothing to do with this package.
 */
describe('the undeclared fallback resolves from the CALLER (#10943)', () => {
  /** Stand-ins for `plugin-auth` / `plugin-audit` / `chalk` — rows 1-3. */
  const CALLER_SCOPED_A = '@fixture/caller-scoped-a';
  const CALLER_SCOPED_B = '@fixture/caller-scoped-b';
  const CALLER_UNSCOPED = 'caller-unscoped';
  /**
   * Present in the caller fixture but NEVER loaded through any base — reserved
   * for the failure-text case, which needs a name the specifier cache has not
   * seen (see the ⚠️ above).
   */
  const CALLER_NEVER_LOADED = '@fixture/caller-never-loaded';

  /** A framework package that calls the helper, with its own `node_modules`. */
  let callerRoot: string;
  /** `(s) => import(s)` evaluated INSIDE `callerRoot` — a real caller base. */
  let fallbackImport: (specifier: string) => Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

  beforeAll(async () => {
    callerRoot = mkdtempSync(join(tmpdir(), 'os-import-caller-pkg-'));
    writeFileSync(
      join(callerRoot, 'package.json'),
      JSON.stringify({ name: '@fixture/caller-pkg', version: '0.0.0-fixture', type: 'module' }),
      'utf8',
    );
    for (const name of [CALLER_SCOPED_A, CALLER_SCOPED_B, CALLER_UNSCOPED, CALLER_NEVER_LOADED]) {
      writeFixturePackage(callerRoot, name, `export const from = ${JSON.stringify(name)};\n`);
    }
    // The caller's own resolver, as a real module on disk at `callerRoot`. This
    // IS the fixture: `import()` written here resolves against THIS file,
    // exactly as `(s) => import(s)` written in `harness.ts` resolves against
    // `packages/verify`.
    writeFileSync(
      join(callerRoot, 'importer.mjs'),
      'export const fallbackImport = (s) => import(s);\nexport const here = import.meta.url;\n',
      'utf8',
    );
    const mod = await import(pathToFileURL(join(callerRoot, 'importer.mjs')).href);
    // PRECONDITION for every row below: the resolver really is anchored in the
    // fixture. Had the runner loaded that module through its own pipeline
    // instead of Node's, `import()` inside it would resolve from the runner's
    // root and this whole matrix would be measuring the wrong base.
    expect(mod.here).toBe(pathToFileURL(join(callerRoot, 'importer.mjs')).href);
    fallbackImport = mod.fallbackImport;
  });

  afterAll(() => {
    if (callerRoot) rmSync(callerRoot, { recursive: true, force: true });
  });

  // Rows 1-3. One case per row so each is independently sensitive: delete the
  // fix and all three go red on their own, naming their own package.
  for (const [row, pkg] of [
    [1, CALLER_SCOPED_A],
    [2, CALLER_SCOPED_B],
    [3, CALLER_UNSCOPED],
  ] as const) {
    it(`row ${row}: ${pkg} — unreachable from here, loads through the caller's base`, async () => {
      // LEFT column, first and in this case (see the ⚠️ on ordering above):
      // the default base is this package's own resolution, and this package
      // declares only `@objectstack/spec`.
      const withoutBase = await createHostImporter(undeclaringRoot)(pkg).catch(
        (e: unknown) => e,
      );
      expect(hostImportFailureKind(withoutBase)).toBe('undeclared');

      // RIGHT column: the same name, the same host app, the caller's base.
      const mod = await createHostImporter(undeclaringRoot, { fallbackImport })(pkg);
      expect(mod.from).toBe(pkg);
    });
  }

  it("row 4: @objectstack/spec is not the caller's to resolve, and no longer leaks in", async () => {
    // The row that made the defect invisible, pointed the other way. The caller
    // fixture does not declare `@objectstack/spec`, so a fallback that is
    // genuinely the caller's cannot produce it — and one that ORs in this
    // package's own resolution still can. (Safe to assert after the default-base
    // case above loaded `@objectstack/spec`: that cache belongs to the module
    // under test, while this path runs entirely inside the fixture's own
    // resolver, which cannot see the package at all.)
    const err = await createHostImporter(undeclaringRoot, { fallbackImport })(
      '@objectstack/spec',
    ).catch((e: unknown) => e);
    expect(hostImportFailureKind(err)).toBe('undeclared');
    expect((err as { code?: string }).code).toBe('MODULE_NOT_FOUND');
  });

  it('the host DECLARATION still wins over the caller base (#4719 untouched)', async () => {
    // The fix moves one branch. The declared path must still resolve from the
    // host app, and an undeclared-but-NODE_PATH-reachable package must still be
    // refused: a caller base is not a way back into the hoisted store.
    const mod = await createHostImporter(hostRoot, { fallbackImport })(ORGANIZATIONS);
    expect(new mod.OrganizationsPlugin().name).toBe('com.objectstack.organizations');
    const err = await createHostImporter(undeclaringRoot, { fallbackImport })(
      HOISTED_ONLY,
    ).catch((e: unknown) => e);
    expect(hostImportFailureKind(err)).toBe('undeclared');
  });

  it('the undeclared failure NAMES a missing caller base instead of hiding it', async () => {
    // The pre-#10943 default is retained so an out-of-tree caller (cloud's
    // loader) cannot break under this parameter's arrival — so the one thing it
    // must not be is silent. A `MODULE_NOT_FOUND` naming no base is exactly what
    // let this defect survive being read.
    const withoutBase = await createHostImporter(undeclaringRoot)(CALLER_NEVER_LOADED).catch(
      (e: Error) => e,
    );
    expect(withoutBase.message).toMatch(/did not pass `fallbackImport`/);
    expect(withoutBase.message).toMatch(/@objectstack\/types/);

    // And it must NOT appear when the caller did state its base — a false note
    // sends the next reader to a parameter that is already correct.
    const withBase = await createHostImporter(undeclaringRoot, { fallbackImport })(
      '@fixture/nowhere-at-all',
    ).catch((e: Error) => e);
    expect(withBase.message).not.toMatch(/did not pass `fallbackImport`/);
  });
});

/**
 * #13330 — the DECLARED leg used to load the CommonJS build of a dual-published
 * package, giving the process a SECOND instance of everything that package
 * brings with it.
 *
 * The defect was invisible to every test that imports things the normal way,
 * because "the same module" is only ever one instance in a suite that never
 * crosses the seam. It surfaced as a shipped EE boot: `os serve` loaded
 * `@objectstack/service-cluster-redis` through this leg, the driver's load-time
 * `registerClusterDriver('redis', …)` ran against the CJS copy of
 * `@objectstack/service-cluster`, and the ESM Runtime read the ESM copy and
 * found nothing — `Cluster driver "redis" is not registered`, about a package
 * that was installed, declared and resolvable.
 *
 * The fixtures below are a miniature of exactly that: a dual-published package
 * holding module-scope state, and a second dual-published package whose only
 * job is a load-time write into it. What is asserted is the SHARED INSTANCE,
 * not the file name — a test that only checked which path was imported would
 * pass on a fix that loaded the right file into the wrong instance.
 */
describe('the declared leg loads the `import` build, not the `require` one (#13330)', () => {
  const REGISTRY = '@fixture/instance-registry';
  const DRIVER = '@fixture/instance-registry-driver';
  const CJS_ONLY = '@fixture/require-only';
  const SUBPATHS = '@fixture/dual-subpaths';

  /** Module-scope state, published as both builds — the `tsup` dual-build shape. */
  const REGISTRY_ESM = `export const BUILD = 'esm';
const registered = [];
export function register(name) { registered.push(name); }
export function listRegistered() { return [...registered]; }
`;
  const REGISTRY_CJS = `const registered = [];
exports.BUILD = 'cjs';
exports.register = (name) => { registered.push(name); };
exports.listRegistered = () => [...registered];
`;
  /** A driver package: its entire contract is the load-time side effect. */
  const DRIVER_ESM = `import { register } from '${REGISTRY}';
register('probe');
export const BUILD = 'esm';
`;
  const DRIVER_CJS = `const { register } = require('${REGISTRY}');
register('probe');
exports.BUILD = 'cjs';
`;

  const roots: string[] = [];

  function writePackage(root: string, name: string, exportsField: unknown, files: Record<string, string>): void {
    const dir = join(root, 'node_modules', ...name.split('/'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name,
        version: '0.0.0-fixture',
        type: 'module',
        main: 'dist/index.js',
        exports: exportsField,
      }),
      'utf8',
    );
    for (const rel of Object.keys(files)) {
      const target = join(dir, rel);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, files[rel] as string, 'utf8');
    }
  }

  /**
   * The condition map `tsup` emits: nested, with `types` first, so the
   * resolution under test has to walk INTO the `import` branch rather than
   * match a flat string.
   */
  const DUAL: unknown = {
    '.': {
      import: { types: './dist/index.d.ts', default: './dist/index.js' },
      require: { types: './dist/index.d.cts', default: './dist/index.cjs' },
    },
  };

  /**
   * A fresh app per case. The ESM module cache is keyed by absolute URL, so a
   * shared fixture directory would let one case's load answer the next one's
   * question — the failure mode this whole suite exists to detect.
   */
  function app(tag: string): string {
    const root = mkdtempSync(join(tmpdir(), `os-instance-split-${tag}-`));
    roots.push(root);
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'dual-build-host-fixture',
        type: 'module',
        dependencies: {
          [REGISTRY]: '0.0.0-fixture',
          [DRIVER]: '0.0.0-fixture',
          [CJS_ONLY]: '0.0.0-fixture',
          [SUBPATHS]: '0.0.0-fixture',
        },
      }),
      'utf8',
    );
    writePackage(root, REGISTRY, DUAL, {
      'dist/index.js': REGISTRY_ESM,
      'dist/index.cjs': REGISTRY_CJS,
    });
    writePackage(root, DRIVER, DUAL, {
      'dist/index.js': DRIVER_ESM,
      'dist/index.cjs': DRIVER_CJS,
    });
    // Publishes ONE build, under the `require` condition only.
    writePackage(root, CJS_ONLY, { '.': { require: './dist/index.cjs' } }, {
      'dist/index.cjs': "exports.BUILD = 'cjs-only';\n",
    });
    writePackage(
      root,
      SUBPATHS,
      {
        '.': { import: './dist/index.js', require: './dist/index.cjs' },
        './named': { import: './dist/named.js', require: './dist/named.cjs' },
        './deep/*': { import: './dist/deep/*.js', require: './dist/deep/*.cjs' },
      },
      {
        'dist/index.js': "export const WHERE = 'root-esm';\n",
        'dist/index.cjs': "exports.WHERE = 'root-cjs';\n",
        'dist/named.js': "export const WHERE = 'named-esm';\n",
        'dist/named.cjs': "exports.WHERE = 'named-cjs';\n",
        'dist/deep/leaf.js': "export const WHERE = 'leaf-esm';\n",
        'dist/deep/leaf.cjs': "exports.WHERE = 'leaf-cjs';\n",
      },
    );
    return root;
  }

  /** The instance an ESM consumer chain holds — what the Runtime reads. */
  function esmInstance(root: string): Promise<{ BUILD: string; listRegistered: () => string[]; register: (n: string) => void }> {
    return import(
      pathToFileURL(join(root, 'node_modules', ...REGISTRY.split('/'), 'dist', 'index.js')).href
    );
  }

  /** The instance a CommonJS load lands in — where the registration used to go. */
  function cjsInstance(root: string): Promise<{ BUILD: string; listRegistered: () => string[]; register: (n: string) => void }> {
    return import(
      pathToFileURL(join(root, 'node_modules', ...REGISTRY.split('/'), 'dist', 'index.cjs')).href
    );
  }

  // No `fallbackImport`: every fixture here is DECLARED, so the undeclared leg
  // (the only consumer of that base) is never reached.
  const importer = (root: string) => createHostImporter(root);

  afterAll(() => {
    for (const dir of roots) rmSync(dir, { recursive: true, force: true });
  });

  it('CONTROL: the reader can see BOTH answers, so an empty registry is a reading', async () => {
    // Every assertion below rests on `listRegistered()` being able to come back
    // non-empty. A probe that could only ever return `[]` would make the whole
    // describe pass on a broken fix — so it is proved here, on the same
    // instrument, before anything is measured with it.
    const root = app('control');
    const esm = await esmInstance(root);
    const cjs = await cjsInstance(root);

    expect(esm.BUILD).toBe('esm');
    expect(cjs.BUILD).toBe('cjs');
    expect(esm.listRegistered()).toEqual([]);

    // And the two really are separate instances: writing one leaves the other
    // untouched. That is the split; without it there would be no defect to fix.
    cjs.register('control-probe');
    expect(cjs.listRegistered()).toEqual(['control-probe']);
    expect(esm.listRegistered()).toEqual([]);
  });

  it('PRECONDITION: host CJS resolution still answers the `require` condition', () => {
    // The cause, pinned separately from the fix. `hostRequire.resolve` is still
    // the host-anchored half of the answer and is deliberately unchanged; if a
    // future Node stopped returning the `require` entry here, this test says so
    // rather than leaving the fix looking like a no-op.
    const root = app('precondition');
    expect(createHostRequire(root).resolve(DRIVER)).toMatch(/dist[/\\]index\.cjs$/);
  });

  it('loads the `import` build of a declared package', async () => {
    const root = app('import-condition');
    expect((await importer(root)(DRIVER)).BUILD).toBe('esm');
  });

  it("a driver's load-time registration lands in the instance an ESM caller reads", async () => {
    // The defect, stated as its consequence. Before the fix this was `[]`.
    const root = app('visible');
    expect((await esmInstance(root)).listRegistered()).toEqual([]);
    await importer(root)(DRIVER);
    expect((await esmInstance(root)).listRegistered()).toEqual(['probe']);
  });

  it('and no longer lands in the CommonJS instance nothing reads', async () => {
    // The other direction: the registration MOVED, it was not duplicated. A
    // fix that loaded both builds would satisfy the previous case and still
    // leave a process holding two live copies of the package's state.
    const root = app('cjs-empty');
    await importer(root)(DRIVER);
    expect((await cjsInstance(root)).listRegistered()).toEqual([]);
    expect((await esmInstance(root)).listRegistered()).toEqual(['probe']);
  });

  it('a package publishing only a `require` condition still loads', async () => {
    // Narrowness. There is no import entry to prefer, so the resolved CJS path
    // is used exactly as before — the fix may not turn a working load into a
    // failure.
    const root = app('cjs-only');
    expect((await importer(root)(CJS_ONLY)).BUILD).toBe('cjs-only');
  });

  it('a package with no `exports` map at all is untouched', async () => {
    // `main` is the only entry such a package publishes and CJS resolution
    // already returned it; there is nothing to re-decide.
    const root = app('no-exports');
    writeFixturePackage(root, '@fixture/no-exports-map', 'export const BUILD = "main";\n');
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'dual-build-host-fixture',
        type: 'module',
        dependencies: { '@fixture/no-exports-map': '0.0.0-fixture' },
      }),
      'utf8',
    );
    expect((await importer(root)('@fixture/no-exports-map')).BUILD).toBe('main');
  });

  it('resolves a declared SUBPATH under the import condition', async () => {
    const root = app('subpath');
    expect((await importer(root)(SUBPATHS)).WHERE).toBe('root-esm');
    expect((await importer(root)(`${SUBPATHS}/named`)).WHERE).toBe('named-esm');
  });

  it('resolves a wildcard subpath pattern under the import condition', async () => {
    const root = app('pattern');
    expect((await importer(root)(`${SUBPATHS}/deep/leaf`)).WHERE).toBe('leaf-esm');
  });
});
