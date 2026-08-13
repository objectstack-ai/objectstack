// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7832 — `visible` / `showWhen` / `disabled` on the `visibleWhen` shapes.
 *
 * `ui/action.zod.ts` has carried this table in the OTHER direction since #3746:
 * on an action, `visible` / `disabled` are the canonical keys and the aliases
 * run `visibleWhen → visible`, `showWhen → visible`, `disabledWhen → disabled`.
 * The reverse direction — an author who learned the action vocabulary writing
 * it on a `visibleWhen` shape — was curated on some surfaces and bare on
 * others, and nothing said which was which. This file is that inventory,
 * asserted rather than asserted-in-prose.
 *
 * ## Why the answers differ per surface, and why that is not inconsistency
 *
 * The rule the six cases below encode:
 *
 *   - ONE landing key ⇒ **alias** (a rename is unambiguous and reads best).
 *   - TWO landing keys, a boolean and a predicate ⇒ **guidance prose** naming
 *     both. A rename has to pick one, and picking wrong just relocates the
 *     confusion — #7816's own note, and the reason `RowCrudActionOverride`'s
 *     `visible` points at `enabled` *and* `visibleWhen` rather than at either.
 *     On `FieldSchema` the two answers additionally have OPPOSITE POLARITY
 *     (`visible: false` is `hidden: true`), so a rename onto `hidden` would
 *     have the author ship the inverse of what they wrote.
 *   - NO landing key ⇒ **nothing**. An alias whose target the shape does not
 *     declare is the ledger's finding-12 shape: the author is told to write
 *     the one key guaranteed to be rejected next. `alias-integrity.test.ts`
 *     fails such a row outright; the cases below record WHICH surfaces are in
 *     that bucket so the next sweep does not read them as missed.
 *
 * ## Acceptance is untouched
 *
 * Every key probed here is rejected before this change and rejected after it —
 * only the message differs. That is the whole card: `strictObject` is
 * `z.object(shape, { error }).strict()`, so converting a plain `.strict()` to
 * it (`RowCrudActionOverrideSchema`) adds an error map and changes no verdict.
 * Section 3 pins that directly.
 */

import { describe, it, expect } from 'vitest';

import { RowCrudActionOverrideSchema } from '../data/object.zod';
import { FieldSchema, SelectOptionSchema } from '../data/field.zod';
import { FormFieldSchema, FormSectionSchema } from '../ui/view.zod';
import { PageComponentSchema } from '../ui/page.zod';
import { PageTabsProps } from '../ui/component.zod';
import { ScreenFieldConfigSchema } from '../automation/builtin-node-config.zod';

/**
 * The `unrecognized_keys` message for `value`, or a loud failure.
 *
 * Deliberately narrowed to that ONE issue code: several of these probes are
 * minimal bodies that also miss a required key, and a whole-error stringify
 * would let an assertion pass on text from an unrelated issue.
 */
function unknownKeyMessage(
  schema: { safeParse: (v: unknown) => { success: boolean; error?: unknown } },
  value: unknown,
): string {
  const r = schema.safeParse(value);
  expect(r.success, `expected REJECTION, got a successful parse of ${JSON.stringify(value)}`).toBe(false);
  const issues = (r.error as { issues?: Array<{ code?: string; message?: string }> }).issues ?? [];
  const hit = issues.find((i) => i.code === 'unrecognized_keys');
  expect(hit, `no \`unrecognized_keys\` issue in ${JSON.stringify(issues)}`).toBeDefined();
  return hit?.message ?? '';
}

/** Minimal bodies that reach each surface's unknown-key path. */
const FIELD = { name: 'probe', type: 'text' } as const;
const OPTION = { label: 'A', value: 'aa' } as const;
const SECTION = { fields: [] } as const;
const COMPONENT = { type: 'text' } as const;
const FORM_FIELD = { field: 'probe' } as const;

// ===========================================================================
// 1. The surfaces this card CHANGED
// ===========================================================================
describe('#7832 — the curation added here', () => {
  describe('`RowCrudActionOverrideSchema` — was a bare zod message, surface unnamed', () => {
    it('names the surface at all (it did not before — `Unrecognized key: "visible"` was the whole message)', () => {
      const m = unknownKeyMessage(RowCrudActionOverrideSchema, { visible: true });
      expect(m).toContain('this row CRUD override');
    });

    it('`visible` names BOTH landing keys — the boolean one first, per #7816', () => {
      const m = unknownKeyMessage(RowCrudActionOverrideSchema, { visible: true });
      expect(m).toMatch(/`enabled: false`/);
      expect(m).toMatch(/`visibleWhen/);
      // The claim the prose makes about the boolean form has to be true.
      expect(RowCrudActionOverrideSchema.safeParse({ enabled: false }).success).toBe(true);
    });

    it('`disabled` points at `disabledWhen`, and says the boolean form is `enabled`', () => {
      const m = unknownKeyMessage(RowCrudActionOverrideSchema, { disabled: true });
      expect(m).toMatch(/`disabledWhen/);
      expect(m).toContain('`enabled: false`');
      expect(RowCrudActionOverrideSchema.safeParse({ disabledWhen: 'record.locked' }).success).toBe(true);
    });

    it('`showWhen` RENAMES — one reading, so it gets the rename channel, not prose', () => {
      const m = unknownKeyMessage(RowCrudActionOverrideSchema, { showWhen: 'record.x' });
      expect(m).toContain('Did you mean `showWhen` → `visibleWhen`?');
      expect(RowCrudActionOverrideSchema.safeParse({ visibleWhen: 'record.x' }).success).toBe(true);
    });
  });

  describe('`FieldSchema` — `visible` and `showWhen` had no hint at all', () => {
    it('`showWhen` renames onto `visibleWhen`', () => {
      const m = unknownKeyMessage(FieldSchema, { ...FIELD, showWhen: 'record.x' });
      expect(m).toContain('Did you mean `showWhen` → `visibleWhen`?');
      expect(FieldSchema.safeParse({ ...FIELD, visibleWhen: 'record.x' }).success).toBe(true);
    });

    it('`visible` names both forms AND the inversion — the trap a rename would spring', () => {
      const m = unknownKeyMessage(FieldSchema, { ...FIELD, visible: false });
      expect(m).toContain('`hidden`');
      expect(m).toContain('`visibleWhen`');
      expect(m).toContain('INVERTED');
      // Both keys the prose names are really accepted here.
      expect(FieldSchema.safeParse({ ...FIELD, hidden: true }).success).toBe(true);
      expect(FieldSchema.safeParse({ ...FIELD, visibleWhen: 'record.x' }).success).toBe(true);
    });
  });

  describe('`FormFieldSchema` — the one view/page shape that declares a landing key for `disabled`', () => {
    it('`disabled` renames onto `readonly`', () => {
      const m = unknownKeyMessage(FormFieldSchema, { ...FORM_FIELD, disabled: true });
      expect(m).toContain('Did you mean `disabled` → `readonly`?');
      expect(FormFieldSchema.safeParse({ ...FORM_FIELD, readonly: true }).success).toBe(true);
    });

    it('…and the row is filed HERE, not on the shared table — the siblings would be lying', () => {
      // `VISIBILITY_STRICT_OPTIONS` is shared with the two shapes below, and
      // neither declares `readonly`. This is the assertion that keeps a future
      // tidy-up from hoisting the alias into the shared options.
      expect(FormSectionSchema.safeParse({ ...SECTION, readonly: true }).success).toBe(false);
      expect(PageComponentSchema.safeParse({ ...COMPONENT, readonly: true }).success).toBe(false);
    });
  });
});

// ===========================================================================
// 2. The surfaces that were ALREADY compliant — pinned so a sweep can tell
//    "already answered" from "nobody got to it"
// ===========================================================================
describe('#7832 — already curated before this card, and why no row was added', () => {
  it('`SelectOptionSchema` already renames `visible` and `showWhen` onto `visibleWhen`', () => {
    expect(unknownKeyMessage(SelectOptionSchema, { ...OPTION, visible: true }))
      .toContain('Did you mean `visible` → `visibleWhen`?');
    expect(unknownKeyMessage(SelectOptionSchema, { ...OPTION, showWhen: 'record.x' }))
      .toContain('Did you mean `showWhen` → `visibleWhen`?');
  });

  it.each([
    ['FormSectionSchema', FormSectionSchema, SECTION],
    ['PageComponentSchema', PageComponentSchema, COMPONENT],
    ['FormFieldSchema', FormFieldSchema, FORM_FIELD],
  ])('%s answers `visible` / `showWhen` through the ADR-0089 guidance SET, not an alias', (_n, schema, base) => {
    for (const key of ['visible', 'showWhen']) {
      const m = unknownKeyMessage(schema, { ...base, [key]: 'record.x' });
      expect(m).toContain('the canonical key is `visibleWhen` (ADR-0089)');
      // The set consumes the key and `continue`s, so the rename channel never
      // runs for it — which is precisely why adding an alias for either key on
      // these three surfaces would be dead code, not a second opinion.
      expect(m).not.toContain('Did you mean');
    }
  });
});

// ===========================================================================
// 3. Where NO row was added, because the target key does not exist
// ===========================================================================
describe('#7832 — the deliberate gaps (an alias here would name a key the shape rejects)', () => {
  it.each([
    ['SelectOptionSchema', SelectOptionSchema, OPTION],
    ['FormSectionSchema', FormSectionSchema, SECTION],
    ['PageComponentSchema', PageComponentSchema, COMPONENT],
  ])('%s declares no `disabledWhen` / `disabled` / `readonly`, so no alias row is filed', (_n, schema, base) => {
    // Rejected — loudly, with the surface named — and with no RENAME, because
    // there is nothing on this shape to point a rename at. If any of these ever
    // gains a disabled-ish key, this assertion fails and the row becomes owed.
    //
    // #7887 ruled the absence a BOUNDARY rather than a gap and gave the two
    // view/page shapes a prescription saying so (`EDITABILITY_BOUNDARY_KEYS`,
    // pinned in `editability-boundary.test.ts`). That is the guidance channel,
    // not the alias channel: no key was added, no alias row was registered, and
    // every assertion below is unchanged and green by construction.
    //
    // `SelectOptionSchema` was out of that ruling's scope until #8201, which
    // re-measured the ruling's premise on the object-field pipeline (zero
    // per-option `disabled` consumers) and gave this shape the boundary too —
    // with its own prescription, because an option has no fields inside it to
    // be redirected to. Same channel, same red line: still no key, still no
    // alias row, so all three rows below stay green by construction.
    for (const target of ['disabledWhen', 'disabled', 'readonly']) {
      expect(
        schema.safeParse({ ...base, [target]: 'x' }).success,
        `${_n} now declares \`${target}\` — file the \`disabled\` row`,
      ).toBe(false);
    }
    expect(unknownKeyMessage(schema, { ...base, disabled: true })).toContain('`disabled`');
  });

  it('`FieldSchema.disabled` was already pointed at `readonly`, which is right — a field has `readonlyWhen`, not `disabledWhen`', () => {
    expect(unknownKeyMessage(FieldSchema, { ...FIELD, disabled: true }))
      .toContain('Did you mean `disabled` → `readonly`?');
    expect(FieldSchema.safeParse({ ...FIELD, disabledWhen: 'record.x' }).success).toBe(false);
    expect(FieldSchema.safeParse({ ...FIELD, readonlyWhen: 'record.x' }).success).toBe(true);
  });
});

// ===========================================================================
// 4. Acceptance is byte-identical — the constraint this card was scoped under
// ===========================================================================
describe('#7832 — no acceptance change', () => {
  it('`RowCrudActionOverrideSchema` still accepts exactly its three declared keys', () => {
    expect(RowCrudActionOverrideSchema.safeParse({}).success).toBe(true);
    expect(
      RowCrudActionOverrideSchema.safeParse({
        enabled: true,
        visibleWhen: 'record.status != "closed"',
        disabledWhen: 'record.locked',
      }).success,
    ).toBe(true);
  });

  it('…and still REJECTS every key it rejected before the error map was attached', () => {
    for (const key of ['visible', 'disabled', 'showWhen', 'hidden', 'nonsenseKey']) {
      expect(
        RowCrudActionOverrideSchema.safeParse({ [key]: true }).success,
        `\`${key}\` must stay rejected — this card curates messages, it does not widen the shape`,
      ).toBe(false);
    }
  });

  it('the surfaces that gained prose/aliases did not gain KEYS', () => {
    for (const key of ['visible', 'showWhen']) {
      expect(FieldSchema.safeParse({ ...FIELD, [key]: true }).success).toBe(false);
    }
    expect(FormFieldSchema.safeParse({ ...FORM_FIELD, disabled: true }).success).toBe(false);
  });
});

// ===========================================================================
// 5. #8382 — the two `visibleWhen` shapes #7832's inventory never enumerated
// ===========================================================================
//
// `page:tabs` items (`component.zod.ts`) and `ScreenFieldConfigSchema`
// (`builtin-node-config.zod.ts`) both declare `visibleWhen` and were outside
// the six shapes #7832 curated: `visible` / `showWhen` were rejected without
// naming the key to write instead. Both have exactly ONE landing key for the
// visibility intent and no boolean sibling, so per the header's rule this is
// the simple alias case on both: `visible → visibleWhen`, `showWhen →
// visibleWhen`. Neither shape spreads `VISIBILITY_STRICT_OPTIONS` — both are
// hand-rolled `strictObject` calls with their own options (the tab item
// already carried one alias row, `key → value`; the screen field carried
// `guidance` only, keyed to the `visibleIf` typo) — so no guidance set
// consumes these keys before the alias channel does; the assertions below
// confirm the rename fires (a shadowed row would emit the guidance-set
// prescription instead, per section 2's `.not.toContain('Did you mean')`
// pattern), which is exactly what keeps `alias-integrity.test.ts` green.

/** Minimal bodies that reach each new surface's unknown-key path. */
const TAB_ITEM = { label: 'Tab', children: [] } as const;
const SCREEN_FIELD = { name: 'f' } as const;

describe('#8382 — the two shapes #7832 never enumerated', () => {
  describe('`page:tabs` item (`PageTabsProps.items`) — `visibleWhen` declared, no alias for the action-side spellings', () => {
    it('`visible` renames onto `visibleWhen`', () => {
      const m = unknownKeyMessage(PageTabsProps, { items: [{ ...TAB_ITEM, visible: true }] });
      expect(m).toContain('Did you mean `visible` → `visibleWhen`?');
    });

    it('`showWhen` renames onto `visibleWhen`', () => {
      const m = unknownKeyMessage(PageTabsProps, { items: [{ ...TAB_ITEM, showWhen: 'record.x' }] });
      expect(m).toContain('Did you mean `showWhen` → `visibleWhen`?');
    });

    it('the canonical `visibleWhen` still parses, unchanged', () => {
      // `ExpressionInputSchema` normalizes a bare string into `{ dialect: 'cel',
      // source }` — that normalization is pre-existing and untouched by this
      // card; what this pins is that the alias rows did not disturb it.
      const r = PageTabsProps.safeParse({ items: [{ ...TAB_ITEM, visibleWhen: 'record.x' }] });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.items[0]?.visibleWhen).toEqual({ dialect: 'cel', source: 'record.x' });
    });

    it('`visible` and `showWhen` stay REJECTED — a pointer is not an acceptance', () => {
      expect(PageTabsProps.safeParse({ items: [{ ...TAB_ITEM, visible: true }] }).success).toBe(false);
      expect(PageTabsProps.safeParse({ items: [{ ...TAB_ITEM, showWhen: 'record.x' }] }).success).toBe(false);
    });

    // The judgment call: `visibility` / `visibleOn` are the ADR-0089 spellings
    // this surface's own docblock says are deliberately NOT folded in (the
    // key is new; there is no legacy convention to carry forward here, unlike
    // the view/page shapes that fold them via `normalizeVisibleWhen`). That
    // sentence is about ACCEPTANCE and an alias row does not disturb it — both
    // stay rejected below. But an author who used the ADR-0089 spelling
    // correctly on a page component or view form and reaches for the same
    // word on a tab item is signalling the identical intent, so #8382 points
    // the rejection at `visibleWhen` for these two as well, on the same
    // one-landing-key rule as `visible` / `showWhen`. Pinned here so a future
    // edit cannot silently drop the pointer OR silently start accepting them.
    it('`visibility` / `visibleOn` are POINTED at `visibleWhen` but stay rejected (the #8382 judgment call)', () => {
      const mVisibility = unknownKeyMessage(PageTabsProps, { items: [{ ...TAB_ITEM, visibility: true }] });
      expect(mVisibility).toContain('Did you mean `visibility` → `visibleWhen`?');
      expect(PageTabsProps.safeParse({ items: [{ ...TAB_ITEM, visibility: true }] }).success).toBe(false);

      const mVisibleOn = unknownKeyMessage(PageTabsProps, { items: [{ ...TAB_ITEM, visibleOn: 'record.x' }] });
      expect(mVisibleOn).toContain('Did you mean `visibleOn` → `visibleWhen`?');
      expect(PageTabsProps.safeParse({ items: [{ ...TAB_ITEM, visibleOn: 'record.x' }] }).success).toBe(false);
    });
  });

  describe('`ScreenFieldConfigSchema` — `visibleWhen` declared, no alias for the action-side spellings', () => {
    it('`visible` renames onto `visibleWhen`', () => {
      const m = unknownKeyMessage(ScreenFieldConfigSchema, { ...SCREEN_FIELD, visible: true });
      expect(m).toContain('Did you mean `visible` → `visibleWhen`?');
    });

    it('`showWhen` renames onto `visibleWhen`', () => {
      const m = unknownKeyMessage(ScreenFieldConfigSchema, { ...SCREEN_FIELD, showWhen: 'record.x' });
      expect(m).toContain('Did you mean `showWhen` → `visibleWhen`?');
    });

    it('the canonical `visibleWhen` still parses, unchanged', () => {
      const r = ScreenFieldConfigSchema.safeParse({ ...SCREEN_FIELD, visibleWhen: 'record.x' });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.visibleWhen).toBe('record.x');
    });

    it('`visible` and `showWhen` stay REJECTED — a pointer is not an acceptance', () => {
      expect(ScreenFieldConfigSchema.safeParse({ ...SCREEN_FIELD, visible: true }).success).toBe(false);
      expect(ScreenFieldConfigSchema.safeParse({ ...SCREEN_FIELD, showWhen: 'record.x' }).success).toBe(false);
    });

    it('the pre-existing `visibleIf` guidance is untouched by the new aliases (`guidance` wins over `aliases`)', () => {
      const m = unknownKeyMessage(ScreenFieldConfigSchema, { ...SCREEN_FIELD, visibleIf: 'record.x' });
      expect(m).toContain('The visibility predicate is `visibleWhen`');
      expect(m).not.toContain('Did you mean');
    });
  });
});
