/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#9475 — `record-related-list.tsx` read `relationshipValueField`
 * through `(schema as any)`, the very key objectui#9469/#8649 had just
 * DECLARED on the mirror (`RecordRelatedListComponentProps`, aligned to
 * `@objectstack/spec` `RecordRelatedListProps.relationshipValueField`). The
 * cast unwrapped the declaration at the one site it was added for — the D1
 * shape that card's contract review found on `record-reference-rail.tsx`, one
 * renderer over.
 *
 * ## The two instruments, and why only one of them settles it
 *
 *   - `getPropertyOfType` on the BINDING is a MEMBERSHIP question. It unwraps
 *     casts, so it reports the key as declared either way — which is why the
 *     declaration looked like it had arrived.
 *   - `getTypeAtLocation` on the READ EXPRESSION is the only instrument that
 *     says what the read actually carries. Run on this site for the first time
 *     by this card: `any` before, `string | undefined` after.
 *
 * ⚠️ Neither instrument is reachable from a type alias, so the discriminating
 * leg in THIS file is the source-text one below. The type-level legs are
 * membership-shaped and stay green on the re-cast source — measured by this
 * card's ablation, and labelled at each one rather than left to be assumed.
 *
 * ## What the repair did NOT buy — and the card that bought it
 *
 * When this card landed, the renderer's own `schema` type was that interface
 * INTERSECTED WITH `Record<string, any>`, so a MISSPELLED key still
 * type-checked here even un-cast; the un-cast read bought the declared TYPE
 * only. This file pinned that limit as a ledger leg built to go red the day
 * the intersection was narrowed. objectui#9963 narrowed it, the leg went red
 * as designed, and the refusal — with the mirror control that used to sit
 * here — now lives in `record-related-list.propsRefusal-9963.test.tsx`.
 *
 * ## The guard is DERIVED, not a list
 *
 * The population of keys the guard protects is read off the contract's own
 * `record:related_list` props schema every run. A key the platform declares
 * tomorrow joins the guard without anyone editing this file.
 *
 * ## The ledger is EMPTY now, and that is a measured outcome
 *
 * This file shipped with one ledgered exemption — `add` — asserted STILL
 * PRESENT so the exemption could not outlive its subject. It did not: that
 * assertion is what went red when objectui#9964 removed the four
 * `(schema as any).add` reads, which is the mechanism working, not a
 * regression. Its subject was a real TS2322 — the mirror typed
 * `add.picker.filter` as `unknown` while `RelatedList`'s own prop types it
 * `ViewFilterRule[]` — and objectui#9964 moved the MIRROR to the protocol's
 * array, so the cast had nothing left to hide. With the ledger empty, the
 * derived guard below covers EVERY contract-declared key with no carve-out.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import * as React from 'react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { RecordContextProvider } from '@object-ui/react';
// ⛔ NOT `import * as` from '@objectstack/spec/ui' — the repo's
// `no-restricted-imports` rule refuses the namespace form by name, and named
// imports make the population a DECLARED set rather than "whatever the module
// happens to export". Same reasoning as `detailRendererUndeclaredKeys-8649`.
import { ComponentPropsMap, RecordRelatedListProps } from '@objectstack/spec/ui';
import type { RecordRelatedListComponentProps } from '@object-ui/types';
import {
  RecordRelatedListRenderer,
  type RecordRelatedListRendererProps,
} from '../record-related-list';
// @ts-expect-error — plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { maskComments } from '../../../../../scripts/js-comment-mask.mjs';

/** Local annotation, since the import above is untyped — the call site stays checked. */
const mask: (source: string) => string = maskComments;

/** Rooted at THIS file, never at `process.cwd()` — the two differ per invocation. */
const HERE = dirname(fileURLToPath(import.meta.url));
const RENDERER = join(HERE, '..', 'record-related-list.tsx');

/* ── Type-level legs (compiled by `tsc -p tsconfig.test.json`, erased by vitest) ── */

/** Invariant type equality. `A extends B` is NOT this: `never` and `any` pass that. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** The only assertion form used here — its constraint is what refuses `false`. */
type Expect<T extends true> = T;

/* Direction proofs: a broken instrument makes THIS file red, not green. */

// @ts-expect-error objectui#9475 — `Expect` must refuse `false`. Widen its constraint and this directive goes unused (TS2578).
type _ExpectRefusesFalse = Expect<false>;

// @ts-expect-error objectui#9475 — `any` must NOT read as equal to `true`. That is the exact shape a cast produces.
type _EqualRefusesAny = Expect<Equal<any, true>>;

/** The type the renderer's own `schema` carries — the one the read goes through. */
type Schema = NonNullable<RecordRelatedListRendererProps['schema']>;

/**
 * The schema type carries the declared member, not `any`. This guards the
 * ANNOTATION — the `{} as any` erasure objectui#8649 repaired, which made every
 * read in this file `any` indistinguishably.
 *
 * ⚠️ It does NOT guard the read, and saying so is the whole lesson of this card:
 * an indexed access on the TYPE is a MEMBERSHIP question, and membership is
 * exactly what a cast leaves intact. MEASURED, not reasoned — the ablation on
 * this card re-cast the read and ran both halves: `tsc -p tsconfig.test.json`
 * stayed GREEN while the source-text legs below went red. A reader who takes
 * this leg for the guard has repeated the defect one layer up.
 */
export type _SchemaTypeCarriesTheDeclaredMember = Expect<
  Equal<Schema['relationshipValueField'], string | undefined>
>;

/** And it is the MIRROR's member, not a lookalike that drifted to the same spelling. */
export type _RendererAgreesWithTheMirror = Expect<
  Equal<
    Schema['relationshipValueField'],
    RecordRelatedListComponentProps['relationshipValueField']
  >
>;

/*
 * The ledger leg that stood here — "a MISSPELLED key is still admitted at
 * `any`" — went red when objectui#9963 narrowed the intersection, which is the
 * signal it was written to give. Its re-derivation (the misspelling REFUSED at
 * a read expression) and its mirror control moved to
 * `record-related-list.propsRefusal-9963.test.tsx` rather than being flipped
 * in place, so this file stays about the cast.
 */

/* ── Source-text legs ─────────────────────────────────────────────────────── */

const maskedRenderer = (): string => mask(readFileSync(RENDERER, 'utf8'));

/**
 * A cast standing between `schema` and `key` — the shape that makes a
 * declaration inert at its own read site. Built per key so the guard below can
 * range over a DERIVED population rather than a written-down list.
 */
const castBefore = (key: string): RegExp =>
  new RegExp(`\\(\\s*schema\\s+as\\s+\\w+\\s*\\)\\s*\\.\\s*${key}\\b`);

/** Every key the CONTRACT declares on this block — read off the artifact, every run. */
const declaredKeys = (): string[] => Object.keys(RecordRelatedListProps.shape).sort();

/**
 * Casts this file still carries over a declared key, each with the reason it is
 * load-bearing. Every entry is asserted STILL CAST below, so an exemption
 * cannot outlive its subject.
 *
 * EMPTY since objectui#9964. The single entry it carried — `add`, exempt
 * because un-casting it was a real TS2322 against `RelatedList`'s
 * `ViewFilterRule[]` prop — was retired by moving the MIRROR to the protocol's
 * array shape, the direction AGENTS.md #0.1 requires. ⛔ An entry added here
 * is a declaration that disagrees with itself somewhere: write the measurement
 * that makes it load-bearing, or move the declaration instead.
 *
 * EMPTY AGAIN since objectui#8649. The 17.5.0 bump left three entries here —
 * the field-security triple, contract-declared on `record:related_list` while
 * the mirror lacked it and the renderer read it through a cast — booked to
 * objectui#8649 by objectui#11111 decision 3 = B (record 5902351047).
 * objectui#8649 moved the declaration, as the sentence above demands, and
 * removed the three casts, so the ledger is carve-out-free again.
 */
const LOAD_BEARING_CASTS: Record<string, string> = {};

describe('objectui#9475 — the guard population is derived and the matcher discriminates', () => {
  it('reads the contract’s own props schema, non-empty and calibrated both ways', () => {
    const keys = declaredKeys();
    // An empty population would make every absence reading below vacuous.
    expect(keys.length).toBeGreaterThan(5);
    expect(keys).toContain('relationshipValueField');
    expect(keys).toContain('add');
    // …and it is not an everything-set, which would make them unfalsifiable.
    // (`enforceFieldSecurity` / `requiredPermissions` were the absent controls
    // through `@objectstack/spec` 17.4.0; 17.5.0 declares both on this block —
    // objectui#11073 — so the control is a key nothing declares.)
    expect(keys).not.toContain('zzqxNoSuchRecordBlockKey');
    // The premise of reading the named export: it IS this block's map entry.
    expect(ComponentPropsMap['record:related_list']).toBe(RecordRelatedListProps);
  });

  it('the cast matcher fires on the cast form and refuses the un-cast one', () => {
    // The control varies ONLY the claim, in the same command as the zero below.
    const m = castBefore('relationshipValueField');
    expect(m.test("const v: string = (schema as any).relationshipValueField || 'id';")).toBe(true);
    expect(m.test("const v: string = schema.relationshipValueField || 'id';")).toBe(false);
    // Comments are masked before the guard runs, so this file's own prose —
    // which spells the cast out — can neither satisfy nor defeat it.
    expect(mask('// (schema as any).relationshipValueField\nconst x = 1;')).not.toMatch(m);
  });
});

describe('objectui#9475 — the declaration reaches the read', () => {
  it('reads `relationshipValueField` off `schema` UN-CAST, and still reads it at all', () => {
    const source = maskedRenderer();
    // Proof the file was read and masked, so the absence below is about the
    // spelling and not about an empty string.
    expect(source).toContain('RecordRelatedListRendererProps');
    // Liveness: the read, and the contract default it applies, are still here.
    expect(source).toMatch(/schema\.relationshipValueField \|\| 'id'/);
    // ⭐ The load-bearing NEGATIVE: no cast may stand between the two again.
    expect(source).not.toMatch(castBefore('relationshipValueField'));
  });

  it('no cast stands between `schema` and ANY contract-declared key, bar the ledgered ones', () => {
    const source = maskedRenderer();
    const offenders = declaredKeys().filter(
      (key) => !(key in LOAD_BEARING_CASTS) && castBefore(key).test(source),
    );
    // Named, not counted: a failure has to say WHICH key regressed.
    expect(offenders).toEqual([]);
  });

  it('reads `add` off `schema` UN-CAST too, and still reads it at all (objectui#9964)', () => {
    const source = maskedRenderer();
    // Liveness first: a file that stopped reading `add` would satisfy the
    // negative below while having deleted the feature.
    expect(source).toMatch(/schema\.add\b/);
    expect(source).toMatch(/pickLocalized\(schema\.add\.label, language\)/);
    // ⭐ The load-bearing NEGATIVE, and it is not per-site: this matcher fires
    // on ANY cast standing between `schema` and `add`, so one of the four
    // creeping back turns it red on its own.
    expect(source).not.toMatch(castBefore('add'));
  });

  // THE CAP (objectui#11111 decision 3 = B, record 5902351047). The ledger was
  // empty from objectui#9964 to the 17.5.0 bump, held exactly the three keys
  // booked to objectui#8649 until that card landed, and is back to `[]` — the
  // carve-out-free state. Pinned empty so a new entry is a reviewed diff here.
  it('the ledger is empty again — objectui#8649 struck the objectui#11111 triple', () => {
    expect(Object.keys(LOAD_BEARING_CASTS)).toEqual([]);
    // …and the three keys it struck are in the guarded population, so the
    // derived guard above now covers them with no carve-out.
    for (const key of ['enforceFieldSecurity', 'redactFields', 'requiredPermissions']) {
      expect(declaredKeys(), `${key} left the contract's population`).toContain(key);
    }
  });

  for (const [key, why] of Object.entries(LOAD_BEARING_CASTS)) {
    it(`the ledgered cast over \`${key}\` is still there, so the exemption is not stale`, () => {
      expect(why.length).toBeGreaterThan(0);
      expect(maskedRenderer()).toMatch(castBefore(key));
    });
  }
});

/* ── Runtime legs: what the read DOES, which the cast removal must not move ── */

const h = vi.hoisted(() => ({ captured: null as any }));
vi.mock('../../RelatedList', () => ({
  RelatedList: (props: any) => {
    h.captured = props;
    return <div data-testid="related-list" />;
  },
}));

const ds = { find: vi.fn(async () => []) };

function renderRelated(schema: Record<string, any>, data?: Record<string, any>) {
  return render(
    <RecordContextProvider
      objectName="sys_user"
      recordId="USR-1"
      data={data as any}
      dataSource={ds as any}
    >
      <RecordRelatedListRenderer
        schema={{ objectName: 'sys_user_position', relationshipField: 'user', ...schema }}
      />
    </RecordContextProvider>,
  );
}

beforeEach(() => {
  h.captured = null;
});

describe('objectui#9475 — the contract default `.default("id")` at the read site', () => {
  it('absent ⇒ the parent link value is the record id (the renderer applies the default itself)', () => {
    // ⭐ This is why the cast removal is inert at RUNTIME: `|| 'id'` already
    // stood in for the zod default, which materializes only through a spec
    // parse — and the synthesized default record page hands raw nodes.
    renderRelated({});
    expect(h.captured).toBeTruthy();
    expect(h.captured.parentId).toBe('USR-1');
  });

  it('explicit `"id"` is the same value, so the default is the identity it claims to be', () => {
    renderRelated({ relationshipValueField: 'id' });
    expect(h.captured.parentId).toBe('USR-1');
  });

  it('a name-keyed junction reads that field OFF THE PARENT RECORD, not the id', () => {
    renderRelated({ relationshipValueField: 'name' }, { id: 'USR-1', name: 'alice' });
    expect(h.captured.parentId).toBe('alice');
  });

  it('while the parent record is still loading, a non-id value resolves to null (no fetch)', () => {
    renderRelated({ relationshipValueField: 'name' });
    expect(h.captured.parentId).toBeNull();
  });
});
