// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7887 / #8202 / #8201 — the **editability boundary** and the surface strings
 * that make it readable, asserted.
 *
 * Sections 1-4 are #7887's, unchanged in intent. Sections 5 and 6 finish the
 * story #7887 started:
 *
 * - **§5 (#8202)** — each shape names ITSELF in its rejection. #7887 is what
 *   made this load-bearing rather than cosmetic: the same key now gets two
 *   deliberately contradictory answers depending on the shape (rename on a
 *   field, boundary on a section / component), and a reader holding the wrong
 *   one is told to move a key that is already in the right place.
 * - **§6 (#8201)** — `SelectOptionSchema`, the third shape §3 of
 *   `visible-when-alias-guidance.test.ts` pins as declaring no disabled-ish
 *   key, gets the boundary too, with the destination that is true for an option
 *   (withdraw it with `visibleWhen`) rather than the containers' (put the key
 *   on the fields inside — an option has no inside).
 *
 * The maintainer's ruling of 2026-08-12, operative sentence: *"`FormSectionSchema`
 * / `PageComponentSchema` gate **visibility only**; editability lives on fields.
 * No `disabled` / `readonly` / `disabledWhen` slot is added to those shapes, and
 * no alias row is registered for them."* The deliverable is therefore text-face
 * only: the accepted set does not move, the rejected set does not move, and the
 * single thing that changes is the sentence an author reads when they write an
 * editability key on a shape that has no editability semantics.
 *
 * ## What each section below would catch
 *
 * 1. **the prescription reaches a real author** — asserted on the actual
 *    `unrecognized_keys` message from `safeParse`, never on the options table.
 *    A row filed in a table nothing consults is exactly the dead-entry shape
 *    `alias-integrity.test.ts` exists for; reading the message back is the only
 *    assertion that cannot pass that way.
 * 2. **it points at `readonlyWhen`, and never at `disabledWhen`** — `field.zod.ts`
 *    renames `disabled → readonly` and records that "a field has `readonlyWhen`,
 *    not `disabledWhen`" (#7832). A prescription naming `disabledWhen` would send
 *    the author to a key that exists on no field surface, which is worse than the
 *    bare rejection it replaced.
 * 3. **the field surface is untouched** — the trap this card was tiered up for.
 *    `VISIBILITY_STRICT_OPTIONS` is shared with `FormFieldSchema`, which answers
 *    `disabled` through its OWN alias row. A guidanceSet match `continue`s past
 *    the rename channel, so filing this family in the shared table would have
 *    replaced the one correct pointer in the family with a redirect away from it.
 * 4. **acceptance is byte-identical** — the lane's admission criterion. A
 *    guidance string must never become an accepted key.
 *
 * The options table itself lives in `editability-boundary.ts`, which the
 * `shared/index.ts` barrel deliberately does not re-export — so the package's
 * public API surface does not move either (`check:api-surface`), which is the
 * same claim one level out.
 */

import { describe, it, expect } from 'vitest';

import { FieldSchema, SelectOptionSchema } from '../data/field.zod';
import { FormFieldSchema, FormSectionSchema } from '../ui/view.zod';
import { PageComponentSchema } from '../ui/page.zod';
import { SELECT_OPTION_EDITABILITY_GUIDANCE, VISIBILITY_ONLY_STRICT_OPTIONS } from './editability-boundary';
import { strictObjectDeclarations } from './strict-object';
import { keySetMatches } from './suggestions.zod';

/**
 * The `unrecognized_keys` message for `value`, or a loud failure.
 *
 * Same helper, same reasoning, as `visible-when-alias-guidance.test.ts`: the
 * probe bodies are minimal and may also miss a required key, so a whole-error
 * stringify could let an assertion pass on text from an unrelated issue.
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
const SECTION = { fields: [] } as const;
const COMPONENT = { type: 'text' } as const;
const FORM_FIELD = { field: 'probe' } as const;
const OPTION = { label: 'A', value: 'aa' } as const;
const FIELD = { name: 'probe', type: 'text' } as const;

/** The two shapes the ruling names, and nothing else. */
const VISIBILITY_ONLY: ReadonlyArray<[string, { safeParse: (v: unknown) => { success: boolean; error?: unknown } }, object]> = [
  ['FormSectionSchema', FormSectionSchema, SECTION],
  ['PageComponentSchema', PageComponentSchema, COMPONENT],
];

/** The spellings the boundary set answers. */
const EDITABILITY_KEYS = ['disabled', 'disabledWhen', 'readonly', 'readOnly', 'readonlyWhen', 'editable'] as const;

// ===========================================================================
// 1. The guidance reaches an author — on the real parse error
// ===========================================================================
describe('#7887 — the boundary prescription an author actually sees', () => {
  it.each(VISIBILITY_ONLY)('%s answers `disabled` with the boundary, not a bare refusal', (_n, schema, base) => {
    const m = unknownKeyMessage(schema, { ...base, disabled: true });
    expect(m).toContain('Editability is a FIELD-level concern');
    expect(m).toContain('gates VISIBILITY only');
    // Rendered through the shared template's prescription channel — the bullet
    // is what puts it directly after the key statement and before the history
    // sentence (#5955's ordering, pinned for this family in `ui/view.test.ts`).
    expect(m).toContain('\n  • Editability is a FIELD-level concern');
  });

  it.each(VISIBILITY_ONLY)('%s answers the whole editability family, not just `disabled`', (_n, schema, base) => {
    for (const key of EDITABILITY_KEYS) {
      expect(
        unknownKeyMessage(schema, { ...base, [key]: 'x' }),
        `\`${key}\` should reach the boundary prescription`,
      ).toContain('Editability is a FIELD-level concern');
    }
  });

  it.each(VISIBILITY_ONLY)('%s emits the prescription ONCE for a body carrying several of them', (_n, schema, base) => {
    // The property that makes this a SET rather than N exact entries: one
    // paragraph per message, however many members were written.
    const m = unknownKeyMessage(schema, { ...base, disabled: true, readonly: true, editable: false });
    expect(m.split('Editability is a FIELD-level concern')).toHaveLength(2);
    // …and every offending key is still named.
    for (const key of ['disabled', 'readonly', 'editable']) expect(m).toContain(`\`${key}\``);
  });

  it.each(VISIBILITY_ONLY)('%s still puts the history sentence last (the #5955 order survives the new set)', (_n, schema, base) => {
    const m = unknownKeyMessage(schema, { ...base, disabled: true });
    const history = 'Before ADR-0089 D3a these were dropped silently';
    expect(m.indexOf('Editability is a FIELD-level concern')).toBeLessThan(m.indexOf(history));
  });
});

// ===========================================================================
// 2. It names `readonlyWhen` — and must never name `disabledWhen`
// ===========================================================================
describe('#7887 — the prescription points at a key that exists', () => {
  it.each(VISIBILITY_ONLY)('%s names the field-level `readonly` / `readonlyWhen` pair', (_n, schema, base) => {
    const m = unknownKeyMessage(schema, { ...base, disabled: true });
    expect(m).toContain('`readonly: true`');
    expect(m).toContain('`readonlyWhen`');
  });

  it.each(VISIBILITY_ONLY)('%s never names `disabledWhen` — no field surface declares it', (_n, schema, base) => {
    // `field.zod.ts` renames `disabled → readonly` precisely because a field
    // has `readonlyWhen`, not `disabledWhen` (#7832). Pointing at the latter
    // would be a rejection that hands the author their next rejection.
    const m = unknownKeyMessage(schema, { ...base, disabledWhen: 'record.locked' });
    expect(m).toContain('Editability is a FIELD-level concern');
    // The offending key is echoed back in the front matter, so the prohibition
    // is on the PRESCRIPTION text, which is everything after the bullet.
    const prescription = m.slice(m.indexOf('\n  • '));
    expect(prescription).not.toContain('disabledWhen');
  });

  it('the boundary also names the visibility escape hatch, and that key really is accepted', () => {
    const m = unknownKeyMessage(FormSectionSchema, { ...SECTION, disabled: true });
    expect(m).toContain('`visibleWhen`');
    expect(FormSectionSchema.safeParse({ ...SECTION, visibleWhen: 'record.x' }).success).toBe(true);
    expect(PageComponentSchema.safeParse({ ...COMPONENT, visibleWhen: 'record.x' }).success).toBe(true);
  });
});

// ===========================================================================
// 3. The field surface is UNCHANGED — the shared-table trap
// ===========================================================================
describe('#7887 — `FormFieldSchema` sees exactly what it saw before', () => {
  it('`disabled` on a form field still renames onto `readonly`, with no boundary text', () => {
    const m = unknownKeyMessage(FormFieldSchema, { ...FORM_FIELD, disabled: true });
    expect(m).toContain('Did you mean `disabled` → `readonly`?');
    // The regression this whole file exists to catch. Hoisting
    // `EDITABILITY_BOUNDARY_KEYS` into `VISIBILITY_STRICT_OPTIONS` makes the set
    // fire here, and a set match `continue`s past the rename channel — so the
    // line above would vanish and this line would appear, redirecting a field
    // author AWAY from the one surface where `readonly` is real.
    expect(m).not.toContain('Editability is a FIELD-level concern');
  });

  it('the boundary options are filed on the two visibility-only shapes, never the shared table', () => {
    const names = (VISIBILITY_ONLY_STRICT_OPTIONS.guidanceSets ?? []).map((s) => s.name);
    expect(names).toContain('EDITABILITY_BOUNDARY_KEYS');
    // The ADR-0089 set is still there and still first — the boundary set is an
    // addition, not a replacement.
    expect(names[0]).toBe('VISIBILITY_KEY_PATTERN');
  });

  it('no editability key matches `VISIBILITY_KEY_PATTERN`, so set order is not load-bearing', () => {
    // Both sets live on one table. If a future edit widened the visibility
    // pattern to reach (say) `editable`, declaration order would silently start
    // deciding which prescription an author reads — the tie-break
    // `alias-integrity.test.ts` forbids any in-repo table from depending on.
    const visibility = (VISIBILITY_ONLY_STRICT_OPTIONS.guidanceSets ?? [])
      .find((s) => s.name === 'VISIBILITY_KEY_PATTERN');
    expect(visibility).toBeDefined();
    for (const key of EDITABILITY_KEYS) {
      expect(keySetMatches(visibility!, key), `\`${key}\` is claimed by both sets`).toBe(false);
    }
  });

  it('no alias row was registered for the boundary — the ruling forbids one', () => {
    // "no alias row is registered for them — an alias would declare a key the
    // runtime does not honour". An alias TARGET must be a key the shape accepts
    // (`alias-integrity.test.ts`), and neither shape accepts any of these, so a
    // row here would be a pointer into a second rejection.
    for (const table of [VISIBILITY_ONLY_STRICT_OPTIONS]) {
      for (const key of EDITABILITY_KEYS) {
        expect(table.aliases?.[key], `\`${key}\` must not have an alias row`).toBeUndefined();
      }
    }
  });
});

// ===========================================================================
// 4. Acceptance is byte-identical — a guidance string is not a key
// ===========================================================================
describe('#7887 — no acceptance change', () => {
  it.each(VISIBILITY_ONLY)('%s still REJECTS every editability spelling', (_n, schema, base) => {
    for (const key of EDITABILITY_KEYS) {
      expect(
        schema.safeParse({ ...base, [key]: true }).success,
        `\`${key}\` must stay rejected — this card curates messages, it does not widen the shape`,
      ).toBe(false);
    }
  });

  it('a representative section that parsed before still parses, unchanged in output', () => {
    const authored = {
      name: 'billing',
      label: 'Billing',
      description: 'Invoicing details',
      collapsible: true,
      collapsed: false,
      columns: 2,
      visibleOn: 'record.type == "customer"',
      fields: ['amount', { field: 'currency', readonly: true }],
    };
    const r = FormSectionSchema.safeParse(authored);
    expect(r.success).toBe(true);
    // The ADR-0089 fold still runs, and the field-level `readonly` inside is
    // still the accepted way to say what `disabled` on the section cannot.
    // `ExpressionInputSchema` normalizes the authored string to a
    // `{ dialect, source }` pair; the fold is about WHICH KEY carries it.
    expect((r.data as { visibleWhen?: { source?: string } }).visibleWhen?.source)
      .toBe('record.type == "customer"');
    expect((r.data as { visibleOn?: unknown }).visibleOn).toBeUndefined();
  });

  it('a representative page component that parsed before still parses, unchanged in output', () => {
    const authored = {
      type: 'record:form',
      id: 'main_form',
      label: 'Details',
      properties: { columns: 2 },
      className: 'p-4',
      visibility: 'current_user.is_admin',
    };
    const r = PageComponentSchema.safeParse(authored);
    expect(r.success).toBe(true);
    expect((r.data as { visibleWhen?: { source?: string } }).visibleWhen?.source)
      .toBe('current_user.is_admin');
    expect((r.data as { visibility?: unknown }).visibility).toBeUndefined();
  });

  it.each(VISIBILITY_ONLY)('%s keeps its bare message for a key in no family at all', (_n, schema, base) => {
    // The new set must claim the editability family and nothing beyond it: an
    // unrelated typo still gets the front matter plus history and no bullet.
    const m = unknownKeyMessage(schema, { ...base, totallyUnrelatedKey: true });
    expect(m).toContain('`totallyUnrelatedKey`');
    expect(m).not.toContain('  • ');
  });
});

// ===========================================================================
// 5. #8202 — every shape names ITSELF, so the two answers cannot be swapped
// ===========================================================================
describe('#8202 — the rejection says WHICH shape refused the key', () => {
  /** Each shape, a probe body, and the name its rejection must give itself. */
  const NAMED: ReadonlyArray<[string, { safeParse: (v: unknown) => { success: boolean; error?: unknown } }, object, string]> = [
    ['FormFieldSchema', FormFieldSchema, FORM_FIELD, 'this form field'],
    ['FormSectionSchema', FormSectionSchema, SECTION, 'this form section'],
    ['PageComponentSchema', PageComponentSchema, COMPONENT, 'this page component'],
    // Already named itself before this card; included because since #8201 its
    // message carries a THIRD answer to `disabled`, so it joins the set of
    // messages that must not be mistaken for one another.
    ['SelectOptionSchema', SelectOptionSchema, OPTION, 'this select option'],
  ];

  it.each(NAMED)('%s opens with its own name, and names no sibling shape', (_n, schema, base, surface) => {
    const m = unknownKeyMessage(schema, { ...base, disabled: true });
    expect(m.startsWith(`Unrecognized key(s) on ${surface}: \`disabled\`.`)).toBe(true);
    for (const other of NAMED.map((row) => row[3])) {
      if (other === surface) continue;
      expect(m, `${surface}'s message also names ${other}`).not.toContain(other);
    }
  });

  it('the two contradictory answers to `disabled` are each stamped with their shape', () => {
    // The defect #8202 records, asserted from both ends at once: these two
    // messages tell the author OPPOSITE things about the same key, on purpose.
    // Before this card both opened `Unrecognized key(s) on this view/page
    // schema`, so an author holding the section answer while looking at a field
    // was being told to move a key that was already in the right place.
    const field = unknownKeyMessage(FormFieldSchema, { ...FORM_FIELD, disabled: true });
    const section = unknownKeyMessage(FormSectionSchema, { ...SECTION, disabled: true });

    expect(field).toContain('this form field');
    expect(field).toContain('Did you mean `disabled` → `readonly`?');
    expect(field).not.toContain('Editability is a FIELD-level concern');

    expect(section).toContain('this form section');
    expect(section).toContain('Editability is a FIELD-level concern');
    expect(section).not.toContain('Did you mean');
  });

  it('no shape reports the shared family string any more', () => {
    // The family name is what the three shapes shared until #8202. A consumer
    // that forgets to override inherits it silently, which is a message going
    // vague rather than a test going red — so it is asserted here, and
    // repo-wide over every live declaration in `alias-integrity.test.ts`.
    for (const [name, schema, base] of NAMED) {
      expect(
        unknownKeyMessage(schema, { ...base, zzNotAKey: true }),
        `${name} still inherits the shared surface string`,
      ).not.toContain('this view/page schema');
    }
  });

  it('the shared table was not edited in place — it still carries the FAMILY name', () => {
    // #8199's placement rule, read from the `surface` end: a table shared by
    // several shapes may carry only what is true of all of them. Renaming the
    // shared string to one shape's name would make it true of one consumer and
    // wrong for the rest, which is the edit this assertion refuses.
    expect(VISIBILITY_ONLY_STRICT_OPTIONS.surface).toBe('this view/page schema');
  });
});

// ===========================================================================
// 6. #8201 — `SelectOptionSchema` inherits the ruling, with its OWN answer
// ===========================================================================
describe('#8201 — an option is offered or withheld, never shown-but-unselectable', () => {
  const OPTION_TEXT = 'Editability is not a per-OPTION concern';

  it('`disabled` on an option reaches the boundary, rendered as the template bullet', () => {
    const m = unknownKeyMessage(SelectOptionSchema, { ...OPTION, disabled: true });
    expect(m).toContain(OPTION_TEXT);
    expect(m).toContain(`\n  • ${OPTION_TEXT}`);
  });

  it('the whole editability family reaches it, once per message', () => {
    for (const key of EDITABILITY_KEYS) {
      expect(
        unknownKeyMessage(SelectOptionSchema, { ...OPTION, [key]: 'x' }),
        `\`${key}\` should reach the option boundary prescription`,
      ).toContain(OPTION_TEXT);
    }
    const many = unknownKeyMessage(SelectOptionSchema, { ...OPTION, disabled: true, readonly: true, editable: false });
    expect(many.split(OPTION_TEXT)).toHaveLength(2);
    for (const key of ['disabled', 'readonly', 'editable']) expect(many).toContain(`\`${key}\``);
  });

  it('the history sentence still comes last', () => {
    const m = unknownKeyMessage(SelectOptionSchema, { ...OPTION, disabled: true });
    expect(m.indexOf(OPTION_TEXT)).toBeLessThan(m.indexOf('Until #4001 closed this shape'));
  });

  it('it is NOT the containers\' prescription — an option has no fields inside it', () => {
    // The wrong turn this card was warned about: reusing #8199's text would
    // tell an option author to "write `readonly` on the form field(s) inside
    // it", and an option has no inside. The two texts must not cross over in
    // either direction.
    const option = unknownKeyMessage(SelectOptionSchema, { ...OPTION, disabled: true });
    expect(option).not.toContain('Editability is a FIELD-level concern');
    expect(option).not.toContain('the form field(s) inside');
    for (const [name, schema, base] of VISIBILITY_ONLY) {
      expect(
        unknownKeyMessage(schema, { ...base, disabled: true }),
        `${name} picked up the option prescription`,
      ).not.toContain(OPTION_TEXT);
    }
  });

  it('it points at per-option `visibleWhen`, and that predicate really parses HERE', () => {
    // Prose must not claim what the schema does not honour. Both readings the
    // prescription advertises are parsed back: a record-dependent predicate and
    // the `current_user` one that only this surface binds (ADR-0068).
    const m = unknownKeyMessage(SelectOptionSchema, { ...OPTION, disabled: true });
    expect(m).toContain('per-option `visibleWhen`');
    expect(m).toContain('`current_user` (ADR-0068)');
    expect(SelectOptionSchema.safeParse({ ...OPTION, visibleWhen: 'record.country == "cn"' }).success).toBe(true);
    expect(SelectOptionSchema.safeParse({ ...OPTION, visibleWhen: '"admin" in current_user.positions' }).success).toBe(true);
  });

  it('…and at the FIELD-level keys for the whole picker, which really parse THERE', () => {
    const m = unknownKeyMessage(SelectOptionSchema, { ...OPTION, disabled: true });
    expect(m).toContain('`readonly: true`');
    expect(m).toContain('`readonlyWhen`');
    expect(FieldSchema.safeParse({ ...FIELD, readonly: true }).success).toBe(true);
    expect(FieldSchema.safeParse({ ...FIELD, readonlyWhen: 'record.locked' }).success).toBe(true);
  });

  it('never names `disabledWhen` in the prescription — no field surface declares it', () => {
    const m = unknownKeyMessage(SelectOptionSchema, { ...OPTION, disabledWhen: 'record.locked' });
    const prescription = m.slice(m.indexOf('\n  • '));
    expect(prescription).not.toContain('disabledWhen');
  });

  it('says what is true TODAY and leaves the decision open', () => {
    // Triage left real product pull for non-selectable field options open as a
    // maintainer decision that would widen the accepted set. The prescription
    // must not read as "never" — it names the route (a spec decision) instead
    // of closing it, and this pin fails a rewrite that hardens it into a
    // permanent refusal.
    const m = unknownKeyMessage(SelectOptionSchema, { ...OPTION, disabled: true });
    expect(m).toContain('spec decision to ask for');
    expect(m).not.toMatch(/\bnever be\b|\bcannot ever\b/);
  });

  it('no alias row was registered for the family, and the existing renames still fire', () => {
    // Same red line as the mother ruling: an alias names a key the shape must
    // then accept. And the new set must not shadow the rename channel this
    // table already had — a set match `continue`s past it, so a member that
    // collided with an alias key would silently delete a working pointer.
    SelectOptionSchema.safeParse(OPTION);
    const decl = strictObjectDeclarations().find((d) => d.options.surface === 'this select option');
    expect(decl, '`SelectOptionSchema` did not register a declaration').toBeDefined();
    expect(decl!.options.guidanceSets?.map((s) => s.name))
      .toContain('SELECT_OPTION_EDITABILITY_BOUNDARY_KEYS');
    for (const key of EDITABILITY_KEYS) {
      expect(decl!.options.aliases?.[key], `\`${key}\` must not have an alias row`).toBeUndefined();
      expect(keySetMatches(SELECT_OPTION_EDITABILITY_GUIDANCE, key)).toBe(true);
    }
    for (const alias of Object.keys(decl!.options.aliases ?? {})) {
      expect(
        keySetMatches(SELECT_OPTION_EDITABILITY_GUIDANCE, alias),
        `the boundary set swallows the \`${alias}\` alias before its rename can fire`,
      ).toBe(false);
    }
    expect(unknownKeyMessage(SelectOptionSchema, { ...OPTION, visible: true }))
      .toContain('Did you mean `visible` → `visibleWhen`?');
    expect(unknownKeyMessage(SelectOptionSchema, { ...OPTION, colour: 'red' }))
      .toContain('Did you mean `colour` → `color`?');
  });

  it('no acceptance change on the option — rejected stays rejected, accepted stays identical', () => {
    for (const key of EDITABILITY_KEYS) {
      expect(
        SelectOptionSchema.safeParse({ ...OPTION, [key]: true }).success,
        `\`${key}\` must stay rejected — this card curates messages, it does not widen the shape`,
      ).toBe(false);
    }
    const authored = {
      label: 'In Progress',
      value: 'in_progress',
      color: '#ff0000',
      default: true,
      visibleWhen: 'record.country == "cn"',
    };
    const r = SelectOptionSchema.safeParse(authored);
    expect(r.success).toBe(true);
    const parsed = r.data as { label: string; value: string; color?: string; default?: boolean; visibleWhen?: { source?: string } };
    expect(Object.keys(parsed).sort()).toEqual(['color', 'default', 'label', 'value', 'visibleWhen']);
    expect(parsed.visibleWhen?.source).toBe('record.country == "cn"');
  });

  it('an option key in no family at all still gets the bare message', () => {
    const m = unknownKeyMessage(SelectOptionSchema, { ...OPTION, totallyUnrelatedKey: true });
    expect(m).toContain('`totallyUnrelatedKey`');
    expect(m).not.toContain('  • ');
  });
});
