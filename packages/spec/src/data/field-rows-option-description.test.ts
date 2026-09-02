// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [objectui#6140 / objectui#6153] The two consumed-but-undeclared field
 * metadata keys the 2026-08-25 maintainer ruling declared (Option A, verbatim:
 * 「就全部接受，然后继续下一批」):
 *
 * - **`rows`** on the multiline editor field types. objectui's `RichTextField`
 *   (the one widget behind the `markdown`/`html`/`richtext` registry keys,
 *   objectui#5498) reads `richField?.rows || 8` through an `as any`, and
 *   `TextAreaField` reads `textareaField?.rows || 4` — while `FieldSchema`
 *   refused the key at publish on EVERY type, so the capability worked in the
 *   running app and failed for exactly the author who wrote it legally.
 *   Declared for the measured consumption set (`MULTILINE_EDITOR_FIELD_TYPES`:
 *   textarea, markdown, html, richtext) with the #11566 template — a
 *   superRefine refuses it on every other type, and the house count discipline
 *   (#8321) refuses 0 / negative / fractional values.
 * - **`options[].description`** on the select-option shape. objectui's
 *   `LookupField` searches it on a lookup's authored static options
 *   (`opt.description && opt.description.toLowerCase().includes(q)`) and its
 *   `recordToOption` produces the same key for fetched options — while
 *   `SelectOptionSchema` refused it. The object-definition authoring form has
 *   offered a `description` input all along; the declaration makes the offer
 *   honest. Per the same inherited ruling, `dependsOn` is deliberately NOT
 *   declared (the canonical `depends_on` already exists at the field level).
 *
 * The ruling's capability expansion STOPS at these keys: the four inert
 * rich-text editor keys (`toolbar`/`preview`/`minHeight`/`maxHeight`) stay
 * undeclared — the control pins below hold that door shut.
 *
 * [#13671] Section 3 was added later and is about the OTHER half of the same
 * offer-vs-door pair this file already documents. The `icon` control in
 * section 2 used to assert one thing — the door refuses `icon` — while
 * `object.form.ts` went on OFFERING an `icon` input, so the file was green
 * across a live disagreement. Section 3 pins the offer side; the file keeps
 * its name because the two subjects are one story (`options[]` keys the
 * authoring form and the publish door must agree about).
 */

import { describe, it, expect } from 'vitest';

import { FieldSchema, SelectOptionSchema } from './field.zod';
import { objectForm } from './object.form';
import { FormSelectOptionSchema } from '../ui/view.zod';

// =========================================================================
// 1. `rows` — the publish door now accepts what the widgets already read
// =========================================================================

describe('FieldSchema accepts `rows` on the multiline editor types (objectui#6140, ruled 2026-08-25)', () => {
  // Hardcoded on purpose (not iterated off the module-local set) so this test
  // is an independent measurement of the set, not a tautology — the same
  // discipline as the #11949 bounded-string pins.
  const multiline = ['textarea', 'markdown', 'html', 'richtext'] as const;

  for (const type of multiline) {
    it(`accepts rows on type: '${type}', preserving the value through parse`, () => {
      const result = FieldSchema.safeParse({
        name: 'body', label: 'Body', type, rows: 12,
      });
      expect(result.success, JSON.stringify((result as { error?: unknown }).error ?? {})).toBe(true);
      if (result.success) expect(result.data.rows).toBe(12);
    });
  }

  it('accepts rows: 1 (the lower bound is 1, not 2)', () => {
    const result = FieldSchema.safeParse({
      name: 'body', label: 'Body', type: 'textarea', rows: 1,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.rows).toBe(1);
  });

  it('absent rows stays absent — no default materializes, on any type', () => {
    for (const type of ['textarea', 'markdown', 'boolean'] as const) {
      const result = FieldSchema.parse({ name: 'f', label: 'F', type }) as Record<string, unknown>;
      expect('rows' in result).toBe(false);
    }
  });
});

describe('malformed or misplaced rows declarations are refused at authoring', () => {
  // House count discipline (#8321 / #11566): a row count of 0, -5 or 2.5 has
  // no defined meaning — the HTML `rows` attribute is a positive integer, and
  // the consuming widgets treat 0 as absent (`|| 8`), so `rows: 0` would be a
  // silently-inert declaration.
  const shapeCases: Array<[value: number, code: string]> = [
    [0, 'too_small'],
    [-5, 'too_small'],
    [2.5, 'invalid_type'],
  ];
  for (const [value, code] of shapeCases) {
    it(`refuses rows: ${value} on a textarea field with a ${code} issue at [rows]`, () => {
      const result = FieldSchema.safeParse({
        name: 'body', label: 'Body', type: 'textarea', rows: value,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const issue = result.error.issues.find((i) => i.path[0] === 'rows');
        expect(issue?.code).toBe(code);
        // Message substance, not just a throw: the refusal names what a legal
        // value looks like (int / >=1), so an AI author can fix it.
        expect(issue?.message).toMatch(code === 'invalid_type' ? /expected int/ : />=1/);
      }
    });
  }

  // One representative per family, mirroring the #11566/#11949 wrong-type
  // blocks — plus `code` and `text`, the near-misses: `code` is a multiline
  // EDITOR whose widget has no `rows` read, and `text` is the single-line
  // sibling an AI author will reach for first.
  const wrongTypes = [
    'text', 'code', 'boolean', 'number', 'date', 'select', 'lookup',
    'autonumber', 'formula', 'json',
  ] as const;
  for (const type of wrongTypes) {
    it(`refuses rows on type: '${type}' with a custom issue at [rows]`, () => {
      const result = FieldSchema.safeParse({
        name: 'f', label: 'F', type, rows: 6,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const issue = result.error.issues.find((i) => i.path[0] === 'rows');
        expect(issue?.code).toBe('custom');
        // The refusal names the legal set and the offending type, so an AI
        // author can fix the declaration without leaving the message.
        expect(issue?.message).toMatch(/multiline editor/);
        expect(issue?.message).toContain("'textarea', 'markdown', 'html', 'richtext'");
        expect(issue?.message).toContain(`\`${type}\``);
      }
    });
  }
});

describe('the ruled expansion stops at `rows` — the four inert editor keys stay refused', () => {
  // The control half of the publish-door pins: the same markdown field that
  // now accepts `rows` still refuses the inert keys the ruling explicitly did
  // NOT make real. If one of these starts parsing, that is a NEW accepted-set
  // expansion nobody ruled on.
  it.each(['toolbar', 'preview', 'minHeight', 'maxHeight'] as const)(
    'an undeclared editor key `%s` on a markdown field is still an unrecognized_keys refusal',
    (key) => {
      const result = FieldSchema.safeParse({
        name: 'body', label: 'Body', type: 'markdown', rows: 8, [key]: true,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const hit = result.error.issues.find((i) => i.code === 'unrecognized_keys');
        expect(hit, `no unrecognized_keys issue for \`${key}\` in ${JSON.stringify(result.error.issues)}`).toBeDefined();
        expect(JSON.stringify(hit)).toContain(key);
      }
    },
  );
});

// =========================================================================
// 2. `options[].description` — the option shape accepts the searched key
// =========================================================================

describe('SelectOptionSchema accepts `description` (objectui#6153, inherited ruling 2026-08-25)', () => {
  const OPTION = { label: 'Open', value: 'open', description: 'Still being worked' } as const;

  it('accepts and preserves description on the bare option shape', () => {
    const result = SelectOptionSchema.safeParse(OPTION);
    expect(result.success, JSON.stringify((result as { error?: unknown }).error ?? {})).toBe(true);
    if (result.success) expect(result.data.description).toBe('Still being worked');
  });

  it('accepts a described option through the real select-field door', () => {
    const result = FieldSchema.safeParse({
      name: 'status', label: 'Status', type: 'select',
      options: [OPTION, { label: 'Closed', value: 'closed' }],
    });
    expect(result.success, JSON.stringify((result as { error?: unknown }).error ?? {})).toBe(true);
    if (result.success) expect(result.data.options?.[0]?.description).toBe('Still being worked');
  });

  it('accepts a described option through the lookup-field door (the measured consumer path)', () => {
    // objectui's LookupField takes `fieldMeta?.options || []` as its static
    // options and searches `opt.description` — this is the door an author of
    // that behaviour publishes through.
    const result = FieldSchema.safeParse({
      name: 'assignee', label: 'Assignee', type: 'lookup', reference: 'sys_user',
      options: [OPTION],
    });
    expect(result.success, JSON.stringify((result as { error?: unknown }).error ?? {})).toBe(true);
    if (result.success) expect(result.data.options?.[0]?.description).toBe('Still being worked');
  });

  it('flows into the form-view option face by construction (the #12868 Omit)', () => {
    const result = FormSelectOptionSchema.safeParse(OPTION);
    expect(result.success, JSON.stringify((result as { error?: unknown }).error ?? {})).toBe(true);
    if (result.success) {
      expect((result.data as { description?: string }).description).toBe('Still being worked');
    }
  });

  it('the neighbouring undeclared option keys are still refused — `icon` (control) and `dependsOn` (explicitly not licensed)', () => {
    // `icon`: declared by objectui's `SelectOptionMetadata` but left out of
    // this shape by #5016's option C, and #13671 re-measured that reading for
    // the FIELD-option surface and kept it (section 3). It stays an
    // unrecognized_keys refusal until someone rules otherwise — what #13671
    // changed is the OFFER, not this door. `dependsOn`: the inherited #6153
    // ruling resolves it objectui-side (the widget reads the canonical
    // field-level `depends_on`); declaring a camelCase twin here is
    // explicitly not licensed.
    for (const [key, value] of [['icon', 'circle-dot'], ['dependsOn', 'country']] as const) {
      const result = SelectOptionSchema.safeParse({ label: 'Open', value: 'open', [key]: value });
      expect(result.success, `\`${key}\` unexpectedly parsed — an unruled accepted-set expansion`).toBe(false);
      if (!result.success) {
        const hit = result.error.issues.find((i) => i.code === 'unrecognized_keys');
        expect(hit, `no unrecognized_keys issue for \`${key}\``).toBeDefined();
      }
    }
  });
});

// =========================================================================
// 3. `options[].icon` — the OTHER half of the same offer-vs-door pair
// =========================================================================

/**
 * ⚠️ THIS PIN CHANGED SUBJECT (#13671) — read this before "restoring" it.
 *
 * The `icon` case in section 2 used to stand alone and assert ONE thing: the
 * publish door refuses `icon`. That was true and is still true — but while it
 * held, `object.form.ts`'s options repeater went on OFFERING an `icon` text
 * input labelled "Lucide icon name", so a Studio author was taught a key the
 * door rejects and found out at the 422. The pin was green across a live
 * disagreement because it only ever looked at one side of it.
 *
 * #13671 closed the disagreement under ADR-0049 enforce-or-remove, on the
 * route triage ruled: **the offer was withdrawn, the door was NOT widened.**
 * So the pin now has two halves and needs both — section 2's `it` for the
 * door, this section for the offer. ⛔ Neither half alone is the pin: a green
 * "the door refuses `icon`" says nothing about what the form offers, which is
 * exactly how the gap survived.
 *
 * ## Why remove and not declare
 *
 * The premise was measured for THIS surface — a FIELD option — rather than
 * inherited from #5016, which measured the ACTION-param path (objectui's
 * `SelectOptionMetadata` does declare `icon`, so the two faces had to be
 * measured apart). Measured at the `.objectui-sha` pin
 * `d8ec8d6d4f011b11c8eb1e6dbd364ef206711391` — the console this repo ships —
 * and again on that repo's `origin/main`, same answer both times, with a live
 * positive control: the select/multiselect cell renderer
 * (`packages/fields/src/index.tsx`, the `renderOne` badge/dot branch) reads
 * `option?.label` and `option?.color` off a `SelectOptionMetadata[]` and never
 * `option?.icon`, and no field-option render path in that tree reads the key at
 * all — the single `opt.icon` read there belongs to the config-panel
 * `ConfigField` vocabulary, whose `icon` is a `React.ReactNode` an authored
 * field option cannot reach. Declaring `icon` would be an accepted-set
 * expansion needing a maintainer ruling; if that ruling ever comes, this
 * section INVERTS (offer restored, door widened, both halves moving together)
 * rather than being deleted.
 */
describe('#13671 — the object.form options repeater offers only keys the door accepts', () => {
  type FormSpec = Record<string, unknown>;

  /**
   * Every form-field spec matching `match`, at any depth. Same traversal as
   * `form-delete-behavior-options.test.ts` (#11410) — sections and `fields`
   * arrays, which is how a repeater's sub-form hangs off its parent.
   */
  function findSpecs(node: unknown, match: (s: FormSpec) => boolean, out: FormSpec[] = []): FormSpec[] {
    if (!node || typeof node !== 'object') return out;
    if (Array.isArray(node)) {
      for (const n of node) findSpecs(n, match, out);
      return out;
    }
    const rec = node as FormSpec;
    if (match(rec)) out.push(rec);
    for (const child of ['sections', 'fields'] as const) {
      if (rec[child]) findSpecs(rec[child], match, out);
    }
    return out;
  }

  /** The one `options` repeater, asserted unique so a second one cannot hide. */
  function optionsRepeater(): FormSpec {
    const hits = findSpecs(objectForm, (s) => s.field === 'options' && s.type === 'repeater');
    expect(hits, 'the object form no longer declares exactly one `options` repeater').toHaveLength(1);
    return hits[0];
  }

  /** The input keys that repeater offers per option. */
  function offeredOptionKeys(): string[] {
    const sub = optionsRepeater().fields;
    // An ABSENT list is not a narrower offer — it is the renderer's DERIVED
    // source (the #11410 lesson): with no `fields` the metadata-admin form
    // falls through to the JSON Schema, so "no list" would silently re-offer
    // whatever the schema exposes. The list must be explicit.
    expect(Array.isArray(sub) && sub.length > 0, 'the options repeater declares no explicit sub-form field list').toBe(true);
    return (sub as FormSpec[]).map((f) => String(f.field));
  }

  it('does not offer `icon` — the withdrawn input (THE DEFECT)', () => {
    expect(offeredOptionKeys()).not.toContain('icon');
  });

  it('still offers the four inputs that survived, in order', () => {
    // The positive control for the assertion above: an empty or mangled list
    // would satisfy `not.toContain('icon')` while having removed the whole
    // repeater. `description` is here because PR #13669 declared it — ⛔ do
    // not drop it while editing this list.
    expect(offeredOptionKeys()).toEqual(['label', 'value', 'color', 'description']);
  });

  it('offers no input naming a key the publish door refuses — the general invariant', () => {
    // The class, not the instance: whatever this repeater offers tomorrow, the
    // door must accept it. Asserted through the door's own behaviour rather
    // than a hand-copied key list, so it cannot drift from the schema.
    for (const key of offeredOptionKeys()) {
      const result = SelectOptionSchema.safeParse({ label: 'Open', value: 'open', [key]: 'probe' });
      const unrecognized = result.success
        ? undefined
        : result.error.issues.find((i) => i.code === 'unrecognized_keys' && JSON.stringify(i).includes(key));
      expect(
        unrecognized,
        `the options repeater offers an input for \`${key}\`, which \`SelectOptionSchema\` refuses at publish `
          + '— offer and door disagree again (ADR-0049 enforce-or-remove)',
      ).toBeUndefined();
    }
  });

  it('declares exactly one `icon` input in total — the OBJECT-level row, a different subject', () => {
    // The object form declares two `icon` inputs in total before #13671 and
    // one after. The survivor is the object's own Lucide icon in Basics, which
    // `ObjectSchema` declares and Studio renders; an over-broad deletion that
    // took it out would otherwise look like a pass above.
    const iconRows = findSpecs(objectForm, (s) => s.field === 'icon');
    expect(iconRows).toHaveLength(1);
    expect(String(iconRows[0].helpText ?? '')).toContain('Lucide icon name');
  });
});
