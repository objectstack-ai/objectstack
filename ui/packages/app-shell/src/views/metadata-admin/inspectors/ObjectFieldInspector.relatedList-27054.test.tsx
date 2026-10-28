// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The field inspector authors how a relationship's child records appear on the
 * PARENT's record page: the three-state `relatedList` control and the
 * `relatedListFilter` builder, on `lookup` / `master_detail` fields.
 *
 *  - 「主要」 on the task → lead FK writes `relatedList: 'primary'`, and the
 *    lead page the platform synthesizes from that draft (the real
 *    `deriveRelatedLists` → `buildDefaultPageSchema` chain) draws the tasks
 *    before every other related list.
 *  - 「不显示」 writes `false`; 「显示」 leaves the key ABSENT (the spec's own
 *    "true/absent = shown"), and a stored `true` reads as shown.
 *  - Every draft the control writes is one the spec's `ObjectSchema` accepts.
 *  - The filter is the shared `FilterConditionField` (the dataset designer's
 *    builder over the list toolbar's `FilterBuilder`), reading a stored
 *    `FilterCondition`; it is offered while the list is shown at all, and the
 *    section is absent on a `tree` field, which the spec gives no related list.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ObjectSchema } from '@objectstack/spec/data';
// The synthesizer the running app's record page uses; module scope (ui/AGENTS.md).
import { buildDefaultPageSchema } from '@object-ui/plugin-detail';

const h = vi.hoisted(() => {
  const CATALOG: Array<Record<string, unknown>> = [{ name: 'lead', label: 'Lead' }];
  const get = async (_type: string, name: string) =>
    name === 'lead' ? { name, fields: { name: { type: 'text', label: 'Name' } } } : null;
  const client = {
    get,
    withPreviewDrafts: (_on: boolean) => ({ list: async (_type: string) => CATALOG, get }),
    list: async (_type: string) => CATALOG,
    listDrafts: async () => [] as unknown[],
  };
  return { client };
});
vi.mock('../useMetadata', () => ({ useMetadataClient: () => h.client }));

import { ObjectFieldInspector } from './ObjectFieldInspector';
import { deriveRelatedLists } from '../../../utils/deriveRelatedLists';
import { t } from '../i18n';

type Row = Record<string, unknown>;

afterEach(cleanup);

const LEAD = { name: 'lead', label: 'Lead', fields: { name: { type: 'text', label: 'Name' } } };

const taskWith = (leadFk: Row): Row => ({
  name: 'task',
  label: 'Task',
  sharingModel: 'public_read_write',
  fields: {
    subject: { type: 'text', label: 'Subject' },
    status: { type: 'select', label: 'Status', options: [{ value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }] },
    lead: leadFk,
  },
});

/** An owned child of the lead: without `primary`, owned lists come first. */
const NOTE = {
  name: 'note',
  label: 'Note',
  fields: { body: { type: 'text' }, lead: { type: 'master_detail', reference: 'lead', label: 'Lead' } },
};

function Designer({ initial, drafts }: { initial: Row; drafts: Row[] }) {
  const [draft, setDraft] = React.useState<Row>(initial);
  return (
    <ObjectFieldInspector
      type="object"
      name="task"
      draft={draft}
      selection={{ kind: 'field', id: 'lead' }}
      onPatch={(patch: Row) => {
        setDraft((d) => {
          const next = { ...d, ...patch };
          drafts.push(next);
          return next;
        });
      }}
      onClearSelection={() => {}}
      onSelectionChange={() => {}}
      readOnly={false}
      locale={'en-US'}
    />
  );
}

const leadFkOf = (draft: Row) => (draft.fields as Record<string, Row>).lead;
const radio = (mode: 'shown' | 'hidden' | 'primary') => screen.getByTestId(`field-related-list-${mode}`);

/** The child object of every related list the synthesized lead page draws, in tab order. */
function relatedOrderOnLeadPage(task: Row): string[] {
  const derived = deriveRelatedLists(LEAD as any, [task as any, NOTE as any]);
  const page = buildDefaultPageSchema(LEAD as any, {
    related: derived.map((d) => ({
      title: d.title ?? d.childLabel,
      objectName: d.childObject,
      relationshipField: d.referenceField,
      ...(d.isPrimary ? { isPrimary: true } : {}),
    })),
  });
  const order: string[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') return;
    const n = node as Record<string, unknown>;
    if (n.type === 'record:related_list') {
      const props = (n.properties ?? n) as Record<string, unknown>;
      order.push(String(props.objectName));
    }
    Object.values(n).forEach(walk);
  };
  walk(page);
  return order;
}

describe('ObjectFieldInspector — the related list on the parent (relatedList / relatedListFilter)', () => {
  it('「主要」 on the task → lead FK writes `primary`, and the synthesized lead page puts tasks first', () => {
    const initial = taskWith({ type: 'lookup', label: 'Lead', reference: 'lead' });
    // Control: without the flag the owned notes come first.
    expect(relatedOrderOnLeadPage(initial)).toEqual(['note', 'task']);

    const drafts: Row[] = [];
    render(<Designer initial={initial} drafts={drafts} />);
    expect(radio('shown').getAttribute('aria-checked')).toBe('true');
    expect(radio('primary').textContent).toBe(t('designer.field.relatedList.primary', 'en-US'));
    fireEvent.click(radio('primary'));

    const last = drafts.at(-1)!;
    expect(leadFkOf(last).relatedList).toBe('primary');
    expect(radio('primary').getAttribute('aria-checked')).toBe('true');
    expect(relatedOrderOnLeadPage(last)).toEqual(['task', 'note']);
    expect(ObjectSchema.safeParse(last).success).toBe(true);
  });

  it('「不显示」 writes false and drops the list; 「显示」 leaves the key absent', () => {
    const drafts: Row[] = [];
    render(<Designer initial={taskWith({ type: 'master_detail', label: 'Lead', reference: 'lead', relatedList: 'primary' })} drafts={drafts} />);
    fireEvent.click(radio('hidden'));
    expect(leadFkOf(drafts.at(-1)!).relatedList).toBe(false);
    expect(relatedOrderOnLeadPage(drafts.at(-1)!)).toEqual(['note']);
    expect(ObjectSchema.safeParse(drafts.at(-1)!).success).toBe(true);

    fireEvent.click(radio('shown'));
    const shown = leadFkOf(drafts.at(-1)!);
    expect('relatedList' in shown).toBe(false);
    expect(ObjectSchema.safeParse(drafts.at(-1)!).success).toBe(true);
  });

  it('reads a stored `true` as shown, and re-picking the current state writes nothing', () => {
    const drafts: Row[] = [];
    render(<Designer initial={taskWith({ type: 'lookup', label: 'Lead', reference: 'lead', relatedList: true })} drafts={drafts} />);
    expect(radio('shown').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(radio('shown'));
    expect(drafts).toHaveLength(0);
  });

  it('edits relatedListFilter with the shared FilterCondition builder, offered while the list is shown', () => {
    const drafts: Row[] = [];
    render(
      <Designer
        initial={taskWith({ type: 'lookup', label: 'Lead', reference: 'lead', relatedListFilter: { status: { $ne: 'closed' } } })}
        drafts={drafts}
      />,
    );
    const filter = screen.getByTestId('field-related-list-filter');
    expect(filter.textContent).toContain(t('designer.field.relatedList.filter', 'en-US'));
    // The stored condition is read by the builder's bridge (one row), not shown as JSON.
    expect(filter.querySelector('button')?.textContent).toContain('1 condition');
    expect(filter.querySelector('textarea')).toBeNull();

    fireEvent.click(radio('hidden'));
    expect(screen.queryByTestId('field-related-list-filter')).toBeNull();
  });

  it('a nested filter the builder cannot hold is kept and named, not rewritten', () => {
    render(
      <Designer
        initial={taskWith({
          type: 'lookup', label: 'Lead', reference: 'lead',
          relatedListFilter: { $or: [{ status: 'open' }, { subject: 'x' }] },
        })}
        drafts={[]}
      />,
    );
    expect(screen.getByTestId('field-related-list-filter').textContent)
      .toContain(t('designer.field.relatedList.filterAdvanced', 'en-US'));
  });

  it('offers no related-list section on a tree field', () => {
    render(<Designer initial={taskWith({ type: 'tree', label: 'Lead' })} drafts={[]} />);
    expect(screen.getByText('Related object')).toBeInTheDocument();
    expect(screen.queryByTestId('field-related-list')).toBeNull();
  });
});
