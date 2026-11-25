// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#37143 — the `related-list-entries` block under a context pack
 * (`ai_context`, ADR-0160 D1). The pack's `related` entries are
 * `{ object, field?, fields? }`: the add picker offers the relationships that
 * point at the pack's root, each entry's columns come from THAT child object,
 * and every value the block writes parses as a pack (`AiContextSchema`).
 */

// The source under test reaches these through dynamic imports: their first load is paid at collection.
import '@objectstack/formula';
import '@objectstack/lint';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { z } from 'zod';
import { AiContextSchema, aiContextForm } from '@objectstack/spec/ai';

/** The console's served objects: two children point at `policy`, one of them twice. */
const OBJECTS = [
  { name: 'policy', label: 'Policy', fields: { title: { type: 'text', label: 'Title' }, parent: { type: 'lookup', reference: 'policy', label: 'Parent policy' } } },
  { name: 'policy_revision', label: 'Policy revision', fields: { version: { type: 'text', label: 'Version' }, published_at: { type: 'datetime', label: 'Published' }, policy: { type: 'master_detail', reference: 'policy', label: 'Policy' } } },
  {
    name: 'acknowledgement',
    label: 'Acknowledgement',
    fields: [
      { name: 'signed_on', type: 'date', label: 'Signed on' },
      { name: 'policy', type: 'lookup', reference: 'policy', label: 'Policy' },
      { name: 'superseded_policy', type: 'lookup', reference: 'policy', label: 'Superseded policy' },
    ],
  },
  { name: 'account', label: 'Account', fields: { name: { type: 'text' } } },
];

/** The object list's load status, as the metadata context reports it (`getTypeStatus('object')`). */
const CATALOG = vi.hoisted(() => ({ status: 'ready' as string }));

vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadata: () => ({ objects: CATALOG.status === 'ready' ? OBJECTS : [], getTypeStatus: () => CATALOG.status }),
}));

/** Each child's own fields, as the draft-overlaid object read serves them. */
vi.mock('./previews/useObjectFields.js', () => ({
  useObjectFields: (name: string | undefined) => {
    const object = OBJECTS.find((o) => o.name === name);
    const raw = object?.fields ?? [];
    const fields = (Array.isArray(raw) ? raw : Object.entries(raw).map(([n, d]) => ({ name: n, ...(d as object) }))) as Array<{ name: string; label?: string; type: string }>;
    return { fields: fields.map((f) => ({ name: f.name, label: f.label ?? f.name, type: f.type, hidden: false })), loading: false, error: null };
  },
}));

import { WIDGETS } from './widgets';
import { compositeWith } from './SchemaForm';
import { contextPackLinks, isContextPackEntrySchema } from './ContextPackRelatedEntries';

afterEach(() => {
  cleanup();
  CATALOG.status = 'ready';
});

const Entries = WIDGETS['related-list-entries'];

/** The `related` node of the JSON Schema the server serves for `ai_context`. */
const PACK_SCHEMA = (z.toJSONSchema(AiContextSchema, { unrepresentable: 'any', io: 'input' }) as { properties: Record<string, any> }).properties;
const RELATED_SCHEMA = PACK_SCHEMA.related;

function relatedRow(): Record<string, unknown> | undefined {
  for (const section of aiContextForm.sections ?? []) {
    for (const f of section.fields ?? []) if ((f as { field?: string }).field === 'related') return f as never;
  }
  return undefined;
}

function renderBlock(value: unknown, onChange = vi.fn(), root: string | null = 'policy') {
  render(
    <Entries
      id="related"
      value={value}
      onChange={onChange}
      schema={RELATED_SCHEMA}
      fieldSpec={relatedRow() as never}
      formData={{ name: 'policy_document', label: 'Policy document', ...(root === null ? {} : { object: root }) }}
    />,
  );
  return onChange;
}

async function openAddList(): Promise<HTMLElement> {
  fireEvent.keyDown(screen.getByTestId('context-pack-add-list'), { key: 'ArrowDown' });
  return await screen.findByRole('listbox');
}

/** The pack the block's value makes, judged by the spec's own parse. */
function parsesAsPack(related: unknown): boolean {
  const pack = { name: 'policy_document', label: 'Policy document', object: 'policy', ...(related === undefined ? {} : { related }) };
  return AiContextSchema.safeParse(pack).success;
}

describe('context pack related lists (objectstack#37143)', () => {
  it('the served entry schema selects the pack face; the object form\'s does not', () => {
    expect(isContextPackEntrySchema(RELATED_SCHEMA)).toBe(true);
    expect(isContextPackEntrySchema({ type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'object', properties: { list: {} } }] } })).toBe(false);
    expect(isContextPackEntrySchema({})).toBe(false);
  });

  it('offers every reference field that points at the root, a self-reference and both links of one child included', async () => {
    expect(contextPackLinks('policy', OBJECTS).map((l) => `${l.object}.${l.field}`)).toEqual([
      'policy.parent',
      'policy_revision.policy',
      'acknowledgement.policy',
      'acknowledgement.superseded_policy',
    ]);
    renderBlock(undefined);
    const offered = within(await openAddList()).getAllByRole('option').map((o) => o.textContent);
    expect(offered).toHaveLength(4);
    expect(offered.some((t) => t?.includes('Account'))).toBe(false);
  });

  it('a picked relationship is written as { object, field }, and the value parses as a pack', async () => {
    const onChange = renderBlock(undefined);
    fireEvent.click(within(await openAddList()).getByRole('option', { name: /acknowledgement\.superseded_policy/ }));
    expect(onChange).toHaveBeenLastCalledWith([{ object: 'acknowledgement', field: 'superseded_policy' }]);
    expect(parsesAsPack(onChange.mock.lastCall![0])).toBe(true);
  });

  it('a related entry\'s columns are its child object\'s fields, not the root\'s', async () => {
    const onChange = renderBlock([{ object: 'policy_revision', field: 'policy', fields: ['version'] }]);
    fireEvent.keyDown(screen.getByTestId('context-pack-add-column-policy_revision'), { key: 'ArrowDown' });
    const offered = within(await screen.findByRole('listbox')).getAllByRole('option').map((o) => o.textContent);
    expect(offered.some((t) => t?.includes('published_at'))).toBe(true);
    expect(offered.some((t) => t?.includes('title'))).toBe(false);
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: /published_at/ }));
    expect(onChange).toHaveBeenLastCalledWith([{ object: 'policy_revision', field: 'policy', fields: ['version', 'published_at'] }]);
    expect(parsesAsPack(onChange.mock.lastCall![0])).toBe(true);
  });

  it('removing the last column removes the key; removing the last list removes `related`', () => {
    const onChange = renderBlock([{ object: 'policy_revision', field: 'policy', fields: ['version'] }]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove version' }));
    expect(onChange).toHaveBeenLastCalledWith([{ object: 'policy_revision', field: 'policy' }]);
    expect(parsesAsPack(onChange.mock.lastCall![0])).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Remove policy_revision' }));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
    expect(parsesAsPack(onChange.mock.lastCall![0])).toBe(true);
  });

  it('a stored entry the catalog shows no link for is kept and marked, and a listed link is not offered again', async () => {
    renderBlock([{ object: 'account' }, { object: 'policy_revision' }]);
    expect(screen.getByTestId('context-pack-unlinked-account')).toBeInTheDocument();
    expect(screen.queryByTestId('context-pack-unlinked-policy_revision')).toBeNull();
    const offered = within(await openAddList()).getAllByRole('option').map((o) => o.textContent);
    expect(offered.some((t) => t?.includes('policy_revision.policy'))).toBe(false);
  });

  it('stops adding at the schema\'s bound, and without a root offers nothing', () => {
    renderBlock([{ object: 'policy', field: 'parent' }, { object: 'policy_revision' }, { object: 'acknowledgement', field: 'policy' }]);
    expect(screen.getByTestId('context-pack-add-list')).toBeDisabled();
    cleanup();
    renderBlock(undefined, vi.fn(), null);
    expect(screen.getByTestId('context-pack-add-list')).toBeDisabled();
  });

  it('the add picker carries the host\'s id, so the row label names it', () => {
    renderBlock(undefined);
    expect(screen.getByTestId('context-pack-add-list')).toHaveAttribute('id', 'related');
  });

  it('while the object list loads, or after it failed, no stored entry is marked unlinked and the picker says why it is empty', () => {
    for (const status of ['loading', 'idle', 'error']) {
      CATALOG.status = status;
      renderBlock([{ object: 'policy_revision', field: 'policy' }, { object: 'account' }]);
      expect(screen.queryByTestId('context-pack-unlinked-account')).toBeNull();
      expect(screen.queryByTestId('context-pack-unlinked-policy_revision')).toBeNull();
      expect(screen.getByTestId('context-pack-add-list')).toBeDisabled();
      expect(screen.getByTestId('context-pack-add-list').textContent).not.toContain('No reference field');
      expect(screen.queryByTestId('context-pack-catalog-failed') !== null).toBe(status === 'error');
      cleanup();
    }
    CATALOG.status = 'ready';
    renderBlock([{ object: 'account' }]);
    expect(screen.getByTestId('context-pack-unlinked-account')).toBeInTheDocument();
  });
});

/**
 * The two other pickers of the form, emptied: a pack whose `fields` is `[]` or
 * whose `body` is `{ field: '' }` is refused at save with no way back in the
 * form, so an emptied value removes its key (L2 review S1 on #37315).
 */
describe('an emptied root picker removes its key (objectstack#37143)', () => {
  const FieldMulti = WIDGETS['field-multi'];
  const loaded = { status: 'loaded', data: [{ name: 'title', label: 'Title', type: 'text' }] } as never;

  it('removing the last root field of a pack writes no `fields`, and the pack parses', () => {
    expect(PACK_SCHEMA.fields.minItems).toBe(1);
    const onChange = vi.fn();
    render(<FieldMulti schema={PACK_SCHEMA.fields} value={['title']} onChange={onChange} context={{ objectFields: loaded } as never} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove title' }));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
    expect(AiContextSchema.safeParse({ name: 'p', label: 'P', object: 'policy', fields: onChange.mock.lastCall![0] }).success).toBe(true);
  });

  it('an array its schema lets be empty still writes []', () => {
    const onChange = vi.fn();
    render(<FieldMulti schema={{ type: 'array' }} value={['title']} onChange={onChange} context={{ objectFields: loaded } as never} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove title' }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('choosing "None" for the body field removes `body`; a composite requiring nothing keeps {}', () => {
    expect(PACK_SCHEMA.body.required).toEqual(['field']);
    const body = compositeWith({ field: 'summary' }, 'field', '', PACK_SCHEMA.body);
    expect(body).toBeUndefined();
    expect(AiContextSchema.safeParse({ name: 'p', label: 'P', object: 'policy', body }).success).toBe(true);
    expect(compositeWith({ field: 'summary' }, 'field', 'notes', PACK_SCHEMA.body)).toEqual({ field: 'notes' });
    expect(compositeWith({ a: 'x' }, 'a', undefined, { type: 'object', properties: { a: {} } })).toEqual({});
    expect(compositeWith({ a: 'x', b: 1 }, 'a', '', PACK_SCHEMA.body)).toEqual({ b: 1 });
  });
});
