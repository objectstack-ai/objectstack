// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12742 — `@objectstack/spec` 18 reserves the flow node types
 * `http_request`, `http_call` and `webhook` inside the open node namespace: the
 * authoring doors refuse them with the rename to `http`, and a stored row that
 * carries one loads as `http`. So the inspector's hand-written HTTP field group
 * is keyed `http`, the spec's node type, and no alias resolves a reserved name
 * onto any group: a node typed with one has no form, the same as any other
 * type the table does not know.
 *
 * A wait node's `eventType: 'webhook'` is a different thing (an event kind, not
 * a node type) and spec 18 leaves it untouched — the control below.
 */

import { describe, it, expect } from 'vitest';
import { FLOW_NODE_CONFIG_TYPES, fieldsForNodeType, localizeFlowFields } from './flow-node-config';
import type { FlowConfigField } from './flow-node-config';

const RESERVED = ['http_request', 'http_call', 'webhook'];

describe('the HTTP field group is keyed `http` (objectui#12742)', () => {
  it('a node typed `http` resolves to the HTTP group', () => {
    expect(fieldsForNodeType('http').map((f) => f.label)).toEqual(['Method', 'URL', 'Headers', 'Body', 'Timeout (ms)']);
    expect(fieldsForNodeType('http').map((f) => f.path.join('.'))).toEqual([
      'config.method',
      'config.url',
      'config.headers',
      'config.body',
      'timeoutMs',
    ]);
  });

  it('the table holds no group keyed by a reserved name, and no alias resolves one', () => {
    expect(FLOW_NODE_CONFIG_TYPES).toContain('http');
    for (const name of RESERVED) {
      expect(FLOW_NODE_CONFIG_TYPES, name).not.toContain(name);
      expect(fieldsForNodeType(name), `${name} resolves to no field group`).toEqual([]);
    }
  });

  it('in zh-CN an `http` node reads its localized field labels, the server-served keys included', () => {
    const offline = localizeFlowFields('http', fieldsForNodeType('http'), 'zh-CN').map((f) => f.label);
    expect(offline).toEqual(['方法', 'URL', '请求头', '请求体', '超时(毫秒)']);

    // `durable` and `signingSecret` reach the form only from the engine's
    // published `configSchema`; the overlay is keyed by the same group name.
    const served: FlowConfigField[] = [
      { id: 'durable', path: ['config', 'durable'], label: 'Durable', kind: 'boolean' },
      { id: 'signingSecret', path: ['config', 'signingSecret'], label: 'Signing secret', kind: 'text' },
    ];
    expect(localizeFlowFields('http', served, 'zh-CN').map((f) => f.label)).toEqual(['持久化(异步)', '签名密钥']);
  });

  it("CONTROL: a wait node's eventType still offers `webhook`", () => {
    const eventType = fieldsForNodeType('wait').find((f) => f.path.join('.') === 'waitEventConfig.eventType');
    expect(eventType?.options?.map((o) => o.value)).toContain('webhook');
  });
});
