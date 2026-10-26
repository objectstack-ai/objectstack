// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12101 — Studio stops authoring the single-brace `{var}` dialect in
 * the flow slots the installed `@objectstack/spec` refuses it in (ADR-0032
 * Decisions 2 and 3; the objectui half of objectstack#19939 pass 4, S1, plus
 * the sites carried from objectui#11824).
 *
 * Value slots (`value` rows of `FLOW_NODE_EXPRESSION_PATHS`): subflow
 * `input.*`, script `inputs.*`, screen `defaults.*`. Each value is a literal or
 * a CEL value envelope. Text slots (`FLOW_NODE_TEXT_SLOTS`): notify
 * `actionUrl`, http `url`, each http `headers` value. Each renders `{{ }}`
 * holes. What is pinned:
 *   1. the installed spec refuses `{x}` at every one of these sites and
 *      accepts the spelling the designer now writes;
 *   2. the hole-mode set is exactly the text slots the spec names;
 *   3. a value slot's text cell is a literal with no picker, its expression
 *      cell's picker inserts a bare reference, and a stored `{token}` shows the
 *      spec's refusal naming its CEL spelling;
 *   4. a header value's picker inserts `{{ x }}` and a single brace there is
 *      flagged with the double-brace fix;
 *   5. no help text of these fields, en or zh, prescribes a single-brace token.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  FLOW_NODE_EXPRESSION_PATHS,
  FLOW_NODE_TEXT_SLOTS,
  HttpConfigSchema,
  NotifyConfigSchema,
  ScreenConfigSchema,
  ScriptConfigSchema,
  SubflowConfigSchema,
} from '@objectstack/spec/automation';
import { FlowNodeConfigField } from './FlowNodeConfigField';
import { FLOW_NODE_CONFIG_TYPES, fieldsForNodeType, mergeServerFlowFields, type FlowConfigField } from './flow-node-config';
import { jsonSchemaToFlowFields } from './json-schema-to-fields';
import { flowFieldZh } from '../i18n';
import type { ScopeGroup } from './useFlowScope';

afterEach(cleanup);

const PICK = 'Insert a reference';
const TOGGLE = 'Write as a CEL expression';
const env = (source: string) => ({ dialect: 'cel', source });


const fieldOf = (type: string, key: string): FlowConfigField => {
  const f = fieldsForNodeType(type).find((x) => x.path[0] === 'config' && x.path[1] === key);
  if (!f) throw new Error(`no ${type}.${key} field`);
  return f;
};

function scope(tokens: string[]): ScopeGroup[] {
  return [{ id: 'variables', label: 'Flow variables', refs: tokens.map((token) => ({ token, label: token, group: 'variables' as const })) }];
}

/** `[spec node type, config key]` of the three value maps. */
const VALUE_MAPS: Array<[string, string]> = [
  ['subflow', 'input'],
  ['script', 'inputs'],
  ['screen', 'defaults'],
];

describe('objectui#12101 — the installed spec refuses {x} at each site', () => {
  const valueMap: Record<string, (v: unknown) => boolean> = {
    subflow: (v) => SubflowConfigSchema.safeParse({ flowName: 'child', input: { a: v } }).success,
    script: (v) => ScriptConfigSchema.safeParse({ function: 'score', inputs: { a: v } }).success,
    screen: (v) => ScreenConfigSchema.safeParse({ objectName: 'account', defaults: { a: v } }).success,
  };
  for (const [type, key] of VALUE_MAPS) {
    it(`${type}.${key}.* is a value row, refuses {x} and {{ x }}, accepts a literal and a CEL value envelope`, () => {
      expect(FLOW_NODE_EXPRESSION_PATHS.some((r) => r.nodeType === type && r.path === `${key}.*` && r.role === 'value')).toBe(true);
      expect(valueMap[type]('{x}')).toBe(false);
      expect(valueMap[type]('{{ x }}')).toBe(false);
      expect(valueMap[type]('Acme')).toBe(true);
      expect(valueMap[type](env('x'))).toBe(true);
    });
  }

  const textSlot: Array<[string, (v: string) => boolean]> = [
    ['notify.actionUrl', (v) => NotifyConfigSchema.safeParse({ recipients: ['usr_1'], title: 't', actionUrl: v }).success],
    ['http.url', (v) => HttpConfigSchema.safeParse({ url: v }).success],
    ['http.headers', (v) => HttpConfigSchema.safeParse({ url: 'https://a', headers: { 'X-A': v } }).success],
  ];
  for (const [slot, parses] of textSlot) {
    it(`${slot} is a text slot, refuses {x}, accepts {{ x }}`, () => {
      const [type, key] = slot.split('.');
      expect(FLOW_NODE_TEXT_SLOTS.some((s) => s.nodeType === type && s.key === key)).toBe(true);
      expect(parses('/a/{x}')).toBe(false);
      expect(parses('/a/{{ x }}')).toBe(true);
    });
  }
});

describe('objectui#12101 — hole mode is exactly the text slots the spec names', () => {
  it('every spec text slot the designer renders is a hole-mode field, and no other field is', () => {
    const holeFields = FLOW_NODE_CONFIG_TYPES.flatMap((type) =>
      fieldsForNodeType(type)
        .filter((f) => f.refMode === 'hole')
        .map((f) => `${type}.${f.path[1]}`),
    );
    const rendered = FLOW_NODE_TEXT_SLOTS.filter((s) =>
      fieldsForNodeType(s.nodeType).some((f) => f.path[0] === 'config' && f.path[1] === s.key),
    ).map((s) => `${s.nodeType}.${s.key}`);
    expect(holeFields.sort()).toEqual(rendered.sort());
  });

  it('a served http url / headers keeps hole mode (the descriptor marks neither)', () => {
    const served = jsonSchemaToFlowFields({
      type: 'object',
      properties: {
        url: { type: 'string', title: 'URL' },
        headers: { type: 'object', additionalProperties: { type: 'string' }, title: 'Headers' },
        method: { type: 'string', title: 'Method' },
      },
    });
    const merged = mergeServerFlowFields(served, 'http');
    const modeOf = (k: string) => merged.find((f) => f.path[1] === k)?.refMode;
    expect(modeOf('url')).toBe('hole');
    expect(modeOf('headers')).toBe('hole');
    expect(modeOf('method')).toBeUndefined();
  });

  for (const [type, key] of [['notify', 'actionUrl'], ['http', 'url']] as const) {
    it(`${type}.${key}: the picker inserts a double-brace hole`, async () => {
      const commits: unknown[] = [];
      render(<FlowNodeConfigField field={fieldOf(type, key)} value="/a/" onCommit={(v) => commits.push(v)} scopeGroups={scope(['customer'])} />);
      await userEvent.click(screen.getByRole('button', { name: PICK }));
      await userEvent.click(await screen.findByRole('option'));
      expect(commits[commits.length - 1]).toBe('/a/{{ customer }}');
    });
  }
});

function renderMap(type: string, key: string, value: unknown, groups: ScopeGroup[] = scope(['customer'])) {
  const onCommit = vi.fn();
  render(
    <FlowNodeConfigField
      field={fieldOf(type, key)}
      value={value}
      onCommit={onCommit}
      scopeGroups={groups}
      context={{ draft: {}, node: { id: 'n1', type } }}
    />,
  );
  return onCommit;
}

describe('objectui#12101 — a value map writes a literal or a CEL value envelope', () => {
  for (const [type, key] of VALUE_MAPS) {
    it(`${type}.${key}: a text cell has no picker; its expression cell's picker inserts a bare reference`, async () => {
      const onCommit = renderMap(type, key, { a: 'Acme' });
      expect(screen.queryByRole('button', { name: PICK })).toBeNull();
      await userEvent.click(screen.getByRole('button', { name: TOGGLE }));
      expect(onCommit).toHaveBeenLastCalledWith({ a: env('Acme') });
      const source = screen.getByDisplayValue('Acme') as HTMLInputElement;
      fireEvent.change(source, { target: { value: '' } });
      await userEvent.click(screen.getByRole('button', { name: PICK }));
      await userEvent.click(await screen.findByRole('option'));
      fireEvent.blur(screen.getByDisplayValue('customer'));
      expect(onCommit).toHaveBeenLastCalledWith({ a: env('customer') });
    });

    it(`${type}.${key}: a stored {token} shows the refusal with its CEL spelling`, () => {
      renderMap(type, key, { account: '{account.id}' });
      const alert = screen.getByRole('alert').textContent ?? '';
      expect(alert).toContain("{ dialect: 'cel', source: 'account.id' }");
    });
  }
});

describe('objectui#12101 — each http header value renders {{ }} holes', () => {
  it('the picker inserts {{ x }}', async () => {
    const onCommit = renderMap('http', 'headers', { Authorization: 'Bearer ' });
    await userEvent.click(screen.getByRole('button', { name: PICK }));
    await userEvent.click(await screen.findByRole('option'));
    fireEvent.blur(screen.getByDisplayValue('Bearer {{ customer }}'));
    expect(onCommit).toHaveBeenLastCalledWith({ Authorization: 'Bearer {{ customer }}' });
  });

  it('a single brace is flagged with the double-brace fix; a hole is clean', () => {
    renderMap('http', 'headers', { 'X-A': '{record.id}' });
    expect(screen.getByRole('alert').textContent).toContain('{{ record.id }}');
    cleanup();
    renderMap('http', 'headers', { 'X-A': '{{ customer }}' });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('note')).toBeNull();
  });
});

describe('objectui#12101 — no help text prescribes a single-brace token', () => {
  // A `{…}` that is not half of a `{{ … }}` hole.
  const SINGLE_BRACE = /(^|[^{])\{[^{}]+\}(?!\})/;
  const SITES: Array<[string, string]> = [
    ['subflow', 'input'],
    ['script', 'inputs'],
    ['screen', 'defaults'],
    ['notify', 'actionUrl'],
    ['http', 'url'],
    ['http', 'headers'],
  ];
  for (const [type, key] of SITES) {
    it(`${type}.${key}`, () => {
      const f = fieldOf(type, key);
      for (const text of [f.help, f.placeholder, flowFieldZh(type, key)?.help]) {
        expect(text ?? '', String(text)).not.toMatch(SINGLE_BRACE);
      }
    });
  }
});
