// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * FlowNodeConfigField — inline expression validation gating (#2670 Phase 3 B).
 * The malformed-condition brace-trap (ADR-0032) fires on a real CEL predicate.
 *
 * objectui#12329 / objectui#12390 — it fires on a body-less loop's
 * `collection` too, the one collection the value-slot control does not take:
 * its executor reads the bare name of a list variable, so a stored
 * `{leadList}` names no variable. It used to be read as a legal single-brace
 * template, a dialect objectstack#19939 S7 deleted; the descriptor now carries
 * no override, the loop's own descriptor field is the fixture.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { FlowNodeConfigField } from './FlowNodeConfigField';
import { fieldsForNodeType, type FlowConfigField } from './flow-node-config';
import type { ScopeGroup } from './useFlowScope';

afterEach(cleanup);

/** A minimal scope with the given variable tokens (all in the `variables` group). */
function scope(tokens: string[]): ScopeGroup[] {
  return [
    {
      id: 'variables',
      label: 'Flow variables',
      refs: tokens.map((token) => ({ token, label: token, group: 'variables' as const })),
    },
  ];
}

/** The loop descriptor's own `collection` field, rendered with no node (so no value-slot control). */
const LOOP_COLLECTION: FlowConfigField = fieldsForNodeType('loop').find((f) => f.id === 'collection')!;

const CEL_CONDITION: FlowConfigField = {
  id: 'condition',
  path: ['config', 'condition'],
  label: 'Condition',
  kind: 'expression',
};

describe('FlowNodeConfigField — expression validation gating', () => {
  it('flags a `{leadList}` on a body-less collection, with the bare name as the fix (objectui#12329)', () => {
    render(
      <FlowNodeConfigField
        field={LOOP_COLLECTION}
        value="{leadList}"
        onCommit={() => {}}
        scopeGroups={scope(['leadList'])}
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain('`leadList`');
  });

  it('control: the bare name in scope is clean', () => {
    render(
      <FlowNodeConfigField
        field={LOOP_COLLECTION}
        value="leadList"
        onCommit={() => {}}
        scopeGroups={scope(['leadList'])}
      />,
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('surfaces an out-of-scope bare name as a NOTE (not an error)', () => {
    render(
      <FlowNodeConfigField
        field={LOOP_COLLECTION}
        value="leadLst"
        onCommit={() => {}}
        scopeGroups={scope(['leadList'])}
      />,
    );
    expect(screen.queryByRole('alert')).toBeNull();
    const note = screen.getByRole('note');
    expect(note.textContent).toMatch(/leadList/);
  });

  it('still flags a genuine `{record.x}` brace-in-CEL mistake on a predicate field', () => {
    render(
      <FlowNodeConfigField
        field={CEL_CONDITION}
        value="{record.amount} > 10"
        onCommit={() => {}}
        scopeGroups={scope(['record'])}
      />,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('does not flag a well-formed CEL predicate with an in-scope reference', () => {
    render(
      <FlowNodeConfigField
        field={CEL_CONDITION}
        value="amount > 10"
        onCommit={() => {}}
        scopeGroups={scope(['amount'])}
      />,
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('note')).toBeNull();
  });
});

describe('FlowNodeConfigField — select keeps a stored value dropped from the options (framework#4278)', () => {
  const ACTION_TYPE: FlowConfigField = {
    id: 'actionType',
    path: ['config', 'actionType'],
    label: 'Action type',
    kind: 'select',
    options: [
      { value: 'invoke_function', label: 'Call function' },
      { value: 'email', label: 'Email' },
      { value: 'slack', label: 'Slack' },
    ],
  };

  it('renders a legacy stored value as a flagged "(deprecated)" option instead of blanking it', () => {
    // A stored script node with the retired `sms` actionType must keep showing
    // that value — the same rule FlowObjectListField applies to select cells.
    render(<FlowNodeConfigField field={ACTION_TYPE} value="sms" onCommit={() => {}} />);
    expect(screen.getByText('sms (deprecated)')).toBeInTheDocument();
  });

  it('offers only the declared options when the stored value is one of them', () => {
    render(<FlowNodeConfigField field={ACTION_TYPE} value="email" onCommit={() => {}} />);
    expect(screen.getByText('Email')).toBeInTheDocument();
    expect(screen.queryByText(/deprecated/)).toBeNull();
  });
});
