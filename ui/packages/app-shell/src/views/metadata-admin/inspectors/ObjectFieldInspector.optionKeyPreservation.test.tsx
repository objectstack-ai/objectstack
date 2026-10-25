// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pins that a picklist option's `default` and `visibleWhen` SURVIVE a
 * read-edit-write round trip through the field designer (objectui#7540).
 *
 * The bug was silent data loss, and it started in the READER:
 *
 *   // readOptions -- the loss site
 *   return raw.map((o: any) => ({
 *     value: String(o?.value ?? ''),
 *     label: typeof o?.label === 'string' ? o.label : undefined,
 *     color: typeof o?.color === 'string' ? o.color : undefined,
 *   }));
 *
 * Three keys in, three keys out — so `default` and `visibleWhen` were already
 * gone by the time `patchOptions` ran, and no writer-only repair could have
 * carried them. An author opened any picklist field, edited any option, saved,
 * and both keys vanished from the document. Not a 422: the payload stayed
 * perfectly valid, just smaller than what the author wrote.
 *
 * Re-measured here on `@objectstack/spec` 17.2.0, controls lit first:
 *
 *   { value:'alpha', label:'A' }                      -> ACCEPT   (clean control)
 *   { value:'a',     label:'A' }                      -> REJECT too_small@[value]
 *   { value:'alpha', label:'A', default:true }        -> ACCEPT
 *   { value:'alpha', label:'A', visibleWhen:'x > 1' } -> ACCEPT, canonicalized to
 *                                                       {dialect:'cel',source:'x > 1'}
 *   { value:'alpha', label:'A', visibleWhen:true }    -> REJECT invalid_union@[visibleWhen]
 *   { value:'alpha', label:'A', zzz:1 }               -> REJECT unrecognized_keys@[]
 *
 * Two traps this file inherits rather than re-earning:
 *   • A select option's `value` must be at least 2 characters. A one-character
 *     value poisons every row with `too_small@[value]` and the rows actually
 *     about `visibleWhen` then say nothing — hence `alpha` / `beta`.
 *   • The BOOLEAN form of `visibleWhen` is refused; it is the STRING form that
 *     is accepted and canonicalized into the expression envelope.
 *
 * Every case is refusal-shaped: it asserts what the WRITTEN document carries
 * and ends at `SelectOptionSchema` / `FieldSchema`, never at "it compiles".
 * The suite also carries an emptiness control — a round trip that silently
 * returned no options at all would pass a naive "the lost key is not present
 * with a wrong value" assertion, so the option COUNT and the landed edit are
 * asserted before any key is inspected.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { SelectOptionSchema, FieldSchema } from '@objectstack/spec/data';

vi.mock('../useMetadata', () => ({
  useMetadataClient: () => ({
    list: vi.fn().mockResolvedValue([]),
    listDrafts: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: [], loading: false, error: null }),
}));

import { ObjectFieldInspector } from './ObjectFieldInspector';

afterEach(cleanup);

type Def = Record<string, unknown>;

function renderField(fields: Record<string, Def>, selectedId: string) {
  const onPatch = vi.fn();
  render(
    <ObjectFieldInspector
      type="object"
      name="probe_widget"
      draft={{ name: 'probe_widget', fields }}
      selection={{ kind: 'field', id: selectedId }}
      onPatch={onPatch}
      onClearSelection={vi.fn()}
      onSelectionChange={vi.fn()}
      readOnly={false}
      locale={'en-US'}
    />,
  );
  /** The fields map the host's Save would persist after the last edit. */
  const savedFields = () => onPatch.mock.calls.at(-1)![0].fields as Record<string, Def>;
  return { onPatch, savedFields };
}

/** The option list the designer would persist for `status`. */
const savedOptions = (fields: Record<string, Def>): Def[] =>
  (fields.status as { options?: Def[] }).options ?? [];

/** The whole field as the PUT body carries it (record key -> `name`). */
const savedField = (fields: Record<string, Def>): Def => ({ name: 'status', ...fields.status });

/** The structural slice of a Zod schema this file needs -- no `any` (AGENTS.md #6). */
type SpecIssue = { code: string; path: ReadonlyArray<PropertyKey> };
type SpecSchema = {
  safeParse: (value: unknown) => { success: boolean; error?: { issues: SpecIssue[] } };
};

/** Every issue the contract raises, as `code@[path]`, for readable failures. */
const rejectionsOf = (schema: SpecSchema, doc: unknown): string[] => {
  const r = schema.safeParse(doc);
  return r.success ? [] : (r.error?.issues ?? []).map((i) => `${i.code}@[${i.path.join('.')}]`);
};

const selectField = (options: Def[]): Record<string, Def> => ({
  status: { type: 'select', label: 'Status', options },
});

/** Edit the Label box of row `i` -- the round trip every case drives. */
const editLabel = (i: number, to: string) =>
  fireEvent.change(screen.getAllByPlaceholderText('Label')[i], { target: { value: to } });

describe('ObjectFieldInspector · the option editor stops dropping `default` (objectui#7540)', () => {
  it('`default: true` on an UNTOUCHED row survives an edit to another row', () => {
    const { savedFields } = renderField(
      selectField([
        { value: 'alpha', label: 'Alpha', default: true },
        { value: 'beta', label: 'Beta' },
      ]),
      'status',
    );

    editLabel(1, 'Beta II');

    const options = savedOptions(savedFields());
    // EMPTINESS CONTROL, asserted before any key is inspected: a round trip
    // that silently wrote no options at all would satisfy "the key does not
    // hold a wrong value" vacuously. Both rows must still be there.
    expect(options).toHaveLength(2);
    // And the edit really landed -- so what follows measures a real round
    // trip, not a render that never called the writer.
    expect(options[1].label).toBe('Beta II');

    expect(options[0].default).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(options[0], 'default')).toBe(true);
  });

  it('`default: true` survives on the very row being edited', () => {
    const { savedFields } = renderField(
      selectField([{ value: 'alpha', label: 'Alpha', default: true, color: '#ff0000' }]),
      'status',
    );

    editLabel(0, 'Alpha II');

    const [option] = savedOptions(savedFields());
    expect(option).toEqual({
      value: 'alpha',
      label: 'Alpha II',
      color: '#ff0000',
      default: true,
    });
  });

  it('the written option is ACCEPTED by SelectOptionSchema and FieldSchema', () => {
    const { savedFields } = renderField(
      selectField([
        { value: 'alpha', label: 'Alpha', default: true },
        { value: 'beta', label: 'Beta' },
      ]),
      'status',
    );

    editLabel(1, 'Beta II');

    const fields = savedFields();
    for (const option of savedOptions(fields)) {
      expect(rejectionsOf(SelectOptionSchema, option)).toEqual([]);
    }
    expect(rejectionsOf(FieldSchema, savedField(fields))).toEqual([]);
  });
});

describe('ObjectFieldInspector · the option editor stops dropping `visibleWhen` (objectui#7540)', () => {
  it('the STRING form survives verbatim, and the contract canonicalizes it', () => {
    const { savedFields } = renderField(
      selectField([
        { value: 'alpha', label: 'Alpha', visibleWhen: 'record.tier == 2' },
        { value: 'beta', label: 'Beta' },
      ]),
      'status',
    );

    editLabel(1, 'Beta II');

    const options = savedOptions(savedFields());
    expect(options).toHaveLength(2);
    expect(options[1].label).toBe('Beta II');
    // Written back exactly as authored -- the editor carries, it does not
    // rewrite. The canonicalization into the expression envelope is the
    // CONTRACT's job, and the parsed result below shows it still happens.
    expect(options[0].visibleWhen).toBe('record.tier == 2');

    const parsed = SelectOptionSchema.safeParse(options[0]);
    expect(parsed.success).toBe(true);
    expect((parsed as { data: Def }).data.visibleWhen).toEqual({
      dialect: 'cel',
      source: 'record.tier == 2',
    });
  });

  it('the ENVELOPE form survives verbatim', () => {
    const { savedFields } = renderField(
      selectField([
        {
          value: 'alpha',
          label: 'Alpha',
          visibleWhen: { dialect: 'cel', source: 'record.tier == 2' },
        },
        { value: 'beta', label: 'Beta' },
      ]),
      'status',
    );

    editLabel(1, 'Beta II');

    const options = savedOptions(savedFields());
    expect(options).toHaveLength(2);
    expect(options[0].visibleWhen).toEqual({ dialect: 'cel', source: 'record.tier == 2' });
    expect(rejectionsOf(FieldSchema, savedField(savedFields()))).toEqual([]);
  });

  it('both keys ride together on one option, alongside the displayed ones', () => {
    const { savedFields } = renderField(
      selectField([
        {
          value: 'alpha',
          label: 'Alpha',
          color: '#00ff00',
          default: true,
          visibleWhen: 'record.tier == 2',
        },
      ]),
      'status',
    );

    editLabel(0, 'Alpha II');

    const [option] = savedOptions(savedFields());
    expect(option).toEqual({
      value: 'alpha',
      label: 'Alpha II',
      color: '#00ff00',
      default: true,
      visibleWhen: 'record.tier == 2',
    });
    expect(rejectionsOf(FieldSchema, savedField(savedFields()))).toEqual([]);
  });
});

describe('ObjectFieldInspector · the option round trip is measured, not assumed (objectui#7540)', () => {
  it('the editor-internal carrier never reaches the document', () => {
    // `readOptions` parks the keys it has no control for on an internal `rest`
    // slot of its row type. That slot is NOT a document key: `SelectOptionSchema`
    // is strict, so leaking it would 422 every save. Assert the exact key set,
    // which a `hasOwnProperty('default')` check alone would not catch.
    const { savedFields } = renderField(
      selectField([{ value: 'alpha', label: 'Alpha', default: true }]),
      'status',
    );

    editLabel(0, 'Alpha II');

    const [option] = savedOptions(savedFields());
    expect(Object.keys(option).sort()).toEqual(['default', 'label', 'value']);
    expect(Object.prototype.hasOwnProperty.call(option, 'rest')).toBe(false);
  });

  it('the ACCEPTs above are not vacuous — the contract does refuse things', () => {
    // Lit controls. Without these, every `toEqual([])` above could be green
    // against a schema that waves everything through.
    expect(rejectionsOf(SelectOptionSchema, { value: 'alpha', label: 'A' })).toEqual([]);
    expect(rejectionsOf(SelectOptionSchema, { value: 'a', label: 'A' })).toEqual([
      'too_small@[value]',
    ]);
    expect(rejectionsOf(SelectOptionSchema, { value: 'alpha', label: 'A', zzz: 1 })).toEqual([
      'unrecognized_keys@[]',
    ]);
    // The boolean form is REFUSED; the string form is what canonicalizes.
    expect(rejectionsOf(SelectOptionSchema, { value: 'alpha', label: 'A', visibleWhen: true })).toEqual([
      'invalid_union@[visibleWhen]',
    ]);
    // And at the field level, where this editor's payload is actually judged.
    expect(
      rejectionsOf(FieldSchema, {
        name: 'status',
        type: 'select',
        label: 'Status',
        options: [{ value: 'alpha', label: 'A', zzz: 1 }],
      }),
    ).toEqual(['unrecognized_keys@[options.0]']);
  });

  it('an option with nothing extra is written exactly as before the repair', () => {
    // Guards the other direction: carrying unknown keys must not have added a
    // key, reordered the shape, or otherwise disturbed the plain case that
    // objectui#7014 Q2 already pinned.
    const { savedFields } = renderField(selectField([{ value: 'alpha', label: 'Alpha' }]), 'status');

    editLabel(0, 'Alpha II');

    expect(savedOptions(savedFields())).toEqual([{ value: 'alpha', label: 'Alpha II' }]);
  });

  it('a key the spec refuses is CARRIED, not silently laundered', () => {
    // A deliberate consequence of preserving what the editor does not display,
    // and the same contract `readFields` keeps one level up for field keys.
    //
    // The document below is ALREADY illegal before the inspector is opened --
    // asserted here, so this case cannot be read as the editor creating a 422.
    // It declines to hide one. Silently dropping `zzz` would rewrite an
    // author's document behind their back on a read they did not ask for, and
    // there is no retired OPTION key for which that laundering is owed: every
    // entry in the retired-key tombstone registry is FIELD-level, and this
    // editor has only ever written `value` / `label` / `color`.
    const authored = { value: 'alpha', label: 'Alpha', zzz: 1 };
    expect(rejectionsOf(SelectOptionSchema, authored)).toEqual(['unrecognized_keys@[]']);

    const { savedFields } = renderField(selectField([authored]), 'status');

    editLabel(0, 'Alpha II');

    const [option] = savedOptions(savedFields());
    expect(option.zzz).toBe(1);
  });
});
