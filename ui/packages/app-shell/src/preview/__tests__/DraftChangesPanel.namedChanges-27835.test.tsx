// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27835 — the publish panel listed what a change touches as raw
 * keys: "+ label + name + sharingModel" for a new object, "+ config + isDefault
 * + viewKind" for a new view, "+ fieldGroups + validations" for an object edit,
 * with no word for which rule moved.
 *
 * Now a property reads as the label its item type's form gives it (the spec's
 * `METADATA_FORM_REGISTRY`, the form the inspector renders), its key beside it
 * only where the label does not already spell it; a property the form has no
 * row for keeps its key. A view is compared one level down, inside `config`,
 * where its inspector edits it. A list of named entries (`validations` by
 * `name`, `fieldGroups` by `key`) names each entry it adds, changes or removes,
 * by its label, as a flow names its nodes.
 *
 * Controls: a list of plain strings stays one key row; a flow's lists are still
 * only its nodes; a property no form row names reads as its key.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (_k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? _k,
    language: 'en',
  }),
}));

import { DraftChangesPanel, computeChangeDetail } from '../DraftChangesPanel';
import { formKeyLabel } from '../changeKeyLabels';

const HOURS_RULE = {
  name: 'hours_over_40',
  label: 'Hours over 40',
  type: 'script',
  condition: 'hours > 40',
  message: 'A week holds at most 40 hours',
};
const DISCOUNT_RULE = { name: 'max_discount', type: 'script', condition: 'discount > 0.4', message: 'Too much' };
const OLD_RULE = { name: 'legacy_check', label: 'Legacy check', type: 'script', condition: 'false', message: 'x' };

const PUBLISHED_OBJECT = {
  name: 'work_order',
  label: 'Work Order',
  fields: { hours: { type: 'number', label: 'Hours' } },
  validations: [DISCOUNT_RULE, OLD_RULE],
  fieldGroups: [{ key: 'basics', label: 'Basics' }],
  highlightFields: ['hours'],
};
const DRAFT_OBJECT = {
  ...PUBLISHED_OBJECT,
  validations: [{ ...DISCOUNT_RULE, condition: 'discount > 0.5' }, HOURS_RULE],
  fieldGroups: [{ key: 'basics', label: 'Basics', collapse: 'collapsed' }],
  highlightFields: ['hours', 'name'],
};

const NEW_VIEW = {
  name: 'work_order_list',
  object: 'work_order',
  viewKind: 'list',
  label: 'Work Order list',
  isDefault: true,
  config: { type: 'grid', columns: ['name', 'hours'], data: { provider: 'object', object: 'work_order' } },
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('a property reads as its label on the item type form (objectstack#27835)', () => {
  it('names an object property, a field property and a view body property by the form row', () => {
    expect(formKeyLabel('object', 'sharingModel')).toBe('Sharing Model');
    expect(formKeyLabel('object', 'validations')).toBe('Validations');
    expect(formKeyLabel('field', 'required')).toBe('Required');
    expect(formKeyLabel('view', 'config.columns')).toBe('Columns');
    expect(formKeyLabel('flow', 'edges')).toBe('Edges');
  });

  it('a declared sub-row label wins over the prettified key', () => {
    // `fieldGroups` declares its sub-rows; `relatedList` is labelled "Related List".
    expect(formKeyLabel('object', 'fieldGroups.relatedList')).toBe('Related List');
    expect(formKeyLabel('object', 'fieldGroups.collapse')).toBe('Collapse');
  });

  it('CONTROL: a property no form row names has no label', () => {
    expect(formKeyLabel('view', 'viewKind')).toBeUndefined();
    expect(formKeyLabel('object', 'no_such_key')).toBeUndefined();
    expect(formKeyLabel('no_such_type', 'label')).toBeUndefined();
  });
});

describe('computeChangeDetail names the entries of a named list (objectstack#27835)', () => {
  it('lists the rule added, the rule changed with its property, and the rule removed', () => {
    const d = computeChangeDetail(PUBLISHED_OBJECT, DRAFT_OBJECT, 'object');
    expect(d.keys.changed).toEqual(['fieldGroups', 'highlightFields', 'validations']);
    expect(d.entries.get('validations')).toEqual({
      added: [{ id: 'hours_over_40', label: 'Hours over 40' }],
      changed: [{ id: 'max_discount', keys: ['condition'] }],
      removed: [{ id: 'legacy_check', label: 'Legacy check' }],
    });
    expect(d.entries.get('fieldGroups')).toEqual({
      added: [],
      changed: [{ id: 'basics', label: 'Basics', keys: ['collapse'] }],
      removed: [],
    });
  });

  it('CONTROL: a list of plain strings stays one key row with no entries', () => {
    const d = computeChangeDetail(PUBLISHED_OBJECT, DRAFT_OBJECT, 'object');
    expect(d.entries.has('highlightFields')).toBe(false);
  });

  it('a NEW object adds every rule', () => {
    const d = computeChangeDetail(null, DRAFT_OBJECT, 'object');
    expect(d.entries.get('validations')?.added.map((e) => e.id)).toEqual(['hours_over_40', 'max_discount']);
  });

  it('CONTROL: a flow names only its nodes, never another list', () => {
    const before = { name: 'f', nodes: [], edges: [{ id: 'e1', name: 'e1' }] };
    const after = { name: 'f', nodes: [], edges: [{ id: 'e1', name: 'e1' }, { id: 'e2', name: 'e2' }] };
    expect(computeChangeDetail(before, after, 'flow').entries.size).toBe(0);
  });
});

describe('computeChangeDetail compares a view inside its body (objectstack#27835)', () => {
  it('a NEW view lists its body properties, not one `config` key', () => {
    const d = computeChangeDetail(null, NEW_VIEW, 'view');
    expect(d.keys.added).toEqual([
      'config.columns',
      'config.data',
      'config.type',
      'isDefault',
      'label',
      'name',
      'object',
      'viewKind',
    ]);
  });

  it('a view edit names the body property that changed', () => {
    const draft = { ...NEW_VIEW, config: { ...NEW_VIEW.config, columns: ['name'] } };
    expect(computeChangeDetail(NEW_VIEW, draft, 'view').keys).toEqual({
      added: [],
      changed: ['config.columns'],
      removed: [],
    });
  });

  it('CONTROL: an item that is not a view compares `config` whole', () => {
    const draft = { ...NEW_VIEW, config: { ...NEW_VIEW.config, columns: ['name'] } };
    expect(computeChangeDetail(NEW_VIEW, draft, 'page').keys.changed).toEqual(['config']);
  });
});

/* ─────────────── the panel ─────────────── */

function stubServer(type: string, name: string, label: string, published: unknown, draft: unknown) {
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/_drafts')) return ok({ drafts: [{ type, name, packageId: 'com.x', label }] });
      if (new RegExp(`/meta/${type}s?(\\?|$)`).test(url)) return ok(published ? [{ name }] : []);
      if (new RegExp(`/meta/${type}s?/${name}\\b`).test(url)) {
        if (url.includes('state=draft')) return ok({ item: draft });
        return published ? ok(published) : { ok: false, status: 404, json: async () => ({}) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    }) as unknown as typeof fetch,
  );
}

async function openDetail(label: string): Promise<HTMLElement> {
  render(<DraftChangesPanel open onOpenChange={() => {}} packageId="com.x" />);
  const toggle = (await screen.findByText(label)).closest('[data-testid="draft-entry-toggle"]') as HTMLElement;
  fireEvent.click(toggle);
  return screen.findByTestId('draft-entry-detail');
}

describe('the publish drill-in names each change in words (objectstack#27835)', () => {
  it('names each validation rule under its list, by its label', async () => {
    stubServer('object', 'work_order', 'Work Order', PUBLISHED_OBJECT, DRAFT_OBJECT);
    const detail = await openDetail('Work Order');

    const keyRows = await within(detail).findAllByTestId('draft-key-row');
    const validations = keyRows.find((r) => r.textContent?.startsWith('~ Validations'))!;
    expect(validations).toBeDefined();
    const entries = within(validations).getAllByTestId('draft-list-entry-row');
    expect(entries.map((r) => r.textContent)).toEqual([
      '+ Hours over 40 hours_over_40',
      // `validations` is a JSON row with no declared sub-rows: the property keeps its key.
      '~ max_discount · condition',
      '− Legacy check legacy_check',
    ]);
    expect(within(entries[0]!).getByText('hours_over_40')).toHaveClass('font-mono');
    // A field group's changed property reads by its declared sub-row label.
    const groups = keyRows.find((r) => r.textContent?.startsWith('~ Field Groups'))!;
    expect(within(groups).getByTestId('draft-list-entry-row')).toHaveTextContent('~ Basics basics · Collapse');
    expect(detail.textContent).not.toContain('~ validations');
  });

  it('heads a NEW view with its body properties by their labels, keeping a key no form row names', async () => {
    stubServer('view', 'work_order_list', 'Work Order list', null, NEW_VIEW);
    const detail = await openDetail('Work Order list');

    const rows = (await within(detail).findAllByTestId('draft-key-row')).map((r) => r.textContent);
    expect(rows).toContain('+ Columns');
    expect(rows).toContain('+ Label');
    expect(rows).toContain('+ viewKind');
    expect(rows).not.toContain('+ config');
  });
});
