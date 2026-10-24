// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12372 — the rest of objectui#12101's value slots: Studio stops
 * inserting or prescribing the single-brace `{var}` token the installed
 * `@objectstack/spec` refuses there (ADR-0032 Decisions 2 and 3).
 *
 * Sites (`value` rows of `FLOW_NODE_EXPRESSION_PATHS`): loop / map
 * `collection`, the CRUD `filter` operands, notify `sourceId` and
 * `templateData.*`, http `body`, screen `recordId` and `fields[].defaultValue`.
 * What is pinned:
 *   1. the installed spec refuses `{x}` at every site and accepts a CEL value
 *      envelope and the site's literal;
 *   2. a field whose whole value is one value slot renders a text cell with no
 *      picker and an expression cell that stores an envelope, whose picker
 *      inserts the bare reference; a stored `{token}` shows the spec's refusal
 *      naming its CEL spelling — offline, and on a served descriptor field;
 *   3. a body-less `loop` (the legacy form, which reads a bare name and no door
 *      judges) keeps the descriptor's control: the spec's `onlyWithKey`;
 *   4. a CRUD `filter` map is a value map whose operands are judged by the
 *      spec's filter-operand rule: `{recordId}` is refused, the query
 *      placeholder `{today}` is not;
 *   5. no help text or placeholder of these fields, en or zh, prescribes a
 *      `{var}` token.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  DeleteRecordConfigSchema,
  FLOW_NODE_EXPRESSION_PATHS,
  GetRecordConfigSchema,
  HttpConfigSchema,
  LoopConfigSchema,
  MapConfigSchema,
  NotifyConfigSchema,
  ScreenConfigSchema,
  UpdateRecordConfigSchema,
} from '@objectstack/spec/automation';
import { FlowNodeConfigField } from './FlowNodeConfigField';
import { fieldsForNodeType, mergeServerFlowFields, type FlowConfigField } from './flow-node-config';
import { jsonSchemaToFlowFields } from './json-schema-to-fields';
import { flowFieldZh } from '../i18n';
import type { ScopeGroup } from './useFlowScope';

afterEach(cleanup);

const PICK = 'Insert a reference';
const TOGGLE = 'Write as a CEL expression';
const env = (source: string) => ({ dialect: 'cel', source });
const BODY = { nodes: [{ id: 'inner', type: 'assignment', label: 'Inner' }], edges: [] };

const fieldOf = (type: string, key: string): FlowConfigField => {
  const f = fieldsForNodeType(type).find((x) => x.path[0] === 'config' && x.path[1] === key);
  if (!f) throw new Error(`no ${type}.${key} field`);
  return f;
};

function scope(tokens: string[]): ScopeGroup[] {
  return [{ id: 'variables', label: 'Flow variables', refs: tokens.map((token) => ({ token, label: token, group: 'variables' as const })) }];
}

function renderField(
  field: FlowConfigField,
  node: Record<string, unknown>,
  value: unknown,
  groups: ScopeGroup[] = scope(['customer']),
) {
  const onCommit = vi.fn();
  render(
    <FlowNodeConfigField
      field={field}
      value={value}
      onCommit={onCommit}
      scopeGroups={groups}
      context={{ draft: {}, node: { id: 'n1', ...node } }}
    />,
  );
  return onCommit;
}

const valueRow = (nodeType: string, path: string) =>
  FLOW_NODE_EXPRESSION_PATHS.find((r) => r.nodeType === nodeType && r.path === path && r.role === 'value');

describe('objectui#12372 — the installed spec refuses {x} at each site', () => {
  // [spec node type, ledger path, parse(value), a literal the site accepts]
  const SITES: Array<[string, string, (v: unknown) => boolean, unknown]> = [
    ['loop', 'collection', (v) => LoopConfigSchema.safeParse({ collection: v, body: BODY }).success, ['a', 'b']],
    ['map', 'collection', (v) => MapConfigSchema.safeParse({ collection: v, flowName: 'per_item' }).success, ['a', 'b']],
    ['update_record', 'filter', (v) => UpdateRecordConfigSchema.safeParse({ objectName: 'account', filter: { id: v }, fields: { a: 1 } }).success, 'acc_1'],
    ['delete_record', 'filter', (v) => DeleteRecordConfigSchema.safeParse({ objectName: 'account', filter: { id: v } }).success, 'acc_1'],
    ['get_record', 'filter', (v) => GetRecordConfigSchema.safeParse({ objectName: 'account', filter: { id: v } }).success, 'acc_1'],
    ['notify', 'sourceId', (v) => NotifyConfigSchema.safeParse({ recipients: ['usr_1'], title: 't', sourceObject: 'account', sourceId: v }).success, 'acc_1'],
    ['notify', 'templateData.*', (v) => NotifyConfigSchema.safeParse({ recipients: ['usr_1'], template: 'welcome', templateData: { name: v } }).success, 'Acme'],
    ['http', 'body', (v) => HttpConfigSchema.safeParse({ url: 'https://a', method: 'POST', body: v }).success, { key: 'value' }],
    ['screen', 'recordId', (v) => ScreenConfigSchema.safeParse({ objectName: 'account', mode: 'edit', recordId: v }).success, 'acc_1'],
    ['screen', 'fields[].defaultValue', (v) => ScreenConfigSchema.safeParse({ fields: [{ name: 'f', label: 'F', type: 'text', defaultValue: v }] }).success, 'Acme'],
  ];
  for (const [type, path, parses, literal] of SITES) {
    it(`${type}.${path} is a value row, refuses {x} and {{ x }}, accepts a CEL value envelope and a literal`, () => {
      expect(valueRow(type, path)).toBeDefined();
      expect(parses('{x}')).toBe(false);
      expect(parses('{{ x }}')).toBe(false);
      expect(parses(env('x'))).toBe(true);
      expect(parses(literal)).toBe(true);
    });
  }

  it('a collection refuses a bare variable name, the spelling the old placeholder taught minus its braces', () => {
    expect(MapConfigSchema.safeParse({ collection: 'items', flowName: 'per_item' }).success).toBe(false);
  });

  it('an http body refuses a JSON string, and accepts the object it spells', () => {
    expect(HttpConfigSchema.safeParse({ url: 'https://a', body: '{ "key": "value" }' }).success).toBe(false);
    expect(HttpConfigSchema.safeParse({ url: 'https://a', body: { key: 'value' } }).success).toBe(true);
  });

  it('a filter operand keeps a whole query placeholder such as {today}', () => {
    expect(GetRecordConfigSchema.safeParse({ objectName: 'task', filter: { due: '{today}' } }).success).toBe(true);
    expect(GetRecordConfigSchema.safeParse({ objectName: 'task', filter: { owner: '{recordId}' } }).success).toBe(false);
  });
});

/** `[designer group, config key, node as stored]` of the fields whose whole value is one value slot. */
const SCALAR_SLOTS: Array<[string, string, Record<string, unknown>]> = [
  ['map', 'collection', { type: 'map', config: { flowName: 'per_item' } }],
  ['loop', 'collection', { type: 'loop', config: { body: BODY } }],
  ['notify', 'sourceId', { type: 'notify', config: { sourceObject: 'account' } }],
  ['http', 'body', { type: 'http', config: { url: 'https://a' } }],
];

describe('objectui#12372 — a field whose whole value is one value slot writes a literal or a CEL value envelope', () => {
  for (const [group, key, node] of SCALAR_SLOTS) {
    it(`${group}.${key}: the expression cell's picker inserts a bare reference and stores an envelope`, async () => {
      const field = fieldOf(group, key);
      const onCommit = renderField(field, node, undefined);
      if (field.kind === 'expression') {
        // A collection's literal is never a string, so it opens on the expression cell.
        expect(screen.getByRole('button', { name: TOGGLE })).toHaveAttribute('aria-pressed', 'true');
      } else {
        // A text cell first, with no picker; switch it to an expression.
        expect(screen.queryByRole('button', { name: PICK })).toBeNull();
        await userEvent.click(screen.getByRole('button', { name: TOGGLE }));
      }
      await userEvent.click(screen.getByRole('button', { name: PICK }));
      await userEvent.click(await screen.findByRole('option'));
      expect(onCommit).toHaveBeenLastCalledWith(env('customer'));
    });

    it(`${group}.${key}: a stored {token} shows the refusal with its CEL spelling`, () => {
      const field = fieldOf(group, key);
      renderField(field, node, '{account.id}');
      const alert = screen.getByRole('alert').textContent ?? '';
      expect(alert).toContain("{ dialect: 'cel', source: 'account.id' }");
      // The text cell holding it carries no picker that could write another.
      expect(screen.queryByRole('button', { name: PICK })).toBeNull();
    });

    it(`${group}.${key}: a stored envelope opens on the expression cell and is clean`, () => {
      renderField(fieldOf(group, key), node, env('customer'));
      expect(screen.getByRole('button', { name: TOGGLE })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByDisplayValue('customer')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).toBeNull();
    });
  }

  it('map.collection: the text cell writes an inline array from its JSON', () => {
    const onCommit = renderField(fieldOf('map', 'collection'), SCALAR_SLOTS[0][2], ['a']);
    expect(screen.getByRole('button', { name: TOGGLE })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.change(screen.getByDisplayValue('["a"]'), { target: { value: '["a", "b"]' } });
    expect(onCommit).toHaveBeenLastCalledWith(['a', 'b']);
  });

  it('map.collection: a bare variable name in the text cell shows the contract refusal naming the envelope', () => {
    renderField(fieldOf('map', 'collection'), SCALAR_SLOTS[0][2], 'items');
    expect(screen.getByRole('alert').textContent).toContain("{ dialect: 'cel'");
  });

  it('http.body: JSON typed in the text cell is stored as the object it spells', () => {
    const onCommit = renderField(fieldOf('http', 'body'), SCALAR_SLOTS[3][2], undefined);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '{ "key": "value" }' } });
    expect(onCommit).toHaveBeenLastCalledWith({ key: 'value' });
  });

  it('notify.sourceId: toggling carries the typed text over as the expression source', async () => {
    const onCommit = renderField(fieldOf('notify', 'sourceId'), SCALAR_SLOTS[2][2], 'record');
    await userEvent.click(screen.getByRole('button', { name: TOGGLE }));
    expect(onCommit).toHaveBeenLastCalledWith(env('record'));
  });
});

describe('objectui#12372 — the spec decides which positions are value slots', () => {
  it('a body-less loop (the legacy form, judged by no door) keeps the descriptor control', () => {
    renderField(fieldOf('loop', 'collection'), { type: 'loop', config: {} }, 'leadList');
    expect(screen.queryByRole('button', { name: TOGGLE })).toBeNull();
  });

  it('a served notify sourceId and screen recordId (plain strings in the descriptor) get the value-slot control', async () => {
    const served = jsonSchemaToFlowFields({
      type: 'object',
      properties: {
        sourceId: { type: 'string', title: 'Link record id' },
        recordId: { type: 'string', title: 'Record to edit' },
      },
    })!;
    for (const [type, key] of [['notify', 'sourceId'], ['screen', 'recordId']] as const) {
      const field = served.find((f) => f.path[1] === key)!;
      // Left to the descriptor, a served string defaults to the `{var}` picker.
      expect(field.refMode).toBeUndefined();
      const onCommit = renderField(field, { type, config: {} }, undefined);
      expect(screen.queryByRole('button', { name: PICK })).toBeNull();
      await userEvent.click(screen.getByRole('button', { name: TOGGLE }));
      await userEvent.click(screen.getByRole('button', { name: PICK }));
      await userEvent.click(await screen.findByRole('option'));
      expect(onCommit).toHaveBeenLastCalledWith(env('customer'));
      cleanup();
    }
  });

  // objectui#12329 — the installed spec marks the descriptor's `collection`
  // `xExpression: 'value'`; an older server's retired `'template'` mark maps to
  // the same plain text field. Either way the ledger decides the control.
  for (const marker of ['value', 'template']) {
    it(`a served collection marked '${marker}' gets the value-slot control`, () => {
      const served = jsonSchemaToFlowFields({
        type: 'object',
        properties: { collection: { type: 'string', title: 'Collection', xExpression: marker }, flowName: { type: 'string' } },
      });
      const field = mergeServerFlowFields(served, 'map').find((f) => f.path[1] === 'collection')!;
      expect(field.refMode).toBeUndefined();
      renderField(field, { type: 'map', config: { flowName: 'per_item' } }, '{items}');
      expect(screen.getByRole('button', { name: TOGGLE })).toBeInTheDocument();
      expect(screen.getByRole('alert').textContent).toContain("{ dialect: 'cel', source: 'items' }");
    });
  }
});

describe('objectui#12372 — a CRUD filter is a value map judged by the filter-operand rule', () => {
  for (const type of ['update_record', 'delete_record', 'get_record']) {
    it(`${type}.filter: the text cell has no picker; the expression cell stores an envelope`, async () => {
      const onCommit = renderField(fieldOf(type, 'filter'), { type, config: { objectName: 'account' } }, { id: 'acc_1' });
      expect(screen.queryByRole('button', { name: PICK })).toBeNull();
      await userEvent.click(screen.getByRole('button', { name: TOGGLE }));
      expect(onCommit).toHaveBeenLastCalledWith({ id: env('acc_1') });
      fireEvent.change(screen.getByDisplayValue('acc_1'), { target: { value: '' } });
      await userEvent.click(screen.getByRole('button', { name: PICK }));
      await userEvent.click(await screen.findByRole('option'));
      fireEvent.blur(screen.getByDisplayValue('customer'));
      expect(onCommit).toHaveBeenLastCalledWith({ id: env('customer') });
    });

    it(`${type}.filter: {recordId} is refused with its CEL spelling, {today} and an operator object are not`, () => {
      renderField(fieldOf(type, 'filter'), { type, config: { objectName: 'account' } }, { id: '{recordId}' });
      expect(screen.getByRole('alert').textContent).toContain("{ dialect: 'cel', source: 'recordId' }");
      cleanup();
      renderField(fieldOf(type, 'filter'), { type, config: { objectName: 'account' } }, { due: '{today}', owner: { $ne: null } });
      expect(screen.queryByRole('alert')).toBeNull();
    });
  }
});

describe('objectui#12372 — no help text or placeholder prescribes a {var} token', () => {
  // A single-brace token naming a variable path — not half of a `{{ … }}` hole,
  // and not JSON (`{"$ne": null}`, `{ "key": "value" }`).
  const VAR_TOKEN = /(^|[^{])\{\s*[A-Za-z_$][\w.$]*\s*\}(?!\})/;
  const SITES: Array<[string, string]> = [
    ['loop', 'collection'],
    ['map', 'collection'],
    ['update_record', 'filter'],
    ['delete_record', 'filter'],
    ['get_record', 'filter'],
    ['notify', 'sourceId'],
    ['http', 'body'],
  ];
  it('the pattern catches the spellings it guards against', () => {
    for (const bad of ['{leadList}', '{items}', 'id → {recordId}']) expect(bad).toMatch(VAR_TOKEN);
    for (const ok of ['{{ customer }}', '{"$ne": null}', '{ "key": "value" }']) expect(ok).not.toMatch(VAR_TOKEN);
  });
  for (const [type, key] of SITES) {
    it(`${type}.${key}`, () => {
      const f = fieldOf(type, key);
      for (const text of [f.help, f.placeholder, flowFieldZh(type, key)?.help]) {
        expect(text ?? '', String(text)).not.toMatch(VAR_TOKEN);
      }
    });
  }
});
