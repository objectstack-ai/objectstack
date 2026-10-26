// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12329 — no flow designer site offers, prescribes or describes a
 * single-brace `{var}` token.
 *
 * objectstack#19939 S7 deleted the engine's single-brace resolver: a value slot
 * refuses a `{…}` token, a text slot reads `{{ }}` holes, and every other flow
 * string is a literal. The installed spec (`18.1.0`) publishes no
 * `xExpression: 'template'` mark. So the picker has two spellings left — the
 * bare reference and the `{{ }}` hole — and a literal position has no picker.
 *
 * - Every offline field with a text-like control, on a node of its type, is
 *   rendered; where it offers a picker, picking a reference writes no
 *   single-brace token. A text field outside the slots has no picker at all.
 * - A body-less loop's `collection` (the legacy form, whose executor reads the
 *   bare name of a list variable and which no door judges): the picker inserts
 *   the bare name, and a stored `{leadList}` is flagged with that bare name.
 * - A key/value map outside the slots (a connector action's `input`): its text
 *   cell has no picker.
 * - No help text or placeholder of any offline field, en or zh, carries a
 *   single-brace token.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FlowNodeConfigField } from './FlowNodeConfigField';
import { FLOW_NODE_CONFIG_TYPES, fieldsForNodeType, localizeFlowFields, type FlowConfigField } from './flow-node-config';
import type { ScopeGroup } from './useFlowScope';

afterEach(cleanup);

const PICK = 'Insert a reference';
const BODY = { nodes: [{ id: 'inner', type: 'assignment', label: 'Inner' }], edges: [] };

/**
 * A single-brace token as the dialect spelled it: one opening brace not part
 * of `{{`, a name with no space around it, one closing brace.
 */
const SINGLE_BRACE = /(^|[^{])\{[A-Za-z_$][\w.$]*\}(?!\})/;

function scope(tokens: string[]): ScopeGroup[] {
  return [{ id: 'variables', label: 'Flow variables', refs: tokens.map((token) => ({ token, label: token, group: 'variables' as const })) }];
}

function renderField(field: FlowConfigField, node: Record<string, unknown>, value: unknown) {
  const onCommit = vi.fn();
  render(
    <FlowNodeConfigField
      field={field}
      value={value}
      onCommit={onCommit}
      scopeGroups={scope(['customer'])}
      context={{ draft: {}, node: { id: 'n1', ...node } }}
    />,
  );
  return onCommit;
}

const configOf = (type: string): Record<string, unknown> => (type === 'loop' ? { body: BODY } : {});

const TEXT_LIKE = new Set(['text', 'textarea', 'expression']);
const textLikeFields = (type: string) =>
  fieldsForNodeType(type).filter((f) => TEXT_LIKE.has(f.kind) && f.path.length === 2);

describe('objectui#12329 — the pattern this file judges with', () => {
  it('fires on a single-brace token and not on a hole, a JSON operator or a JSON object', () => {
    expect('{leadList}').toMatch(SINGLE_BRACE);
    expect('Hi {record.name}').toMatch(SINGLE_BRACE);
    expect('{{ record.name }}').not.toMatch(SINGLE_BRACE);
    expect('{"$ne": null}').not.toMatch(SINGLE_BRACE);
    expect('{ "key": "value" }').not.toMatch(SINGLE_BRACE);
    // JS shorthand in prose (the script node's help) is not a token.
    expect('defineStack({ functions })').not.toMatch(SINGLE_BRACE);
  });
});

describe('objectui#12329 — a picker never writes a single-brace token', () => {
  const sites = FLOW_NODE_CONFIG_TYPES.flatMap((type) => textLikeFields(type).map((f) => [type, f] as const));

  it('covers the fields that used to offer one', () => {
    const ids = sites.map(([type, f]) => `${type}.${f.path[1]}`);
    for (const id of ['loop.collection', 'map.collection', 'loop.iteratorVariable', 'create_record.outputVariable', 'notify.topic']) {
      expect(ids).toContain(id);
    }
  });

  for (const [type, field] of sites) {
    it(`${type}.${field.path[1]}`, async () => {
      const onCommit = renderField(field, { type, config: configOf(type) }, '');
      const picker = screen.queryByRole('button', { name: PICK });
      if (!picker) return;
      await userEvent.click(picker);
      const option = (await screen.findAllByRole('option')).find((o) => within(o).queryByText(/customer/));
      expect(option).toBeDefined();
      await userEvent.click(option!);
      const value = onCommit.mock.calls.at(-1)?.[0];
      const written = typeof value === 'string' ? value : JSON.stringify(value);
      expect(written).toContain('customer');
      expect(written).not.toMatch(SINGLE_BRACE);
    });
  }

  it('a text field outside the slots is a literal: no picker', () => {
    // Fields whose value no flow reads as a reference: names and literals.
    for (const [type, key] of [
      ['loop', 'iteratorVariable'],
      ['map', 'outputVariable'],
      ['create_record', 'outputVariable'],
      ['notify', 'topic'],
      ['notify', 'sourceObject'],
      ['try_catch', 'errorVariable'],
    ] as const) {
      const field = fieldsForNodeType(type).find((f) => f.path[1] === key)!;
      expect(field.refMode, `${type}.${key}`).toBeUndefined();
      renderField(field, { type, config: configOf(type) }, '');
      expect(screen.queryByRole('button', { name: PICK }), `${type}.${key}`).toBeNull();
      cleanup();
    }
  });

  it('control: a text slot and an expression field keep their picker', () => {
    for (const [type, key] of [
      ['notify', 'title'],
      ['decision', 'condition'],
    ] as const) {
      const field = fieldsForNodeType(type).find((f) => f.path[1] === key)!;
      renderField(field, { type, config: {} }, '');
      expect(screen.getByRole('button', { name: PICK }), `${type}.${key}`).toBeInTheDocument();
      cleanup();
    }
  });
});

describe('objectui#12329 — a body-less loop reads collection as a bare variable name', () => {
  const collection = () => fieldsForNodeType('loop').find((f) => f.path[1] === 'collection')!;

  it('the picker inserts the bare name', async () => {
    const onCommit = renderField(collection(), { type: 'loop', config: {} }, '');
    await userEvent.click(screen.getByRole('button', { name: PICK }));
    await userEvent.click(await screen.findByRole('option'));
    expect(onCommit).toHaveBeenLastCalledWith('customer');
  });

  it('a stored {leadList} is flagged, with the bare name as the fix', () => {
    renderField(collection(), { type: 'loop', config: {} }, '{leadList}');
    const alert = screen.getByRole('alert').textContent ?? '';
    expect(alert).toContain('`leadList`');
  });

  it('control: the bare name is clean', () => {
    renderField(collection(), { type: 'loop', config: {} }, 'customer');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('objectui#12329 — a key/value map outside the slots has literal text cells', () => {
  it('connector_action input: the text cell has no picker', () => {
    const input = fieldsForNodeType('connector_action').find((f) => f.path[1] === 'input')!;
    expect(input.kind).toBe('keyValue');
    renderField(input, { type: 'connector_action', connectorConfig: {} }, { channel: 'general' });
    expect(screen.getByDisplayValue('general')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: PICK })).toBeNull();
  });

  it('control: http headers, a {{ }} text-slot map, keeps its hole picker', async () => {
    const headers = fieldsForNodeType('http').find((f) => f.path[1] === 'headers')!;
    renderField(headers, { type: 'http', config: {} }, { Authorization: '' });
    expect(screen.getByRole('button', { name: PICK })).toBeInTheDocument();
  });
});

describe('objectui#12329 — no help text or placeholder prescribes a single-brace token', () => {
  for (const locale of ['en-US', 'zh-CN']) {
    it(locale, () => {
      const offenders: string[] = [];
      for (const type of FLOW_NODE_CONFIG_TYPES) {
        for (const f of localizeFlowFields(type, fieldsForNodeType(type), locale)) {
          for (const [what, text] of [
            ['help', f.help],
            ['placeholder', f.placeholder],
          ] as const) {
            if (typeof text === 'string' && SINGLE_BRACE.test(text)) offenders.push(`${type}.${f.id} ${what}: ${text}`);
          }
        }
      }
      expect(offenders).toEqual([]);
    });
  }
});
