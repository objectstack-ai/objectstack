// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11788 — a config key the published descriptor DECLARES but the
 * JSON-Schema mapper cannot type keeps its hand-written editor online.
 *
 * Measured before the fix, with the inspector fed the notify node's published
 * `configSchema`: the offline form showed Recipients, the online form did not,
 * and the node's `recipients: []` seed sat in Advanced (JSON). The path that
 * decides a registry-described node's fields is the inspector's `fields` memo:
 * `jsonSchemaToFlowFields` maps the schema, and `mergeServerFlowFields` lets the
 * mapped fields replace every config-rooted field of the offline table. The
 * descriptor publishes `recipients` with a description and NO `type` (the
 * contract, `NotifyConfigSchema.recipients`, takes a string or a string array),
 * so the mapper emitted nothing for it and the merge dropped the offline row.
 * The same mechanism dropped the `http` node's `headers` (an object with no
 * `properties` or `additionalProperties`) and `body` (untyped).
 *
 * The two schemas below are the descriptor `configSchema` literals of
 * objectstack `service-automation` (`registerNotifyNode` in
 * `builtin/notify-node.ts`, `registerHttpNodes` in `builtin/http-nodes.ts`),
 * read on objectstack `main` at `51290bca`, with the long descriptions cut.
 * The shapes are what the mapper reads; the descriptions are fixture text.
 *
 * Every case is judged against the offline table as the control: the same node
 * with no published schema.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

const stubs = vi.hoisted(() => ({ configSchemas: {} as Record<string, unknown> }));

vi.mock('../previews/useFlowNodePalette', () => ({
  useActionConfigSchemas: () => stubs.configSchemas,
  useFlowNodePalette: () => [],
}));
vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: [], loading: false, error: null }),
}));

import { FlowNodeInspector } from './FlowNodeInspector';
import type { MetadataSelection } from '../preview-registry';
import { jsonSchemaToFlowFields, declaredConfigKeys } from './json-schema-to-fields';
import { mergeServerFlowFields } from './flow-node-config';

const NOTIFY_SCHEMA = {
  type: 'object',
  properties: {
    recipients: { description: 'FIXTURE recipients description' },
    title: { type: 'string', description: 'FIXTURE title' },
    message: { type: 'string', description: 'FIXTURE message' },
    template: { type: 'string', description: 'FIXTURE template' },
    templateData: { type: 'object', description: 'FIXTURE templateData' },
    channels: { type: 'array', items: { type: 'string' }, description: 'FIXTURE channels' },
    topic: { type: 'string', description: 'FIXTURE topic' },
    severity: { type: 'string', enum: ['info', 'warning', 'critical'], description: 'FIXTURE severity' },
    sourceObject: { type: 'string', description: 'FIXTURE sourceObject' },
    sourceId: { type: 'string', description: 'FIXTURE sourceId' },
    actorId: { type: 'string', description: 'FIXTURE actorId' },
    actionUrl: { type: 'string', description: 'FIXTURE actionUrl' },
    payload: { type: 'object', description: 'FIXTURE payload' },
  },
};

const HTTP_SCHEMA = {
  type: 'object',
  required: ['url'],
  properties: {
    url: { type: 'string', description: 'FIXTURE url' },
    method: { type: 'string', description: 'FIXTURE method' },
    headers: { type: 'object', description: 'FIXTURE headers' },
    body: { description: 'FIXTURE body' },
    durable: { type: 'boolean', description: 'FIXTURE durable' },
    timeoutMs: { type: 'number', description: 'FIXTURE timeoutMs' },
    signingSecret: { type: 'string', description: 'FIXTURE signingSecret' },
  },
};

/* The `meta/*` double the sibling inspector files serve: an empty registry. */
const META_PREFIX = '/api/v1/meta/';
const routeOf = (url: string) => url.split('?')[0];
let calls: string[] = [];

beforeEach(() => {
  stubs.configSchemas = {};
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input && typeof input === 'object' && 'url' in input ? (input as { url: unknown }).url : input);
      calls.push(url);
      const route = routeOf(url);
      if (!route.startsWith(META_PREFIX)) return { ok: false, status: 404, headers: new Headers(), json: async () => ({}) };
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({ type: route.slice(META_PREFIX.length), items: [] }) };
    }),
  );
});

afterEach(() => {
  expect(calls.filter((url) => !routeOf(url).startsWith(META_PREFIX))).toEqual([]);
  cleanup();
  vi.unstubAllGlobals();
});

type Source = 'offline' | 'engine';
const SOURCES: Source[] = ['offline', 'engine'];

function mountNode(source: Source, node: Record<string, unknown>, schemas: Record<string, unknown>) {
  stubs.configSchemas = source === 'engine' ? schemas : {};
  render(
    <FlowNodeInspector
      type="flow"
      name="ticket_done"
      draft={{ nodes: [node], edges: [] }}
      selection={{ kind: 'node', id: String(node.id) } as MetadataSelection}
      onPatch={vi.fn()}
      onClearSelection={vi.fn()}
      readOnly={false}
      locale="en-US"
    />,
  );
}

/** The Advanced (JSON) block's text (its textarea's `{ }` placeholder), or ''. */
function advancedText(): string {
  return Array.from(document.querySelectorAll('textarea[placeholder="{ }"]'))
    .map((el) => (el as HTMLTextAreaElement).value)
    .join('\n');
}

describe('objectui#11788 — notify recipients renders with the published descriptor', () => {
  // The palette's notify seed (`flow-canvas-parts.tsx`), the node QA opened.
  const seeded = { id: 'tell_owner', type: 'notify', label: 'Tell owner', config: { channels: ['inbox'], recipients: [] } };

  for (const source of SOURCES) {
    it(`shows the Recipients editor, not the key in Advanced (JSON) — ${source}`, () => {
      mountNode(source, seeded, { notify: NOTIFY_SCHEMA });
      expect(screen.getByText('Recipients')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Add recipient' })).toBeInTheDocument();
      expect(advancedText()).not.toMatch(/recipients/);
    });
  }

  it('online, the restored editor sits at the key\'s declared position and carries the schema\'s description', () => {
    const merged = mergeServerFlowFields(jsonSchemaToFlowFields(NOTIFY_SCHEMA), 'notify', declaredConfigKeys(NOTIFY_SCHEMA));
    expect(merged.map((f) => f.id).slice(0, 3)).toEqual(['recipients', 'title', 'message']);
    const recipients = merged.find((f) => f.id === 'recipients')!;
    expect(recipients.kind).toBe('recipients');
    expect(recipients.help).toBe('FIXTURE recipients description');
  });

  it('a declared key the offline table has no editor for still goes to Advanced (JSON) — the control', () => {
    mountNode('engine', { ...seeded, config: { recipients: ['usr_1'], payload: { ticket: 'T-1' } } }, { notify: NOTIFY_SCHEMA });
    expect(advancedText()).toMatch(/"payload"/);
    expect(advancedText()).not.toMatch(/recipients/);
  });

  it('an offline row whose key the schema does not declare is not brought back online', () => {
    // The engine rejects an undeclared config key at registerFlow(). This case
    // used to read the offline table's `url` row; objectui#11968 made that row
    // write the declared `actionUrl`, and its pin holds every offline row to the
    // node's contract, so the real table no longer has such a row. The case is
    // read instead off a schema that leaves out a key the offline table has.
    const { topic: _topic, ...withoutTopic } = NOTIFY_SCHEMA.properties;
    const schema = { ...NOTIFY_SCHEMA, properties: withoutTopic };
    const offline = mergeServerFlowFields(null, 'notify');
    expect(offline.some((f) => f.id === 'topic')).toBe(true);
    const online = mergeServerFlowFields(jsonSchemaToFlowFields(schema), 'notify', declaredConfigKeys(schema));
    expect(online.some((f) => f.id === 'topic')).toBe(false);
    // The lit control: with the full schema the same key IS on the online form.
    const full = mergeServerFlowFields(jsonSchemaToFlowFields(NOTIFY_SCHEMA), 'notify', declaredConfigKeys(NOTIFY_SCHEMA));
    expect(full.some((f) => f.id === 'topic')).toBe(true);
  });

  it('without the declared list the merge is what it was: the published fields alone', () => {
    const served = jsonSchemaToFlowFields(NOTIFY_SCHEMA)!;
    expect(mergeServerFlowFields(served, 'notify').map((f) => f.id)).toEqual(served.map((f) => f.id));
  });
});

describe('objectui#11788 — the same mechanism on the http node: headers and body', () => {
  const node = {
    id: 'call_out',
    type: 'http',
    label: 'Call out',
    config: { url: 'https://example.com/hook', headers: { 'Content-Type': 'application/json' }, body: '{"ok":true}' },
  };

  for (const source of SOURCES) {
    it(`edits headers and body in the form, not in Advanced (JSON) — ${source}`, () => {
      mountNode(source, node, { http: HTTP_SCHEMA });
      expect(screen.getByText('Headers')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Content-Type')).toBeInTheDocument();
      expect(screen.getByText('Body')).toBeInTheDocument();
      expect(advancedText()).not.toMatch(/headers|body/);
    });
  }

  it('online the restored editors read the schema\'s own description', () => {
    const merged = mergeServerFlowFields(jsonSchemaToFlowFields(HTTP_SCHEMA), 'http', declaredConfigKeys(HTTP_SCHEMA));
    expect(merged.find((f) => f.id === 'headers')?.help).toBe('FIXTURE headers');
    expect(merged.find((f) => f.id === 'body')?.help).toBe('FIXTURE body');
    // `timeoutMs` stays the structured top-level editor, never a config duplicate.
    expect(merged.filter((f) => f.path[f.path.length - 1] === 'timeoutMs').map((f) => f.path)).toEqual([['timeoutMs']]);
  });
});
