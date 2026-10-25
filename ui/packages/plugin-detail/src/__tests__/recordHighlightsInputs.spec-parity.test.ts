/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `record:highlights` — the published authoring surface stays in parity with
 * `@objectstack/spec` RecordHighlights* (objectui#3407, objectstack#5176).
 *
 * The registry `inputs` ARE the published contract: `gen-manifest.ts`
 * serializes them into `sdui.manifest.json` (the save-gate + parser whitelist)
 * and into `sdui-intrinsics.d.ts` (the JSX authoring type surface). Nothing in
 * the repo cross-checks them against the spec, so both drift directions are
 * silent and both are harmful:
 *
 *   - a spec ENTRY key that no input mentions is a key an AI author cannot
 *     discover (the complaint that opened #3407: `readonly` was enforced by the
 *     HeaderHighlight gate and honoured by the renderer, but the `fields`
 *     description still spelled the entry shape `{name,label?,icon?,type?}`);
 *   - a top-level input the spec does not declare is worse than undocumented,
 *     it is actively misleading: the manifest would be publishing an authoring
 *     surface the platform does not accept. That verdict holds on every pin —
 *     an UNDECLARED top-level key is not an authoring surface — while the
 *     contract states it two ways depending on the installed
 *     `@objectstack/spec`: a closed `RecordHighlightsProps` refuses the key
 *     with a named `unrecognized_keys`, where the older strip-mode `z.object`
 *     dropped it from `data` with no error at all, which is exactly why this
 *     gap could stay silent for as long as it did. Which way the installed pin
 *     states it is probed behaviourally, below, by
 *     `specRefusesUnknownTopLevelKeys` — never narrated here as a
 *     present-tense fact about a mode.
 *
 * Both assertions derive their expectation from the spec at runtime rather than
 * restating today's key list, so a spec change fails here instead of quietly
 * widening the gap.
 */

import { describe, it, expect } from 'vitest';
import { ComponentRegistry } from '@object-ui/core';
import { PageComponentSchema, RecordHighlightsField, RecordHighlightsProps } from '@objectstack/spec/ui';
import { authorableShapeKeys } from '@object-ui/test-support';
import '../index';

/** Keys of the object arm of the spec's `RecordHighlightsField` union. */
function specEntryKeys(): string[] {
  const union = RecordHighlightsField as unknown as {
    def?: { options?: unknown[] };
    _def?: { options?: unknown[] };
  };
  const arms = union.def?.options ?? union._def?.options ?? [];
  for (const arm of arms) {
    const shape = (arm as { shape?: unknown; _def?: { shape?: unknown } }).shape
      ?? (arm as { _def?: { shape?: unknown } })._def?.shape;
    const resolved = typeof shape === 'function' ? (shape as () => object)() : shape;
    if (resolved && typeof resolved === 'object') return Object.keys(resolved);
  }
  return [];
}

/** Top-level keys of the spec's `RecordHighlightsProps`. */
function specTopLevelKeys(): string[] {
  const obj = RecordHighlightsProps as unknown as {
    shape?: unknown;
    _def?: { shape?: unknown };
  };
  const shape = obj.shape ?? obj._def?.shape;
  const resolved = typeof shape === 'function' ? (shape as () => object)() : shape;
  return resolved && typeof resolved === 'object' ? Object.keys(resolved) : [];
}

/**
 * Keys the spec accepts on the NODE, on every page component — the widening
 * `recordRelatedListInputs.spec-parity.test.ts` and the repo-wide
 * `registry-inputs-spec-parity.test.ts` already make (objectui#6678).
 * `dataSource`, the per-element binding this block reads since objectui#12294
 * and declares from the seam, is a `PageComponentSchema` key, not a
 * `RecordHighlightsProps` one. DERIVED from that schema's own shape (a `.pipe()`
 * through `@objectstack/spec` 18.0.0-next.2, a plain object since 18.0.0-next.3,
 * objectstack `105902f`).
 */
const nodeLevelSpecKeys = (): string[] => authorableShapeKeys(PageComponentSchema);

const config = () => ComponentRegistry.getConfig('record:highlights');
const inputs = () => config()?.inputs ?? [];
const fieldsInput = () => inputs().find((i) => i.name === 'fields');

/**
 * Does the installed spec REFUSE an undeclared top-level key, or drop it in
 * silence? (objectui#4648, measured on a GA-installed tree.)
 *
 * `@objectstack/spec` 17.0.0 GA closed `RecordHighlightsProps` under
 * objectstack#4001 batch A, so an undeclared key now raises `unrecognized_keys`
 * with a named message; the pinned `17.0.0-rc.6` still strips it silently. The
 * VERDICT under test is identical either way — a top-level `readonly` is not an
 * authoring surface and must not be published — but the evidence differs, and
 * asserting the wrong one turns this file red for a reason that has nothing to
 * do with what it guards.
 *
 * Probed behaviourally rather than off a version string: the strictness IS the
 * fact this file cares about, a probe cannot go stale against a pin it never
 * reads, and the probe key is a name no spec would ever declare.
 */
const specRefusesUnknownTopLevelKeys = !RecordHighlightsProps.safeParse({
  fields: ['amount'],
  __objectui_4648_probe__: true,
}).success;

describe('record:highlights — registry inputs vs @objectstack/spec', () => {
  it('is registered with a non-empty `inputs` surface', () => {
    expect(config()).toBeDefined();
    expect(inputs().length).toBeGreaterThan(0);
    expect(inputs().map((i) => i.name)).toContain('fields');
  });

  it('the spec really carries `readonly` per ENTRY, not top-level', () => {
    // Guards the premise the rest of the file rests on. If a future spec moves
    // `readonly` up to the props object, this fails and the `inputs` shape
    // above should be revisited — a top-level input would then be correct.
    expect(specEntryKeys()).toContain('readonly');
    expect(specTopLevelKeys()).not.toContain('readonly');
  });

  it('the spec does not carry a top-level `readonly`, so it must not be published', () => {
    // A KEY-reachability verdict: the question is whether a top-level
    // `readonly` is an authoring surface at all, and the answer is no on both
    // pins — the contract just says it two different ways (see
    // `specRefusesUnknownTopLevelKeys`).
    const parsed = RecordHighlightsProps.safeParse({ fields: ['amount'], readonly: true });

    if (specRefusesUnknownTopLevelKeys) {
      // 17.0.0 GA: a loud refusal. Asserted as an envelope — the code AND the
      // key it names — because a bare "it failed" would also be satisfied by a
      // rejection of `fields`, which is the half that must stay valid.
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues.map((i) => i.code)).toContain('unrecognized_keys');
      expect(
        parsed.error?.issues.flatMap((i) => (i as unknown as { keys?: string[] }).keys ?? []),
      ).toContain('readonly');
    } else {
      // The pinned rc.6, and the concrete harm objectui#3407 was filed over:
      // no throw, no diagnostic, key gone, author told nothing.
      expect(parsed.success).toBe(true);
      expect(parsed.data).not.toHaveProperty('readonly');
    }

    // …while the per-entry spelling survives on both pins, which is the one
    // authors need and the one the `fields` description teaches.
    const perEntry = RecordHighlightsProps.parse({ fields: [{ name: 'amount', readonly: true }] });
    expect(perEntry.fields[0]).toMatchObject({ name: 'amount', readonly: true });
  });

  it('every spec entry key is discoverable from the `fields` input description', () => {
    const description = fieldsInput()?.description ?? '';
    expect(description).not.toBe('');
    const undocumented = specEntryKeys().filter((key) => !description.includes(key));
    expect(undocumented).toEqual([]);
    // The key this issue was filed for, named explicitly so the regression is
    // legible if the derived check above is ever loosened.
    expect(description).toContain('readonly');
  });

  it('the `fields` entry-shape sketch advertises no key the spec refuses', () => {
    // The REVERSE direction of the check above, and the one objectui#9280 was
    // filed for: the description sketched the entry as
    // `{name,label?,icon?,type?,readonly?}` while the spec's object arm is
    // `$strict` over four keys, so the manifest was teaching authors a key that
    // gets the WHOLE document refused at publish. Under-documenting a key is a
    // discoverability bug; over-advertising one is an impossible promise.
    const description = fieldsInput()?.description ?? '';
    const sketch = /\{([a-zA-Z?,\s]+)\}/.exec(description)?.[1];
    expect(sketch, 'the description must keep an entry-shape sketch to check').toBeDefined();

    const advertised = (sketch ?? '')
      .split(',')
      .map((k) => k.trim().replace(/\?$/, ''))
      .filter(Boolean)
      .sort();

    // Derived from the spec at runtime, so a spec that WIDENS the arm fails
    // here instead of leaving the sketch quietly short.
    expect(advertised).toEqual(specEntryKeys().sort());

    // ⭐ LIT CONTROL for this matcher: it really does read keys out of the
    // sketch rather than returning an empty list that trivially compares
    // equal. `name` is the one key the arm cannot lose.
    expect(advertised).toContain('name');
    expect(advertised).not.toContain('icon');
  });

  it('declares no top-level input the spec does not accept', () => {
    const allowed = new Set([...specTopLevelKeys(), ...nodeLevelSpecKeys()]);
    const offSpec = inputs().map((i) => i.name).filter((name) => !allowed.has(name));
    expect(offSpec).toEqual([]);
    // Calibration: the node-level widening is derived and discriminating.
    expect(nodeLevelSpecKeys()).toContain('dataSource');
    expect(nodeLevelSpecKeys()).not.toContain('fields');
  });
});

const tripleInput = (name: string) => inputs().find((i) => i.name === name);
const HIGHLIGHTS_BASELINE = { fields: ['amount'] };

/**
 * objectui#8649 — the field-security triple, published as the CONTRACT declares
 * it on this block.
 *
 * `@objectstack/spec` 17.5.0 declares `enforceFieldSecurity`, `redactFields` and
 * `requiredPermissions` on `record:highlights`. The renderer honoured all three before that,
 * through a cast, while these `inputs` omitted them; objectui#8649 publishes
 * them. Three claims per key, each read off the INSTALLED spec rather than
 * restated: the key is declared on this block's props, the published coarse
 * type is the one the contract's VALUES bear out (a full parse on an accepted
 * value and a named refusal on a rejected one — a value claim, so a key-level
 * `unrecognized_keys` reading would not do), and the description is this
 * block's own `.describe()` text, verbatim — so a spec that rewords one turns
 * this file red rather than leaving the manifest to drift.
 */
describe('record:highlights — the field-security triple is published as the contract declares it (objectui#8649)', () => {
  const TRIPLE = {
    enforceFieldSecurity: { type: 'boolean', of: undefined, accepted: true, refused: 'true' },
    redactFields: { type: 'array', of: 'string', accepted: ['salary'], refused: [1] },
    requiredPermissions: { type: 'array', of: 'string', accepted: ['crm.manage'], refused: 'crm.manage' },
  } as const;
  const shapeOf = (key: string) =>
    (RecordHighlightsProps.shape as Record<string, { description?: string; def?: { innerType?: { description?: string } } }>)[key];
  const describeOf = (key: string): string | undefined =>
    shapeOf(key)?.description ?? shapeOf(key)?.def?.innerType?.description;

  for (const [key, want] of Object.entries(TRIPLE)) {
    it(`publishes \`${key}\` with the contract's type, proved on values`, () => {
      expect(Object.keys(RecordHighlightsProps.shape), `${key} is not declared on record:highlights`).toContain(key);
      const published = tripleInput(key);
      expect(published, `${key} is not published`).toBeDefined();
      expect(published?.type).toBe(want.type);
      expect(published?.of).toBe(want.of);

      const ok = RecordHighlightsProps.safeParse({ ...HIGHLIGHTS_BASELINE, [key]: want.accepted });
      expect(ok.success, `${key}: the contract refused a value of the published type`).toBe(true);
      expect((ok.data as Record<string, unknown> | undefined)?.[key]).toEqual(want.accepted);
      const bad = RecordHighlightsProps.safeParse({ ...HIGHLIGHTS_BASELINE, [key]: want.refused });
      expect(bad.success, `${key}: the contract accepted a value outside the published type`).toBe(false);
      // Refused AT this key — `redactFields: [1]` is refused at its MEMBER
      // (`redactFields.0`), which is the member-kind half of the same claim.
      expect(bad.error?.issues.map((i) => String(i.path[0]))).toContain(key);
    });

    it(`\`${key}\`'s description is this block's own describe text, verbatim`, () => {
      const text = describeOf(key);
      // Non-vacuity: an undefined describe would compare equal to a missing one.
      expect(text ?? '', `${key}: the contract carries no describe to publish`).not.toBe('');
      expect(tripleInput(key)?.description).toBe(text);
    });
  }

  it('CONTROL — the value probe refuses at the key it names, and accepts the unmodified baseline', () => {
    expect(RecordHighlightsProps.safeParse(HIGHLIGHTS_BASELINE).success).toBe(true);
    const bad = RecordHighlightsProps.safeParse({ ...HIGHLIGHTS_BASELINE, enforceFieldSecurity: 'true' });
    expect(bad.error?.issues.map((i) => i.path.join('.'))).toEqual(['enforceFieldSecurity']);
  });
});
