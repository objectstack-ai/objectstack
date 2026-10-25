// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The inline `visibleWhen` cell of a `screen` node's `fields` list binds the
 * screen's declared fields, not the flow scope (objectui#10772).
 *
 * A screen field's `visibleWhen` is bare CEL over the same screen's declared
 * fields plus `record` (spec `ScreenFieldSpec.visibleWhen`; ruling C on
 * objectui#10743). The Problems panel and the Debug run's screen step judge that
 * column by one rule, `screenPredicateRoots` / `screenVisibleWhenScopeError`
 * (`previews/screen-spec.ts`). The inline cell used to read the FLOW scope: it
 * flagged a sibling-field predicate ("`discount` is not a reference in scope at
 * this step"), said nothing on a run variable (`needsApproval == true`), and its
 * picker offered `needsApproval` / `record` / `previous` — inviting an author to
 * rewrite a correct predicate into one the runner cannot bind.
 *
 * Mounted through the real plumbing — `FlowNodeConfigField` with the real
 * `screen` / `decision` descriptors, the node and draft as `context`, and the
 * `resolveFlowScope` groups the inspector hands every field — so the pins read
 * the cell an author sees. The control is a non-screen expression column, a
 * decision's `conditions[].expression`, which keeps the flow scope.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FlowNodeConfigField } from './FlowNodeConfigField';
import { fieldsForNodeType, getFieldValue, type FlowConfigField } from './flow-node-config';
import { resolveFlowScope } from './flow-scope';
import type { ScopeGroup } from './useFlowScope';
import { flowExpressionProblems } from '../previews/flow-expr-problems';
import { screenPredicateRoots } from '../previews/screen-spec';

afterEach(cleanup);

const PICK = 'Insert a reference';

const start = { id: 'start', type: 'start', config: { triggerType: 'record-after-update', objectName: 'crm_lead' } };
// A decision UPSTREAM of the screen: its scope is the flow's (`needsApproval`,
// `record`, `previous`) and holds none of the screen's fields.
const decision = {
  id: 'd',
  type: 'decision',
  config: { conditions: [{ label: 'Big', expression: 'discount > 0' }, { label: 'Flag', expression: 'needsApproval == true' }] },
};
const review = {
  id: 'review',
  type: 'screen',
  config: {
    fields: [
      { name: 'discount', label: 'Discount %', type: 'number' },
      { name: 'other_field', label: 'Other', type: 'text' },
      // The console sample's shape, and the dispatch's `other_field == 'x'`.
      { name: 'note', label: 'Note', type: 'text', visibleWhen: 'discount > 0' },
      { name: 'extra', label: 'Extra', type: 'text', visibleWhen: "other_field == 'x'" },
      // A run variable: in the flow scope, not a field on this screen.
      { name: 'reason', label: 'Reason', type: 'text', visibleWhen: 'needsApproval == true' },
    ],
  },
};
const draft = {
  variables: [{ name: 'needsApproval', type: 'boolean' }],
  nodes: [start, decision, review],
  edges: [
    { source: 'start', target: 'd' },
    { source: 'd', target: 'review' },
  ],
};

/** The picker sections the inspector builds from `resolveFlowScope` (as `useFlowScope` groups them). */
function flowGroupsAt(nodeId: string): ScopeGroup[] {
  const refs = resolveFlowScope(draft, nodeId).refs;
  return (['variables', 'outputs', 'loop', 'trigger'] as const)
    .map((id) => ({ id, label: id, refs: refs.filter((r) => r.group === id) }))
    .filter((g) => g.refs.length > 0);
}

function fieldOf(type: string, id: string): FlowConfigField {
  const f = fieldsForNodeType(type).find((x) => x.id === id);
  if (!f) throw new Error(`no ${type}.${id} descriptor`);
  return f;
}

/** Mount one node's objectList field exactly as `FlowNodeInspector` does. */
function mount(node: Record<string, unknown> & { id: string; type: string }, fieldId: string) {
  const field = fieldOf(node.type, fieldId);
  return render(
    <FlowNodeConfigField
      field={field}
      value={getFieldValue(node, field)}
      onCommit={() => {}}
      context={{ draft, node }}
      scopeGroups={flowGroupsAt(node.id)}
    />,
  );
}

/** The expression cell (input + its inline note) holding `value`. */
function cellOf(value: string): HTMLElement {
  const input = screen.getByDisplayValue(value);
  const cell = input.closest('div.space-y-1');
  if (!cell) throw new Error(`no cell around ${value}`);
  return cell as HTMLElement;
}

/** The inline note / alert texts under one expression cell. */
function notesOf(value: string): string[] {
  const cell = cellOf(value);
  return [...within(cell).queryAllByRole('note'), ...within(cell).queryAllByRole('alert')].map((n) => n.textContent ?? '');
}

/** Open the cell's reference picker and read the tokens it offers. */
async function pickerTokens(value: string): Promise<string[]> {
  await userEvent.click(within(cellOf(value)).getByRole('button', { name: PICK }));
  const opts = await screen.findAllByRole('option');
  // An option reads token then (optional) detail; the token is its first mono span.
  return opts.map((o) => o.querySelector('span')?.textContent ?? '');
}

describe("the screen fields[].visibleWhen inline cell binds the screen's declared fields (objectui#10772)", () => {
  it('a sibling-field predicate is silent (the console sample, and a sibling string compare)', () => {
    mount(review, 'fields');
    expect(notesOf('discount > 0')).toEqual([]);
    expect(notesOf("other_field == 'x'")).toEqual([]);
  });

  it("a run variable is flagged, in the Problems panel's own words for that row", () => {
    mount(review, 'fields');
    const notes = notesOf('needsApproval == true');
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('`needsApproval`');
    // The panel prefixes the row's label; the cell sits in the row. Same rule,
    // same sentence — and the panel reports nothing else on this screen.
    const onScreen = flowExpressionProblems(draft).filter(
      (p) => p.target.kind === 'node' && p.target.nodeId === 'review',
    );
    expect(onScreen.map((p) => p.message)).toEqual([`Reason: ${notes[0]}`]);
    // The cell's note is a warning (role="note"), as the panel's level is.
    expect(within(cellOf('needsApproval == true')).getAllByRole('note')).toHaveLength(1);
    expect(onScreen[0].level).toBe('warning');
  });

  it("the picker offers the screen's roots — its declared fields and `record` — not the flow scope", async () => {
    mount(review, 'fields');
    const tokens = await pickerTokens('discount > 0');
    expect(tokens).toEqual([...screenPredicateRoots(review)]);
    expect(tokens).toEqual(expect.arrayContaining(['discount', 'other_field', 'record']));
    expect(tokens).not.toContain('needsApproval');
    expect(tokens).not.toContain('previous');
  });

  it("control: a decision's conditions[].expression keeps the flow scope — the sibling-shaped name is flagged there, the run variable is clean, the picker offers the flow scope", async () => {
    mount(decision, 'conditions');
    const flagged = notesOf('discount > 0');
    expect(flagged).toHaveLength(1);
    expect(flagged[0]).toContain('`discount`');
    expect(notesOf('needsApproval == true')).toEqual([]);
    const tokens = await pickerTokens('needsApproval == true');
    expect(tokens).toEqual(flowGroupsAt('d').flatMap((g) => g.refs.map((r) => r.token)));
    expect(tokens).toEqual(expect.arrayContaining(['needsApproval', 'record', 'previous']));
  });
});
