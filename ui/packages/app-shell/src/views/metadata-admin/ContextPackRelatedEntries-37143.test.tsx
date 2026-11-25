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

vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadata: () => ({ objects: OBJECTS }),
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
import { contextPackLinks, isContextPackEntrySchema } from './ContextPackRelatedEntries';

afterEach(cleanup);

const Entries = WIDGETS['related-list-entries'];

/** The `related` node of the JSON Schema the server serves for `ai_context`. */
const RELATED_SCHEMA = (z.toJSONSchema(AiContextSchema, { unrepresentable: 'any', io: 'input' }) as { properties: Record<string, any> }).properties.related;

function relatedRow(): Record<string, unknown> | undefined {
  for (const section of aiContextForm.sections ?? []) {
    for (const f of section.fields ?? []) if ((f as { field?: string }).field === 'related') return f as never;
  }
  return undefined;
}

function renderBlock(value: unknown, onChange = vi.fn(), root: string | undefined = 'policy') {
  render(
    <Entries
      id="related"
      value={value}
      onChange={onChange}
      schema={RELATED_SCHEMA}
      fieldSpec={relatedRow() as never}
      formData={{ name: 'policy_document', label: 'Policy document', object: root }}
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
    renderBlock(undefined, vi.fn(), undefined);
    expect(screen.getByTestId('context-pack-add-list')).toBeDisabled();
  });

  it('the add picker carries the host\'s id, so the row label names it', () => {
    renderBlock(undefined);
    expect(screen.getByTestId('context-pack-add-list')).toHaveAttribute('id', 'related');
  });
});
