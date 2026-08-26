// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os serve` loads the cluster gate and its driver AS THE HOST APP DECLARES
 * THEM, not from the CLI's own `node_modules`.
 *
 * ── The defect ───────────────────────────────────────────────────────────
 *
 * Measured on a published EE image: with `OS_CLUSTER_DRIVER=redis` set, boot
 * died with
 *
 *     Cannot find package '@objectstack/service-cluster' imported from
 *     /repo/objectstack/packages/cli/dist/commands/serve.js
 *
 * The CLI's own `node_modules/@objectstack/` held 48 packages and NEITHER
 * cluster package; both were installed only under the app, which declares them.
 * `serve.ts` reached them through a bare dynamic `import()`, and Node ESM
 * resolves a bare specifier against the IMPORTER's realpath — the CLI's, inside
 * the framework workspace. So the one hop that could not work was CLI to app,
 * while app-side code loaded the very same packages fine.
 *
 * ── Why this is not fixed by declaring the packages ──────────────────────
 *
 * Adding `@objectstack/service-cluster*` to `packages/cli`'s dependencies would
 * silence this driver and leave the class open: the next app-declared optional
 * package the CLI advertises it will load breaks identically, a third-party
 * cluster driver can never work, and the open-core CLI would take a static
 * dependency on packages that ship with a distribution — the exact coupling the
 * non-literal specifier in `serve.ts` exists to avoid. The fix is to resolve
 * from the host app, which is what `createHostImporter` already does for the
 * organizations / capability loads further down `serve`.
 *
 * ── What is pinned here ──────────────────────────────────────────────────
 *
 * 1. The BOUNDARY, behaviourally and hermetically: a package that exists only
 *    in a host app's `node_modules` is invisible to a bare import from this
 *    file (which sits in `packages/cli`, the same resolution base as the
 *    shipped `dist/commands/serve.js`) and IS loadable through the host
 *    importer. The fixture package is synthetic on purpose — the contract is
 *    "any app-declared optional package", not "these two cluster packages", and
 *    a synthetic one needs nothing built.
 *
 * 2. The REACHABILITY of the helper, by source scan. This is the half that
 *    actually regressed, twice: `importFromHost` used to be a `const` bound
 *    partway down one very long boot function, so it existed only BELOW its own
 *    binding. A load placed above it is not a compile error — the author writes
 *    a bare `import()`, which resolves from the CLI and is green in any dev
 *    checkout where everything is hoisted into one `node_modules`. The first
 *    time it cost the enterprise organizations load (cloud#1013); the second
 *    time it cost EE multi-node boot outright (#10645).
 *
 *    #10769 closed the class rather than hoisting a third time: the helper is
 *    now a module-scope FUNCTION DECLARATION, hoisted over the entire module, so
 *    "above the definition" is not a state this file can be in. The scan below
 *    pins that shape — a `const`, or a declaration nested inside a function,
 *    fails — which is strictly stronger than the ordering check it replaced.
 *
 * 3. EVERY app-declarable optional load, by source scan (#10769). The cluster
 *    pair was only the instance that happened to ship. A package is treated as
 *    app-declarable exactly when `packages/cli`'s own manifest does not declare
 *    it — mechanically, so a newly added optional package is covered without
 *    anyone remembering this file. Bare `import()` of such a package fails, and
 *    a bare `import()` whose specifier the scan cannot resolve must be
 *    enumerated with its reason.
 *
 * The source scan reads `serve.ts` and `package.json` from THIS package, so no
 * cross-package test input is declared or needed.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHostImporter } from '@objectstack/types/node';

const HERE = dirname(fileURLToPath(import.meta.url));

/** `packages/cli/src/commands/serve.ts` — same package, no escaping read. */
const SERVE_SOURCE = readFileSync(resolve(HERE, 'serve.ts'), 'utf8');

/** `packages/cli/package.json` — the CLI's OWN declared dependency surface. */
const CLI_MANIFEST = JSON.parse(
  readFileSync(resolve(HERE, '..', '..', 'package.json'), 'utf8'),
) as {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

/**
 * What the CLI itself declares, and therefore what a bare `import()` from
 * `dist/commands/serve.js` can actually resolve. `devDependencies` are
 * deliberately excluded: they are not installed beside a published CLI.
 */
const CLI_DECLARES = new Set([
  ...Object.keys(CLI_MANIFEST.dependencies ?? {}),
  ...Object.keys(CLI_MANIFEST.peerDependencies ?? {}),
  ...Object.keys(CLI_MANIFEST.optionalDependencies ?? {}),
]);

/**
 * Blank out comments, preserving every byte offset and every newline, so the
 * sweep below reads CODE only.
 *
 * This matters more than it looks: `serve.ts` discusses `import()` in prose all
 * over its comments (including the note that describes this very defect), and a
 * naive scan matches those and reports hazards that do not exist. Strings and
 * template literals are tracked so a `'http://…'` literal is not mistaken for a
 * line comment.
 */
function stripComments(src: string): string {
  const out = src.split('');
  const n = src.length;
  let i = 0;
  let prevCode = '';
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') { out[i] = ' '; i++; }
      continue;
    }
    if (c === '/' && d === '*') {
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] !== '\n') out[i] = ' ';
        i++;
      }
      if (i < n) { out[i] = ' '; out[i + 1] = ' '; i += 2; }
      continue;
    }
    if (c === '"' || c === "'") {
      i++;
      while (i < n && src[i] !== c) { if (src[i] === '\\') i++; i++; }
      i++; prevCode = c; continue;
    }
    if (c === '`') {
      i++;
      while (i < n && src[i] !== '`') {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '$' && src[i + 1] === '{') {
          let depth = 1; i += 2;
          while (i < n && depth > 0) {
            if (src[i] === '{') depth++;
            else if (src[i] === '}') depth--;
            i++;
          }
          continue;
        }
        i++;
      }
      i++; prevCode = '`'; continue;
    }
    if (c === '/' && /[=(,:[!&|?+\-*%^~{;]/.test(prevCode)) { // regex literal
      i++;
      while (i < n && src[i] !== '/') {
        if (src[i] === '\\') i++;
        else if (src[i] === '[') { while (i < n && src[i] !== ']') { if (src[i] === '\\') i++; i++; } }
        i++;
      }
      i++; prevCode = '/'; continue;
    }
    if (!/\s/.test(c)) prevCode = c;
    i++;
  }
  return out.join('');
}

/** `serve.ts` with comments blanked — offsets and line numbers preserved. */
const SERVE_CODE = stripComments(SERVE_SOURCE);

type LoadSite = {
  /** 1-based line in `serve.ts`. */
  line: number;
  callee: 'import' | 'importFromHost';
  /** The argument source text, whitespace-collapsed. */
  argument: string;
  /** The literal specifier, when the scan can determine one statically. */
  specifier?: string;
  /** Bare package name of `specifier` (`@scope/name`), when it names a package. */
  packageName?: string;
};

/** Read the balanced argument text of the call whose `(` is at `open`. */
function argumentAt(code: string, open: number): string {
  let depth = 0;
  let out = '';
  for (let i = open; i < code.length; i++) {
    const c = code[i];
    if (c === '(') { depth++; if (depth === 1) continue; }
    if (c === ')') { depth--; if (depth === 0) break; }
    out += c;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** `@scope/name/sub` → `@scope/name`. Paths, URLs and `node:` builtins → undefined. */
function packageNameOf(specifier: string): string | undefined {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.includes(':')) {
    return undefined;
  }
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/**
 * Resolve `const X = '<literal>'` — the idiom `serve.ts` uses everywhere to keep
 * `tsc` from statically resolving an optional package
 * (`const i18nPkg = '@objectstack/service-i18n'`) — and one further hop,
 * `const X = Serve.MEMBER`, where `MEMBER` is a `static readonly` string on the
 * command class in this same file. Without this the sweep sees only an
 * identifier and classifies the load as unknowable.
 *
 * The second hop is not a convenience. #11614 single-sourced the
 * `@objectstack/organizations` spelling onto `Serve.ORGANIZATIONS_RUNTIME_PKG`
 * so the spec-owned provenance roster could pin it, and a resolver that stops
 * one hop short turns that load from "app-declarable, host-anchored, checked"
 * into "unknowable" — SILENTLY, because an unresolved specifier drops OUT of
 * `APP_DECLARABLE_LOADS` rather than into it. The named half of the vacuity
 * guard below is what caught that, and is why it names packages instead of only
 * counting them. Resolving one hop further strictly WIDENS what the sweep
 * judges; it can never excuse a load.
 */
function resolveIdentifier(code: string, name: string): string | undefined {
  const direct = code.match(
    new RegExp(`\\bconst\\s+${name}\\s*(?::\\s*string\\s*)?=\\s*(['"\`])([^'"\`]*)\\1`),
  );
  if (direct) return direct[2];

  // `const organizationsPkg = Serve.ORGANIZATIONS_RUNTIME_PKG;` (#11614)
  const viaStatic = code.match(
    new RegExp(`\\bconst\\s+${name}\\s*(?::\\s*string\\s*)?=\\s*Serve\\.([A-Za-z_$][\\w$]*)\\s*;`),
  );
  if (!viaStatic) return undefined;

  const member = code.match(
    new RegExp(`\\bstatic\\s+readonly\\s+${viaStatic[1]}\\s*(?::\\s*string\\s*)?=\\s*(['"\`])([^'"\`]*)\\1`),
  );
  return member?.[2];
}

/** Every dynamic load in `serve.ts`, bare or host-anchored. */
function collectLoadSites(code: string): LoadSite[] {
  const sites: LoadSite[] = [];
  const re = /\b(?:await\s+)?(importFromHost|import)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const callee = m[1] as LoadSite['callee'];
    const open = m.index + m[0].length - 1;
    const argument = argumentAt(code, open);
    const line = code.slice(0, m.index).split('\n').length;

    let specifier: string | undefined;
    const literal = argument.match(/^(['"])([^'"]*)\1$/);
    const plainTemplate = argument.match(/^`([^`$]*)`$/);
    const prefixTemplate = argument.match(/^`([^`$]*)\$\{/);
    const identifier = argument.match(/^([A-Za-z_$][\w$]*)$/);
    if (literal) specifier = literal[2];
    else if (plainTemplate) specifier = plainTemplate[1];
    else if (prefixTemplate) specifier = prefixTemplate[1];        // `@objectstack/service-cluster-${driver}`
    else if (identifier) specifier = resolveIdentifier(code, identifier[1]);

    sites.push({
      line,
      callee,
      argument,
      specifier,
      packageName: specifier ? packageNameOf(specifier) : undefined,
    });
  }
  return sites;
}

const LOAD_SITES = collectLoadSites(SERVE_CODE);

/**
 * The class this file exists for: a package `serve` loads that the CLI does NOT
 * declare. A bare `import()` from the CLI cannot resolve it except by accident
 * of workspace hoisting — which is precisely why the two shipped instances
 * passed every dev checkout and died on a distribution image.
 */
const APP_DECLARABLE_LOADS = LOAD_SITES.filter(
  (site) => site.packageName?.startsWith('@objectstack/') && !CLI_DECLARES.has(site.packageName),
);

/**
 * Bare `import()` calls whose specifier no source scan can resolve — a member
 * expression or a loop/parameter variable. Each is allowlisted BY ITS ARGUMENT
 * TEXT (stable across line moves) with the reason it is not the class above.
 * A new one fails the test, which is the point: an unknowable specifier is
 * exactly where a bare `import()` hides.
 */
const UNRESOLVABLE_BARE_IMPORTS: Record<string, string> = {
  // A filesystem path to the app's own compiled config/artifact, never a package.
  // `createHostImporter` passes non-package specifiers through untouched anyway.
  "absolutePath.startsWith('/') ? `file://${absolutePath}` : absolutePath":
    'a path to the served artifact, not a package name',
  // Loop over a literal pair: '@objectstack/setup', '@objectstack/account'.
  // Both are declared by packages/cli, so bare resolution finds them.
  appPkg: 'iterates @objectstack/setup + @objectstack/account, both CLI-declared',
  // Serve.CAPABILITY_PROVIDERS — every `pkg` in that table is CLI-declared.
  'spec.pkg': 'Serve.CAPABILITY_PROVIDERS entries are all CLI-declared',
  'ex.pkg': 'CAPABILITY_PROVIDERS `extras` entries are all CLI-declared',
  // The app's own `plugins: [...]` config entries, routed through
  // `Serve.importConfigPlugin` (#10908). ONE bare `import()` site remains there,
  // and it is the reason this list exists rather than a hole in it: the
  // specifier is not a package name at all (an absolute path, a `file://` URL, a
  // `node:` builtin), so nothing a package.json can declare, and every one of
  // those spellings means the same module from every base.
  //
  // It used to be TWO. The second was the UNDECLARED branch, which kept a local
  // `import()` because the host importer's fallback resolved from
  // `@objectstack/types` rather than from this CLI. #11157 threaded the base
  // (`fallbackImport`), which made that branch identical to the helper's own
  // fallback, and it was collapsed into `importFromHost`. Pinned behaviourally,
  // not by this comment, in `serve-config-plugin-host-resolution.test.ts` and
  // `serve-host-fallback-base.test.ts`.
  pluginSpecifier: 'the non-package branch: an absolute path, a file:// URL or a node: builtin (#10908)',
  // `importFromHost`'s own `fallbackImport` (#11157) — the caller base
  // `createHostImporter` resolves everything the served app does NOT declare
  // from. It is a bare `import()` on purpose and it MUST be written in this
  // file: ESM resolves a bare specifier against the module containing the call,
  // so moving it anywhere else moves the base, which is the whole defect. Its
  // parameter is the helper's argument, so no scan can know the specifier —
  // and no scan needs to: this site is not a load of any particular package,
  // it is the resolution base every other undeclared load is handed.
  fallbackSpecifier:
    "importFromHost's caller base — the CLI's own resolver, handed to createHostImporter (#11157)",
};

/**
 * A host app that DECLARES an optional package and carries it in its own
 * `node_modules` — the shape of every EE app that declares
 * `@objectstack/service-cluster`. Nothing here is built or installed: the
 * package is three files written to a temp dir.
 */
function makeHostApp(pkgName: string, declare: boolean): string {
  const root = mkdtempSync(join(tmpdir(), 'os-host-app-'));
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'fixture-host-app',
      version: '1.0.0',
      type: 'module',
      ...(declare ? { dependencies: { [pkgName]: '1.0.0' } } : {}),
    }),
  );
  const pkgDir = join(root, 'node_modules', ...pkgName.split('/'));
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(
    join(pkgDir, 'package.json'),
    JSON.stringify({ name: pkgName, version: '1.0.0', type: 'module', main: 'index.js' }),
  );
  // The marker export stands in for `checkMultiNodeAllowed`: proof the module
  // that loaded is the app's copy, not something the CLI happened to resolve.
  writeFileSync(join(pkgDir, 'index.js'), 'export const loadedFrom = "host-app";\n');
  return root;
}

describe('os serve → app-declared optional package resolution', () => {
  // A name no workspace package can satisfy, so a pass cannot come from the
  // CLI's own node_modules by accident.
  const PKG = '@os-fixture/cluster-driver-probe';

  it('reproduces the asymmetry: an app-only package is invisible to a bare import', async () => {
    // This file resolves from `packages/cli`, exactly as `dist/commands/serve.js`
    // does — the failing hop the EE image measured.
    const bare: string = PKG;
    await expect(import(bare)).rejects.toMatchObject({
      code: expect.stringMatching(/MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND/),
    });
  });

  it('crosses the boundary: the host importer loads what the app declares', async () => {
    const hostRoot = makeHostApp(PKG, true);
    const mod = await createHostImporter(hostRoot)(PKG);
    expect(mod.loadedFrom).toBe('host-app');
  });

  it('still refuses a package the app does not declare (the gate is unchanged)', async () => {
    // Present in the app's node_modules but absent from its package.json.
    // Reachability must not substitute for declaration (#4719) — this fix moves
    // where a module is resolved FROM, it does not widen what serve accepts.
    const hostRoot = makeHostApp(PKG, false);
    await expect(createHostImporter(hostRoot)(PKG)).rejects.toMatchObject({
      code: 'MODULE_NOT_FOUND',
    });
  });
});

describe('os serve → cluster block source shape', () => {
  it('loads the cluster gate and driver through the host importer', () => {
    expect(SERVE_SOURCE).toMatch(/await importFromHost\(__clusterPkg\)/);
    expect(SERVE_SOURCE).toMatch(
      /await importFromHost\(`@objectstack\/service-cluster-\$\{__clusterDriver\}`\)/,
    );
  });

  it('never reaches the cluster packages through a bare dynamic import', () => {
    // The exact regression, in both spellings the block used.
    expect(SERVE_SOURCE).not.toMatch(/await import\(__clusterPkg\)/);
    expect(SERVE_SOURCE).not.toMatch(/await import\(`@objectstack\/service-cluster-/);
  });

  // ── Replaces the former "definition is ABOVE the cluster block" assertion ──
  //
  // That assertion pinned an ORDERING inside one long boot method, which is the
  // shape #10769 removed: `importFromHost` is now a module-scope FUNCTION
  // DECLARATION, hoisted over the entire module. The ordering it used to check
  // is not merely satisfied, it is unrepresentable — so the check below is the
  // strictly stronger one it must be read as. Ordering can only regress again if
  // the helper is moved back INSIDE a function, which is exactly what fails here.
  it('defines importFromHost at MODULE scope, so no load can sit above it', () => {
    const moduleScopeDefinitions = [...SERVE_CODE.matchAll(/^function importFromHost\s*\(/gm)];

    expect(
      moduleScopeDefinitions.length,
      'No module-scope `function importFromHost(...)` in serve.ts. A function '
      + 'DECLARATION at column 0 is hoisted over the whole module, which is what '
      + 'makes "a load written above the helper" impossible. If this was moved back '
      + 'inside the boot method — or turned into a `const`/arrow — the ordering '
      + 'hazard is back: a load placed above it is not a compile error, the author '
      + 'writes a bare `import()`, and it resolves from the CLI. That shipped twice '
      + '(cloud#1013, #10645).',
    ).toBe(1);

    // A nested (indented) declaration is scoped to its enclosing function again.
    expect(
      SERVE_CODE,
      'importFromHost is declared INSIDE a function — module scope is the point.',
    ).not.toMatch(/^[ \t]+function importFromHost\s*\(/m);

    // No binding form can re-introduce a temporal dead zone.
    expect(
      SERVE_CODE,
      'importFromHost is bound with const/let. A binding only exists BELOW itself; '
      + 'that is the defect. Keep it a hoisted function declaration.',
    ).not.toMatch(/\b(?:const|let|var)\s+importFromHost\b/);
  });

  it('keeps exactly one host importer, so the helper cannot fork', () => {
    // One definition, and one place that builds the underlying importer.
    expect([...SERVE_CODE.matchAll(/^function importFromHost\s*\(/gm)]).toHaveLength(1);
    expect([...SERVE_CODE.matchAll(/createHostImporter\s*\(/g)]).toHaveLength(1);
  });
});

/**
 * The detection backstop, widened from the cluster pair to EVERY app-declarable
 * optional load in `serve.ts` (#10769).
 *
 * The structural half of that card makes the ordering hazard unrepresentable
 * (`importFromHost` is a hoisted module-scope declaration). This sweep is what
 * catches the remaining way in: a load written as a bare `import()` even though
 * the helper was reachable. It classifies mechanically rather than from a
 * hand-kept list — a package is app-declarable exactly when `packages/cli`'s own
 * manifest does not declare it — so a NEW optional package is covered the moment
 * it is added, with nobody having to remember this file exists.
 */
describe('os serve → every app-declarable optional load is host-anchored', () => {
  it('the sweep actually reads serve.ts (vacuity guard)', () => {
    // A sweep that asserts "nothing is wrong" passes trivially when it matches
    // nothing. These floors fail loudly instead, so a broken scanner can never
    // read as a clean bill of health.
    expect(LOAD_SITES.length, 'no dynamic loads found in serve.ts at all').toBeGreaterThan(25);

    const resolvedPackages = LOAD_SITES.filter((s) => s.packageName?.startsWith('@objectstack/'));
    expect(
      resolvedPackages.length,
      'the specifier resolver stopped resolving — every load now looks unknowable, '
      + 'which would empty the sweep below without failing it',
    ).toBeGreaterThan(20);

    expect(
      CLI_DECLARES.size,
      "packages/cli's manifest read as empty — every package would look app-declarable",
    ).toBeGreaterThan(20);

    // Named, not just counted: this proves the resolver still handles every
    // spelling serve.ts uses — a `const` binding, a template prefix, a `const`
    // bound to a class static, and the manifest cross-check that decides
    // app-declarable at all. Naming them is what caught #11614: the
    // organizations spelling moved onto a static, the resolver stopped one hop
    // short, and that load dropped OUT of the swept population — which the
    // count-only floor of >20 absorbed without a word.
    const found = new Set(APP_DECLARABLE_LOADS.map((s) => s.packageName));
    for (const pkg of [
      '@objectstack/service-cluster',    // const binding   (#10645)
      '@objectstack/service-cluster-',   // template prefix (#10645, the driver)
      '@objectstack/organizations',      // const <- static (cloud#1013, #11614)
      '@objectstack/service-i18n',       // const binding   (#10769)
    ]) {
      expect(found, `the sweep no longer sees the ${pkg} load`).toContain(pkg);
    }
    expect(APP_DECLARABLE_LOADS.length).toBeGreaterThanOrEqual(4);
  });

  it('reads code, not the prose that discusses `import()` (stripper guard)', () => {
    // serve.ts explains this very defect in its comments. If the stripper broke
    // OPEN, prose matches would be scanned as loads; if it broke CLOSED it could
    // blank real code and empty the sweep. Pin both directions.
    expect(SERVE_CODE.length).toBe(SERVE_SOURCE.length);
    expect(SERVE_CODE.split('\n').length).toBe(SERVE_SOURCE.split('\n').length);
    // A phrase that exists ONLY inside a comment in serve.ts.
    expect(SERVE_SOURCE).toContain('Node ESM resolves a bare');
    expect(SERVE_CODE).not.toContain('Node ESM resolves a bare');
    // …and real code either side of the comments survives untouched.
    // Markers deliberately unrelated to the shape the tests above pin, so this
    // guard reports on the STRIPPER and never doubles as a second shape check.
    expect(SERVE_CODE).toContain("const __clusterPkg: string = '@objectstack/service-cluster'");
    expect(SERVE_CODE).toContain('export default class Serve extends Command {');
  });

  it('never loads an app-declarable optional package through a bare import()', () => {
    const bare = APP_DECLARABLE_LOADS.filter((site) => site.callee === 'import');

    expect(
      bare.map((site) => `serve.ts:${site.line}  import(${site.argument})  → ${site.packageName}`),
      'These packages are NOT declared by packages/cli, so a bare `import()` resolves '
      + "against the CLI's own realpath and can only find them by accident of workspace "
      + 'hoisting — green in a dev checkout, dead at boot on a real distribution layout. '
      + 'That is the exact failure that shipped as cloud#1013 and #10645. Load them with '
      + '`importFromHost(...)`, which is a module-scope declaration reachable from every '
      + 'line of serve.ts. An app that does not declare the package still falls back to '
      + "the CLI's own resolution, so no quiet-skip path changes.",
    ).toEqual([]);
  });

  it('enumerates every bare import() whose specifier a scan cannot resolve', () => {
    const unresolvable = LOAD_SITES.filter(
      (site) => site.callee === 'import' && site.specifier === undefined,
    );

    // Non-vacuity: these sites exist, so an empty list means the scan broke.
    expect(unresolvable.length).toBeGreaterThan(0);

    const unjustified = unresolvable
      .filter((site) => !(site.argument in UNRESOLVABLE_BARE_IMPORTS))
      .map((site) => `serve.ts:${site.line}  import(${site.argument})`);

    expect(
      unjustified,
      'A new bare `import()` whose specifier this scan cannot resolve. An unknowable '
      + 'specifier is exactly where an app-declared package hides from the sweep above, '
      + 'so it cannot pass silently. Either load it through `importFromHost(...)` — the '
      + 'right answer whenever the specifier can come from the served app — or add it to '
      + 'UNRESOLVABLE_BARE_IMPORTS with the reason it can only ever name a CLI-declared '
      + 'package or a filesystem path.',
    ).toEqual([]);
  });

  it('keeps the cluster and organizations loads host-anchored (the shipped instances)', () => {
    // The two regressions, pinned by package rather than by line number.
    const byPackage = (pkg: string) => APP_DECLARABLE_LOADS.filter((s) => s.packageName === pkg);
    for (const pkg of [
      '@objectstack/service-cluster',
      '@objectstack/service-cluster-',
      '@objectstack/organizations',
      '@objectstack/service-i18n',
    ]) {
      const sites = byPackage(pkg);
      expect(sites.length, `no load site found for ${pkg}`).toBeGreaterThan(0);
      for (const site of sites) {
        expect(site.callee, `serve.ts:${site.line} loads ${pkg} bare`).toBe('importFromHost');
      }
    }
  });
});
