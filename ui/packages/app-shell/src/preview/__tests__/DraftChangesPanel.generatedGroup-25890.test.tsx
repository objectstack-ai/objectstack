/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#25890 — the pending-changes drill-in lists what the author
 * changed; what the platform wrote folds into one collapsed line.
 *
 * Measured in a console walkthrough: Studio → new object 「报修工单」 (OWD
 * private) → Publish expanded the one object to six field rows (the five
 * injected system columns beside the author's `name`) and four "other
 * changes" (`label`, `name`, `nameField`, `sharingModel`). The `/meta` reads
 * serve an object with the platform's columns stamped on and its `nameField`
 * derived, and a NEW object has no published body to cancel them against.
 *
 * The fixture is that object as the read serves it. Its system columns are the
 * spec's own definitions (`injectedSystemColumnDefs`, the table the injection
 * spreads), relabelled the way the read localises them, so the test proves the
 * fold reads the `system` mark and not a label or a byte-identity.
 *
 * Controls, each a way to get the fold wrong while the headline stays green:
 *
 * - a system field CHANGED between two bodies is the author's edit: listed;
 * - a `nameField` naming a field the derivation would not pick is the author's
 *   choice: listed;
 * - a system field an UPDATE adds is the platform's: folded;
 * - an author field that merely looks like an audit column (no `system`): listed.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { injectedSystemColumnDefs } from '@objectstack/spec/data';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (_k: string, o?: Record<string, unknown> & { defaultValue?: string }) =>
      (o?.defaultValue ?? _k).replace(/\{\{(\w+)\}\}/g, (_m, key: string) => String(o?.[key] ?? '')),
    language: 'en',
  }),
}));

import { DraftChangesPanel, computeChangeDetail } from '../DraftChangesPanel';

/** The read's zh-CN labels for the injected columns (`SYSTEM_FIELD_LABELS`). */
const ZH_LABELS: Record<string, string> = {
  created_at: '创建时间',
  created_by: '创建人',
  owner_id: '负责人',
  updated_at: '更新时间',
  updated_by: '更新人',
};

const AUTHORED = { name: 'com_test_browser_repair_ticket', label: '报修工单', sharingModel: 'private' };

/** The injected columns as the read serves them: the spec's definitions, labels localised. */
function servedSystemColumns(): Record<string, Record<string, unknown>> {
  const injected = injectedSystemColumnDefs({ ...AUTHORED, fields: { name: { type: 'text' } } });
  const out: Record<string, Record<string, unknown>> = {};
  for (const [name, def] of Object.entries(injected)) {
    out[name] = { ...def, ...(ZH_LABELS[name] ? { label: ZH_LABELS[name] } : {}) };
  }
  return out;
}

/** The card's repro: one authored field, the platform's columns, the derived pointer. */
const REPAIR_TICKET_DRAFT = {
  ...AUTHORED,
  nameField: 'name',
  fields: {
    name: { type: 'text', label: '名称' },
    ...servedSystemColumns(),
    // The search companion: injected AND hidden, dropped outright (objectui#13125).
    __search: { type: 'text', label: 'Search Index', hidden: true, readonly: true, system: true },
  },
};

const SYSTEM_COLUMNS = ['created_at', 'created_by', 'owner_id', 'updated_at', 'updated_by'];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('computeChangeDetail — what the platform wrote is not an author row (objectstack#25890)', () => {
  it('the fixture carries the five visible system columns the card measured', () => {
    // Guards the fixture: if the injection table moves, this test says so here.
    const visible = Object.entries(REPAIR_TICKET_DRAFT.fields)
      .filter(([, def]) => (def as { system?: unknown }).system === true && !(def as { hidden?: unknown }).hidden)
      .map(([name]) => name)
      .sort();
    expect(visible).toEqual(SYSTEM_COLUMNS);
  });

  it("a NEW object's author rows are its authored field and keys; the system columns and nameField are generated", () => {
    const d = computeChangeDetail(null, REPAIR_TICKET_DRAFT);
    expect(d.isNew).toBe(true);
    expect(d.fields?.added).toEqual(['name']);
    expect(d.fields?.changed).toEqual([]);
    expect(d.fields?.removed).toEqual([]);
    expect(d.keys).toEqual({ added: ['label', 'name', 'sharingModel'], changed: [], removed: [] });
    expect(d.generated).toEqual([
      ...SYSTEM_COLUMNS.map((name) => ({ name, kind: 'added', scope: 'field' })),
      { name: 'nameField', kind: 'added', scope: 'key' },
    ]);
    // A generated field keeps its label, for the row the group shows when opened.
    expect(d.fields?.labels.get('owner_id')).toBe('负责人');
  });

  it('CONTROL: a field shaped like an audit column without the system mark is the author’s', () => {
    const draft = { name: 'x', fields: { created_on: { type: 'datetime', label: 'Created On', readonly: true } } };
    const d = computeChangeDetail(null, draft);
    expect(d.fields?.added).toEqual(['created_on']);
    expect(d.generated).toEqual([]);
  });

  it('an UPDATE folds a system column it adds, and lists a system column the author changed', () => {
    const cols = servedSystemColumns();
    const published = {
      name: 'ticket',
      fields: { subject: { type: 'text' }, created_at: cols.created_at },
    };
    const draft = {
      name: 'ticket',
      fields: {
        subject: { type: 'text' },
        // Relabelled by the author: the same column on both reads, so the difference is an edit.
        created_at: { ...cols.created_at, label: 'Opened At' },
        // Newly provisioned (e.g. the OWD now asks for an owner): the platform's.
        owner_id: cols.owner_id,
      },
    };
    const d = computeChangeDetail(published, draft);
    expect(d.isNew).toBe(false);
    expect(d.fields?.added).toEqual([]);
    expect(d.fields?.changed).toEqual([{ name: 'created_at', keys: ['label'] }]);
    expect(d.generated).toEqual([{ name: 'owner_id', kind: 'added', scope: 'field' }]);
  });

  it('CONTROL: a nameField the derivation would not pick is the author’s choice and is listed', () => {
    const fields = { name: { type: 'text' }, subject: { type: 'text' } };
    const published = { name: 'ticket', nameField: 'name', fields };
    const draft = { name: 'ticket', nameField: 'subject', fields };
    const d = computeChangeDetail(published, draft);
    expect(d.keys.changed).toEqual(['nameField']);
    expect(d.generated).toEqual([]);
  });

  it('a nameField moving between two derived answers is the platform’s', () => {
    const published = { name: 'ticket', nameField: 'name', fields: { name: { type: 'text' } } };
    const draft = { name: 'ticket', nameField: 'subject', fields: { subject: { type: 'text' } } };
    const d = computeChangeDetail(published, draft);
    expect(d.keys.changed).toEqual([]);
    expect(d.generated).toEqual([{ name: 'nameField', kind: 'changed', scope: 'key' }]);
  });
});

/* ─────────────── the panel ─────────────── */

function stubServer() {
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/_drafts')) {
        return ok({ drafts: [{ type: 'object', name: AUTHORED.name, packageId: 'com.x', label: AUTHORED.label }] });
      }
      if (/\/meta\/object(\?|$)/.test(url)) return ok([]);
      if (url.includes(`/meta/object/${AUTHORED.name}`) && url.includes('state=draft')) {
        return ok({ item: REPAIR_TICKET_DRAFT });
      }
      return { ok: false, status: 404, json: async () => ({}) };
    }) as unknown as typeof fetch,
  );
}

async function expandRepairTicket(): Promise<HTMLElement> {
  stubServer();
  render(<DraftChangesPanel open onOpenChange={() => {}} packageId="com.x" />);
  const toggle = (await screen.findByText(AUTHORED.label)).closest('[data-testid="draft-entry-toggle"]') as HTMLElement;
  fireEvent.click(toggle);
  return screen.findByTestId('draft-entry-detail');
}

describe("the card's repro in the sheet (objectstack#25890)", () => {
  it('shows the one authored field and one collapsed line for what the platform wrote', async () => {
    const detail = await expandRepairTicket();
    const rows = within(detail).getAllByTestId('draft-field-row');
    expect(rows.map((r) => r.textContent)).toEqual(['+ 名称 name']);
    const toggle = within(detail).getByTestId('draft-generated-toggle');
    expect(toggle).toHaveTextContent('Generated by the platform (6)');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const text = detail.textContent ?? '';
    for (const name of [...SYSTEM_COLUMNS, '__search', 'nameField']) expect(text).not.toContain(name);
  });

  it('heads a NEW item’s keys as what it includes, not as other changes', async () => {
    const detail = await expandRepairTicket();
    expect(within(detail).getByText('Includes:')).toBeInTheDocument();
    expect(within(detail).queryByText('Also changed:')).toBeNull();
    expect(within(detail).getByText('+ Sharing Model')).toBeInTheDocument();
  });

  it('opens the group to the five system columns, label first, and the derived nameField', async () => {
    const detail = await expandRepairTicket();
    const toggle = within(detail).getByTestId('draft-generated-toggle');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const group = within(detail).getByTestId('draft-generated-group');
    const fieldRows = within(group).getAllByTestId('draft-field-row').map((r) => r.textContent);
    expect(fieldRows).toEqual(SYSTEM_COLUMNS.map((name) => `+ ${ZH_LABELS[name]} ${name}`));
    expect(within(group).getByText('+ nameField')).toBeInTheDocument();
    expect(group.textContent ?? '').not.toContain('__search');
  });
});
