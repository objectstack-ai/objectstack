import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

// Types are INFERRED from the .mjs source by `tsconfig.scripts.json`
// (`allowJs`), so no `@ts-expect-error` and no hand-written `.d.mts`.
import {
  EXIT_DISAGREES,
  EXIT_NO_MEASUREMENT,
  EXIT_OK,
  classifyEffect,
  evaluate,
  evaluatePackage,
  main,
  readArrayPackages,
  walkEntryGraph,
} from '../check-side-effects-array.mjs';

/**
 * objectui#6683. The gate under test exists because an INCOMPLETE `sideEffects`
 * array fails silently inside a CONSUMER's bundle — no error, no warning, exit
 * 0. A gate against a silent failure is worth exactly as much as its ability to
 * go red, so this file's first duty is DISCRIMINATION: every assertion below
 * has a partner that makes the same fixture fail.
 *
 * The fixtures are synthetic workspaces rather than the repo, for the reason
 * `check-eager-closure-budget.test.ts` gives about its own: a gate whose only
 * test is "it passes on today's tree" is green because the tree is currently
 * correct, and stays green when the gate stops looking.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

interface Files {
  [relativePath: string]: string;
}

/** A throwaway workspace on disk. The gate reads files, so the fixture is files. */
function workspace(files: Files): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'objectui-6683-'));
  fs.writeFileSync(path.join(dir, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return dir;
}

const manifest = (sideEffects: string[]): string =>
  JSON.stringify(
    {
      name: '@fixture/pkg',
      type: 'module',
      main: './dist/index.js',
      exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
      sideEffects,
    },
    null,
    2,
  );

/** barrel -> a registrar (bare import) and a pure module (named import). */
const SOURCES: Files = {
  'packages/pkg/src/index.ts': "import './registrar.js';\nexport { pure } from './pure.js';\n",
  'packages/pkg/src/registrar.ts': "import { Registry } from 'somewhere';\nRegistry.register('fixture:key', 1);\n",
  'packages/pkg/src/pure.ts': 'export const pure = 1;\n',
};

const HONEST_ARRAY = ['./dist/index.js', './dist/registrar.js', './src/index.ts', './src/registrar.ts'];

function run(files: Files): ReturnType<typeof evaluatePackage> {
  const dir = workspace(files);
  try {
    const packages = readArrayPackages(dir);
    expect(packages, 'the fixture workspace must expose exactly one array package').toHaveLength(1);
    return evaluatePackage(packages[0], dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('the honest array', () => {
  it('passes, and names the registrar it derived', () => {
    const verdict = run({ ...SOURCES, 'packages/pkg/package.json': manifest(HONEST_ARRAY) });
    expect(verdict.problems).toEqual([]);
    expect(verdict.missing).toEqual([]);
    expect(verdict.stale).toEqual([]);
    expect(verdict.registrars).toEqual(['src/registrar.ts']);
    expect(verdict.ok).toBe(true);
  });

  it('is not passing because the walk found nothing', () => {
    // The anti-vacuity partner of the case above. A walk that collapsed to the
    // barrel would derive an empty registrar set, and an empty set agrees with
    // any array at all.
    const verdict = run({ ...SOURCES, 'packages/pkg/package.json': manifest(HONEST_ARRAY) });
    expect(verdict.modulesWalked).toBe(3);
    expect(verdict.registrars.length).toBeGreaterThan(0);
  });
});

describe('MISSING — the silent drop this gate exists to make loud', () => {
  it('fails when the array omits a registering module', () => {
    const verdict = run({
      ...SOURCES,
      'packages/pkg/package.json': manifest(HONEST_ARRAY.filter((e) => !e.includes('registrar'))),
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.missing).toEqual(['dist/registrar.js', 'src/registrar.ts']);
    expect(verdict.stale).toEqual([]);
  });

  it('fails when only the SOURCE spelling is named and the published one is not', () => {
    // The half a consumer pays for. In-repo bundlers resolve the alias to
    // `src/`; everyone who installs the package resolves `exports` to `dist/`.
    const verdict = run({
      ...SOURCES,
      'packages/pkg/package.json': manifest(HONEST_ARRAY.filter((e) => e !== './dist/registrar.js')),
    });
    expect(verdict.missing).toEqual(['dist/registrar.js']);
  });

  it('fails when an entry form itself is missing', () => {
    const verdict = run({
      ...SOURCES,
      'packages/pkg/package.json': manifest(HONEST_ARRAY.filter((e) => e !== './src/index.ts')),
    });
    expect(verdict.missing).toEqual(['src/index.ts']);
  });
});

describe('STALE — a name whose module no longer registers anything', () => {
  it('fails when the array names a pure module', () => {
    const verdict = run({
      ...SOURCES,
      'packages/pkg/package.json': manifest([...HONEST_ARRAY, './src/pure.ts']),
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.stale).toEqual(['src/pure.ts']);
    expect(verdict.missing).toEqual([]);
  });

  it('fails when the array names a path that does not exist at all', () => {
    const verdict = run({
      ...SOURCES,
      'packages/pkg/package.json': manifest([...HONEST_ARRAY, './src/gone.ts']),
    });
    expect(verdict.stale).toEqual(['src/gone.ts']);
  });
});

describe('the gauge — exit 2 territory, never a pass', () => {
  it('refuses a top-level side effect it does not recognise', () => {
    const verdict = run({
      ...SOURCES,
      'packages/pkg/src/pure.ts': "export const pure = 1;\nsomeGlobal.installed = true;\n",
      'packages/pkg/package.json': manifest(HONEST_ARRAY),
    });
    expect(verdict.gauge).toBe(true);
    expect(verdict.problems.join('\n')).toContain('does not recognise');
    // ...and it did NOT quietly decide the module was pure, which is the whole
    // point: an unrecognised effect must not collapse into "not a registration".
    expect(verdict.stale).toEqual([]);
  });

  it('refuses a glob, which would make the comparison vacuous on whatever it covers', () => {
    const verdict = run({
      ...SOURCES,
      'packages/pkg/package.json': manifest([...HONEST_ARRAY, './src/**/*.ts']),
    });
    expect(verdict.gauge).toBe(true);
    expect(verdict.problems.join('\n')).toContain('is a glob');
  });

  it('refuses an unresolved relative specifier rather than shrinking the walk', () => {
    const verdict = run({
      ...SOURCES,
      'packages/pkg/src/index.ts': "import './registrar.js';\nimport './not-here.js';\n",
      'packages/pkg/package.json': manifest(HONEST_ARRAY),
    });
    expect(verdict.gauge).toBe(true);
    expect(verdict.problems.join('\n')).toContain('unresolved relative specifier');
  });

  it('refuses a spelling map that does not round-trip on the barrel', () => {
    const dir = workspace({
      ...SOURCES,
      'packages/pkg/package.json': JSON.stringify({
        name: '@fixture/pkg',
        main: './build/index.js',
        sideEffects: ['./build/index.js', './src/index.ts'],
      }),
    });
    try {
      const verdict = evaluatePackage(readArrayPackages(dir)[0], dir);
      // `src/index.ts` -> `build/index.js` round-trips, so this one is FINE;
      // the failure below is the real asymmetry. Keeping both in one test is
      // deliberate: a map test that only ever sees `src`/`dist` proves nothing
      // about the derivation being a derivation.
      expect(verdict.problems.join('\n')).not.toContain('round-trip');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }

    const broken = workspace({
      ...SOURCES,
      'packages/pkg/src/index.ts': "import './registrar.js';\n",
      'packages/pkg/package.json': JSON.stringify({
        name: '@fixture/pkg',
        // A published barrel two levels deep: `src/index.ts` cannot produce it.
        main: './dist/esm/index.js',
        sideEffects: ['./dist/esm/index.js', './src/index.ts'],
      }),
    });
    try {
      const verdict = evaluatePackage(readArrayPackages(broken)[0], broken);
      expect(verdict.gauge).toBe(true);
      expect(verdict.problems.join('\n')).toContain('round-trip');
    } finally {
      fs.rmSync(broken, { recursive: true, force: true });
    }
  });

  it('main() exits 2 when no package declares an array', () => {
    const dir = workspace({ 'packages/pkg/package.json': JSON.stringify({ name: '@fixture/pkg' }) });
    try {
      expect(main([], dir)).toBe(EXIT_NO_MEASUREMENT);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('reachability — naming a module is not enough to retain it', () => {
  it('fails when a registrar is reachable only through a shakeable module', () => {
    // `barrel -> pure.ts -> registrar.ts`. Every name is in the array, and the
    // registration is still lost: `pure.ts` is shakeable, so when its exports go
    // unused a bundler drops it and takes the registrar's ONLY edge with it.
    const verdict = run({
      'packages/pkg/src/index.ts': "export { pure } from './pure.js';\n",
      'packages/pkg/src/pure.ts': "import './registrar.js';\nexport const pure = 1;\n",
      'packages/pkg/src/registrar.ts': "import { Registry } from 'somewhere';\nRegistry.register('fixture:key', 1);\n",
      'packages/pkg/package.json': manifest(HONEST_ARRAY),
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join('\n')).toContain('no chain of `sideEffects`-covered modules reaches it');
  });

  it('passes when the same registrar is reached from the barrel directly', () => {
    // The partner. Identical shape apart from where the edge starts, so the
    // assertion above is about REACHABILITY and not about the fixture.
    const verdict = run({ ...SOURCES, 'packages/pkg/package.json': manifest(HONEST_ARRAY) });
    expect(verdict.problems).toEqual([]);
  });
});

describe('classifyEffect', () => {
  const statements = (source: string) =>
    ts.createSourceFile('probe.ts', source, ts.ScriptTarget.Latest, true).statements;
  const kindOf = (source: string, locals: string[] = []) =>
    [...statements(source)].map((stmt) => classifyEffect(stmt, new Set(locals))).filter((k) => k !== null);

  it('reads any top-level call as a registration, whatever it is called', () => {
    // Deliberately NOT a name test. `Registry.add(...)` and `register(...)` are
    // indistinguishable to a bundler, and a name test is an UNDER-reading —
    // which here is the silent drop.
    expect(kindOf("register('x');")).toEqual(['registration']);
    expect(kindOf("Registry.add('x');")).toEqual(['registration']);
    expect(kindOf('new Thing();')).toEqual(['registration']);
    expect(kindOf('try { register(); } catch {}')).toEqual(['registration']);
  });

  it('reads a write to this module’s own binding as module-local', () => {
    expect(kindOf("Banner.displayName = 'Banner';", ['Banner'])).toEqual(['local-binding-write']);
  });

  it('...but a write to something it did NOT declare is unknown, not local', () => {
    // The asymmetry that keeps the carve-out honest: `window.x = 1` is
    // observable from outside and must not ride the displayName exemption.
    expect(kindOf("window.installed = true;")).toEqual(['unknown']);
    expect(kindOf("Banner.displayName = 'Banner';")).toEqual(['unknown']);
  });

  it('reads a bare import as propagation, not as an effect of the importer', () => {
    expect(kindOf("import './x.js';")).toEqual(['side-effect-only-import']);
    expect(kindOf("import { a } from './x.js';")).toEqual([]);
    expect(kindOf("export { a } from './x.js';")).toEqual([]);
  });

  it('reads declarations and directive prologues as nothing', () => {
    expect(kindOf("'use client';\nconst a = 1;\nfunction f() { register(); }\nexport const b = f;")).toEqual([]);
  });
});

describe('a call inside a top-level initializer (objectui#8578)', () => {
  // The card's shape: `export const X = f(...)` where `f` writes a slot living
  // in another module. A bundler drops the whole statement with the module, so
  // the effect leaves with the binding — but the classifier used to read the
  // statement as "declares a constant, does nothing" and score the package 0.
  //
  // Every assertion below has a partner that makes the same fixture NOT a
  // registration, because the widening's own failure mode is the opposite one:
  // reading `new Set([...])` as a registration would name every module in the
  // package and spend exactly the bytes the array exists to save.
  const kindOf = (source: string) => {
    const file = ts.createSourceFile('probe-8578.ts', source, ts.ScriptTarget.Latest, true);
    return [...file.statements].map((stmt) => classifyEffect(stmt, new Set())).filter((k) => k !== null);
  };

  it('sees a call whose callee writes a binding it did not declare', () => {
    // `nodeUnionOptions[0] = installed` — @object-ui/types' real shape, reduced.
    expect(
      kindOf(
        'const slot: unknown[] = [];\n' +
          'function install(u: unknown) { slot[0] = u; return u; }\n' +
          'export const Union = install(1);\n',
      ),
    ).toEqual(['registration']);
  });

  it('...but not when the callee only computes the binding’s value', () => {
    // The partner. Same statement shape, same call, callee writes nothing.
    expect(
      kindOf('function build(u: unknown) { const local = [u]; return local; }\nexport const Union = build(1);\n'),
    ).toEqual([]);
  });

  it('does not read a write inside a RETURNED closure as load-time', () => {
    // `withSettleSignal` in @object-ui/app-shell: the module counter moves when
    // the wrapper is CALLED, not when the module loads. This is the one site the
    // whole-workspace measurement flagged before the walk learned to stop at
    // function boundaries, and it is a false positive.
    expect(
      kindOf(
        'let pending = 0;\n' +
          'function wrap(f: () => void) { return () => { pending += 1; return f(); }; }\n' +
          'export const wrapped = wrap(() => {});\n',
      ),
    ).toEqual([]);
  });

  it('walks a function handed as an ARGUMENT to a call being made now', () => {
    // The asymmetry the partner above needs: a callback passed to a call that
    // is happening now may run now, so its writes are load-time.
    expect(
      kindOf(
        'const seen: unknown[] = [];\n' +
          'function each(cb: (v: number) => void) { cb(1); }\n' +
          'function fill() { each((v) => { seen.push(v); seen[0] = v; }); return seen; }\n' +
          'export const filled = fill();\n',
      ),
    ).toEqual(['registration']);
  });

  it('reads a call into ANOTHER package as value-producing', () => {
    // The stated boundary (see the gate's header): the walk cannot see into a
    // bare specifier, and another package's load-time behaviour is that
    // package's manifest's problem. Reading these as registrations is what took
    // @object-ui/app-shell from 14 registering modules to 122 when measured.
    expect(kindOf("import { z } from 'zod';\nexport const S = z.object({});\n")).toEqual([]);
    expect(kindOf('export const S = new Set([1, 2]);\n')).toEqual([]);
    expect(kindOf("import React from 'react';\nexport const C = React.createContext(null);\n")).toEqual([]);
  });

  it('does not read a call nested inside a declared function as load-time', () => {
    // `containsCall` (used for STATEMENTS) walks into function bodies; the
    // initializer rule must not, or every arrow-valued const is a registrar.
    expect(kindOf('export const render = () => register();\n')).toEqual([]);
  });
});

describe('an initializer registrar across a relative import (objectui#8578)', () => {
  // The unit tests above resolve a callee inside ONE file. This proves the whole
  // gate on the shape that actually occurs: the registering call is in the
  // barrel, the function it calls lives one relative import away, and the array
  // has to name the CALLER.
  const INITIALIZER_SOURCES: Files = {
    'packages/pkg/src/index.ts':
      "import { install } from './slot.js';\nexport const Union = install(1);\nexport { pure } from './pure.js';\n",
    'packages/pkg/src/slot.ts':
      'const options: unknown[] = [];\nexport function install(u: unknown) { options[0] = u; return u; }\n',
    'packages/pkg/src/pure.ts': 'export const pure = 1;\n',
  };

  it('names the module whose const initializer performs the write', () => {
    const verdict = run({
      ...INITIALIZER_SOURCES,
      'packages/pkg/package.json': manifest(['./dist/index.js', './src/index.ts']),
    });
    expect(verdict.problems).toEqual([]);
    expect(verdict.registrars).toEqual(['src/index.ts']);
    expect(verdict.ok).toBe(true);
  });

  it('would go RED if the effect became invisible again', () => {
    // The discrimination partner: identical fixture except the callee writes
    // nothing, so the same statement is a plain declaration and naming it is
    // STALE. A gate that returns the same verdict for both proves nothing.
    const verdict = run({
      ...INITIALIZER_SOURCES,
      'packages/pkg/src/slot.ts': 'export function install(u: unknown) { return [u]; }\n',
      'packages/pkg/package.json': manifest(['./dist/index.js', './src/index.ts']),
    });
    expect(verdict.registrars).toEqual([]);
    expect(verdict.ok).toBe(true);
  });
});

describe('the real workspace', () => {
  it('agrees with every array this repo actually declares', () => {
    const { packages, results } = evaluate(repoRoot);
    expect(packages.length, 'this gate is a set comparison; over nothing it is green for nothing').toBeGreaterThanOrEqual(2);
    for (const r of results) {
      expect(r.problems, `${r.name}: ${r.problems.join('\n')}`).toEqual([]);
      expect(r.missing, `${r.name} is missing ${r.missing.join(', ')}`).toEqual([]);
      expect(r.stale, `${r.name} has stale entries ${r.stale.join(', ')}`).toEqual([]);
    }
    expect(main([], repoRoot)).toBe(EXIT_OK);
  });

  it('finds the registrations the 2026-08-29 ruling names as controls', () => {
    // A FLOOR on the derivation, not a copy of it: the enumeration is derived
    // from the module bodies, and these are the modules whose registrations
    // `"sideEffects": false` was measured to drop to 0 chunks (objectui#6535).
    // If the walk stops seeing them, the array agrees with an empty enumeration.
    // The ruling named three; `CloudOnboardingNext.tsx` retired with its widget
    // (objectui#12954).
    const { results } = evaluate(repoRoot);
    const appShell = results.find((r) => r.name === '@object-ui/app-shell');
    expect(appShell, '@object-ui/app-shell must still declare a `sideEffects` array').toBeDefined();
    expect(appShell!.registrars).toContain('src/console/connect/ConnectAgentWidget.tsx');
    expect(appShell!.registrars).toContain('src/console/diagnostics/CloudAiModelStatus.tsx');
  });

  it('would go RED if one of those controls left the array', () => {
    // The discrimination proof against the REAL manifest: same package, same
    // module bodies, one entry removed. A gate that passes both before and
    // after proves nothing.
    const packages = readArrayPackages(repoRoot);
    const appShell = packages.find((p) => p.name === '@object-ui/app-shell')!;
    const wrong = {
      ...appShell,
      declared: (appShell.declared as string[]).filter((e: string) => e !== 'src/console/connect/ConnectAgentWidget.tsx'),
    };
    const verdict = evaluatePackage(wrong, repoRoot);
    expect(verdict.ok).toBe(false);
    expect(verdict.missing).toEqual(['src/console/connect/ConnectAgentWidget.tsx']);
    expect(main([], repoRoot)).toBe(EXIT_OK); // ...and the real one still passes
  });

  it('publishes distinct exit codes for a wrong array and a broken gauge', () => {
    expect(EXIT_OK).toBe(0);
    expect(EXIT_DISAGREES).toBe(1);
    expect(EXIT_NO_MEASUREMENT).toBe(2);
  });
});

describe('the walk covers EVERY entry point, not just the barrel (objectui#8850)', () => {
  // The card's shape, reduced to its bones: a package with TWO subpaths, whose
  // registrar is reachable only from the SECOND one. Walking just the barrel
  // makes the registrar invisible — never proposed as MISSING, and read as
  // STALE if the array names it anyway. That second consequence is why this is
  // not a coverage nit: the gate does not merely miss the defect, it argues for
  // introducing one.
  const TWO_ENTRY_SOURCES: Files = {
    'packages/pkg/src/index.ts': "export { pure } from './pure.js';\n",
    'packages/pkg/src/pure.ts': 'export const pure = 1;\n',
    'packages/pkg/src/secondary.ts': "import './registrar.js';\nexport const secondary = 1;\n",
    'packages/pkg/src/registrar.ts': "import { Registry } from 'somewhere';\nRegistry.register('fixture:secondary', 1);\n",
  };

  const twoEntryManifest = (sideEffects: string[]): string =>
    JSON.stringify(
      {
        name: '@fixture/pkg',
        type: 'module',
        main: './dist/index.js',
        exports: {
          '.': { types: './dist/index.d.ts', import: './dist/index.js' },
          './secondary': { types: './dist/secondary.d.ts', import: './dist/secondary.js' },
        },
        sideEffects,
      },
      null,
      2,
    );

  /** Forms + BOTH spellings of every entry point + both spellings of the registrar. */
  const TWO_ENTRY_HONEST = [
    './dist/index.js',
    './dist/registrar.js',
    './dist/secondary.js',
    './src/index.ts',
    './src/registrar.ts',
    './src/secondary.ts',
  ];

  it('proves the registrar is unreachable from the barrel — the fixture, not the gate', () => {
    // Anti-vacuity FIRST. Every assertion below is about a module the barrel's
    // own graph does not contain, so the fixture has to establish that much by
    // itself; otherwise the walk could have collapsed back to one root and
    // every green below would be green for the wrong reason.
    const dir = workspace({ ...TWO_ENTRY_SOURCES, 'packages/pkg/package.json': twoEntryManifest(TWO_ENTRY_HONEST) });
    try {
      const fromBarrel = walkEntryGraph(path.join(dir, 'packages/pkg/src/index.ts'), dir);
      expect(fromBarrel.modules.map((m) => path.relative(dir, m))).not.toContain(
        path.join('packages', 'pkg', 'src', 'registrar.ts'),
      );
      const verdict = evaluatePackage(readArrayPackages(dir)[0], dir);
      expect(verdict.entryPoints).toEqual(['src/index.ts', 'src/secondary.ts']);
      expect(verdict.registrars).toEqual(['src/registrar.ts']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('proposes the secondary entry’s registrar as MISSING', () => {
    // The leg that did not exist before. The array below is exactly what the
    // barrel-only walk derives — forms plus the source barrel — and it is now
    // three names short of the promise the package makes.
    const verdict = run({
      ...TWO_ENTRY_SOURCES,
      'packages/pkg/package.json': twoEntryManifest(['./dist/index.js', './dist/secondary.js', './src/index.ts']),
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.missing).toEqual(['dist/registrar.js', 'src/registrar.ts', 'src/secondary.ts']);
    expect(verdict.stale).toEqual([]);
  });

  it('...and passes, with no reachability complaint, once the array names them', () => {
    // The green partner: same fixture, honest array. `problems` empty is also
    // the reachability assertion — the registrar is reached from the SECONDARY
    // entry and from nothing else, so a check still anchored on the barrel
    // alone would report it retained by nobody.
    const verdict = run({ ...TWO_ENTRY_SOURCES, 'packages/pkg/package.json': twoEntryManifest(TWO_ENTRY_HONEST) });
    expect(verdict.problems).toEqual([]);
    expect(verdict.missing).toEqual([]);
    expect(verdict.stale).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  it('no longer calls a correct entry STALE — the consequence that made this p2', () => {
    // The gate used to derive an enumeration that did not contain these three
    // names, so an array that honestly named them read as STALE and the gate
    // told the author to DELETE a live registration. Nothing here is stale.
    const verdict = run({ ...TWO_ENTRY_SOURCES, 'packages/pkg/package.json': twoEntryManifest(TWO_ENTRY_HONEST) });
    expect(verdict.stale).toEqual([]);
    expect(verdict.registrars).toContain('src/registrar.ts');
  });

  it('still fails when the secondary entry reaches its registrar only through a shakeable module', () => {
    // Reachability WIDENED with the walk; it did not go away. Same chain that
    // fails from the barrel, hung off the secondary entry instead.
    const verdict = run({
      ...TWO_ENTRY_SOURCES,
      'packages/pkg/src/secondary.ts': "export { helper } from './helper.js';\n",
      'packages/pkg/src/helper.ts': "import './registrar.js';\nexport const helper = 1;\n",
      'packages/pkg/package.json': twoEntryManifest(TWO_ENTRY_HONEST),
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join('\n')).toContain('no chain of `sideEffects`-covered modules reaches it');
  });

  it('walks the union as ONE de-duplicated module set, not once per entry', () => {
    // The card's cost question. Both entries import the same module; it is
    // walked once, so N entries cost the union of their graphs and never N
    // times one of them.
    const verdict = run({
      'packages/pkg/src/index.ts': "export { shared } from './shared.js';\n",
      'packages/pkg/src/secondary.ts': "export { shared } from './shared.js';\n",
      'packages/pkg/src/shared.ts': 'export const shared = 1;\n',
      'packages/pkg/package.json': twoEntryManifest([
        './dist/index.js',
        './dist/secondary.js',
        './src/index.ts',
        './src/secondary.ts',
      ]),
    });
    expect(verdict.entryPoints).toEqual(['src/index.ts', 'src/secondary.ts']);
    expect(verdict.modulesWalked).toBe(3);
    expect(verdict.ok).toBe(true);
  });
});

describe('classifying a published form — entry point, or provably not a root', () => {
  // The distinction the fix had to draw. Both shapes below are forms the
  // inverse of the spelling map CANNOT map to a source file, and neither is a
  // defect — so "fail loudly when it cannot be mapped" would have turned this
  // gate red on its whole real population. What is loud is a form that cannot
  // be CLASSIFIED.

  it('reads a second build FORMAT of one subpath as no new root', () => {
    // `@object-ui/layout`'s real shape: one subpath `.`, an `import` half and a
    // `require` half. Conditions choose a format, not an entry, so the `.cjs`
    // adds no root — and is NOT re-spelled into a `dist/index.umd.js` that the
    // manifest does not publish and the array would then be told to name.
    const verdict = run({
      ...SOURCES,
      'packages/pkg/package.json': JSON.stringify({
        name: '@fixture/pkg',
        main: 'dist/index.umd.cjs',
        module: 'dist/index.js',
        exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js', require: './dist/index.umd.cjs' } },
        // The `.cjs` is a published FORM, so the array names it; what it is not
        // is a second graph ROOT, and it is not re-spelled into a
        // `dist/index.umd.js` the manifest never publishes.
        sideEffects: [...HONEST_ARRAY, './dist/index.umd.cjs'],
      }),
    });
    expect(verdict.entryPoints).toEqual(['src/index.ts']);
    expect(verdict.entryForms).toEqual([
      {
        subpath: '.',
        kind: 'entry-point',
        sources: ['src/index.ts'],
        forms: ['dist/index.js', 'dist/index.umd.cjs'],
        alternateFormats: ['dist/index.umd.cjs'],
      },
    ]);
    expect(verdict.problems).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  it('reads a published non-module ASSET as no new root', () => {
    // `@object-ui/app-shell`'s real shape: a stylesheet on its own subpath. It
    // is a resolution target and there is no import to follow out of it.
    // Positive on both halves — the file is THERE and no source module produces
    // it — never "the map returned undefined".
    const verdict = run({
      ...SOURCES,
      'packages/pkg/src/styles.css': '.a { color: red; }\n',
      'packages/pkg/package.json': JSON.stringify({
        name: '@fixture/pkg',
        main: './dist/index.js',
        exports: { '.': { import: './dist/index.js' }, './styles.css': './src/styles.css' },
        sideEffects: [...HONEST_ARRAY, './src/styles.css'],
      }),
    });
    expect(verdict.entryPoints).toEqual(['src/index.ts']);
    expect(verdict.entryForms.map((e) => [e.subpath, e.kind])).toEqual([
      ['.', 'entry-point'],
      ['./styles.css', 'asset'],
    ]);
    expect(verdict.problems).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  it('reads an ALIAS subpath that resolves to an entry already walked as no new root', () => {
    const verdict = run({
      ...SOURCES,
      'packages/pkg/package.json': JSON.stringify({
        name: '@fixture/pkg',
        main: './dist/index.js',
        exports: { '.': './dist/index.js', './index': './dist/index.js' },
        sideEffects: HONEST_ARRAY,
      }),
    });
    expect(verdict.entryPoints).toEqual(['src/index.ts']);
    expect(verdict.entryForms.map((e) => e.kind)).toEqual(['entry-point', 'duplicate-entry']);
    expect(verdict.ok).toBe(true);
  });

  it('refuses a form it cannot classify rather than skipping it', () => {
    // The loud case, and the reason it is loud: a skipped form is a skipped
    // ROOT, and a registrar behind it would never be proposed as MISSING —
    // this gate's own silent drop, one level up. `./dist/ghost.js` inverts to
    // no source module and is not a file present as published.
    const verdict = run({
      ...SOURCES,
      'packages/pkg/package.json': JSON.stringify({
        name: '@fixture/pkg',
        main: './dist/index.js',
        exports: { '.': './dist/index.js', './ghost': './dist/ghost.js' },
        sideEffects: HONEST_ARRAY,
      }),
    });
    expect(verdict.gauge).toBe(true);
    expect(verdict.problems.join('\n')).toContain('cannot CLASSIFY');
    expect(verdict.problems.join('\n')).toContain('"./dist/ghost.js"');
  });

  it('refuses a subpath PATTERN, which names no single file', () => {
    // The partner of the case above on the other shape that cannot be a root.
    // A `*` target resolves to many files or none; it is not an entry point and
    // it is not an asset on disk, so it is loud rather than silently dropped.
    const verdict = run({
      ...SOURCES,
      'packages/pkg/package.json': JSON.stringify({
        name: '@fixture/pkg',
        main: './dist/index.js',
        exports: { '.': './dist/index.js', './*': './dist/*.js' },
        sideEffects: HONEST_ARRAY,
      }),
    });
    expect(verdict.gauge).toBe(true);
    expect(verdict.problems.join('\n')).toContain('cannot CLASSIFY');
  });
});

describe('the verdict does not depend on whether the tree is BUILT (objectui#9124)', () => {
  // The defect this pins: `alternateFormats` was decided with `fs.existsSync`,
  // so `@object-ui/layout`'s `require` half classified as an `asset` on a built
  // tree and as an alternate format on an unbuilt one — and the file it turned
  // on (`packages/layout/dist/index.umd.cjs`) is `.gitignore`d, so the input was
  // not in the tree at all. A contributor who built the workspace got a red
  // their own diff could never clear.
  //
  // The fixture is `@object-ui/layout`'s real shape, run TWICE against the same
  // manifest: once with the build output materialised on disk, once without.
  // The two verdicts must be identical. This pins the INVARIANCE; the case
  // below still asserts the real-workspace population, which is what it exists
  // to prove and is not replaced here.
  const LAYOUT_SHAPED = {
    ...SOURCES,
    'packages/pkg/package.json': JSON.stringify({
      name: '@fixture/pkg',
      main: 'dist/index.umd.cjs',
      module: 'dist/index.js',
      exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js', require: './dist/index.umd.cjs' } },
      sideEffects: [...HONEST_ARRAY, './dist/index.umd.cjs'],
    }),
  };
  /** What `pnpm turbo run build` leaves behind, and nothing else. */
  const BUILD_OUTPUT: Files = {
    'packages/pkg/dist/index.js': "import './registrar.js';\nexport { pure } from './pure.js';\n",
    'packages/pkg/dist/index.umd.cjs': "'use strict';\nrequire('./registrar.js');\n",
  };

  it('classifies a second build FORMAT the same way built and unbuilt', () => {
    const unbuilt = run(LAYOUT_SHAPED);
    const built = run({ ...LAYOUT_SHAPED, ...BUILD_OUTPUT });

    // Anti-vacuity FIRST: two empty sets agree with each other, so an
    // agreement between them would pin nothing. The alternate format must
    // actually be found, in BOTH states, before the agreement means anything.
    expect(unbuilt.entryForms.flatMap((e) => e.alternateFormats)).toEqual(['dist/index.umd.cjs']);
    expect(built.entryForms.flatMap((e) => e.alternateFormats)).toEqual(['dist/index.umd.cjs']);

    // ...and then the invariance itself, over the whole classification rather
    // than the one field, so a future decision that reads the filesystem
    // somewhere else in this function is caught here too.
    expect(built.entryForms).toEqual(unbuilt.entryForms);
    expect(built.entryPoints).toEqual(unbuilt.entryPoints);
    expect(built.problems).toEqual(unbuilt.problems);
    expect(built.ok).toBe(unbuilt.ok);
    expect(built.ok).toBe(true);
  });

  it('still refuses a DANGLING form built and unbuilt — the gap is bounded, not global', () => {
    // The partner that keeps the pin above from being satisfied by a gate that
    // simply stopped classifying. `./ghost` has NO module form under it, so the
    // existence check still decides there and the refusal must survive both
    // states — including a built tree, where `dist/index.js` exists and only
    // `dist/ghost.js` does not.
    const withGhost = {
      ...SOURCES,
      'packages/pkg/package.json': JSON.stringify({
        name: '@fixture/pkg',
        main: './dist/index.js',
        exports: { '.': './dist/index.js', './ghost': './dist/ghost.js' },
        sideEffects: HONEST_ARRAY,
      }),
    };
    for (const [state, files] of [
      ['unbuilt', withGhost],
      ['built', { ...withGhost, 'packages/pkg/dist/index.js': "import './registrar.js';\n" }],
    ] as const) {
      const verdict = run(files);
      expect(verdict.gauge, state).toBe(true);
      expect(verdict.problems.join('\n'), state).toContain('cannot CLASSIFY');
      expect(verdict.problems.join('\n'), state).toContain('"./dist/ghost.js"');
    }
  });
});

describe('the real workspace — the population this widening was measured against', () => {
  // The two shapes above are not hypotheticals: they are the only two forms
  // this workspace publishes beside a barrel today. Pinning them keeps the
  // design rationale checkable — if either changes, the argument for
  // classifying rather than failing-to-map has to be re-read.
  it('classifies every form every array-declaring package publishes', () => {
    const { results } = evaluate(repoRoot);
    for (const r of results) {
      expect(r.problems.join('\n'), r.name).not.toContain('cannot CLASSIFY');
      expect(r.entryForms.length, `${r.name} publishes no form at all`).toBeGreaterThan(0);
    }
  });

  it('finds a stylesheet subpath and a second build format, and no second entry POINT', () => {
    const { results } = evaluate(repoRoot);
    const kinds = results.flatMap((r) => r.entryForms.map((e) => e.kind));
    expect(kinds).toContain('asset'); // @object-ui/app-shell's `./styles.css`
    expect(results.flatMap((r) => r.entryForms.flatMap((e) => e.alternateFormats)).length).toBeGreaterThan(0);
    // ...and every package still walks from exactly one root, which is the
    // sentence this change has to carry: the fix is right, and the genuine
    // multi-entry population is ZERO today, so it is future packages the
    // priority rests on rather than present ones.
    for (const r of results) expect(r.entryPoints, r.name).toHaveLength(1);
  });
});
