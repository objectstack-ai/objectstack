/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `record:related_list` — the published authoring surface stays in parity with
 * `@objectstack/spec` `RecordRelatedListProps` (objectui#3808).
 *
 * Third sibling of `recordHighlightsInputs.spec-parity.test.ts` (objectui#3407 /
 * PR #3795) and `recordDetailsInputs.spec-parity.test.ts` (objectui#3807), added
 * for the direction those two carry and the repo-wide gate had not: a top-level
 * key the SPEC declares must be discoverable from `inputs`.
 *
 * This block had the worst instance of it. `relationshipValueField` and `add`
 * were both spec keys the renderer had honoured all along —
 * `renderers/record-related-list.tsx:95` and `:186` — while `inputs` published
 * neither, and nothing anywhere reported the mismatch:
 * `gen-manifest.ts` left them out of `sdui.manifest.json` and
 * `sdui-intrinsics.d.ts`, `sdui-parser/src/validate.ts:74` returned
 * `unknown-prop` for an author who wrote one, and the renderer went on honouring
 * it. `add` in particular is the ONLY way to build a junction-assignment list,
 * so the single published route to that feature was an undiscoverable key.
 *
 * WHY A DESCRIPTION IS WORTH A TEST, and why `add`'s is checked member by
 * member: `ComponentInput` is flat by design, so an `object` input can document
 * its member shape nowhere but its own prose. The assertions below derive the
 * member list from the spec at runtime, so a spec change fails here rather than
 * leaving the description quietly incomplete — the failure mode objectui#3807
 * was filed for.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ComponentRegistry } from '@object-ui/core';
import { PageComponentSchema, RecordRelatedListProps } from '@objectstack/spec/ui';
import '../index';

type ShapeCarrier = { shape?: unknown; _def?: { shape?: unknown } };

/** Resolve a Zod object's `.shape` through both spellings, lazy or plain. */
function shapeKeys(schema: unknown): string[] {
  const carrier = schema as ShapeCarrier | undefined;
  const shape = carrier?.shape ?? carrier?._def?.shape;
  const resolved = typeof shape === 'function' ? (shape as () => object)() : shape;
  return resolved && typeof resolved === 'object' ? Object.keys(resolved) : [];
}

/**
 * One entry of `.shape`, unwrapped past the optional/default wrappers until an
 * object shape is reachable. `add` is `.optional()` and `add.picker` carries
 * defaults on its own members, so a single `.unwrap()` is not enough.
 */
function innerObject(schema: unknown, key: string): unknown {
  const carrier = schema as ShapeCarrier | undefined;
  const shape = carrier?.shape ?? carrier?._def?.shape;
  const resolved = (typeof shape === 'function' ? (shape as () => object)() : shape) as
    | Record<string, unknown>
    | undefined;
  let member = resolved?.[key] as
    | { shape?: unknown; _def?: { shape?: unknown; innerType?: unknown; type?: unknown } }
    | undefined;
  for (let hop = 0; hop < 8; hop += 1) {
    if (member?.shape ?? member?._def?.shape) return member;
    const next = member?._def?.innerType ?? member?._def?.type;
    if (!next || typeof next !== 'object') return member;
    member = next as typeof member;
  }
  return member;
}

const specTopLevelKeys = (): string[] => shapeKeys(RecordRelatedListProps);

/**
 * Keys the spec accepts on the NODE, on every page component (objectui#6678).
 *
 * `RecordRelatedListProps` is this block's PROPS contract, which is not the whole
 * contract of the node an `inputs` list describes: `PageComponentSchema` carries
 * its own top-level keys, and the html tier validates an author's attributes
 * against `BASE_PROPS` + `inputs` with no third place for a node-level key to be
 * declared. `dataSource` — the spec's per-element binding, which this block reads
 * through `ElementDataSourceGate` and now declares from that seam — is one of
 * them, and it is accepted here for the same reason `className` would be.
 *
 * DERIVED from `PageComponentSchema`'s own shape, never listed, so a spec release
 * moves it. (It was a `.pipe()` through `@objectstack/spec` 18.0.0-next.2, whose
 * input side carried the keys; 18.0.0-next.3 makes it a plain object, objectstack
 * `105902f`.) The repo-wide half of this gate makes the
 * same widening in
 * `apps/console/src/__tests__/registry-inputs-spec-parity.test.ts`, and both
 * assert the derivation still discriminates.
 */
const nodeLevelSpecKeys = (): string[] => shapeKeys(PageComponentSchema);
const specAddKeys = (): string[] => shapeKeys(innerObject(RecordRelatedListProps, 'add'));
const specPickerKeys = (): string[] =>
  shapeKeys(innerObject(innerObject(RecordRelatedListProps, 'add'), 'picker'));

const config = () => ComponentRegistry.getConfig('record:related_list');
const inputs = () => config()?.inputs ?? [];
const inputNames = () => inputs().map((i) => i.name);
const input = (name: string) => inputs().find((i) => i.name === name);
const addDescription = () => input('add')?.description ?? '';

/** A spec-valid related list, so a fixture only ever carries the key under test. */
const baseline = { objectName: 'task', relationshipField: 'account', columns: ['name'] };

/**
 * Does the installed spec REFUSE an undeclared TOP-LEVEL key on this block, or
 * drop it in silence? (objectui#5887.)
 *
 * `@objectstack/spec` 17.0.0 GA closed the props schemas under objectstack#4001
 * batch A, so an undeclared key now raises `unrecognized_keys` with a named
 * message; the older strip-mode `z.object`s parsed it green and dropped it from
 * `data`. The VERDICT under test is identical either way — an undeclared
 * top-level key is not an authoring surface — but the evidence differs, and
 * asserting the wrong one turns this file red for a reason that has nothing to
 * do with what it guards.
 *
 * Measured HERE rather than cited from the sibling: strictness is per schema, so
 * `recordHighlightsInputs.spec-parity.test.ts`'s probe is a reading of
 * `RecordHighlightsProps` and of nothing else — it is the shape to copy, not
 * evidence about `RecordRelatedListProps`. Probed behaviourally rather than off
 * a version string: the strictness IS the fact this file cares about, and a
 * probe cannot go stale against a pin it never reads.
 *
 * The probe key is a name no spec would ever declare — and if one ever did, the
 * assertion below is what says so, rather than the probe quietly measuring a
 * declared key and reporting strip mode.
 */
const UNDECLARED_TOP_LEVEL_KEY = '__objectui_5887_probe__';
const unknownTopLevelParse = RecordRelatedListProps.safeParse({
  ...baseline,
  [UNDECLARED_TOP_LEVEL_KEY]: true,
});
const specRefusesUnknownTopLevelKeys = !unknownTopLevelParse.success;

describe('record:related_list — registry inputs vs @objectstack/spec', () => {
  it('is registered with a non-empty `inputs` surface', () => {
    expect(config()).toBeDefined();
    expect(inputNames().length).toBeGreaterThan(0);
  });

  it('declares no top-level input the spec does not accept', () => {
    const allowed = new Set([...specTopLevelKeys(), ...nodeLevelSpecKeys()]);
    expect(inputNames().filter((name) => !allowed.has(name))).toEqual([]);
  });

  it('the node-level widening is derived, discriminating and non-empty', () => {
    // Calibration, in both directions: [] would silently stop widening and this
    // block would red on a key the spec accepts, while an everything-set would
    // stop this pin being a gate at all.
    const nodeKeys = nodeLevelSpecKeys();
    expect(nodeKeys.length).toBeGreaterThan(0);
    expect(nodeKeys).toContain('dataSource');
    expect(nodeKeys).not.toContain('relationshipField');
    expect(nodeKeys).not.toContain('__not_a_spec_key__');
  });

  it('publishes `relationshipValueField`, which the renderer has read all along', () => {
    // A KEY-reachability claim, so the criterion is that the key SURVIVES the
    // parse rather than merely that the parse succeeds. The verdict behind that
    // choice holds on every pin — an UNDECLARED top-level key is not an authoring
    // surface — but the contract states it two ways depending on the installed
    // `@objectstack/spec`: the closed props schemas refuse it with a named
    // `unrecognized_keys`, while the older strip-mode `z.object`s parsed it green
    // and dropped it from `data` in silence, which is exactly how this gap stayed
    // invisible for as long as it did. Key survival is the criterion that reads
    // the same either way; `success === true` does not, because on a stripping
    // pin an undeclared key gets that too. Which way the installed pin says it is
    // measured on THIS schema by `specRefusesUnknownTopLevelKeys` above and
    // asserted in the block that follows (objectui#5887) — strictness is per
    // schema, so the sibling `recordHighlightsInputs.spec-parity.test.ts` probe
    // was only ever the shape to copy, never evidence about this one.
    expect(specTopLevelKeys()).toContain('relationshipValueField');
    const parsed = RecordRelatedListProps.safeParse({ ...baseline, relationshipValueField: 'name' });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.relationshipValueField).toBe('name');

    expect(inputNames()).toContain('relationshipValueField');
  });

  it('refuses an undeclared top-level key, measured on THIS schema (#5887)', () => {
    // The reading the block above used to borrow from a sibling. Both arms state
    // the same verdict — an undeclared top-level key is not an authoring surface
    // — because the contract states it two ways depending on the installed
    // `@objectstack/spec`, and pinning the wrong one reds this file for a reason
    // unrelated to what it guards.
    //
    // CONTROL FIRST, in this same assertion: the identical fixture WITHOUT the
    // probe key parses green, so the probe's verdict below is attributable to the
    // undeclared key and not to a malformed fixture. Without it, a probe that
    // failed for any other reason would read as strictness.
    expect(RecordRelatedListProps.safeParse(baseline).success).toBe(true);

    if (specRefusesUnknownTopLevelKeys) {
      // A loud refusal. Asserted as an ENVELOPE — the code AND the key it names —
      // because a bare "it failed" would also be satisfied by a rejection of
      // `objectName`, which is the half that must stay valid.
      expect(unknownTopLevelParse.success).toBe(false);
      expect(unknownTopLevelParse.error?.issues.map((i) => i.code)).toContain('unrecognized_keys');
      expect(
        unknownTopLevelParse.error?.issues.flatMap(
          (i) => (i as unknown as { keys?: string[] }).keys ?? [],
        ),
      ).toContain(UNDECLARED_TOP_LEVEL_KEY);
    } else {
      // Strip mode, and the concrete harm this family keeps re-paying for: no
      // throw, no diagnostic, key gone, author handed a success receipt.
      expect(unknownTopLevelParse.success).toBe(true);
      expect(unknownTopLevelParse.data).not.toHaveProperty(UNDECLARED_TOP_LEVEL_KEY);
    }
  });

  it("`relationshipValueField`'s description names the renderer's default, and it matches the read site", () => {
    // `record-related-list.tsx` reads `schema.relationshipValueField || 'id'`,
    // and the input's `description` tells the author "Defaults to "id"". Pinned
    // because a default advertised on the authoring surface that disagrees
    // with the renderer is worse than no default: the author would write for
    // one value and the page would behave as another, with nothing comparing
    // them. (The registration used to restate it as `ComponentInput.defaultValue`;
    // that key is an ADR-0049 tombstone since objectui#7493 — nothing ever read
    // it — so `description` and the read site are the two ends now.)
    const renderer = readFileSync(resolve(__dirname, '../renderers/record-related-list.tsx'), 'utf8');
    expect(renderer).toMatch(/relationshipValueField \|\| 'id'/);
    expect(input('relationshipValueField')?.description ?? '').toMatch(/Defaults to "id"/);

    // And the spec agrees, so all three say `id`.
    expect(RecordRelatedListProps.safeParse(baseline).data?.relationshipValueField ?? 'id').toBe('id');
  });

  it('publishes `add`, the only route to a junction-assignment list', () => {
    expect(specTopLevelKeys()).toContain('add');
    const parsed = RecordRelatedListProps.safeParse({
      ...baseline,
      add: { picker: { object: 'sys_position' }, linkField: 'position', label: 'Assign' },
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.add?.picker?.object).toBe('sys_position');

    expect(inputNames()).toContain('add');
    expect(input('add')?.type).toBe('object');
    expect(addDescription()).not.toBe('');
  });

  it('every spec member key of `add` is discoverable from its description', () => {
    // `ComponentInput` has no member-shape slot (the LIMIT the repo-wide gate in
    // `apps/console/src/__tests__/registry-inputs-spec-parity.test.ts` documents),
    // so this prose is the only published description of the shape. Derived from
    // the spec at runtime: a member key added upstream fails here instead of
    // going unmentioned.
    expect(specAddKeys().length).toBeGreaterThan(0);
    expect(specPickerKeys().length).toBeGreaterThan(0);

    const description = addDescription();
    expect(specAddKeys().filter((key) => !description.includes(key))).toEqual([]);
    expect(specPickerKeys().filter((key) => !description.includes(key))).toEqual([]);
  });

  it("`add`'s published defaults are the RENDERER's, not the spec's prose", () => {
    // The one place the two disagree. `RelatedList.tsx:724` defaults
    // `picker.valueField` to `id` — same as the spec — but `:390` defaults
    // `picker.labelField` to `name`, where the spec's `.describe()` says it
    // "defaults to the object title field". The description publishes what the
    // platform does; publishing the spec's wording would document a behaviour no
    // code implements.
    const description = addDescription();
    expect(description).toMatch(/labelField[^.]*default "name"/);
    expect(description).not.toMatch(/labelField[^.]*title field/);
  });

  it('documents `picker.filter` as a real restriction, with no gap warning left over', () => {
    // The INVERSE of the assertion this used to carry. Until #3831 the spec
    // declared `add.picker.filter` ("Restrict which records the picker offers")
    // and nothing in this repo read it, so the description named it as a KNOWN
    // GAP on the `record:activity.showSubscriptionToggle` precedent. The wiring
    // landed (`RelatedList` hands it to `RecordPickerDialog`'s `baseFilter`
    // verbatim), so the warning had to go — and this direction now fails if
    // anyone puts a gap warning back, or reverts the wiring and leaves the
    // description claiming a restriction the dialog does not apply.
    expect(specPickerKeys()).toContain('filter');
    expect(addDescription()).not.toMatch(/KNOWN GAP/);
    expect(addDescription()).not.toMatch(/not applied/);
    expect(addDescription()).toMatch(/`picker\.filter` restricts which records/);
    // The restriction must be published as un-widenable, not as a suggestion:
    // `lookupFilters` would have rendered it as an editable filter-bar row.
    expect(addDescription()).toMatch(/hard constraint the user cannot widen/);
  });
});

/**
 * objectui#8649 — the field-security triple, published as the CONTRACT declares
 * it on this block.
 *
 * `@objectstack/spec` 17.5.0 declares `enforceFieldSecurity`, `redactFields` and
 * `requiredPermissions` on `record:related_list`. The renderer honoured all three before that,
 * through a cast, while these `inputs` omitted them; objectui#8649 publishes
 * them. Three claims per key, each read off the INSTALLED spec rather than
 * restated: the key is declared on this block's props, the published coarse
 * type is the one the contract's VALUES bear out (a full parse on an accepted
 * value and a named refusal on a rejected one — a value claim, so a key-level
 * `unrecognized_keys` reading would not do), and the description is this
 * block's own `.describe()` text, verbatim — so a spec that rewords one turns
 * this file red rather than leaving the manifest to drift.
 */
describe('record:related_list — the field-security triple is published as the contract declares it (objectui#8649)', () => {
  const TRIPLE = {
    enforceFieldSecurity: { type: 'boolean', of: undefined, accepted: true, refused: 'true' },
    redactFields: { type: 'array', of: 'string', accepted: ['salary'], refused: [1] },
    requiredPermissions: { type: 'array', of: 'string', accepted: ['crm.manage'], refused: 'crm.manage' },
  } as const;
  const shapeOf = (key: string) =>
    (RecordRelatedListProps.shape as Record<string, { description?: string; def?: { innerType?: { description?: string } } }>)[key];
  const describeOf = (key: string): string | undefined =>
    shapeOf(key)?.description ?? shapeOf(key)?.def?.innerType?.description;

  for (const [key, want] of Object.entries(TRIPLE)) {
    it(`publishes \`${key}\` with the contract's type, proved on values`, () => {
      expect(Object.keys(RecordRelatedListProps.shape), `${key} is not declared on record:related_list`).toContain(key);
      const published = input(key);
      expect(published, `${key} is not published`).toBeDefined();
      expect(published?.type).toBe(want.type);
      expect(published?.of).toBe(want.of);

      const ok = RecordRelatedListProps.safeParse({ ...baseline, [key]: want.accepted });
      expect(ok.success, `${key}: the contract refused a value of the published type`).toBe(true);
      expect((ok.data as Record<string, unknown> | undefined)?.[key]).toEqual(want.accepted);
      const bad = RecordRelatedListProps.safeParse({ ...baseline, [key]: want.refused });
      expect(bad.success, `${key}: the contract accepted a value outside the published type`).toBe(false);
      // Refused AT this key — `redactFields: [1]` is refused at its MEMBER
      // (`redactFields.0`), which is the member-kind half of the same claim.
      expect(bad.error?.issues.map((i) => String(i.path[0]))).toContain(key);
    });

    it(`\`${key}\`'s description is this block's own describe text, verbatim`, () => {
      const text = describeOf(key);
      // Non-vacuity: an undefined describe would compare equal to a missing one.
      expect(text ?? '', `${key}: the contract carries no describe to publish`).not.toBe('');
      expect(input(key)?.description).toBe(text);
    });
  }

  it('CONTROL — the value probe refuses at the key it names, and accepts the unmodified baseline', () => {
    expect(RecordRelatedListProps.safeParse(baseline).success).toBe(true);
    const bad = RecordRelatedListProps.safeParse({ ...baseline, enforceFieldSecurity: 'true' });
    expect(bad.error?.issues.map((i) => i.path.join('.'))).toEqual(['enforceFieldSecurity']);
  });
});
