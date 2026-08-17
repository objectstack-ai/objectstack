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
import { join } from 'node:path';
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
    "falls back to the importing package's own resolution when the host does not declare",
    async () => {
      // Whatever the host app does not declare must still load from the framework
      // package's own dependencies — that fallback is what keeps every
      // framework-owned load in `serve` (plugin-auth, plugin-security,
      // service-i18n, …) and in `bootStack` working exactly as before.
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
