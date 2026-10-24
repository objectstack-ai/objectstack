// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11824 — Studio's flow text slots insert and prescribe `{{ }}`
 * (ADR-0032 §3, the objectui half of objectstack#22110).
 *
 * The slots are the five objectstack#22110 converted: the notify node's `title`
 * / `message`, the screen node's `title` / `description`, and the end node's
 * `message`. What is pinned:
 *   1. the installed spec refuses a single-brace token in each of them and
 *      accepts the `{{ }}` hole, so the form follows the contract;
 *   2. each of them, offline and served, is in `hole` mode, and its picker
 *      inserts `{{ x }}`;
 *   3. a single brace there is flagged, naming the `{{ }}` fix; a hole is clean;
 *   4. a CEL role's brace check is unchanged;
 *   5. a slot outside the five keeps its single-brace template mode;
 *   6. the screen preview renders `{{ }}` holes and leaves a single brace as
 *      written.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EndConfigSchema, FLOW_NODE_TEXT_SLOTS, NotifyConfigSchema, ScreenConfigSchema } from '@objectstack/spec/automation';
import { FlowNodeConfigField } from './FlowNodeConfigField';
import { FLOW_NODE_CONFIG_TYPES, fieldsForNodeType, mergeServerFlowFields, type FlowConfigField } from './flow-node-config';
import { jsonSchemaToFlowFields } from './json-schema-to-fields';
import { validateExpressionClient } from './expression-validate';
import type { ScopeGroup } from './useFlowScope';
import { interpolateHoles } from '../previews/screen-spec';

afterEach(cleanup);

const PICK = 'Insert a reference';

/** The five slots, as `[node type, config key]`. */
const CONVERTED: Array<[string, string]> = [
  ['notify', 'title'],
  ['notify', 'message'],
  ['screen', 'title'],
  ['screen', 'description'],
  ['end', 'message'],
];

const fieldOf = (type: string, key: string): FlowConfigField => {
  const f = fieldsForNodeType(type).find((x) => x.path[0] === 'config' && x.path[1] === key);
  if (!f) throw new Error(`no ${type}.${key} field`);
  return f;
};

function scope(tokens: string[]): ScopeGroup[] {
  return [{ id: 'variables', label: 'Flow variables', refs: tokens.map((token) => ({ token, label: token, group: 'variables' as const })) }];
}

describe('objectui#11824 — the installed spec is the contract the slots follow', () => {
  const parse: Record<string, (key: string, text: string) => boolean> = {
    notify: (key, text) => NotifyConfigSchema.safeParse({ recipients: ['usr_1'], title: 't', [key]: text }).success,
    screen: (key, text) => ScreenConfigSchema.safeParse({ [key]: text }).success,
    end: (key, text) => EndConfigSchema.safeParse({ outcome: 'refused', [key]: text }).success,
  };

  for (const [type, key] of CONVERTED) {
    it(`${type}.${key} refuses {name} and accepts {{ name }}`, () => {
      expect(parse[type](key, 'Hi {name}')).toBe(false);
      expect(parse[type](key, 'Hi {{ name }}')).toBe(true);
    });
  }

  // objectui#12101 widened the hole-mode set to every text slot the spec names
  // (notify `actionUrl`, http `url` / `headers` joined); its own file pins the
  // whole set against `FLOW_NODE_TEXT_SLOTS`. Here: the five are in it.
  it('every hole-mode field is a text slot the spec names, and the five are hole-mode fields', () => {
    const specSlots = new Set(FLOW_NODE_TEXT_SLOTS.map((s) => `${s.nodeType}.${s.key}`));
    const holeFields = FLOW_NODE_CONFIG_TYPES.flatMap((type) =>
      fieldsForNodeType(type)
        .filter((f) => f.refMode === 'hole')
        .map((f) => `${type}.${f.path[1]}`),
    );
    for (const slot of holeFields) expect(specSlots.has(slot), slot).toBe(true);
    for (const [t, k] of CONVERTED) expect(holeFields, `${t}.${k}`).toContain(`${t}.${k}`);
  });
});

describe('objectui#11824 — each converted slot inserts {{ x }}', () => {
  for (const [type, key] of CONVERTED) {
    it(`${type}.${key}: the picker inserts a double-brace hole`, async () => {
      const commits: unknown[] = [];
      render(<FlowNodeConfigField field={fieldOf(type, key)} value="Hi " onCommit={(v) => commits.push(v)} scopeGroups={scope(['customer'])} />);
      await userEvent.click(screen.getByRole('button', { name: PICK }));
      await userEvent.click(await screen.findByRole('option'));
      expect(commits[commits.length - 1]).toBe('Hi {{ customer }}');
    });
  }

  it('a served screen title / description keeps hole mode (the descriptor marks neither)', () => {
    const served = jsonSchemaToFlowFields({
      type: 'object',
      properties: {
        title: { type: 'string', title: 'Title' },
        description: { type: 'string', format: 'multiline', title: 'Description' },
        objectName: { type: 'string', title: 'Object form' },
      },
    });
    const merged = mergeServerFlowFields(served, 'screen');
    const modeOf = (k: string) => merged.find((f) => f.path[1] === k)?.refMode;
    expect(modeOf('title')).toBe('hole');
    expect(modeOf('description')).toBe('hole');
    expect(modeOf('objectName')).toBeUndefined();
  });
});

describe('objectui#11824 — the check on a converted slot', () => {
  it('flags a single brace and names the {{ }} fix', () => {
    render(<FlowNodeConfigField field={fieldOf('notify', 'message')} value="Hi {record.name}" onCommit={() => {}} />);
    expect(screen.getByRole('alert').textContent).toContain('{{ record.name }}');
  });

  it('a {{ }} hole is clean, and its formatter is not read as a reference', () => {
    render(
      <FlowNodeConfigField
        field={fieldOf('screen', 'description')}
        value="Total {{ amount | currency }}"
        onCommit={() => {}}
        scopeGroups={scope(['amount'])}
      />,
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('an out-of-scope hole is the unknown-reference note', () => {
    render(<FlowNodeConfigField field={fieldOf('end', 'message')} value="Refused: {{ custmer }}" onCommit={() => {}} scopeGroups={scope(['customer'])} />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('note').textContent).toMatch(/customer/);
  });
});

describe('objectui#11824 — what stays as it was', () => {
  it('a CEL role keeps its brace check', () => {
    const cel: FlowConfigField = { id: 'condition', path: ['config', 'condition'], label: 'Condition', kind: 'expression' };
    render(<FlowNodeConfigField field={cel} value="{record.amount} > 1" onCommit={() => {}} />);
    expect(screen.getByRole('alert').textContent).toBe(validateExpressionClient('predicate', '{record.amount} > 1')!.message);
  });

  it('a text field outside the slots is a literal: no hole flag, and no picker (objectui#12329)', () => {
    // Rendered with no node, so the value-slot control does not take it: the
    // descriptor's own text control. Since spec 18 no such string reads a
    // `{…}` token, so there is nothing for a picker to insert.
    const body = fieldOf('http', 'body');
    expect(body.refMode).toBeUndefined();
    render(<FlowNodeConfigField field={body} value="{a}" onCommit={() => {}} scopeGroups={scope(['a', 'customer'])} />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('note')).toBeNull();
    expect(screen.queryByRole('button', { name: PICK })).toBeNull();
  });
});

describe('objectui#11824 — the screen preview renders holes', () => {
  it('substitutes a known hole, keeps an unknown one, and leaves a single brace as written', () => {
    expect(interpolateHoles('Deal {{ deal_id }} · {{ missing }} · {customer}', { deal_id: 42, customer: 'Acme' })).toBe(
      'Deal 42 · {{ missing }} · {customer}',
    );
    expect(interpolateHoles('Hi {{ record.name | upper }}', { record: { name: 'Ada' } })).toBe('Hi Ada');
  });
});
