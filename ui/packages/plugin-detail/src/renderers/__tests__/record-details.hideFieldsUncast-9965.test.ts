/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#9965 — `record-details.tsx` read `hideFields` through
 * `(schema as any)`, the very key the mirror DECLARES
 * (`RecordDetailsComponentProps.hideFields`, `string[]`, declared by
 * objectui#9040 and aligned to `@objectstack/spec`
 * `RecordDetailsProps.hideFields`). The cast spent that declaration at the one
 * site it was added for — the same class objectui#9475 repaired one renderer
 * over, recurring here because that repair was per-FILE rather than per-CLASS.
 *
 * ## The census this card is fenced to
 *
 * When this card landed the file carried SEVEN `(schema as any)` occurrences
 * over FOUR distinct keys. Exactly TWO of those occurrences read a key the
 * mirror declared, and both were `hideFields` in the highlight-dedup path —
 * this card's repair. The other five read `requiredPermissions`,
 * `enforceFieldSecurity` and `redactFields`, keys the mirror did NOT declare
 * then, so a cast was the honest spelling. They were LEDGERED below with the
 * property that makes each exemption expire — the key still absent from the
 * mirror — and they expired as designed: `@objectstack/spec` 17.5.0 declared
 * all three on `record:details`, objectui#8649 declared them on the mirror and
 * removed the five casts, and this file went red until the ledger was emptied.
 * The occurrence counts in this paragraph are that history, ⛔ not a live
 * census: the legs below re-derive the reads every run.
 *
 * ## The three instruments, and which one actually settles it
 *
 *   - An indexed access on the TYPE (`Schema['hideFields']`) is a MEMBERSHIP
 *     question. A cast leaves membership intact, so this leg is GREEN on the
 *     defect and on the repair alike. MEASURED by this card's ablation, not
 *     assumed: re-casting the read left every type-level leg below green.
 *   - A RUNTIME assertion is green both ways too, and for a stronger reason:
 *     `as any` is erased before anything runs, so no behavioural test can tell
 *     the two sources apart. The dedup behaviour itself is already covered by
 *     `record-details.dedupeEmptinessTrims-8350.test.tsx` and
 *     `record-details.nameFieldDedupe-8175.test.tsx`; repeating it here would
 *     add a leg that cannot fail.
 *   - `getTypeAtLocation` on the READ EXPRESSION is the only instrument that
 *     reports what the read actually CARRIES. objectui#9475 named it and could
 *     not reach it from a type alias; this file reaches it by building a real
 *     `ts.Program`, the shape `scripts/__tests__/js-comment-mask-param-types-9324.test.ts`
 *     established. Measured on this site: `any` before the repair,
 *     `string[] | undefined` after.
 *
 * ## ⚠️ What the repair does NOT buy, measured rather than assumed
 *
 * `RecordDetailsRendererProps['schema']` is the mirror INTERSECTED WITH
 * `Record<string, any>`. An index signature admits any key at `any`, so a
 * MISSPELLED key still type-checks at this site even un-cast. What the un-cast
 * read buys is the declared TYPE: a wrong-typed use of the CORRECT spelling is
 * now refused. Both halves are pinned below, each with a control that varies
 * only the claim, so neither reading can rot into prose. ⛔ Narrowing that
 * index signature is a different card and is deliberately not attempted here.
 *
 * ## Both populations are DERIVED, never written down
 *
 * The mirror's declared keys are read off the renderer's own `schema` type
 * through the type checker; the contract's are read off
 * `RecordDetailsProps.shape`. A key either layer declares tomorrow joins the
 * guard without anyone editing this file.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import ts from 'typescript';
// ⛔ NOT `import * as` from '@objectstack/spec/ui' — the repo's
// `no-restricted-imports` rule refuses the namespace form by name, and named
// imports make the population a DECLARED set rather than "whatever the module
// happens to export". Same reasoning as `detailRendererUndeclaredKeys-8649`.
import { ComponentPropsMap, RecordDetailsProps } from '@objectstack/spec/ui';
import type { RecordDetailsComponentProps } from '@object-ui/types';
import type { RecordDetailsRendererProps } from '../record-details';
// @ts-expect-error — plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { maskComments } from '../../../../../scripts/js-comment-mask.mjs';

/** Local annotation, since the import above is untyped — the call site stays checked. */
const mask: (source: string) => string = maskComments;

/** Rooted at THIS file, never at `process.cwd()` — the two differ per invocation. */
const HERE = dirname(fileURLToPath(import.meta.url));
const RENDERER = join(HERE, '..', 'record-details.tsx');
const REPO_ROOT = join(HERE, '..', '..', '..', '..', '..');

/* ── Type-level legs (compiled by `tsc -p tsconfig.test.json`, erased by vitest) ── */

/** Invariant type equality. `A extends B` is NOT this: `never` and `any` pass that. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** The only assertion form used here — its constraint is what refuses `false`. */
type Expect<T extends true> = T;

/* Direction proofs: a broken instrument makes THIS file red, not green. */

// @ts-expect-error objectui#9965 — `Expect` must refuse `false`. Widen its constraint and this directive goes unused (TS2578).
type _ExpectRefusesFalse = Expect<false>;

// @ts-expect-error objectui#9965 — `any` must NOT read as equal to `true`. That is the exact shape a cast produces.
type _EqualRefusesAny = Expect<Equal<any, true>>;

/** The type the renderer's own `schema` carries — the one the read goes through. */
type Schema = NonNullable<RecordDetailsRendererProps['schema']>;

/**
 * The schema type carries the declared member, not `any`. This guards the
 * ANNOTATION — the `{} as any` erasure objectui#8649 repaired, which made every
 * read in this file `any` indistinguishably.
 *
 * ⚠️ It does NOT guard the read. An indexed access on the TYPE is a MEMBERSHIP
 * question, and membership is exactly what a cast leaves intact — measured by
 * this card's ablation, which re-cast the read and watched this leg stay green
 * while the program leg and the source-text leg went red. A reader who takes
 * this leg for the guard has repeated the defect one layer up.
 */
export type _SchemaTypeCarriesTheDeclaredMember = Expect<
  Equal<Schema['hideFields'], string[] | undefined>
>;

/** And it is the MIRROR's member, not a lookalike that drifted to the same spelling. */
export type _RendererAgreesWithTheMirror = Expect<
  Equal<Schema['hideFields'], RecordDetailsComponentProps['hideFields']>
>;

/**
 * ⚠️ LEDGER — the measured limit of this repair, asserted rather than written
 * down. `Record<string, any>` in `RecordDetailsRendererProps['schema']` admits
 * a MISSPELLED key at `any`, so un-casting does not make a typo red at this
 * site. The day that intersection is narrowed, this leg goes red and the limit
 * gets re-derived instead of quietly outliving its subject.
 */
export type _MisspellingIsStillAdmittedHere = Expect<Equal<Schema['hideFeilds'], any>>;

// @ts-expect-error objectui#9965 — CONTROL for the ledger above: the MIRROR interface has no index signature, so it REFUSES the same misspelling (TS2551). This directive going unused (TS2578) means the control stopped firing and the ledger leg stopped being a reading.
type _MirrorRefusesTheMisspelling = RecordDetailsComponentProps['hideFeilds'];

/* ── The program leg: what the read CARRIES, which is the discriminating one ── */

/**
 * Casts this file still carries over a key, each with the reason it is honest.
 * ⛔ Not an opinion, and ⛔ not a list of keys to leave alone forever: every
 * entry is asserted to be ABSENT FROM THE MIRROR below, so the exemption
 * expires the moment its premise does.
 *
 * ⭐ EMPTY since objectui#8649, and that is the measured outcome, not a
 * default. It is also the source-text guard's ledger, which held the three
 * keys objectui#11111 decision 3 = B (record 5902351047) booked to
 * objectui#8649 once `@objectstack/spec` 17.5.0 declared them on
 * `record:details`: `requiredPermissions`, `enforceFieldSecurity`,
 * `redactFields`. objectui#8649 declared them on the mirror and removed the
 * casts, so every entry expired at once and the guard is carve-out-free again.
 * ⛔ An entry added here is a cast over a key the mirror declares somewhere:
 * move the declaration or the read, don't ledger it.
 */
const HONEST_CASTS: Record<string, string> = {};

/** The cap: the booked casts, by name. Taken to `[]` by objectui#8649's landing. */
const OBJECTUI_11111_BOOKED_CASTS: string[] = [];

/** The field-security triple objectui#8649 declared on the mirror — each asserted DECLARED below. */
const FIELD_SECURITY_TRIPLE = ['enforceFieldSecurity', 'redactFields', 'requiredPermissions'];

interface SchemaRead {
  /** The property name read off `schema`. */
  key: string;
  /** 1-based line in the renderer, for a failure message that can be acted on. */
  line: number;
  /** Whether a cast stands between `schema` and the key. */
  cast: boolean;
  /** What `getTypeAtLocation` reports the READ EXPRESSION carries. */
  type: string;
}

interface Measurement {
  /** Every `schema.KEY` / `(schema as X).KEY` read in the renderer. */
  reads: SchemaRead[];
  /**
   * The same reads, measured by the same visitor and checker over
   * {@link CONTROL_SOURCE} — a virtual file that DOES carry a cast read and an
   * `any` read, so the renderer carrying neither is a reading, not a blind spot.
   */
  controlReads: SchemaRead[];
  /** Keys the MIRROR declares, derived from the very type the read goes through. */
  declared: string[];
  /** The index signature's value type, or null when the intersection lost it. */
  indexType: string | null;
}

/**
 * The lit control for the program leg (objectui#8649).
 *
 * Until objectui#8649 the renderer itself supplied both calibrations below — it
 * carried five cast reads, each typed `any`. Removing them is the point of that
 * card, and it left the renderer with no cast and no `any` read for the
 * instrument to find, so "found none" would read the same as "cannot see one".
 * This virtual file puts the three shapes back in front of the SAME checker, in
 * the SAME program, typed through the renderer's own exported props, so the
 * instrument is shown to report each one before its answer about the renderer
 * is believed. It exists only in the program's compiler host, never on disk.
 */
const CONTROL_FILE = join(HERE, '..', '__objectui_8649_program_control__.ts');
const CONTROL_SOURCE = [
  "import type { RecordDetailsRendererProps } from './record-details';",
  "declare const schema: NonNullable<RecordDetailsRendererProps['schema']>;",
  'export const castRead = (schema as any).hideFields;',
  'export const unCastRead = schema.hideFields;',
  'export const undeclaredRead = schema.zzqxNoSuchRecordBlockKey;',
].join('\n');

/**
 * Build a real program over the renderer and measure every read off `schema`.
 *
 * ⚠️ The ROOT tsconfig, deliberately, ⛔ not this package's `tsconfig.test.json`.
 * The package config empties `paths` so `tsc` resolves `@object-ui/*` through
 * each workspace dependency's BUILT `.d.ts`; the root config maps them to
 * `src`. The test shards run `pnpm test` without building anything, so a
 * program built the package's way would find no `@object-ui/types`, read
 * `RecordDetailsComponentProps` as `any`, and report the repaired read as
 * defective. The calibration leg below is what turns that failure mode from a
 * false verdict into a named one.
 *
 * `types: []` switches off automatic `@types/*` inclusion — nothing here needs
 * a global, and the explicit imports in the renderer still resolve their own.
 */
function measure(): Measurement {
  const configPath = join(REPO_ROOT, 'tsconfig.json');
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  expect(
    read.error && ts.flattenDiagnosticMessageText(read.error.messageText, ' '),
    'the root tsconfig must parse',
  ).toBeFalsy();
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, REPO_ROOT, undefined, configPath);
  expect(parsed.options.paths?.['@object-ui/types'], 'the mirror must resolve to source').toBeTruthy();

  const options: ts.CompilerOptions = {
    ...parsed.options,
    noEmit: true,
    skipLibCheck: true,
    types: [],
  };
  // The control file is served from memory; every other file comes off disk
  // exactly as before.
  const host = ts.createCompilerHost(options);
  const diskGetSourceFile = host.getSourceFile.bind(host);
  const diskFileExists = host.fileExists.bind(host);
  const diskReadFile = host.readFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) =>
    fileName === CONTROL_FILE
      ? ts.createSourceFile(fileName, CONTROL_SOURCE, languageVersion, true)
      : diskGetSourceFile(fileName, languageVersion, onError, shouldCreate);
  host.fileExists = (fileName) => fileName === CONTROL_FILE || diskFileExists(fileName);
  host.readFile = (fileName) => (fileName === CONTROL_FILE ? CONTROL_SOURCE : diskReadFile(fileName));

  const program = ts.createProgram([RENDERER, CONTROL_FILE], options, host);
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(RENDERER);
  expect(source, 'the renderer must be a program input').toBeTruthy();
  const control = program.getSourceFile(CONTROL_FILE);
  expect(control, 'the control file must be a program input').toBeTruthy();

  const reads: SchemaRead[] = [];
  const controlReads: SchemaRead[] = [];
  let schemaType: ts.Type | null = null;

  /** Unwrap parens / casts / non-null down to the identifier being read. */
  const rootOf = (node: ts.Expression): { id: ts.Identifier | null; cast: boolean } => {
    let cur: ts.Expression = node;
    let cast = false;
    for (;;) {
      if (ts.isParenthesizedExpression(cur)) { cur = cur.expression; continue; }
      if (ts.isNonNullExpression(cur)) { cur = cur.expression; continue; }
      if (ts.isSatisfiesExpression(cur)) { cur = cur.expression; continue; }
      if (ts.isAsExpression(cur) || ts.isTypeAssertionExpression(cur)) {
        cast = true;
        cur = cur.expression;
        continue;
      }
      break;
    }
    return { id: ts.isIdentifier(cur) ? cur : null, cast };
  };

  const visitor = (file: ts.SourceFile, into: SchemaRead[], bindSchemaType: boolean) => {
    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAccessExpression(node)) {
        const { id, cast } = rootOf(node.expression);
        if (id && id.text === 'schema') {
          if (bindSchemaType && !schemaType) schemaType = checker.getTypeAtLocation(id);
          into.push({
            key: node.name.text,
            line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
            cast,
            type: checker.typeToString(checker.getTypeAtLocation(node)),
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    return visit;
  };
  visitor(source!, reads, true)(source!);
  visitor(control!, controlReads, false)(control!);

  const resolved: ts.Type | null = schemaType;
  const declared = resolved ? checker.getPropertiesOfType(resolved).map((s) => s.name).sort() : [];
  const indexInfo = resolved ? checker.getIndexInfoOfType(resolved, ts.IndexKind.String) : undefined;
  return {
    reads,
    controlReads,
    declared,
    indexType: indexInfo ? checker.typeToString(indexInfo.type) : null,
  };
}

/**
 * Built once, LAZILY — a program over this renderer pulls in several hundred
 * files, and building it at module scope would report a calibration failure as
 * a collection error instead of as the named test that checks for it.
 */
let memo: Measurement | null = null;
const measurement = (): Measurement => (memo ??= measure());

describe('objectui#9965 — the instrument is calibrated before it is believed', () => {
  it('resolved the mirror: the declared population is real, and is not an everything-set', () => {
    // Empty or `any`-shaped would make every reading below vacuous, and that is
    // exactly what an unresolved `@object-ui/types` looks like.
    expect(measurement().declared).toContain('hideFields');
    expect(measurement().declared).toContain('sections');
    expect(measurement().declared.length).toBeGreaterThan(4);
    // …and any key still ledgered as cast is genuinely NOT in it (none since
    // objectui#8649 — the loop is kept so a new entry is judged the same way).
    for (const key of Object.keys(HONEST_CASTS)) {
      expect(measurement().declared).not.toContain(key);
    }
    // objectui#8649: the field-security triple IS in it now — the membership
    // half of that card's alignment, read off the renderer's own binding.
    for (const key of FIELD_SECURITY_TRIPLE) {
      expect(measurement().declared).toContain(key);
    }
  });

  it('found the reads it is meant to range over', () => {
    expect(measurement().reads.length).toBeGreaterThan(8);
    expect(measurement().reads.some((r) => !r.cast)).toBe(true);
  });

  it('CONTROL — the same visitor and checker report a cast and an `any` when one is there', () => {
    // Since objectui#8649 the renderer carries neither, so this is the only
    // place the instrument is shown to see them (see `CONTROL_SOURCE`). Each row
    // varies one thing against its neighbour.
    const byKey = (key: string, cast: boolean) =>
      measurement().controlReads.find((r) => r.key === key && r.cast === cast);
    expect(byKey('hideFields', true)?.type).toBe('any');
    expect(byKey('hideFields', false)?.type).toBe('string[] | undefined');
    expect(byKey('zzqxNoSuchRecordBlockKey', false)?.type).toBe('any');
    expect(measurement().controlReads).toHaveLength(3);
  });

  it('`any` is a reachable verdict here, so the assertion below can fail', () => {
    // The index signature is what admits an undeclared key at `any`. Without
    // this control, "no declared read carries `any`" would also be satisfied by
    // an instrument that never reports `any` at all. The renderer supplied an
    // `any` read of its own until objectui#8649 removed the last ones; the
    // control file supplies it now.
    expect(measurement().indexType).toBe('any');
    expect(measurement().controlReads.filter((r) => r.type === 'any').length).toBeGreaterThan(0);
  });
});

describe('objectui#9965 — the declaration reaches the read', () => {
  it('every read of a MIRROR-DECLARED key carries its declared type, never `any`', () => {
    const spent = measurement().reads
      .filter((r) => measurement().declared.includes(r.key))
      .filter((r) => r.cast || r.type === 'any')
      // Named, not counted: a failure has to say WHICH read regressed.
      .map((r) => `${r.key} @ line ${r.line} => ${r.type}${r.cast ? ' (cast)' : ''}`);
    expect(spent).toEqual([]);
  });

  it('the field-security triple is still READ, and each read carries the mirror\'s type (objectui#8649)', () => {
    // The expression half of objectui#8649's alignment on this file: the leg
    // above already refuses a cast or an `any` on these keys now that the mirror
    // declares them; this one is the liveness and the exact type, so deleting
    // a read cannot satisfy it.
    for (const key of FIELD_SECURITY_TRIPLE) {
      const hits = measurement().reads.filter((r) => r.key === key);
      expect(hits.length, `${key} is no longer read`).toBeGreaterThan(0);
      // `string[]` is the `Array.isArray` narrowing of the same declaration.
      const declaredAs = key === 'enforceFieldSecurity' ? ['boolean | undefined'] : ['string[] | undefined', 'string[]'];
      for (const hit of hits) {
        expect(hit.cast, `${key} @ line ${hit.line} is cast`).toBe(false);
        expect(declaredAs, `${key} @ line ${hit.line}`).toContain(hit.type);
      }
    }
  });

  it('`hideFields` is still READ, and reads as the mirror declares it', () => {
    const hits = measurement().reads.filter((r) => r.key === 'hideFields');
    // Liveness: a negative guard alone is satisfied by deleting the read.
    expect(hits.length).toBeGreaterThan(0);
    // `string[]` is the `Array.isArray` narrowing of the same declaration.
    for (const hit of hits) {
      expect(['string[] | undefined', 'string[]']).toContain(hit.type);
    }
  });

  for (const [key, why] of Object.entries(HONEST_CASTS)) {
    it(`the cast over \`${key}\` is honest because the mirror still does not declare it`, () => {
      expect(why.length).toBeGreaterThan(0);
      // ⭐ The expiry condition. Declare the key and this leg goes red, which is
      // the point: the exemption cannot outlive its premise.
      expect(measurement().declared).not.toContain(key);
      expect(measurement().reads.some((r) => r.key === key && r.cast)).toBe(true);
    });
  }
});

/* ── Source-text legs: the cheap guard, over the CONTRACT's population ─────── */

const maskedRenderer = (): string => mask(readFileSync(RENDERER, 'utf8'));

/**
 * A cast standing between `schema` and `key` — the shape that makes a
 * declaration inert at its own read site. Built per key so the guard below can
 * range over a DERIVED population rather than a written-down list.
 */
const castBefore = (key: string): RegExp =>
  new RegExp(`\\(\\s*schema\\s+as\\s+\\w+\\s*\\)\\s*\\.\\s*${key}\\b`);

/** Every key the CONTRACT declares on this block — read off the artifact, every run. */
const declaredKeys = (): string[] => Object.keys(RecordDetailsProps.shape).sort();

describe('objectui#9965 — the source-text guard is derived and discriminates', () => {
  it('reads the contract’s own props schema, non-empty and calibrated both ways', () => {
    const keys = declaredKeys();
    expect(keys.length).toBeGreaterThan(5);
    expect(keys).toContain('hideFields');
    // …and it is not an everything-set, which would make the guard unfalsifiable.
    // (`enforceFieldSecurity` / `requiredPermissions` were the absent controls
    // through `@objectstack/spec` 17.4.0; 17.5.0 declares both on this block —
    // objectui#11073 — so the control is a key nothing declares.)
    expect(keys).not.toContain('zzqxNoSuchRecordBlockKey');
    // The premise of reading the named export: it IS this block's map entry.
    expect(ComponentPropsMap['record:details']).toBe(RecordDetailsProps);
  });

  it('the cast matcher fires on the cast form and refuses the un-cast one', () => {
    // The control varies ONLY the claim, in the same command as the zero below.
    const m = castBefore('hideFields');
    expect(m.test('Array.isArray((schema as any).hideFields)')).toBe(true);
    expect(m.test('Array.isArray(schema.hideFields)')).toBe(false);
    // Comments are masked before the guard runs, so this file's own prose —
    // and the renderer's, which spells the cast out — can neither satisfy nor
    // defeat it.
    expect(mask('// (schema as any).hideFields\nconst x = 1;')).not.toMatch(m);
  });

  it('no cast stands between `schema` and ANY contract-declared key', () => {
    const source = maskedRenderer();
    // Proof the file was read and masked, so the absences below are about the
    // spelling and not about an empty string.
    expect(source).toContain('RecordDetailsRendererProps');
    // Liveness, in source text this time: the read and its guard are still here.
    expect(source).toMatch(/Array\.isArray\(schema\.hideFields\) \? schema\.hideFields/);
    const cast = declaredKeys().filter((key) => castBefore(key).test(source));
    // Named, not counted: a failure has to say WHICH key regressed. Any cast
    // over a contract-declared key outside the booked ledger is red.
    expect(cast.filter((key) => !(key in HONEST_CASTS))).toEqual([]);
    // THE CAP (objectui#11111 decision 3 = B): the ledger holds exactly the three
    // booked to objectui#8649, each still contract-declared AND still cast — so
    // it can neither grow nor keep an entry whose cast is gone.
    expect(Object.keys(HONEST_CASTS).sort()).toEqual(OBJECTUI_11111_BOOKED_CASTS);
    expect(cast.filter((key) => key in HONEST_CASTS).sort()).toEqual(OBJECTUI_11111_BOOKED_CASTS);
  });
});
