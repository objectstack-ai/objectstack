// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  isTitleEligible,
  resolveDisplayField,
  resolveRecordDisplayName,
  provisionPrimary,
  objectTitleCompleteness,
  TITLE_ELIGIBLE,
  TITLE_ELIGIBLE_TYPES,
  TITLE_INELIGIBLE_TYPES,
} from './display-name';

describe('isTitleEligible', () => {
  it('accepts text-ish types', () => {
    for (const type of ['text', 'textarea', 'email', 'url', 'markdown', 'html', 'richtext']) {
      expect(isTitleEligible({ type })).toBe(true);
    }
  });

  it('excludes the ineligible type set (date/number/boolean/media/relational/choice/system)', () => {
    const excluded = [
      'date', 'datetime', 'time',
      'number', 'currency', 'percent',
      'boolean', 'toggle',
      'file', 'image', 'avatar', 'attachment', 'signature',
      'json', 'code', 'composite', 'repeater', 'record', 'vector',
      'geolocation', 'location',
      'select', 'multiselect', 'multi_select', 'radio', 'checkboxes', 'tags', 'color', 'rating', 'slider', 'progress',
      'lookup', 'master_detail', 'tree', 'user',
      'autonumber', 'password', 'secret',
    ];
    for (const type of excluded) {
      expect(isTitleEligible({ type }), `${type} should be ineligible`).toBe(false);
    }
  });

  it('email IS eligible but phone is NOT', () => {
    expect(isTitleEligible({ type: 'email' })).toBe(true);
    expect(isTitleEligible({ type: 'phone' })).toBe(false);
  });

  it('formula eligible only when result type (returnType) is text', () => {
    expect(isTitleEligible({ type: 'formula', returnType: 'text' })).toBe(true);
    expect(isTitleEligible({ type: 'formula', returnType: 'number' })).toBe(false);
    expect(isTitleEligible({ type: 'formula', returnType: 'date' })).toBe(false);
    expect(isTitleEligible({ type: 'formula' })).toBe(false); // unknown result type
  });

  it('formula also reads valueType as a fallback', () => {
    expect(isTitleEligible({ type: 'formula', valueType: 'text' })).toBe(true);
    expect(isTitleEligible({ type: 'formula', valueType: 'number' })).toBe(false);
  });

  it('unknown/new field types are ineligible (fail-closed allowlist)', () => {
    expect(isTitleEligible({ type: 'some_future_widget' })).toBe(false);
    expect(isTitleEligible({})).toBe(false);
    expect(isTitleEligible(undefined)).toBe(false);
    expect(isTitleEligible(null)).toBe(false);
  });

  it('eligible/ineligible sets do not overlap', () => {
    for (const t of TITLE_ELIGIBLE_TYPES) expect(TITLE_INELIGIBLE_TYPES.has(t)).toBe(false);
    expect(TITLE_ELIGIBLE).toBe(TITLE_ELIGIBLE_TYPES);
  });
});

describe('resolveDisplayField — explicit pointer precedence', () => {
  it('prefers nameField over displayNameField over derivation', () => {
    expect(resolveDisplayField({
      nameField: 'a', displayNameField: 'b',
      fields: { a: { type: 'text' }, b: { type: 'text' }, name: { type: 'text' } },
    })).toBe('a');
  });

  it('falls back to displayNameField (deprecated alias) when nameField absent', () => {
    expect(resolveDisplayField({
      displayNameField: 'b',
      fields: { b: { type: 'text' }, name: { type: 'text' } },
    })).toBe('b');
  });

  it('honors an explicit pointer even when the target is not title-eligible', () => {
    // author asserted it — eligibility gates DERIVATION only
    expect(resolveDisplayField({ nameField: 'amount', fields: { amount: { type: 'currency' } } })).toBe('amount');
  });

  it('returns undefined for null/empty meta', () => {
    expect(resolveDisplayField(undefined)).toBeUndefined();
    expect(resolveDisplayField({})).toBeUndefined();
    expect(resolveDisplayField({ fields: {} })).toBeUndefined();
  });
});

describe('resolveDisplayField — derivation ranking', () => {
  it('tier 1: name-ish exact wins over a non-name title-eligible field', () => {
    expect(resolveDisplayField({
      fields: { description: { type: 'text' }, title: { type: 'text' } },
    })).toBe('title');
  });

  it('tier 1: `name` beats `title`/`subject` regardless of declaration order', () => {
    expect(resolveDisplayField({
      fields: { subject: { type: 'text' }, title: { type: 'text' }, name: { type: 'text' } },
    })).toBe('name');
  });

  it('tier 1: full_name / display_name are recognized exacts', () => {
    expect(resolveDisplayField({ fields: { display_name: { type: 'text' }, foo: { type: 'text' } } })).toBe('display_name');
    expect(resolveDisplayField({ fields: { foo: { type: 'text' }, full_name: { type: 'text' } } })).toBe('full_name');
  });

  it('tier 2: name-ish affix (*_name, *_title, name_*) beats a generic field', () => {
    expect(resolveDisplayField({
      fields: { notes: { type: 'text' }, account_name: { type: 'text' } },
    })).toBe('account_name');
    expect(resolveDisplayField({
      fields: { notes: { type: 'text' }, job_title: { type: 'text' } },
    })).toBe('job_title');
    expect(resolveDisplayField({
      fields: { notes: { type: 'text' }, name_en: { type: 'text' } },
    })).toBe('name_en');
  });

  it('tier 1 outranks tier 2 (exact `name` beats `*_name` affix)', () => {
    expect(resolveDisplayField({
      fields: { company_name: { type: 'text' }, name: { type: 'text' } },
    })).toBe('name');
  });

  it('tier 3: first title-eligible field by declaration order when no name-ish field', () => {
    expect(resolveDisplayField({
      fields: {
        created: { type: 'datetime' },   // ineligible
        amount: { type: 'currency' },    // ineligible
        notes: { type: 'text' },         // first eligible
        extra: { type: 'text' },
      },
    })).toBe('notes');
  });

  it('derives a formula→text field when nothing else is eligible', () => {
    expect(resolveDisplayField({
      fields: { qty: { type: 'number' }, computed_label: { type: 'formula', returnType: 'text' } },
    })).toBe('computed_label');
  });

  it('returns undefined when no field is title-eligible', () => {
    expect(resolveDisplayField({
      fields: { amount: { type: 'currency' }, when: { type: 'date' }, status: { type: 'select' }, ref: { type: 'lookup' } },
    })).toBeUndefined();
  });
});

describe('resolveRecordDisplayName', () => {
  const meta = { fields: { name: { type: 'text' } } };

  it('uses the resolved display field value', () => {
    expect(resolveRecordDisplayName(meta, { id: '7', name: 'Acme' })).toBe('Acme');
  });

  it('viewTitleField overrides the resolved field', () => {
    expect(resolveRecordDisplayName(meta, { id: '7', name: 'Acme', code: 'AC-1' }, { viewTitleField: 'code' })).toBe('AC-1');
  });

  it('falls back to `Record #<id>` on null/empty value (never bare "Untitled")', () => {
    expect(resolveRecordDisplayName(meta, { id: '7', name: '' })).toBe('Record #7');
    expect(resolveRecordDisplayName(meta, { id: '7', name: '   ' })).toBe('Record #7');
    expect(resolveRecordDisplayName(meta, { id: '7' })).toBe('Record #7');
  });

  it('uses _id when id is absent', () => {
    expect(resolveRecordDisplayName(meta, { _id: 'abc' })).toBe('Record #abc');
  });

  it('floors to `Record #` with no id rather than throwing or "Untitled"', () => {
    expect(resolveRecordDisplayName(meta, {})).toBe('Record #');
    expect(resolveRecordDisplayName(meta, null)).toBe('Record #');
  });

  it('non-string values stringify', () => {
    expect(resolveRecordDisplayName({ fields: { count: { type: 'text' } } }, { count: 42 })).toBe('42');
  });
});

describe('provisionPrimary', () => {
  it('DESIGNATES an existing derivable title (sets nameField, no synthesis)', () => {
    const out = provisionPrimary({ fields: { title: { type: 'text' }, notes: { type: 'text' } } });
    expect(out.nameField).toBe('title');
    expect(Object.keys(out.fields!)).toEqual(['title', 'notes']); // no field added
  });

  it('respects an explicit pointer (designates nameField from displayNameField alias)', () => {
    const out = provisionPrimary({ displayNameField: 'subject', fields: { subject: { type: 'text' } } });
    expect(out.nameField).toBe('subject');
  });

  it('SYNTHESIZES a `name` text field when nothing is title-eligible', () => {
    const out = provisionPrimary({ fields: { amount: { type: 'currency' }, when: { type: 'date' } } });
    expect(out.nameField).toBe('name');
    expect(out.fields!.name).toMatchObject({ type: 'text' });
    expect(Object.keys(out.fields!)).toContain('amount');
  });

  it('synthesizes `name` for an object with no fields at all', () => {
    const out = provisionPrimary({ name: 'thing' });
    expect(out.nameField).toBe('name');
    expect(out.fields!.name).toMatchObject({ type: 'text' });
  });

  it('is idempotent — a second pass is a no-op and returns the same instance', () => {
    const once = provisionPrimary({ fields: { title: { type: 'text' } } });
    const twice = provisionPrimary(once);
    expect(twice).toBe(once);
    expect(twice.nameField).toBe('title');

    const synthOnce = provisionPrimary({ fields: { amount: { type: 'currency' } } });
    const synthTwice = provisionPrimary(synthOnce);
    expect(synthTwice.nameField).toBe('name');
    expect(Object.keys(synthTwice.fields!).filter((k) => k === 'name')).toHaveLength(1);
  });

  it('does not mutate the input object', () => {
    const input = { fields: { amount: { type: 'currency' } } };
    const out = provisionPrimary(input);
    expect(input.nameField).toBeUndefined();
    expect((input.fields as Record<string, unknown>).name).toBeUndefined();
    expect(out).not.toBe(input);
  });

  it('synthesize:true is the explicit default (synthesizes when nothing eligible)', () => {
    const out = provisionPrimary({ fields: { amount: { type: 'currency' } } }, { synthesize: true });
    expect(out.nameField).toBe('name');
    expect(out.fields!.name).toMatchObject({ type: 'text' });
  });
});

describe('provisionPrimary — designate-only (synthesize: false)', () => {
  it('DESIGNATES an existing derivable title (sets nameField, no column added)', () => {
    const out = provisionPrimary(
      { fields: { notes: { type: 'text' }, title: { type: 'text' } } },
      { synthesize: false },
    );
    expect(out.nameField).toBe('title');
    expect(Object.keys(out.fields!)).toEqual(['notes', 'title']); // no field added
  });

  it('DESIGNATES a `*_name` affix text field (e.g. account_name)', () => {
    const out = provisionPrimary(
      { fields: { notes: { type: 'text' }, account_name: { type: 'text' } } },
      { synthesize: false },
    );
    expect(out.nameField).toBe('account_name');
    expect(Object.keys(out.fields!)).toEqual(['notes', 'account_name']);
  });

  it('honors an existing explicit pointer (designates nameField from displayNameField alias)', () => {
    const out = provisionPrimary(
      { displayNameField: 'subject', fields: { subject: { type: 'text' } } },
      { synthesize: false },
    );
    expect(out.nameField).toBe('subject');
  });

  it('leaves a title-LESS object UNCHANGED — no `name` synthesized, same instance', () => {
    const input = { fields: { amount: { type: 'currency' }, when: { type: 'date' } } };
    const out = provisionPrimary(input, { synthesize: false });
    expect(out).toBe(input); // returned as-is
    expect(out.nameField).toBeUndefined();
    expect((out.fields as Record<string, unknown>).name).toBeUndefined();
    expect(Object.keys(out.fields!)).toEqual(['amount', 'when']);
  });

  it('leaves a FIELDLESS object UNCHANGED — no `name` added', () => {
    const input = { name: 'sys_thing' };
    const out = provisionPrimary(input, { synthesize: false });
    expect(out).toBe(input);
    expect((out as { nameField?: string }).nameField).toBeUndefined();
    expect((out as { fields?: unknown }).fields).toBeUndefined();
  });

  it('is idempotent in designate-only mode', () => {
    const once = provisionPrimary({ fields: { title: { type: 'text' } } }, { synthesize: false });
    const twice = provisionPrimary(once, { synthesize: false });
    expect(twice).toBe(once);
    expect(twice.nameField).toBe('title');
  });

  it('does not mutate the input in designate-only mode', () => {
    const input = { fields: { name: { type: 'text' } } };
    const out = provisionPrimary(input, { synthesize: false });
    expect(input.nameField).toBeUndefined(); // input untouched
    expect(out.nameField).toBe('name');
    expect(out).not.toBe(input);
  });
});

describe('objectTitleCompleteness', () => {
  it('explicit — pointer present and field exists', () => {
    expect(objectTitleCompleteness({ nameField: 'title', fields: { title: { type: 'text' } } }))
      .toEqual({ status: 'explicit', field: 'title' });
  });

  it('explicit via deprecated displayNameField alias', () => {
    expect(objectTitleCompleteness({ displayNameField: 'subject', fields: { subject: { type: 'text' } } }))
      .toEqual({ status: 'explicit', field: 'subject' });
  });

  it('synthesized — pointer set but the field is not in fields (runtime must materialize)', () => {
    expect(objectTitleCompleteness({ nameField: 'name', fields: { amount: { type: 'currency' } } }))
      .toEqual({ status: 'synthesized', field: 'name' });
  });

  it('derived — no pointer but a title-eligible field is derivable', () => {
    expect(objectTitleCompleteness({ fields: { notes: { type: 'text' } } }))
      .toEqual({ status: 'derived', field: 'notes' });
  });

  it('none — no pointer and nothing derivable', () => {
    expect(objectTitleCompleteness({ fields: { amount: { type: 'currency' }, when: { type: 'date' } } }))
      .toEqual({ status: 'none' });
    expect(objectTitleCompleteness(undefined)).toEqual({ status: 'none' });
  });

  // [#16663] PROVENANCE — the collapse the `status` declaration warns about,
  // pinned WITH a control. `provisionPrimary(…, { synthesize: false })` is the
  // designation a `/meta` read exit replays onto every served object body, so
  // two authored bodies a reader would call "designated" and "not designated"
  // reach this predicate as one body and grade identically. The control is the
  // half that proves the pair really runs the designation: a pointer the
  // derivation would NOT have picked survives it and stays distinguishable.
  const bySortedKeys = (o: object): string =>
    JSON.stringify(Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b))));

  it('provenance — after the read-exit designation, an authored pointer and a derived one collapse', () => {
    const fields = {
      visit_title: { type: 'text' },
      pet: { type: 'text' },
      visited_at: { type: 'date' },
    };
    const authored = { nameField: 'visit_title', fields };
    const unauthored = { fields };

    // BEFORE the designation — a pre-write body still separates the two.
    expect(objectTitleCompleteness(authored)).toEqual({ status: 'explicit', field: 'visit_title' });
    expect(objectTitleCompleteness(unauthored)).toEqual({ status: 'derived', field: 'visit_title' });

    // AFTER it — which is what a `/meta` read exit serves — it cannot.
    const servedAuthored = provisionPrimary(authored, { synthesize: false });
    const servedUnauthored = provisionPrimary(unauthored, { synthesize: false });
    expect(objectTitleCompleteness(servedAuthored)).toEqual({ status: 'explicit', field: 'visit_title' });
    expect(objectTitleCompleteness(servedUnauthored)).toEqual({ status: 'explicit', field: 'visit_title' });
    expect(bySortedKeys(servedUnauthored)).toBe(bySortedKeys(servedAuthored));
  });

  it('provenance CONTROL — a pointer the derivation would not pick does NOT collapse', () => {
    const fields = { note: { type: 'text' }, case_title: { type: 'text' } };
    const authored = { nameField: 'note', fields };
    const unauthored = { fields };

    const servedAuthored = provisionPrimary(authored, { synthesize: false });
    const servedUnauthored = provisionPrimary(unauthored, { synthesize: false });
    expect(objectTitleCompleteness(servedAuthored)).toEqual({ status: 'explicit', field: 'note' });
    expect(objectTitleCompleteness(servedUnauthored)).toEqual({ status: 'explicit', field: 'case_title' });
    expect(bySortedKeys(servedUnauthored)).not.toBe(bySortedKeys(servedAuthored));
  });
});
