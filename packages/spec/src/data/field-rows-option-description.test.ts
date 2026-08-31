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
 */

import { describe, it, expect } from 'vitest';

import { FieldSchema, SelectOptionSchema } from './field.zod';
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
    // `icon`: offered by the object.form options repeater and declared by
    // objectui's SelectOptionMetadata, but #5016's option C left it out of
    // this shape — it stays an unrecognized_keys refusal until someone rules
    // otherwise. `dependsOn`: the inherited #6153 ruling resolves it
    // objectui-side (the widget reads the canonical field-level `depends_on`);
    // declaring a camelCase twin here is explicitly not licensed.
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
