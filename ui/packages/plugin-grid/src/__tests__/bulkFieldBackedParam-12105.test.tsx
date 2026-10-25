/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12105 — a PROMOTED bulk action's field-backed param resolves through
 * the same resolver as the single-record dialog.
 *
 * ## The defect
 *
 * A view's `bulkActions: ['add_to_campaign']` promotes the object's action, and
 * the action declares `params: [{ field: 'crm_campaign', objectOverride:
 * 'crm_campaign_member' }]` — spec `ActionParamSchema`'s field-backed form.
 * plugin-grid's hand-mapper (`toBulkParam`) renamed `field` onto `name`,
 * defaulted `type` to `'text'` and read `object` only off an inline
 * `reference`, so it never consulted the field definition: the selection bar's
 * dialog drew `<input id="bulk-param-crm_campaign" type="text">`, and the
 * confirm step listed the raw id. The record page renders the record picker for
 * the very same action, because app-shell's `resolveActionParams` resolves the
 * field — and plugin-grid could not import it (app-shell depends on
 * plugin-grid). Measured on HotCRM (`Add to Campaign`, objectstack-ai/hotcrm#2058).
 *
 * ## What is pinned
 *
 *  1. The field-backed lookup param resolves onto the bulk vocabulary — type,
 *     label and picker target from the FIELD — and `bulkParamToField` builds the
 *     picker, not a text widget. Its answer is the single-record resolver's
 *     answer for the same declaration (parity, not a second copy).
 *  2. CONTROL: a literal-typed (inline) param comes out as it did — same widget,
 *     same label, help and default, an inline `reference` still the target.
 *  3. A field-backed param whose field is NOT in the metadata is refused, as the
 *     record dialog refuses it, instead of becoming a text box again.
 *  4. Through the REAL `ObjectGrid` + `BulkActionDialog`: the picker renders on
 *     the selection bar's dialog, the confirm step shows the record's LABEL, the
 *     run sends the id — and the grid awaits the session's object metadata before
 *     resolving, so an `objectOverride` target that loads late is waited for.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return {
    ...actual,
    usePermissions: () => ({ isLoaded: false, checkField: () => true, getObjectApiOperations: () => undefined, can: () => true }),
  };
});

import type { BulkActionDef } from '@object-ui/types';
import { registerAllFields, resolveActionParam, type ResolveActionParamsContext } from '@object-ui/fields';
import { ActionProvider, MetadataCtx, type MetadataContextValue } from '@object-ui/react';
import { ObjectGrid } from '../ObjectGrid';
import { resolveBulkActions, resolvePromotedBulkParams, unresolvedFieldOf } from '../resolveBulkActions';
import { bulkParamToField } from '../components/bulkParamToField';

registerAllFields();

const GRID_OBJECT = 'crm_lead';

/** The junction object that OWNS the referenced field — only the session store knows it. */
const CAMPAIGN_MEMBER = {
  name: 'crm_campaign_member',
  fields: {
    crm_campaign: {
      type: 'lookup',
      label: 'Campaign',
      reference: 'crm_campaign',
      displayField: 'name',
      required: true,
      defaultValue: 'c1',
    },
  },
};

const ADD_TO_CAMPAIGN = {
  name: 'add_to_campaign',
  label: 'Add to Campaign',
  type: 'api',
  target: '/api/v1/campaigns/add',
  params: [{ field: 'crm_campaign', objectOverride: 'crm_campaign_member' }],
};

const ctx = (objects: ResolveActionParamsContext['objects']): ResolveActionParamsContext => ({
  objectName: GRID_OBJECT,
  objects,
  fieldLabel: (_o, _f, fallback) => fallback,
});

/** Promote one action through the real fold, the way `ObjectGrid` does. */
function promote(action: Record<string, unknown>): BulkActionDef {
  const { defs } = resolveBulkActions({ bulkActions: [String(action.name)], objectActions: [action] });
  expect(defs).toHaveLength(1);
  return defs[0];
}

describe('resolvePromotedBulkParams — the shared resolver on the bulk path (objectui#12105)', () => {
  it('resolves a field-backed lookup param against the field, and the bulk adapter builds the picker', () => {
    const def = resolvePromotedBulkParams(promote(ADD_TO_CAMPAIGN), ctx([CAMPAIGN_MEMBER]));
    const [param] = def.params ?? [];

    expect(param).toEqual(
      expect.objectContaining({
        name: 'crm_campaign',
        label: 'Campaign',
        type: 'lookup',
        object: 'crm_campaign',
        labelField: 'name',
        default: 'c1',
      }),
    );
    expect(unresolvedFieldOf(param)).toBeUndefined();

    // The widget the dialog renders: the record picker with its target, where
    // the hand-mapper produced `type: 'text'` and no target at all.
    const field = bulkParamToField(param, false);
    expect(field.type).toBe('lookup');
    expect(field.reference).toBe('crm_campaign');
    expect(field.displayField).toBe('name');
  });

  it("answers what the single-record resolver answers for the same declaration", () => {
    const context = ctx([CAMPAIGN_MEMBER]);
    const single = resolveActionParam(ADD_TO_CAMPAIGN.params[0], context);
    const [bulk] = resolvePromotedBulkParams(promote(ADD_TO_CAMPAIGN), context).params ?? [];

    expect({
      name: bulk.name,
      label: bulk.label,
      type: bulk.type,
      required: bulk.required,
      default: bulk.default,
      object: bulk.object,
      labelField: bulk.labelField,
    }).toEqual({
      name: single.name,
      label: single.label,
      type: single.type,
      required: single.required,
      default: single.defaultValue,
      object: single.referenceTo,
      labelField: single.displayField,
    });
  });

  it('CONTROL: a literal-typed param is unchanged', () => {
    const action = {
      name: 'log_note',
      params: [
        { name: 'note', type: 'textarea', label: 'Note', helpText: 'Why', defaultValue: 'x', required: true, placeholder: 'Say why' },
        { name: 'owner', type: 'lookup', label: 'Owner', reference: 'sys_user' },
      ],
    };
    // No metadata at all — an inline param never needed any.
    const def = resolvePromotedBulkParams(promote(action), ctx([]));
    const [note, owner] = def.params ?? [];

    expect(note).toEqual(
      expect.objectContaining({ name: 'note', type: 'textarea', label: 'Note', help: 'Why', default: 'x', required: true, placeholder: 'Say why' }),
    );
    expect(bulkParamToField(note, false)).toEqual(
      expect.objectContaining({ name: 'note', type: 'textarea', label: 'Note', required: true, placeholder: 'Say why' }),
    );
    // The inline `reference` is still the picker target — and `sys_user`
    // still promotes to the person picker, as it did.
    expect(owner).toEqual(expect.objectContaining({ name: 'owner', type: 'lookup', object: 'sys_user' }));
    expect(bulkParamToField(owner, false).type).toBe('user');
    expect(unresolvedFieldOf(note)).toBeUndefined();
    expect(unresolvedFieldOf(owner)).toBeUndefined();
  });

  it('names a field-backed param whose field the metadata does not hold, instead of degrading it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const [param] = resolvePromotedBulkParams(promote(ADD_TO_CAMPAIGN), ctx([])).params ?? [];
      expect(unresolvedFieldOf(param)).toBe('crm_campaign_member.crm_campaign');
    } finally {
      warn.mockRestore();
    }
  });

  it('leaves an authored def, and authored params, exactly as authored', () => {
    const authored: BulkActionDef = {
      name: 'set_queue',
      operation: 'update',
      params: [{ name: 'queue', type: 'lookup', object: 'queues' }],
    };
    expect(resolvePromotedBulkParams(authored, ctx([CAMPAIGN_MEMBER]))).toBe(authored);
  });
});

// ─── Through the real grid and dialog ────────────────────────────────────────

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
  if (!(Element.prototype as any).hasPointerCapture) {
    (Element.prototype as any).hasPointerCapture = () => false;
  }
  if (!(Element.prototype as any).setPointerCapture) {
    (Element.prototype as any).setPointerCapture = () => {};
  }
});

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // happy-dom lacks matchMedia; the lookup widgets' useIsMobile needs it.
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as any;
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: () => 'application/json' },
    json: async () => ({ success: true }),
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const LEADS = [
  { id: 'l1', name: 'Ada Lovelace' },
  { id: 'l2', name: 'Grace Hopper' },
];
const CAMPAIGNS = [{ id: 'c1', name: 'Spring Launch' }];

/**
 * A session store whose `object` type is NOT loaded until `ensureType('object')`
 * is asked — so a grid that resolved without waiting would find no owner for
 * the `objectOverride` param and refuse it.
 */
function lateLoadingMetadata(objects: unknown[]) {
  let loaded = false;
  const ensureType = vi.fn(async (type: string) => {
    if (type === 'object') loaded = true;
    return loaded ? objects : [];
  });
  const value = {
    apps: [],
    get objects() {
      return loaded ? objects : [];
    },
    dashboards: [],
    reports: [],
    pages: [],
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType,
    getItem: async () => null,
    getItemsByType: () => [],
  } as unknown as MetadataContextValue;
  return { value, ensureType };
}

async function openBulkDialog(action: Record<string, unknown>, metadataObjects: unknown[]) {
  const dataSource: any = {
    find: vi.fn(async (resource: string) => {
      const data = resource === 'crm_campaign' ? CAMPAIGNS : LEADS;
      return { data: data.map((r) => ({ ...r })), total: data.length, hasMore: false, pageSize: 50 };
    }),
    findOne: vi.fn(async (resource: string, id: string) =>
      resource === 'crm_campaign' ? CAMPAIGNS.find((c) => c.id === id) ?? null : null),
    getObjectSchema: async (name: string) => ({
      name,
      fields: { id: { type: 'text' }, name: { type: 'text', label: 'Name' } },
      actions: [action],
    }),
  };
  const { value, ensureType } = lateLoadingMetadata(metadataObjects);
  render(
    <ActionProvider handlers={{}}>
      <MetadataCtx.Provider value={value}>
        <ObjectGrid
          schema={{
            type: 'object-grid',
            objectName: GRID_OBJECT,
            columns: [{ field: 'name', label: 'Name' }],
            pagination: { pageSize: 50 },
            bulkActions: [String(action.name)],
          } as any}
          dataSource={dataSource}
        />
      </MetadataCtx.Provider>
    </ActionProvider>,
  );
  await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeInTheDocument());
  await waitFor(() => expect(document.querySelector('thead [role="checkbox"]')).toBeTruthy());
  fireEvent.click(document.querySelector('thead [role="checkbox"]') as HTMLElement);
  fireEvent.click(await screen.findByTestId(`bulk-action-${String(action.name)}`));
  return { dataSource, ensureType };
}

describe('ObjectGrid bulk dialog — a field-backed param on the selection bar (objectui#12105)', () => {
  it('renders the record picker, shows the label on confirm, and sends the id', async () => {
    const { dataSource, ensureType } = await openBulkDialog(ADD_TO_CAMPAIGN, [CAMPAIGN_MEMBER]);

    // The picker, not the text box the hand-mapper drew.
    expect(await screen.findByTestId('lookup-trigger-crm_campaign')).toBeInTheDocument();
    expect(document.querySelector('input#bulk-param-crm_campaign')).toBeNull();
    expect(screen.queryByTestId('bulk-param-unresolved-crm_campaign')).not.toBeInTheDocument();
    // It waited for the session's objects before resolving.
    expect(ensureType).toHaveBeenCalledWith('object');

    // The field's default seeded the value; the confirm step names the record.
    const next = screen.getByRole('button', { name: 'Next' });
    await waitFor(() => expect(next).toBeEnabled());
    fireEvent.click(next);
    await screen.findByRole('button', { name: 'Run' });
    await waitFor(() => expect(screen.getByText(/Spring Launch/)).toBeInTheDocument());
    expect(dataSource.findOne).toHaveBeenCalledWith('crm_campaign', 'c1');
    expect(screen.queryByText(/:\s*c1$/)).not.toBeInTheDocument();

    // One dispatch per lead, each carrying the picked campaign's id.
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const bodies = fetchMock.mock.calls.map((c) => JSON.parse((c[1] as any).body));
    expect(bodies.map((b) => b.crm_campaign)).toEqual(['c1', 'c1']);
  });

  it('CONTROL: a literal-typed param still renders its own widget', async () => {
    await openBulkDialog(
      { name: 'log_note', label: 'Log note', type: 'api', target: '/api/v1/notes', params: [{ name: 'note', type: 'text', label: 'Note' }] },
      [],
    );
    const input = await waitFor(() => {
      const el = document.querySelector('input#bulk-param-note');
      expect(el).toBeTruthy();
      return el as HTMLInputElement;
    });
    expect(input.type).toBe('text');
  });

  it('refuses a field-backed param whose field is missing, and blocks the run', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // The session store holds no `crm_campaign_member` at all.
      await openBulkDialog(ADD_TO_CAMPAIGN, []);
      const refusal = await screen.findByTestId('bulk-param-unresolved-crm_campaign');
      expect(refusal).toHaveAttribute('role', 'alert');
      expect(refusal).toHaveTextContent('crm_campaign_member.crm_campaign');
      expect(document.querySelector('input#bulk-param-crm_campaign')).toBeNull();
      expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    } finally {
      warn.mockRestore();
    }
  });
});
