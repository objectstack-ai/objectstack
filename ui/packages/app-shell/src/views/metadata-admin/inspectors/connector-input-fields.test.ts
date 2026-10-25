// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * connector-input-fields — the descriptor `inputSchema` → typed Input fields
 * adapter (#4305).
 *
 * The fixtures below are copied VERBATIM from the shipped connectors in
 * `objectstack` (they are what `GET /api/v1/automation/connectors` actually
 * serves, since the engine projects `inputSchema: a.inputSchema` unchanged):
 *   • slack-connector.ts    — `{type:'object', required:[…], properties:{…}}`
 *   • rest-connector.ts     — free-form `object` properties, no `required`
 *   • openapi-connector.ts  — one level of nested `{type:'object', properties}`
 * so the mapping is pinned against the real schema language, not an invented one.
 */

import { describe, it, expect } from 'vitest';
import {
  CONNECTOR_INPUT_PATH,
  connectorActionInputSchema,
  connectorInputFields,
  connectorInputExtras,
  mergeConnectorInputExtras,
  applyConnectorInputForm,
} from './connector-input-fields';
import { fieldsForNodeType, type FlowConfigField } from './flow-node-config';

/** slack-connector.ts `chat.postMessage`, verbatim. */
const SLACK_POST_MESSAGE = {
  type: 'object',
  required: ['channel'],
  properties: {
    channel: { type: 'string', description: 'Channel id, user id, or #name' },
    text: { type: 'string', description: 'Message text' },
    thread_ts: { type: 'string', description: 'Thread root ts to reply into' },
    blocks: { type: 'array', description: 'Block Kit blocks' },
  },
};

/** A registry payload shaped like the dispatcher's `{ data: { connectors } }`. */
const CONNECTORS = [
  {
    name: 'slack',
    label: 'Slack',
    type: 'saas',
    origin: 'plugin',
    state: 'ready',
    actions: [
      { key: 'chat.postMessage', label: 'Post Message', inputSchema: SLACK_POST_MESSAGE },
      { key: 'noSchema', label: 'No Schema' },
    ],
  },
];

describe('connectorActionInputSchema', () => {
  it('reads the chosen action’s inputSchema out of the registry payload', () => {
    expect(connectorActionInputSchema(CONNECTORS, 'slack', 'chat.postMessage')).toEqual(SLACK_POST_MESSAGE);
  });

  it('returns undefined for an action that declares none, an unknown action, an unknown connector, and a non-list payload', () => {
    expect(connectorActionInputSchema(CONNECTORS, 'slack', 'noSchema')).toBeUndefined();
    expect(connectorActionInputSchema(CONNECTORS, 'slack', 'nope')).toBeUndefined();
    expect(connectorActionInputSchema(CONNECTORS, 'jira', 'chat.postMessage')).toBeUndefined();
    expect(connectorActionInputSchema(CONNECTORS, undefined, 'chat.postMessage')).toBeUndefined();
    expect(connectorActionInputSchema(CONNECTORS, 'slack', undefined)).toBeUndefined();
    expect(connectorActionInputSchema(null, 'slack', 'chat.postMessage')).toBeUndefined();
  });
});

describe('connectorInputFields — re-rooting onto connectorConfig.input', () => {
  it('maps the slack schema to typed fields rooted at connectorConfig.input.<key>', () => {
    const form = connectorInputFields(SLACK_POST_MESSAGE);
    expect(form).not.toBeNull();
    // `blocks` is an `array` with no `items` — the resolver declines it (it has
    // no representable list kind), so it is absent here and stays editable in
    // the extras repeater. That is the fallback working, not a gap.
    expect(form!.fields.map((f) => [f.id, f.path.join('.'), f.kind, f.label])).toEqual([
      ['connectorConfig.input.channel', 'connectorConfig.input.channel', 'text', 'Channel'],
      ['connectorConfig.input.text', 'connectorConfig.input.text', 'text', 'Text'],
      ['connectorConfig.input.thread_ts', 'connectorConfig.input.thread_ts', 'text', 'Thread Ts'],
    ]);
  });

  it('carries the descriptor’s own description through as the field help (the i18n channel)', () => {
    const form = connectorInputFields(SLACK_POST_MESSAGE);
    expect(form!.fields[0].help).toBe('Channel id, user id, or #name');
  });

  it('prefers the schema `title` over the humanized key', () => {
    const form = connectorInputFields({
      type: 'object',
      properties: { api_key: { type: 'string', title: 'API key' } },
    });
    expect(form!.fields[0].label).toBe('API key');
  });

  it('reports declaredKeys as the keys that actually got a typed field', () => {
    const form = connectorInputFields(SLACK_POST_MESSAGE);
    expect(form!.declaredKeys).toEqual(['channel', 'text', 'thread_ts']);
  });

  it('leaves an unmappable property OFF the form and OUT of declaredKeys (it stays repeater-editable)', () => {
    // `oneOf` with no `type` is exactly the case the resolver declines to map;
    // it must not be silently claimed, or the key becomes uneditable.
    const form = connectorInputFields({
      type: 'object',
      properties: {
        ok: { type: 'string' },
        weird: { oneOf: [{ type: 'string' }, { type: 'number' }] },
      },
    });
    expect(form!.declaredKeys).toEqual(['ok']);
    expect(form!.fields).toHaveLength(1);
  });

  it('flattens one level of nested object (the openapi-connector shape)', () => {
    const form = connectorInputFields({
      type: 'object',
      properties: {
        path: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        query: { type: 'object', properties: { limit: { type: 'number' } } },
      },
      required: ['path'],
    });
    expect(form!.fields.map((f) => [f.id, f.path.join('.'), f.kind])).toEqual([
      ['connectorConfig.input.path.id', 'connectorConfig.input.path.id', 'text'],
      ['connectorConfig.input.query.limit', 'connectorConfig.input.query.limit', 'number'],
    ]);
    // The flattened group is claimed by its TOP-level key, so the repeater does
    // not also offer `path` / `query` as raw JSON cells.
    expect(form!.declaredKeys).toEqual(['path', 'query']);
  });

  it('maps an `additionalProperties` map property to the keyValue widget', () => {
    const form = connectorInputFields({
      type: 'object',
      properties: {
        headers: { type: 'object', additionalProperties: { type: 'string' }, description: 'Per-request headers' },
      },
    });
    expect(form!.fields[0].kind).toBe('keyValue');
    expect(form!.fields[0].path).toEqual(['connectorConfig', 'input', 'headers']);
  });

  it('declines a bare `{type:"object"}` property (rest-connector `headers`/`query`) — it stays repeater-editable', () => {
    // No fixed `properties` AND no `additionalProperties`: the resolver has
    // nothing to render, so the key must NOT be claimed as declared.
    const form = connectorInputFields({
      type: 'object',
      properties: {
        method: { type: 'string' },
        headers: { type: 'object', description: 'Per-request headers' },
        body: {},
      },
    });
    expect(form!.declaredKeys).toEqual(['method']);
  });

  it('rewrites a showWhen controller reference onto the re-rooted id', () => {
    const form = connectorInputFields({
      type: 'object',
      properties: {
        retry: {
          type: 'object',
          properties: { enabled: { type: 'boolean' }, attempts: { type: 'number' } },
        },
      },
    });
    const attempts = form!.fields.find((f) => f.id.endsWith('attempts'))!;
    expect(attempts.showWhen).toEqual({ field: 'connectorConfig.input.retry.enabled', equals: ['true'] });
    // …and the controller it names really is in the same list.
    expect(form!.fields.some((f) => f.id === attempts.showWhen!.field)).toBe(true);
  });

  it('returns null for a schema that is not a usable object schema', () => {
    expect(connectorInputFields(undefined)).toBeNull();
    expect(connectorInputFields({})).toBeNull();
    expect(connectorInputFields({ type: 'string' })).toBeNull();
    expect(connectorInputFields({ type: 'object' })).toBeNull(); // no properties
  });

  it('CONNECTOR_INPUT_PATH is the spec block the executor reads', () => {
    expect(CONNECTOR_INPUT_PATH).toEqual(['connectorConfig', 'input']);
  });
});

describe('connectorInputFields — measured additionalProperties semantics', () => {
  it('treats an ABSENT additionalProperties as OPEN (every shipped connector omits it)', () => {
    expect(connectorInputFields(SLACK_POST_MESSAGE)!.open).toBe(true);
  });

  it('treats `additionalProperties: false` as CLOSED', () => {
    expect(connectorInputFields({ ...SLACK_POST_MESSAGE, additionalProperties: false })!.open).toBe(false);
  });

  it('treats `additionalProperties: true` / a value schema as OPEN', () => {
    expect(connectorInputFields({ ...SLACK_POST_MESSAGE, additionalProperties: true })!.open).toBe(true);
    expect(
      connectorInputFields({ ...SLACK_POST_MESSAGE, additionalProperties: { type: 'string' } })!.open,
    ).toBe(true);
  });
});

describe('connectorInputExtras / mergeConnectorInputExtras — the round-trip contract', () => {
  const declared = ['channel', 'text'];

  it('extras are the stored keys the typed fields do NOT own', () => {
    expect(connectorInputExtras({ channel: 'C1', text: 'hi', legacy_note: 'keep' }, declared)).toEqual({
      legacy_note: 'keep',
    });
  });

  it('extras of a non-object (or absent) stored value are empty', () => {
    expect(connectorInputExtras(undefined, declared)).toEqual({});
    expect(connectorInputExtras([{ variable: 'a', value: 1 }], declared)).toEqual({});
  });

  it('merging preserves the declared keys, their values, AND the stored key order', () => {
    const stored = { channel: 'C1', legacy_note: 'keep', text: 'hi' };
    expect(mergeConnectorInputExtras(stored, { legacy_note: 'edited' }, declared)).toEqual({
      channel: 'C1',
      legacy_note: 'edited',
      text: 'hi',
    });
    expect(Object.keys(mergeConnectorInputExtras(stored, { legacy_note: 'edited' }, declared)!)).toEqual([
      'channel',
      'legacy_note',
      'text',
    ]);
  });

  it('a removed extra is dropped while every declared key survives', () => {
    expect(mergeConnectorInputExtras({ channel: 'C1', legacy_note: 'keep' }, {}, declared)).toEqual({
      channel: 'C1',
    });
  });

  it('a newly added extra is appended', () => {
    expect(mergeConnectorInputExtras({ channel: 'C1' }, { fresh: 2 }, declared)).toEqual({
      channel: 'C1',
      fresh: 2,
    });
  });

  it('collapses to undefined only when nothing at all is left (so the block is pruned)', () => {
    expect(mergeConnectorInputExtras({}, {}, declared)).toBeUndefined();
    expect(mergeConnectorInputExtras({ channel: 'C1' }, {}, declared)).toEqual({ channel: 'C1' });
  });
});

describe('applyConnectorInputForm — splicing into the connector_action group', () => {
  const base = (): FlowConfigField[] => fieldsForNodeType('connector_action');

  it('is a no-op when there is no form (no descriptor / no inputSchema)', () => {
    const fields = base();
    expect(applyConnectorInputForm(fields, null)).toEqual(fields);
    expect(applyConnectorInputForm(fields, null)).toBe(fields);
  });

  it('replaces the Input repeater IN PLACE, keeping the surrounding fields and their order', () => {
    const form = connectorInputFields(SLACK_POST_MESSAGE)!;
    const out = applyConnectorInputForm(base(), form);
    expect(out.map((f) => f.id)).toEqual([
      'connectorConfig.connectorId',
      'connectorConfig.actionId',
      'connectorConfig.input.channel',
      'connectorConfig.input.text',
      'connectorConfig.input.thread_ts',
      'connectorConfig.input', // the extras repeater, still open-schema
      'timeoutMs',
    ]);
  });

  it('an OPEN schema keeps the repeater, carrying the declared keys as omitKeys', () => {
    const form = connectorInputFields(SLACK_POST_MESSAGE)!;
    const repeater = applyConnectorInputForm(base(), form).find((f) => f.id === 'connectorConfig.input')!;
    expect(repeater.kind).toBe('keyValue');
    expect(repeater.omitKeys).toEqual(['channel', 'text', 'thread_ts']);
  });

  it('a CLOSED schema drops the repeater entirely', () => {
    const form = connectorInputFields({ ...SLACK_POST_MESSAGE, additionalProperties: false })!;
    const out = applyConnectorInputForm(base(), form);
    expect(out.some((f) => f.id === 'connectorConfig.input')).toBe(false);
    expect(out.map((f) => f.id)).toEqual([
      'connectorConfig.connectorId',
      'connectorConfig.actionId',
      'connectorConfig.input.channel',
      'connectorConfig.input.text',
      'connectorConfig.input.thread_ts',
      'timeoutMs',
    ]);
  });

  it('leaves a group that has no Input field untouched', () => {
    const form = connectorInputFields(SLACK_POST_MESSAGE)!;
    const httpFields = fieldsForNodeType('http');
    expect(applyConnectorInputForm(httpFields, form)).toBe(httpFields);
  });
});
