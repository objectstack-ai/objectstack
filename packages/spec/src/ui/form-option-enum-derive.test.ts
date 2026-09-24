// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #19678 / #19907 — derive only where a member cannot be spelled (ruling 乙,
 * record 5805845085, which narrows item 1 of ruling 不动 + 声明, record
 * 5793380467).
 *
 * A form option `value` is a system identifier: `SelectOptionSchema.value`,
 * which `FormSelectOptionSchema` reuses by reference. So an enum member that
 * carries a hyphen or a capital — `object.managedBy`'s `system-data`,
 * `action.openIn`'s `new-tab`, `action.execution`'s `perRecord` — cannot be
 * written as an inline option at all, and `defineForm` throws at module load
 * when an author tries. The bound stays. The rule, as ruling 乙 records it: an
 * enum-typed metadata-form row MAY carry an inline `options` list (human
 * labels, a deliberate subset); a row whose members cannot be spelled as
 * option values OMITS `options`, the control derives the members from the
 * served JSON Schema, and the meanings go in `helpText`.
 *
 * What this file pins is where an author meets that rule:
 *
 * 1. **The wall says what to do.** `defineForm`'s refusal of an unspellable
 *    value still carries the grammar message, and names the derive path —
 *    scoped to a row whose members cannot be spelled — as its remedy. The
 *    firing control reads TODAY's message live — the object face raises the
 *    same grammar issue through the same property schema, with no remedy —
 *    and proves the predicates this file asserts with are red on it.
 * 2. **Each case has a firing and a dark control, on real spec enums.** An
 *    unspellable row with inline `options` is refused and the same row without
 *    them builds; a labelled spellable row and a deliberate subset build, and
 *    the same rows with one member mis-spelled are refused. Every enum is read
 *    off the served JSON Schema, so "spellable", "unspellable" and "subset"
 *    are measured here, never assumed.
 * 3. **The verdict did not move.** The same values are refused and the same
 *    values accepted as before; only a message grew.
 * 4. **The remedy is scoped.** It rides a grammar refusal of an inline option
 *    `value` and nothing else a form parse can raise.
 * 5. **The describe states the rule** on the served JSON Schema, where the
 *    metadata-admin renderer and an AI author read it — the permission for an
 *    inline list, and the derive path for an unspellable row, and ⛔ never
 *    again the blanket "a spec-enum row omits `options`" it first carried.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

import { SelectOptionSchema } from '../data/field.zod';
import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';
import { defineForm, FormFieldSchema, FormSelectOptionSchema } from './view.zod';

type Issue = { code: string; path: PropertyKey[]; message: string; errors?: Issue[][] };

/** Every leaf issue, with the full path (a field row is a union, so its issues nest). */
function leaves(issues: readonly Issue[], at: readonly PropertyKey[] = []): Array<Issue & { fullPath: PropertyKey[] }> {
  return issues.flatMap((issue) => {
    const fullPath = [...at, ...issue.path];
    return issue.code === 'invalid_union' && issue.errors
      ? issue.errors.flatMap((branch) => leaves(branch, fullPath))
      : [{ ...issue, fullPath }];
  });
}

/**
 * The predicate this file judges a message by: does it name the derive path?
 * It asserts the named subjects — omitting `options`, the served JSON Schema
 * the members come from, `helpText` for their meanings — never the sentence
 * around them.
 */
function namesDerivePath(message: string): boolean {
  return /\bomit/i.test(message)
    && message.includes('`options`')
    && message.includes('JSON Schema')
    && message.includes('`helpText`');
}

/**
 * Ruling 乙's narrowing, as a predicate: the derive path is conditioned on
 * members that CANNOT BE SPELLED as option values — not on every enum row.
 */
function scopesDeriveToUnspellable(message: string): boolean {
  return /cannot be spelled as option values/.test(message);
}

/**
 * The blanket rule ruling 乙 narrowed away — "a spec-enum row omits
 * `options`", in either spelling this PR first shipped (the describe's
 * declarative one, the remedy's imperative one).
 */
function statesBlanketOmitRule(message: string): boolean {
  return /whose key is a spec enum omits `options`/.test(message)
    || /edits a spec enum, omit `options`/.test(message);
}

/** Build a one-row metadata form whose row lists a single inline option. */
function formWithOption(value: string, extra: Record<string, unknown> = {}) {
  return () => defineForm({
    schemaId: 'action',
    type: 'simple',
    sections: [{ label: 'Behavior', fields: [{ field: 'openIn', options: [{ label: 'Option', value, ...extra }] }] }],
  });
}

/** Build a one-row metadata form over `schemaId` with the given row. */
function formWithRow(schemaId: string, row: Record<string, unknown>) {
  return () => defineForm({
    schemaId,
    type: 'simple',
    sections: [{ label: 'Section', fields: [row as never] }],
  });
}

/** The ZodError a build threw, or a loud failure when it built. */
function refusal(build: () => unknown): z.ZodError {
  let thrown: unknown;
  try {
    build();
  } catch (e) {
    thrown = e;
  }
  expect(thrown, 'expected defineForm to REFUSE at module load').toBeInstanceOf(z.ZodError);
  return thrown as z.ZodError;
}

/** The issue `defineForm` raised at the row's option value, or a loud failure. */
function optionValueIssue(build: () => unknown, index = 0) {
  const thrown = refusal(build);
  const hit = leaves(thrown.issues as unknown as Issue[])
    .find((i) => i.fullPath.join('.') === `sections.0.fields.0.options.${index}.value`);
  expect(hit, `no issue at the option value in ${thrown.message}`).toBeDefined();
  return hit!;
}

/** Today's message for the same value, read live off the object face — the same property schema. */
function objectFaceMessage(value: string): string {
  const r = SelectOptionSchema.safeParse({ label: 'Option', value });
  expect(r.success).toBe(false);
  const hit = (r.error!.issues as unknown as Issue[]).find((i) => i.path.join('.') === 'value');
  expect(hit, 'the object face raised no issue at `value`').toBeDefined();
  return hit!.message;
}

/** Can `value` be spelled as a form option value? Asked of the form face itself. */
function spellable(value: string): boolean {
  return FormSelectOptionSchema.safeParse({ label: 'Option', value }).success;
}

/** The members `type.key` declares, read off the SERVED JSON Schema (input side). */
function servedEnum(type: string, key: string): string[] {
  const schema = getMetadataTypeSchema(type);
  expect(schema, `no metadata type schema for '${type}'`).toBeDefined();
  const json = z.toJSONSchema(schema!, { io: 'input', unrepresentable: 'any' }) as {
    properties?: Record<string, { enum?: unknown[] }>;
  };
  const members = json.properties?.[key]?.enum;
  expect(Array.isArray(members) && members.length > 0, `'${type}.${key}' serves no enum`).toBe(true);
  return members as string[];
}

// The card's own three members, plus the two-character floor.
const UNSPELLABLE = [
  { value: 'new-tab', code: 'invalid_format', why: 'a hyphen (action.openIn)' },
  { value: 'perRecord', code: 'invalid_format', why: 'a capital (action.execution)' },
  { value: 'system-data', code: 'invalid_format', why: 'a hyphen (object.managedBy)' },
  { value: 'x', code: 'too_small', why: 'a single character' },
] as const;

describe('defineForm: the refusal of an unspellable option value names the derive path', () => {
  it.each(UNSPELLABLE)('`$value` ($why) is refused with the remedy', ({ value, code }) => {
    const issue = optionValueIssue(formWithOption(value));
    expect(issue.code).toBe(code);
    expect(namesDerivePath(issue.message), issue.message).toBe(true);
  });

  it.each(UNSPELLABLE)('`$value`: the remedy scopes the derive path to members that cannot be spelled (ruling 乙)', ({ value }) => {
    const issue = optionValueIssue(formWithOption(value));
    expect(scopesDeriveToUnspellable(issue.message), issue.message).toBe(true);
    expect(statesBlanketOmitRule(issue.message), issue.message).toBe(false);
  });

  it.each(UNSPELLABLE)('`$value`: the grammar message is kept, and the remedy follows it', ({ value }) => {
    const today = objectFaceMessage(value);
    const issue = optionValueIssue(formWithOption(value));
    expect(issue.message.startsWith(`${today}. `), issue.message).toBe(true);
  });

  it('firing control — both predicates are RED on today\'s message', () => {
    // The object face raises the grammar issue through the very property schema
    // the form face shares, and carries no remedy: this is the message
    // `defineForm` threw before the ruling was executed.
    for (const { value } of UNSPELLABLE) {
      const today = objectFaceMessage(value);
      expect(namesDerivePath(today), today).toBe(false);
      expect(scopesDeriveToUnspellable(today), today).toBe(false);
    }
  });

  it('firing control — the blanket-rule predicate is LIT on the wording ruling 乙 narrowed away', () => {
    // The two spellings this PR first shipped, held as fixtures ONLY to prove
    // `statesBlanketOmitRule` can fire — a predicate that is never true would
    // make every "states no blanket rule" assertion in this file vacuous.
    expect(statesBlanketOmitRule('On a metadata form (schema-bound, built by `defineForm`), a row whose key is a spec enum omits `options`: …')).toBe(true);
    expect(statesBlanketOmitRule('When this row edits a spec enum, omit `options`: …')).toBe(true);
  });

  it('a nested row (composite `fields`) gets the same remedy', () => {
    const thrown = refusal(() => defineForm({
      schemaId: 'action',
      type: 'simple',
      sections: [{ label: 'Behavior', fields: [{ field: 'outer', fields: [{ field: 'inner', options: [{ label: 'New tab', value: 'new-tab' }] }] }] }],
    }));
    const hit = leaves(thrown.issues as unknown as Issue[])
      .find((i) => i.fullPath.join('.') === 'sections.0.fields.0.fields.0.options.0.value');
    expect(hit).toBeDefined();
    expect(namesDerivePath(hit!.message), hit!.message).toBe(true);
    expect(scopesDeriveToUnspellable(hit!.message), hit!.message).toBe(true);
  });
});

describe('ruling 乙 item 1, on real spec enums — each case with a firing and a dark control', () => {
  describe('a row whose members cannot be spelled (`object.managedBy`)', () => {
    const members = servedEnum('object', 'managedBy');

    it('lit precondition: the served enum carries members the form face cannot spell', () => {
      expect(members.filter((m) => !spellable(m)).length).toBeGreaterThan(0);
      expect(members.filter((m) => !spellable(m))).toContain('system-data');
    });

    it('FIRING — carrying inline `options`, it is REFUSED, and the remedy names the derive path', () => {
      const thrown = refusal(formWithRow('object', {
        field: 'managedBy',
        type: 'select',
        options: members.map((m) => ({ label: m, value: m })),
      }));
      const byPath = new Map(leaves(thrown.issues as unknown as Issue[]).map((i) => [i.fullPath.join('.'), i]));
      members.forEach((m, index) => {
        const issue = byPath.get(`sections.0.fields.0.options.${index}.value`);
        if (spellable(m)) {
          expect(issue, `spellable member '${m}' was refused`).toBeUndefined();
        } else {
          expect(issue, `unspellable member '${m}' was not refused`).toBeDefined();
          expect(issue!.code).toBe('invalid_format');
          expect(namesDerivePath(issue!.message), issue!.message).toBe(true);
          expect(scopesDeriveToUnspellable(issue!.message), issue!.message).toBe(true);
        }
      });
    });

    it('DARK — the same row without `options`, meanings in `helpText`, is GREEN', () => {
      const form = formWithRow('object', {
        field: 'managedBy',
        helpText: `Lifecycle bucket: ${members.join(', ')}.`,
      })();
      const row = form.sections![0]!.fields![0] as { field: string; options?: unknown };
      expect(row.field).toBe('managedBy');
      expect(row.options).toBeUndefined();
    });
  });

  describe('a spellable enum row with a labelled inline list (`object.sharingModel`, the #19331 shape)', () => {
    const members = servedEnum('object', 'sharingModel');
    const LABELS: Record<string, string> = {
      private: 'Private — owner only',
      public_read: 'Public read — everyone reads, owner writes',
      public_read_write: 'Public read/write — everyone reads and writes',
      controlled_by_parent: 'Controlled by parent — derived from the master record',
    };
    const labelled = () => members.map((m) => ({ label: LABELS[m] ?? m, value: m }));

    it('lit precondition: every served member is spellable, and each carries a human label', () => {
      for (const m of members) expect(spellable(m), m).toBe(true);
      for (const m of members) expect(LABELS[m], `no human label for '${m}'`).toBeDefined();
    });

    it('DARK — the labelled full list is GREEN, labels kept', () => {
      const form = formWithRow('object', { field: 'sharingModel', type: 'select', options: labelled() })();
      const row = form.sections![0]!.fields![0] as { options?: Array<{ label: string; value: string }> };
      expect(row.options).toEqual(labelled());
    });

    it('FIRING — the same list with one member re-spelled with a hyphen is REFUSED at that member', () => {
      const options = labelled().map((o) => (o.value === 'public_read' ? { ...o, value: 'public-read' } : o));
      const index = options.findIndex((o) => o.value === 'public-read');
      expect(index).toBeGreaterThanOrEqual(0);
      const issue = optionValueIssue(formWithRow('object', { field: 'sharingModel', type: 'select', options }), index);
      expect(issue.code).toBe('invalid_format');
    });
  });

  describe('a deliberate subset (`field.deleteBehavior` on a master_detail row, no `set_null`)', () => {
    const members = servedEnum('field', 'deleteBehavior');
    const SUBSET = [
      { label: 'Cascade (delete children)', value: 'cascade' },
      { label: 'Restrict (block the delete)', value: 'restrict' },
    ];

    it('lit precondition: the list is a PROPER subset of the served enum', () => {
      for (const { value } of SUBSET) expect(members, value).toContain(value);
      expect(members).toContain('set_null');
      expect(SUBSET.map((o) => o.value)).not.toContain('set_null');
    });

    it('DARK — the subset is GREEN, and is not widened to the enum', () => {
      const form = formWithRow('field', {
        field: 'deleteBehavior',
        type: 'select',
        visibleWhen: "data.type == 'master_detail'",
        options: SUBSET,
      })();
      const row = form.sections![0]!.fields![0] as { options?: Array<{ value: string }> };
      expect(row.options!.map((o) => o.value)).toEqual(['cascade', 'restrict']);
    });

    it('FIRING — the same subset with one member re-spelled with a capital is REFUSED at that member', () => {
      const options = SUBSET.map((o) => (o.value === 'cascade' ? { ...o, value: 'Cascade' } : o));
      const issue = optionValueIssue(formWithRow('field', {
        field: 'deleteBehavior',
        type: 'select',
        visibleWhen: "data.type == 'master_detail'",
        options,
      }), 0);
      expect(issue.code).toBe('invalid_format');
    });
  });
});

describe('the verdict did not move — the bound stays', () => {
  it('the form face refuses exactly what it refused before', () => {
    for (const { value } of UNSPELLABLE) {
      expect(FormSelectOptionSchema.safeParse({ label: 'Option', value }).success, value).toBe(false);
    }
    expect(FormSelectOptionSchema.safeParse({ label: 'New tab', value: 'new_tab' }).success).toBe(true);
  });

  it('a spellable inline option still builds', () => {
    const form = defineForm({
      schemaId: 'action',
      type: 'simple',
      sections: [{ label: 'Behavior', fields: [{ field: 'mode', options: [{ label: 'Custom', value: 'custom' }] }] }],
    });
    expect(form.data).toEqual({ provider: 'schema', schemaId: 'action' });
  });
});

describe('the remedy is scoped to a grammar refusal of an inline option value', () => {
  it('an unknown key on the option is answered without it', () => {
    const all = leaves(refusal(formWithOption('new_tab', { colour: 'red' })).issues as unknown as Issue[]);
    expect(all.some((i) => i.code === 'unrecognized_keys')).toBe(true);
    for (const issue of all) expect(namesDerivePath(issue.message), issue.message).toBe(false);
  });

  it('an unrelated refusal on the same form is answered without it', () => {
    const thrown = refusal(() => defineForm({ schemaId: 'action', type: 'no_such_layout' as never, sections: [] }));
    for (const issue of leaves(thrown.issues as unknown as Issue[])) {
      expect(namesDerivePath(issue.message), issue.message).toBe(false);
    }
  });
});

describe('the form field\'s `options` describe states ruling 乙\'s rule', () => {
  const served = z.toJSONSchema(FormFieldSchema, { io: 'input', unrepresentable: 'any' }) as {
    properties?: { options?: { description?: string } };
  };
  const text = served.properties?.options?.description ?? '';

  it('permits an inline list on an enum-typed metadata-form row, for human labels or a deliberate subset', () => {
    expect(text).toContain('`defineForm`');
    expect(text).toMatch(/enum-typed row may list its members/);
    expect(text).toContain('human labels');
    expect(text).toContain('deliberate subset');
  });

  it('names the derive path, scoped to a row whose members cannot be spelled', () => {
    expect(namesDerivePath(text), text).toBe(true);
    expect(scopesDeriveToUnspellable(text), text).toBe(true);
  });

  it('no longer states the blanket "a spec-enum row omits `options`" rule ruling 乙 narrowed away', () => {
    expect(statesBlanketOmitRule(text), text).toBe(false);
  });

  it('keeps the per-option `default` prescription it already carried', () => {
    expect(text).toContain('per-option `default`');
  });
});
