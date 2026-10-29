// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27356 (hotcrm#2320 Studio S5) — a Create Record node's field
 * names were cut to four or five characters ("subj", "dueD"): each map row put
 * the field box, the value box and two buttons on one line, so the narrow
 * inspector split its width between them. A row now stacks: the field on its
 * own line beside the remove button, the value on the line under it beside the
 * text / expression toggle.
 *
 * jsdom draws no layout, so the pin is the row's structure, read through
 * `FlowNodeConfigField` (the editor's only caller) on a `create_record` node:
 * the field box never shares a line with the value box. The same editor draws
 * every key / value map in the flow inspector; the HTTP `headers` map is the
 * second case, a map with no value toggle.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: [], loading: false, error: null }),
}));

import { FlowNodeConfigField } from './FlowNodeConfigField';
import type { FlowConfigField } from './flow-node-config';

afterEach(cleanup);

const TOGGLE = 'Write as a CEL expression';
const REMOVE = /remove/i;
const LONG_FIELD = 'customer_satisfaction_score';

function renderMap(field: FlowConfigField, nodeType: string, value: Record<string, unknown>) {
  render(
    <FlowNodeConfigField
      field={field}
      value={value}
      onCommit={vi.fn()}
      context={{ draft: {}, node: { id: 'n1', type: nodeType, config: { objectName: 'case' } } }}
    />,
  );
}

/** The line a box sits on: the row's key line or value line. */
const lineOf = (el: HTMLElement) => el.closest('[data-testid^="flow-kv-"]') as HTMLElement;

describe('a key / value map row stacks the field over its value (objectstack#27356)', () => {
  it('Create Record: the long field name has its own line, beside the remove button only', () => {
    renderMap(
      { id: 'fields', path: ['config', 'fields'], label: 'Field values', kind: 'keyValue' },
      'create_record',
      { [LONG_FIELD]: '5' },
    );
    const key = screen.getByDisplayValue(LONG_FIELD);
    const value = screen.getByDisplayValue('5');
    const keyLine = lineOf(key);

    expect(keyLine.contains(value)).toBe(false);
    expect(keyLine.querySelectorAll('input')).toHaveLength(1);
    const buttons = [...keyLine.querySelectorAll('button')];
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.getAttribute('aria-label')).toMatch(REMOVE);

    // The value's line carries the text / expression toggle, under the field.
    const valueLine = lineOf(value);
    expect(valueLine).not.toBe(keyLine);
    expect(valueLine.contains(screen.getByRole('button', { name: TOGGLE }))).toBe(true);
    expect(keyLine.compareDocumentPosition(valueLine) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('a map with no value toggle (HTTP headers) stacks the same way', () => {
    renderMap(
      { id: 'headers', path: ['config', 'headers'], label: 'Headers', kind: 'keyValue' },
      'http',
      { 'X-Request-Correlation-Id': 'abc' },
    );
    const key = screen.getByDisplayValue('X-Request-Correlation-Id');
    expect(lineOf(key).contains(screen.getByDisplayValue('abc'))).toBe(false);
    expect(screen.queryByRole('button', { name: TOGGLE })).toBeNull();
  });
});
