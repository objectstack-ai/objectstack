// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#34818 item 7 — "Add variable" on the flow's Variables tab.
 *
 * The panel replaces the read-only list. Every write is the whole
 * `variables` array, parsed here with the spec's own `FlowVariableSchema`.
 * A name the spec refuses (blank, `$`-led) or one another variable holds is
 * held with a note; renaming or removing a variable a step still reads is
 * refused with a note naming the steps. Control: without `onPatch` the panel
 * is the read-only list, with no add button.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { FlowVariableSchema } from '@objectstack/spec/automation';
import { FlowVariablesPanel, flowVariableReaders, nextFlowVariableName, type FlowVariableRow } from './FlowVariablesPanel';
import { t, tFormat } from '../i18n';
import { loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';

await loadStudioCatalogue('zh');

afterEach(cleanup);

const en = (key: string) => t(key, 'en');

const NODES = [
  { id: 'start', type: 'start', label: 'Start' },
  { id: 'notify', type: 'notify', label: 'Tell the owner', config: { message: 'Deal {{ amount }} closed' } },
  { id: 'route', type: 'decision', label: 'Big?', config: { conditions: [{ expression: 'amount > 1000' }] } },
  { id: 'end', type: 'end', label: 'End' },
];

/** A host that applies each patch, as the designer's draft does. */
function Host({ initial, onWrite, nodes = NODES }: { initial: FlowVariableRow[]; onWrite: (v: FlowVariableRow[]) => void; nodes?: typeof NODES }) {
  const [variables, setVariables] = React.useState(initial);
  return (
    <FlowVariablesPanel
      variables={variables}
      nodes={nodes}
      locale="en"
      onPatch={({ variables: next }) => {
        onWrite(next);
        setVariables(next);
      }}
    />
  );
}

/** Each write parses as the spec's variables. */
function expectSpecShaped(rows: FlowVariableRow[]) {
  for (const row of rows) expect(() => FlowVariableSchema.parse(row), JSON.stringify(row)).not.toThrow();
}

const rows = () => screen.queryAllByTestId('flow-variable-row');
const nameBox = (row: HTMLElement) => within(row).getByRole('textbox', { name: en('engine.flowPreview.vars.name') });
const note = (row: HTMLElement) => within(row).queryByTestId('flow-variable-note');

function rename(row: HTMLElement, value: string) {
  const box = nameBox(row);
  fireEvent.change(box, { target: { value } });
  fireEvent.blur(box);
}

describe('the Variables panel adds and edits variables (#34818 item 7)', () => {
  it('the empty state says what variables are for, and Add variable writes a spec-shaped text variable', () => {
    const onWrite = vi.fn();
    render(<Host initial={[]} onWrite={onWrite} />);
    expect(screen.getByTestId('flow-variables-empty')).toHaveTextContent(en('engine.flowPreview.noVars'));
    expect(en('engine.flowPreview.noVars')).toContain('{{ name }}');

    fireEvent.click(screen.getByRole('button', { name: en('engine.flowPreview.addVariable') }));
    expect(onWrite).toHaveBeenLastCalledWith([{ name: 'variable_1', type: 'text' }]);
    fireEvent.click(screen.getByRole('button', { name: en('engine.flowPreview.addVariable') }));
    expect(onWrite.mock.calls.at(-1)![0].map((v: FlowVariableRow) => v.name)).toEqual(['variable_1', 'variable_2']);
    expectSpecShaped(onWrite.mock.calls.at(-1)![0]);
    expect(rows()).toHaveLength(2);
  });

  it('edits name, type, default, input and output into one spec-shaped row', () => {
    const onWrite = vi.fn();
    render(<Host initial={[{ name: 'variable_1', type: 'text' }]} onWrite={onWrite} />);
    const [row] = rows();
    rename(row, 'discount');
    fireEvent.change(within(row).getByRole('combobox', { name: en('engine.flowPreview.vars.type') }), { target: { value: 'number' } });
    const def = within(row).getByRole('textbox', { name: en('engine.flowPreview.vars.default') });
    fireEvent.change(def, { target: { value: '15' } });
    fireEvent.blur(def);
    fireEvent.click(within(row).getByRole('checkbox', { name: en('engine.flowPreview.vars.input') }));
    fireEvent.click(within(row).getByRole('checkbox', { name: en('engine.flowPreview.vars.output') }));
    const last = onWrite.mock.calls.at(-1)![0] as FlowVariableRow[];
    expect(last).toEqual([{ name: 'discount', type: 'number', defaultValue: 15, isInput: true, isOutput: true }]);
    expectSpecShaped(last);
    expect(note(row)).toBeNull();
  });

  it('a default the type cannot hold is held with a note, not written', () => {
    const onWrite = vi.fn();
    render(<Host initial={[{ name: 'count', type: 'number' }]} onWrite={onWrite} />);
    const [row] = rows();
    const def = within(row).getByRole('textbox', { name: en('engine.flowPreview.vars.default') });
    fireEvent.change(def, { target: { value: 'many' } });
    fireEvent.blur(def);
    expect(note(row)).toHaveTextContent(en('engine.flowPreview.vars.defaultNumber'));
    expect(onWrite).not.toHaveBeenCalled();
  });

  it('refuses a $ name, a blank name and a duplicate, holding the text and writing nothing', () => {
    const onWrite = vi.fn();
    render(<Host initial={[{ name: 'a', type: 'text' }, { name: 'b', type: 'text' }]} onWrite={onWrite} />);
    const second = rows()[1];
    rename(second, '$record');
    expect(note(second)).toHaveTextContent(en('engine.flowPreview.vars.nameDollar'));
    expect(nameBox(second)).toHaveValue('$record');
    rename(second, '   ');
    expect(note(second)).toHaveTextContent(en('engine.flowPreview.vars.nameBlank'));
    rename(second, 'a');
    expect(note(second)).toHaveTextContent(tFormat('engine.flowPreview.vars.nameTaken', 'en', { name: 'a' }));
    expect(onWrite).not.toHaveBeenCalled();
    // The spec agrees on the $ name.
    expect(() => FlowVariableSchema.parse({ name: '$record', type: 'text' })).toThrow();
  });

  it('refuses to rename or remove a variable a step still reads, naming the steps', () => {
    const onWrite = vi.fn();
    render(<Host initial={[{ name: 'amount', type: 'number' }, { name: 'unused', type: 'text' }]} onWrite={onWrite} />);
    const [amount, unused] = rows();
    rename(amount, 'total');
    expect(note(amount)).toHaveTextContent(
      tFormat('engine.flowPreview.vars.renameRead', 'en', { name: 'amount', steps: 'Tell the owner, Big?' }),
    );
    fireEvent.click(within(amount).getByRole('button', { name: tFormat('engine.flowPreview.vars.remove', 'en', { name: 'amount' }) }));
    expect(note(amount)).toHaveTextContent(
      tFormat('engine.flowPreview.vars.removeRead', 'en', { name: 'amount', steps: 'Tell the owner, Big?' }),
    );
    expect(onWrite).not.toHaveBeenCalled();

    // The control: a variable no step reads renames and removes.
    rename(unused, 'spare');
    expect(onWrite).toHaveBeenLastCalledWith([{ name: 'amount', type: 'number' }, { name: 'spare', type: 'text' }]);
    fireEvent.click(within(rows()[1]).getByRole('button', { name: tFormat('engine.flowPreview.vars.remove', 'en', { name: 'spare' }) }));
    expect(onWrite).toHaveBeenLastCalledWith([{ name: 'amount', type: 'number' }]);
  });

  it('keeps an input that declares a record object an input, and its objectName rides along', () => {
    const onWrite = vi.fn();
    const lead = { name: 'lead_id', type: 'text', isInput: true, objectName: 'crm_lead' };
    render(<Host initial={[lead]} onWrite={onWrite} />);
    const [row] = rows();
    fireEvent.click(within(row).getByRole('checkbox', { name: en('engine.flowPreview.vars.input') }));
    expect(note(row)).toHaveTextContent(tFormat('engine.flowPreview.vars.inputRecord', 'en', { object: 'crm_lead' }));
    expect(onWrite).not.toHaveBeenCalled();
    fireEvent.click(within(row).getByRole('checkbox', { name: en('engine.flowPreview.vars.output') }));
    expect(onWrite).toHaveBeenLastCalledWith([{ ...lead, isOutput: true }]);
    expectSpecShaped(onWrite.mock.calls.at(-1)![0]);
  });

  it('the control: without onPatch the panel is the read-only list, with no add button', () => {
    render(<FlowVariablesPanel variables={[{ name: 'amount', type: 'number', isInput: true, defaultValue: 5 }]} nodes={NODES} locale="en" />);
    expect(screen.queryByRole('button', { name: en('engine.flowPreview.addVariable') })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    const [row] = rows();
    expect(row).toHaveTextContent('amount');
    expect(row).toHaveTextContent(en('engine.flowPreview.varIn'));
    expect(row).toHaveTextContent('= 5');
  });

  it('zh-CN: the panel reads its zh rows', () => {
    render(<FlowVariablesPanel variables={[]} nodes={NODES} locale="zh-CN" onPatch={() => {}} />);
    expect(screen.getByTestId('flow-variables-empty')).toHaveTextContent(t('engine.flowPreview.noVars', 'zh-CN'));
    expect(screen.getByRole('button', { name: '添加变量' })).toBeInTheDocument();
  });
});

describe('flowVariableReaders and nextFlowVariableName', () => {
  it('reads whole-word mentions only: not record.amount, not amounts', () => {
    const nodes = [
      { id: 'a', type: 'update_record', label: 'A', config: { fields: { total: '{{ record.amount }}' } } },
      { id: 'b', type: 'notify', label: 'B', config: { message: 'amounts due' } },
      { id: 'c', type: 'assignment', label: 'C', config: { amount: '{{ 1 }}' } },
      { id: 'amount', type: 'end', label: 'amount' },
    ];
    expect(flowVariableReaders('amount', nodes)).toEqual(['C']);
    expect(flowVariableReaders('amount', [], [{ condition: 'amount > 3' }], [], 'en')).toEqual([en('engine.flowPreview.vars.readerConnection')]);
    expect(flowVariableReaders('amount', [], [], ['Closed {{ amount }}'], 'en')).toEqual([en('engine.flowPreview.vars.readerMessages')]);
  });

  it('names the first free variable_N', () => {
    expect(nextFlowVariableName([{ name: 'variable_1' }, { name: 'variable_3' }])).toBe('variable_2');
  });
});
