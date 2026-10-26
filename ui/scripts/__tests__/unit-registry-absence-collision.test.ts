import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Plain-JS shared helper. Its types are INFERRED from the .mjs source by
// `tsconfig.scripts.json` (`allowJs`), so no `@ts-expect-error` here —
// re-adding one is itself an error (TS2578). See objectui#3494.
import {
  FLOORS,
  checkFloors,
  findCollisions,
  formatCollisions,
  readAbsenceAssertions,
  readImportSpecifiers,
  readOwnRegistrations,
  readUnitProjectShape,
  resolveSpecifier,
  unitProjectFiles,
} from '../unit-registry-collision.mjs';
import {
  healGlobalLeaks,
  snapshotGlobals,
} from '../../vitest.setup.shared-global-leak';

/**
 * objectui#7134 — the `unit` project's `isolate: false` is safe only while a
 * key one file asserts ABSENT from the `ComponentRegistry` is registered by no
 * other file in the project. This gate is what makes that a fact rather than a
 * sentence in `vitest.config.mts`.
 *
 * ## Why a comment was not enough
 *
 * The config used to justify `isolate: false` with "no ComponentRegistry ... state
 * to leak across files". That premise was false in BOTH directions and had been
 * for some time: the project holds files whose import closure registers into the
 * singleton, and files that assert a key is absent from it. Measured here on
 * every run — over `ec0a7b846` the project's 811 files import 551 distinct
 * modules whose closures register 505 keys into the shared singleton.
 *
 * Nothing was red, and that is the point: a collision is ORDER-DEPENDENT, so it
 * arrives as a failure in a file that did nothing wrong, in whichever worker
 * happened to run the writer first. A comment is the only thing a future author
 * consults before adding a registering import to this project, and this one had
 * already gone false without anyone noticing.
 *
 * ## Why the writers' keys are EXECUTED and not read off the source
 *
 * They cannot be read off the source. The live field path registers from data —
 * `registerAllFields()` walks a map — so `field:multiselect` exists at runtime
 * and appears in no `register('field:multiselect')` call site anywhere in the
 * repo. A static reader would report "nothing registers it" and this gate would
 * be green for the empty reason. So the writer half is measured by running the
 * project's import closures in a FRESH module graph and diffing the registry;
 * only what genuinely cannot be executed (a file's own in-body `register` calls,
 * which happen when the test runs, not when it is imported) is read off the AST.
 *
 * ## Why this file does not itself pollute the project it measures
 *
 * It runs in the very project it is about, so its own imports would otherwise be
 * the largest registry write in it. `vi.resetModules()` before the measurement
 * gives it a private module graph — a fresh `@object-ui/core`, therefore a fresh
 * singleton, not the one its worker's other files hold — and a second reset
 * afterwards drops that graph so files running later re-import their own.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const configPath = path.join(repoRoot, 'vitest.config.mts');

/** Where a future author reads the justification, and what it must point at. */
const GUARD_PATH = 'scripts/__tests__/unit-registry-absence-collision.test.ts';

type Population = {
  files: string[];
  readers: Array<{ file: string; keys: string[]; sites: Array<{ key: string | null; line: number; matcher: string; text: string }> }>;
  ownWriters: Array<{ file: string; keys: string[] }>;
  unresolvedAbsenceSites: Array<{ file: string; line: number; text: string }>;
  specsByFile: Map<string, string[]>;
  importIds: string[];
  workspaceIds: Set<string>;
  filesBySpecId: Map<string, string[]>;
  unresolvedSpecifiers: Array<{ file: string; spec: string }>;
  isolateFalse: boolean;
  configText: string;
};

function derive(): Population {
  const configText = fs.readFileSync(configPath, 'utf8');
  const shape = readUnitProjectShape(configText);
  const files: string[] = unitProjectFiles(repoRoot, shape);

  const readers: Population['readers'] = [];
  const ownWriters: Population['ownWriters'] = [];
  const unresolvedAbsenceSites: Population['unresolvedAbsenceSites'] = [];
  const specsByFile = new Map<string, string[]>();
  const filesBySpecId = new Map<string, string[]>();
  const workspaceIds = new Set<string>();
  const unresolvedSpecifiers: Population['unresolvedSpecifiers'] = [];
  const importIds: string[] = [];

  for (const file of files) {
    const source = fs.readFileSync(path.join(repoRoot, file), 'utf8');

    const sites = readAbsenceAssertions(source, file);
    if (sites.length > 0) {
      const keys = [...new Set(sites.map((s) => s.key).filter((k): k is string => k !== null))];
      readers.push({ file, keys, sites });
      for (const site of sites) {
        if (site.key === null) unresolvedAbsenceSites.push({ file, line: site.line, text: site.text });
      }
    }

    const own = readOwnRegistrations(source, file);
    if (own.keys.length > 0) ownWriters.push({ file, keys: own.keys });

    const specs = readImportSpecifiers(source, file);
    specsByFile.set(file, specs);
    for (const spec of specs) {
      const resolved = resolveSpecifier(repoRoot, file, spec);
      if (resolved.kind === 'unresolved') {
        unresolvedSpecifiers.push({ file, spec });
        continue;
      }
      if (resolved.kind === 'workspace') workspaceIds.add(resolved.id);
      if (!filesBySpecId.has(resolved.id)) {
        filesBySpecId.set(resolved.id, []);
        importIds.push(resolved.id);
      }
      filesBySpecId.get(resolved.id)!.push(file);
    }
  }

  return {
    files, readers, ownWriters, unresolvedAbsenceSites, specsByFile, importIds,
    workspaceIds, filesBySpecId, unresolvedSpecifiers, isolateFalse: shape.isolateFalse, configText,
  };
}

/**
 * `@object-ui/core` by computed specifier, like every other import below it.
 * `tsconfig.scripts.json` has no path mapping into the workspace packages, and
 * adding one to type ONE line would put every `scripts/` file on a different
 * module resolution than the one CI type-checks them with.
 */
const CORE_SPECIFIER = '@object-ui/core';
type Singleton = { getAllTypes(): string[] };

/**
 * Import `ids` into a private module graph and report what they registered.
 *
 * The globals are snapshotted and put back around the measurement, and that is
 * not hygiene — it is a measured repair (objectui#8500). `ids` is derived from
 * what the project's test files IMPORT, and one of them names a root setup
 * module: `scripts/__tests__/network-escape-ledger.test.ts` imports
 * `vitest.setup.network-escape-guard`. `vi.resetModules()` drops it from the
 * registry, so importing it here RE-EXECUTES it, and its body assigns a second
 * `guardedFetch` over the first. Both wrappers are named `guardedFetch`, so
 * nothing downstream could see the swap — every file after this one in the
 * worker ran with a doubled wrapper whose `afterEach` belonged to a module
 * instance the run had already discarded.
 */
async function registryAfterImporting(ids: string[]) {
  const scope = globalThis as unknown as Record<string, unknown>;
  const globalsBefore = snapshotGlobals(scope);
  vi.resetModules();
  const { ComponentRegistry } = (await import(/* @vite-ignore */ CORE_SPECIFIER)) as {
    ComponentRegistry: Singleton;
  };
  const before = new Set<string>(ComponentRegistry.getAllTypes());
  const failures: Array<{ id: string; message: string }> = [];
  let imported = 0;
  for (const id of ids) {
    try {
      await import(/* @vite-ignore */ id);
      imported += 1;
    } catch (error) {
      failures.push({ id, message: String((error as Error)?.message ?? error).split('\n')[0].slice(0, 160) });
    }
  }
  const added = ComponentRegistry.getAllTypes().filter((k) => !before.has(k));
  // Before anything else can observe them: a re-executed setup module leaves its
  // own globals behind, and this file's job is to measure the project, not to
  // change it out from under the files that run after it.
  healGlobalLeaks(scope, globalsBefore);
  return { added, failures, imported, startedEmpty: before.size === 0 };
}

let population: Population;
let measurement: Awaited<ReturnType<typeof registryAfterImporting>>;

beforeAll(async () => {
  population = derive();
  measurement = await registryAfterImporting(population.importIds);
}, 600_000);

// Drop the private graph so files running later in this worker re-import their
// own rather than inheriting the one this file built.
afterAll(() => {
  vi.resetModules();
});

describe('the unit project shares one ComponentRegistry, and this gate is what keeps that safe (objectui#7134)', () => {
  it('is measuring the project it claims to (population, readers, writers, modules)', () => {
    const counts = {
      populationFiles: population.files.length,
      readerFiles: population.readers.length,
      resolvedAbsentKeys: new Set(population.readers.flatMap((r) => r.keys)).size,
      distinctSpecifiers: population.importIds.length,
      registeredKeys: measurement.added.length,
    };
    expect(
      checkFloors(counts),
      'a population COLLAPSED — this run proves nothing:\n' +
        JSON.stringify(counts, null, 2) +
        '\nFix the derivation. If a floor is genuinely too high because the tree changed shape, ' +
        'move it in `FLOORS` deliberately and say why — never to make a red run green.',
    ).toEqual([]);
    // The private graph must really be private: a non-empty starting registry
    // means `vi.resetModules()` did not give this file its own `@object-ui/core`,
    // and every number above would be about its worker's leftovers instead.
    expect(measurement.startedEmpty, 'the measurement did not start from a fresh registry').toBe(true);
  });

  it('imports every module this repo owns (a module that fails to load registers nothing)', () => {
    const ours = measurement.failures.filter((f) => population.workspaceIds.has(f.id));
    expect(
      ours.map((f) => `${path.relative(repoRoot, f.id)}: ${f.message}`),
      'a workspace module the unit project imports could not be imported here, so its registrations ' +
        'were not measured and this gate is blind to them',
    ).toEqual([]);
    expect(
      population.unresolvedSpecifiers.length,
      `relative import specifiers with no file behind them: ${JSON.stringify(population.unresolvedSpecifiers.slice(0, 5))}`,
    ).toBeLessThanOrEqual(2);
  });

  it('no key asserted ABSENT by one file is registered by another', async () => {
    const absentKeys = new Set(population.readers.flatMap((r) => r.keys));
    const registered = new Set(measurement.added);

    // Cheap path first: the whole project's closures registered `measurement.added`,
    // so if no asserted-absent key is in there, no closure can collide with one.
    const suspects = [...absentKeys].filter((k) => registered.has(k));

    const writers: Array<{ file: string; keys: string[] }> = [...population.ownWriters];
    for (const key of suspects) {
      for (const reader of population.readers.filter((r) => r.keys.includes(key))) {
        // Attribution runs only on this expensive path, and it runs over the
        // specifiers SOME OTHER file imports. Measuring the whole union instead
        // would let the reader's own closure answer for the key — a file that
        // registers what it then asserts absent is hermetic, not a collision,
        // and reporting one would be a false red.
        const othersIds = population.importIds.filter((id) =>
          (population.filesBySpecId.get(id) ?? []).some((f) => f !== reader.file),
        );
        const specId = await bisectForKey(key, othersIds);
        if (!specId) continue;
        const importers = (population.filesBySpecId.get(specId) ?? []).filter((f) => f !== reader.file);
        const via = ` (via ${path.relative(repoRoot, specId)})`;
        for (const importer of importers) writers.push({ file: `${importer}${via}`, keys: [key] });
      }
    }

    const collisions = findCollisions(
      population.readers.map((r) => ({ file: r.file, keys: r.keys })),
      writers,
    );
    expect(
      collisions,
      'REGISTRY COLLISION in the `unit` project. `vitest.config.mts` runs it with `isolate: false`, so ' +
        'these files share one module graph — and one ComponentRegistry — per worker. Whether the ' +
        'absence assertion sees the registration depends on which file the worker ran first, so the ' +
        'outcome is not information about the code under test:\n' +
        formatCollisions(collisions) +
        '\n\nClose it by making the absence assertion hermetic (reset the module graph and re-import ' +
        'only what it means to measure), or by keeping the registration out of this project.',
    ).toEqual([]);
  }, 600_000);

  it('reports every absence assertion whose key it could not resolve, rather than dropping it', () => {
    // An unresolvable key is a place this gate is blind. Today there is exactly
    // one — `exclusion-reason-truthfulness.test.ts` asserts over a key set
    // derived at runtime from `PALETTE_EXCLUSIONS`. Dropping such a site
    // silently is how a gate shrinks to nothing while staying green, so the
    // count is pinned: a NEW one is a decision, not a default.
    expect(
      population.unresolvedAbsenceSites.map((s) => `${s.file}:${s.line} ${s.text}`),
      'a new registry-absence assertion names a key this gate cannot resolve statically, so it cannot ' +
        'check it. Either spell the key as a literal (or a local const), or make the assertion hermetic ' +
        'and record why here.',
    ).toHaveLength(1);
  });

  it('the config justification still points at this gate', () => {
    // Rule of the card: the justification is the only thing a future author
    // consults. It has to name where the constraint is enforced, and that name
    // has to still be true.
    expect(
      population.configText.includes(GUARD_PATH),
      `vitest.config.mts no longer names ${GUARD_PATH} in the \`unit\` project's \`isolate: false\` ` +
        'justification. Point it back at the gate, or move the gate and update the comment.',
    ).toBe(true);
    expect(population.isolateFalse, "the `unit` project no longer sets `isolate: false`").toBe(true);
  });
});

/** Which single specifier registers `key`? Bisection — the red path only. */
async function bisectForKey(key: string, ids: string[]): Promise<string | null> {
  let pool = ids;
  const registers = async (subset: string[]) => (await registryAfterImporting(subset)).added.includes(key);
  if (!(await registers(pool))) return null;
  while (pool.length > 1) {
    const mid = Math.floor(pool.length / 2);
    const head = pool.slice(0, mid);
    pool = (await registers(head)) ? head : pool.slice(mid);
  }
  return pool[0] ?? null;
}

describe('the judgement, on planted populations (this gate must be able to go red)', () => {
  it('names both files and the key when a writer registers what a reader asserts absent', () => {
    const collisions = findCollisions(
      [{ file: 'a.test.ts', keys: ['field:retired'] }],
      [{ file: 'b.test.ts', keys: ['field:retired', 'field:kept'] }],
    );
    expect(collisions).toEqual([{ key: 'field:retired', reader: 'a.test.ts', writer: 'b.test.ts' }]);
    expect(formatCollisions(collisions)).toContain('a.test.ts');
    expect(formatCollisions(collisions)).toContain('b.test.ts');
    expect(formatCollisions(collisions)).toContain('field:retired');
  });

  it('does not report a file colliding with itself — that file is hermetic either way', () => {
    expect(
      findCollisions([{ file: 'a.test.ts', keys: ['k'] }], [{ file: 'a.test.ts', keys: ['k'] }]),
    ).toEqual([]);
  });

  it('an empty population FAILS instead of passing (every floor is one a zero would satisfy)', () => {
    expect(checkFloors({ populationFiles: 0, readerFiles: 0, resolvedAbsentKeys: 0, distinctSpecifiers: 0, registeredKeys: 0 }))
      .toHaveLength(Object.keys(FLOORS).length);
    // A population that was never measured is not "zero", and must not read as one.
    expect(checkFloors({}).every((line: string) => line.includes('NOT MEASURED'))).toBe(true);
    // The control's control: a healthy census clears every floor.
    expect(checkFloors({ populationFiles: 810, readerFiles: 2, resolvedAbsentKeys: 2, distinctSpecifiers: 600, registeredKeys: 502 }))
      .toEqual([]);
  });
});

describe('the readers read the AST, not the text (this repo embeds fixture sources in strings)', () => {
  const absence = (src: string) => readAbsenceAssertions(src, 'f.test.ts');

  it('finds a literal-key absence assertion', () => {
    expect(absence("expect(ComponentRegistry.get('field:x')).toBeUndefined();")[0]).toMatchObject({
      key: 'field:x', matcher: 'toBeUndefined',
    });
  });

  it('resolves a template key through a local const, the way a retirement pin spells it', () => {
    const src = "const RETIRED = 'multiselect';\nexpect(ComponentRegistry.get(`field:${RETIRED}`)).toBeUndefined();";
    expect(absence(src)[0].key).toBe('field:multiselect');
  });

  it('counts `.not.toBeDefined()` as absence and plain `.toBeDefined()` as presence', () => {
    expect(absence("expect(ComponentRegistry.get('k')).not.toBeDefined();")).toHaveLength(1);
    expect(absence("expect(ComponentRegistry.get('k')).toBeDefined();")).toHaveLength(0);
    expect(absence("expect(ComponentRegistry.get('k')).not.toBeUndefined();")).toHaveLength(0);
  });

  it('reports an unresolvable key as a site with key null, never as no site at all', () => {
    expect(absence('expect(ComponentRegistry.get(type)).toBeFalsy();')).toMatchObject([{ key: null }]);
  });

  it('ignores a registration written inside a fixture string — source to a regex, not a registration', () => {
    const src = 'const fixture = `ComponentRegistry.register("ui:ghost", C, { namespace: "ui" });`;\n';
    expect(readOwnRegistrations(src, 'f.test.ts').keys).toEqual([]);
    expect(readImportSpecifiers("const f = `import '@object-ui/components';`;\n", 'f.test.ts')).toEqual([]);
  });

  it('reads a real in-body registration, with the bare-name fallback `register` also writes', () => {
    const one = readOwnRegistrations("ComponentRegistry.register('grid', C, { namespace: 'view' });", 'f.test.ts');
    expect(one.keys).toEqual(['view:grid', 'grid']);
    const skipped = readOwnRegistrations(
      "ComponentRegistry.register('grid', C, { namespace: 'view', skipFallback: true });", 'f.test.ts');
    expect(skipped.keys).toEqual(['view:grid']);
  });

  it('reports a dynamic registration key rather than dropping the call', () => {
    expect(readOwnRegistrations('ComponentRegistry.register(type, C);', 'f.test.ts')).toMatchObject({
      keys: [], unresolved: [{ line: 1 }],
    });
  });
});
