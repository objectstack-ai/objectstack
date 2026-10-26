// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10948 — the flow node inspector marks the config keys the installed
 * spec refuses the node without, so the author meets the requirement before the
 * save-time error does.
 *
 * The marker is the metadata form's own (`RequiredMarker`, `SchemaForm`'s
 * `data-required-marker` `*`), and its source is the spec, asked at render time
 * (`flow-required-keys.ts`): no required-key list lives in the product. The
 * expectations below are the MEASURED answer for each seeded node — what the
 * installed spec requires of it — and each is asserted as an EQUALITY over the
 * labels the form draws, so one row pins both halves: a marker where the spec
 * requires the key, and none where it does not.
 *
 * Every row is lit by a control: the labels it expects UNMARKED are asserted
 * present, so an empty marked set can never be a form that drew nothing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('../previews/useFlowNodePalette', () => ({
  useActionConfigSchemas: () => ({}),
  useFlowNodePalette: () => [],
}));
vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: [], loading: false, error: null }),
}));

import { FlowNodeInspector } from './FlowNodeInspector';
import { fieldsForNodeType } from './flow-node-config';
import { specRequiredColumns, specRequiresField } from './flow-required-keys';
import type { MetadataSelection } from '../preview-registry';
import { defaultNodeExtras, defaultNodeLabel } from '../previews/flow-canvas-parts';

/* ── `fetch` double: reference pickers resolve through a real `fetch` under
 * happy-dom. The metadata routes answer empty and the automation routes (the
 * connector registry a `connector_action` node reads) answer 404 — the degrade
 * the pickers already fall back from; anything else fails the row. ── */
const META_PREFIX = '/api/v1/meta/';
const AUTOMATION_PREFIX = '/api/v1/automation/';
let calls: string[] = [];
const routeOf = (url: string) => url.split('?')[0];
const allowed = (url: string) => routeOf(url).startsWith(META_PREFIX) || routeOf(url).startsWith(AUTOMATION_PREFIX);

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(
        input && typeof input === 'object' && 'url' in input ? (input as { url: unknown }).url : input,
      );
      calls.push(url);
      const route = routeOf(url);
      if (!route.startsWith(META_PREFIX)) {
        return { ok: false, status: 404, headers: new Headers(), json: async () => ({}) };
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ type: route.slice(META_PREFIX.length), items: [] }),
      };
    }),
  );
});

afterEach(() => {
  expect(calls.filter((url) => !allowed(url))).toEqual([]);
  cleanup();
  vi.unstubAllGlobals();
});

function renderNode(node: Record<string, unknown>) {
  const { container } = render(
    <FlowNodeInspector
      type="flow"
      name="probe_flow"
      draft={{ name: 'probe_flow', label: 'Probe', type: 'autolaunched', nodes: [node], edges: [] }}
      selection={{ kind: 'node', id: String(node.id) } as MetadataSelection}
      onPatch={vi.fn()}
      onClearSelection={vi.fn()}
      readOnly={false}
      locale="en-US"
    />,
  );
  return container;
}

/** A label's text as the author reads it, without the marker. */
const ownText = (el: Element) => {
  const copy = el.cloneNode(true) as Element;
  copy.querySelectorAll('[data-required-marker]').forEach((m) => m.remove());
  return (copy.textContent ?? '').trim();
};

/** Every label the form drew that carries the required marker, by its own text. */
const markedLabels = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[data-required-marker="true"]')).map((m) => {
    expect(m.getAttribute('aria-hidden'), 'the marker is visual-only, as in SchemaForm').toBe('true');
    return ownText(m.parentElement!);
  });

/** Every label (`<label>`) the form drew, by its own text. */
const allLabels = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('label')).map((l) => ownText(l));

const seeded = (type: string) => ({ id: 'n1', type, label: defaultNodeLabel(type), ...defaultNodeExtras(type) });

describe('each seeded kind: markers exactly where the spec requires the key (objectui#10948)', () => {
  it.each([
    ['create_record', ['Object'], ['Field values', 'Output variable']],
    ['update_record', ['Object'], ['Filter', 'Field values']],
    ['get_record', ['Object'], ['Filter', 'Limit', 'Output variable']],
    ['delete_record', ['Object'], ['Filter']],
    // objectui#11968 removed the http group's Output variable row: the `http`
    // contract declares no `outputVariable`.
    ['http', ['URL'], ['Method', 'Headers', 'Body', 'Timeout (ms)']],
    ['notify', ['Recipients', 'Title'], ['Message', 'Channels', 'Topic', 'Severity', 'Click-through URL']],
    ['script', ['Function'], ['Inputs', 'Output variable', 'Timeout (ms)']],
    ['subflow', ['Flow'], ['Input mapping', 'Output variable', 'Timeout (ms)']],
    ['map', ['Collection', 'Per-item flow'], ['Item variable', 'Item object', 'Output variable']],
    ['connector_action', ['Connector', 'Action'], ['Input', 'Timeout (ms)']],
    ['wait', ['Wait for', 'Duration'], []],
    ['boundary_event', ['Attached to', 'Event type'], ['Interrupting', 'Error code']],
    ['loop', [], ['Collection', 'Item variable']],
    // `approval` marked nothing through 17.6.0. 17.7.0 judges its config against
    // `ApprovalNodeConfigSchema` (objectstack#21893), which requires `approvers`
    // and each approver's `type` (objectui#11717).
    ['approval', ['Approvers', 'Type'], ['Value']],
    ['assignment', [], ['Assignments']],
    ['end', [], ['Outcome']],
    ['try_catch', [], ['Error variable']],
  ] as const)('`%s` marks %j and nothing else', (type, marked, unmarked) => {
    const container = renderNode(seeded(type));
    const labels = allLabels(container);
    for (const l of [...marked, ...unmarked]) expect(labels, `the form draws "${l}"`).toContain(l);
    expect(markedLabels(container).sort()).toEqual([...marked].sort());
  });

  it('a decision branch row marks its Label and Expression, not its Target', () => {
    const container = renderNode({
      id: 'n1',
      type: 'decision',
      label: 'Route',
      config: { conditions: [{ label: 'big', expression: 'amount > 10' }] },
    });
    expect(allLabels(container)).toEqual(expect.arrayContaining(['Branches', 'Target', 'Branch mode']));
    expect(markedLabels(container).sort()).toEqual(['Expression', 'Label']);
  });

  it('a screen field row marks its Name only', () => {
    const container = renderNode({
      id: 'n1',
      type: 'screen',
      label: 'Ask',
      config: { fields: [{ name: 'discount', label: 'Discount', type: 'number' }] },
    });
    expect(allLabels(container)).toEqual(
      expect.arrayContaining(['Label', 'Type', 'Required', 'Visible when', 'Title', 'Fields']),
    );
    expect(markedLabels(container)).toEqual(['Name']);
  });
});

describe('the marker follows the configuration the author has (objectui#10948)', () => {
  it('`notify` with a `template` does not require a `title`', () => {
    const container = renderNode({
      id: 'n1',
      type: 'notify',
      label: 'Tell',
      config: { recipients: ['u1'], template: 'welcome' },
    });
    expect(allLabels(container)).toContain('Title');
    expect(markedLabels(container)).toEqual(['Recipients']);
  });

  it('a `loop` requires its `collection` once it has a body', () => {
    const container = renderNode({
      id: 'n1',
      type: 'loop',
      label: 'Each',
      config: { body: { nodes: [], edges: [] } },
    });
    expect(markedLabels(container)).toEqual(['Collection']);
  });

  it('a refused `end` requires its `message` — the node contract, not the config judge', () => {
    const container = renderNode({ id: 'n1', type: 'end', label: 'Stop', config: { outcome: 'refused' } });
    const message = fieldsForNodeType('end').find((f) => f.id === 'message');
    expect(message, '`end` still has a "message" field').toBeDefined();
    expect(markedLabels(container)).toEqual([message!.label]);
  });

  it('a `wait` on a signal requires what to wait for, and no duration', () => {
    const container = renderNode({
      id: 'n1',
      type: 'wait',
      label: 'Hold',
      waitEventConfig: { eventType: 'signal', signalName: 'paid' },
    });
    expect(allLabels(container)).toContain('Signal name');
    expect(markedLabels(container)).toEqual(['Wait for']);
  });
});

describe('the requirement reaches the control, not only the eye (objectui#10948)', () => {
  it('a required text key carries `aria-required`; an optional sibling does not', () => {
    renderNode(seeded('http'));
    expect(screen.getByPlaceholderText('https://api.example.com/v1/contracts').getAttribute('aria-required')).toBe(
      'true',
    );
    // The optional sibling is the Body text control (objectui#11968 removed the
    // Output variable row this read before).
    expect(screen.getByPlaceholderText('{ "key": "value" }').getAttribute('aria-required')).toBeNull();
  });

  it('a required select carries `aria-required` on its trigger', () => {
    renderNode(seeded('wait'));
    const trigger = screen.getByRole('combobox', { name: /Wait for/ });
    expect(trigger.getAttribute('aria-required')).toBe('true');
  });

  it('a required row cell carries `aria-required`; an optional cell does not', () => {
    renderNode({
      id: 'n1',
      type: 'screen',
      label: 'Ask',
      config: { fields: [{ name: 'discount', label: 'Discount' }] },
    });
    expect(screen.getByDisplayValue('discount').getAttribute('aria-required')).toBe('true');
    expect(screen.getByDisplayValue('Discount').getAttribute('aria-required')).toBeNull();
  });
});

describe('flow-required-keys asks the spec, per field (objectui#10948)', () => {
  const field = (type: string, id: string) => {
    const f = fieldsForNodeType(type).find((x) => x.id === id);
    expect(f, `${type} still has a "${id}" field`).toBeDefined();
    return f!;
  };

  it('answers per key, from the node as it stands', () => {
    expect(specRequiresField(seeded('http'), field('http', 'url'))).toBe(true);
    expect(specRequiresField(seeded('http'), field('http', 'method'))).toBe(false);
    // A written value does not retire the requirement: the question is whether
    // the spec refuses the node WITHOUT one.
    expect(specRequiresField({ ...seeded('http'), config: { url: 'https://x.test' } }, field('http', 'url'))).toBe(true);
  });

  it('answers per column of a list, independent of the rows written', () => {
    expect([...specRequiredColumns(seeded('decision'), field('decision', 'conditions'))].sort()).toEqual([
      'expression',
      'label',
    ]);
    expect([...specRequiredColumns(seeded('screen'), field('screen', 'fields'))]).toEqual(['name']);
  });

  it('says nothing about a node with no type to ask about', () => {
    expect(specRequiresField({ id: 'n1' }, field('http', 'url'))).toBe(false);
    expect(specRequiresField(null, field('http', 'url'))).toBe(false);
    expect(specRequiredColumns(null, field('screen', 'fields')).size).toBe(0);
  });
});
