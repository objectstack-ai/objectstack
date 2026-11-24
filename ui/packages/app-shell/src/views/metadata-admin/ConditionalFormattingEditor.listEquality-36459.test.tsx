// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36459 — a view's conditional formatting editor hands the lint the
 * object's field types and `multiple`, so `record.<list field> == 'x'` — a list
 * compared with a scalar, one constant answer on every row, so the rule never
 * styles anything — is refused (`list-equality`, with the membership rewrite)
 * while the author types. A membership test on the same field is accepted.
 *
 * Pinned against the REAL `@objectstack/formula` engine:
 *  - the editor itself: `tags` (a `select` declared `multiple: true`) is the
 *    list subject; `stage` (a plain `select`) is the scalar CONTROL; `'vip' in
 *    record.tags` is the shape that does match;
 *  - the mount site hands the object's field definitions through: the view
 *    variant inspector (metadata admin). The Studio list-view panel's "more"
 *    section was the second, until objectstack#36502 retired it with the
 *    Interfaces pillar.
 *
 * Direction: without `fieldDefs` reaching the editor no field is judged a list,
 * `record.tags == 'vip'` lints clean and the refusing cases are red; the
 * controls are green either way.
 */

import '@testing-library/jest-dom/vitest';
// The CEL authoring helpers load these through dynamic imports; paying the first
// load at module top keeps it out of every clocked window (`check:test-source-alias`).
import '@objectstack/formula';
import '@objectstack/lint';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';

const TICKET_FIELDS = {
  name: { name: 'name', label: 'Name', type: 'text' },
  tags: {
    name: 'tags', label: 'Tags', type: 'select', multiple: true,
    options: [{ value: 'vip', label: 'VIP' }, { value: 'new', label: 'New' }],
  },
  stage: {
    name: 'stage', label: 'Stage', type: 'select',
    options: [{ value: 'open', label: 'Open' }, { value: 'done', label: 'Done' }],
  },
} as const;
const TICKET = { name: 'ticket', label: 'Ticket', fields: TICKET_FIELDS };

const clients = vi.hoisted(() => ({
  fake: {
    get: async () => undefined,
    list: async () => [] as unknown[],
    listDrafts: async () => [] as unknown[],
    withPreviewDrafts() {
      return this;
    },
  },
}));
vi.mock('./useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./useMetadata')>();
  return { ...mod, useMetadataClient: () => clients.fake };
});

import { ConditionalFormattingEditor, type ConditionalFormattingRuleDraft } from './ConditionalFormattingEditor';
import { ViewVariantInspector } from './inspectors/ViewVariantInspector';
import { mapObjectFields } from '../ViewConfigPanel';

afterEach(cleanup);

const t = (k: string) => k;
const FIELD_DEFS = Object.values(TICKET_FIELDS).map((f) => ({
  name: f.name,
  type: f.type,
  multiple: 'multiple' in f ? f.multiple : undefined,
}));
const LIST_FINDING = /`record\.tags` holds a list/;

function EditorHarness({
  initial,
  report,
}: {
  initial: string;
  report: (count: number) => void;
}) {
  const [rules, setRules] = React.useState<ConditionalFormattingRuleDraft[]>([{ condition: initial, style: {} }]);
  return (
    <ConditionalFormattingEditor
      rules={rules}
      onChange={setRules}
      objectName="ticket"
      fieldNames={Object.keys(TICKET_FIELDS)}
      fieldDefs={FIELD_DEFS}
      t={t}
      onBlockingIssuesChange={report}
    />
  );
}

/** Type `source` into the first rule's condition inside `scope`. */
function typeCondition(source: string, scope: HTMLElement = document.body) {
  const box = within(scope).getByTestId('cf-rule-0').querySelector('textarea') as HTMLElement;
  fireEvent.change(box, { target: { value: source } });
}

describe('ConditionalFormattingEditor — list-equality while typing (#36459)', () => {
  it('refuses == on a select declared multiple: true, with the membership rewrite, and reports it as blocking', async () => {
    const report = vi.fn();
    render(<EditorHarness initial="" report={report} />);
    typeCondition("record.tags == 'vip'");
    await waitFor(() => expect(report.mock.calls.at(-1)?.[0]).toBe(1), { timeout: 5000 });
    const finding = await screen.findByText(LIST_FINDING);
    expect(finding.textContent).toMatch(/\bin\b/);
  });

  it('refuses != on the same list field', async () => {
    const report = vi.fn();
    render(<EditorHarness initial="" report={report} />);
    typeCondition("record.tags != 'vip'");
    await waitFor(() => expect(report.mock.calls.at(-1)?.[0]).toBe(1), { timeout: 5000 });
    expect(await screen.findByText(LIST_FINDING)).toBeInTheDocument();
  });

  it('accepts the membership test that does match a list', async () => {
    const report = vi.fn();
    render(<EditorHarness initial="" report={report} />);
    typeCondition("'vip' in record.tags");
    await waitFor(() => expect(report.mock.calls.at(-1)?.[0]).toBe(0), { timeout: 5000 });
    expect(screen.queryByText(/holds a list/)).toBeNull();
  });

  it('CONTROL — == on a single-value select is clean', async () => {
    const report = vi.fn();
    render(<EditorHarness initial="" report={report} />);
    typeCondition("record.stage == 'open'");
    await waitFor(() => expect(report.mock.calls.at(-1)?.[0]).toBe(0), { timeout: 5000 });
    expect(screen.queryByText(/holds a list/)).toBeNull();
  });
});

describe('the mount site hands the editor the object’s field definitions (#36459)', () => {
  it('the view variant inspector refuses == on a list field in a formatting rule', async () => {
    function Harness() {
      const [draft, setDraft] = React.useState<Record<string, unknown>>({
        name: 'tickets',
        object: 'ticket',
        list: {
          type: 'grid',
          data: { provider: 'object', object: 'ticket' },
          columns: ['name'],
          conditionalFormatting: [{ condition: '', style: {} }],
        },
      });
      return (
        <ViewVariantInspector
          type="view"
          name="tickets"
          draft={draft}
          onPatch={(patch: Record<string, unknown>) => setDraft((d) => ({ ...d, ...patch }))}
          onSelectionChange={() => {}}
          onClearSelection={() => {}}
          readOnly={false}
          locale={'en-US'}
          variantKey="list"
          familyKey="list"
          isHome={false}
          objectFieldsOverride={mapObjectFields(TICKET as never)}
        />
      );
    }
    render(<Harness />);
    const editor = await screen.findByTestId('cf-editor');
    typeCondition("record.tags == 'vip'", editor);
    expect(await within(editor).findByText(LIST_FINDING, {}, { timeout: 5000 })).toBeInTheDocument();
  });
});
