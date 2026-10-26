/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// Picker-first (#5): a connector_action node's `actionId` is a picker of the
// CHOSEN connector's actions, not free text. These cover the pure resolution +
// option-mapping the picker relies on (the fetch/render is thin glue on top).

import { describe, it, expect } from 'vitest';
import { resolveConnectorName, connectorActionsToOptions, connectorsToOptions } from './FlowReferenceField';

describe('resolveConnectorName', () => {
  const ctx = (connectorConfig: unknown) => ({ draft: {}, node: { connectorConfig } as Record<string, unknown> });

  it('reads the chosen connector from the node connectorConfig block', () => {
    expect(resolveConnectorName('connector-action', 'connectorId', ctx({ connectorId: 'slack' }))).toBe('slack');
  });

  it('honors a custom connectorSource key', () => {
    expect(resolveConnectorName('connector-action', 'conn', ctx({ conn: 'salesforce' }))).toBe('salesforce');
  });

  it('defaults the source key to connectorId', () => {
    expect(resolveConnectorName('connector-action', undefined, ctx({ connectorId: 'email' }))).toBe('email');
  });

  it('is undefined for a non-connector-action kind, or with no connector chosen', () => {
    expect(resolveConnectorName('object', 'connectorId', ctx({ connectorId: 'slack' }))).toBeUndefined();
    expect(resolveConnectorName('connector-action', 'connectorId', ctx({}))).toBeUndefined();
    expect(resolveConnectorName('connector-action', 'connectorId', ctx(undefined))).toBeUndefined();
  });
});

describe('connectorActionsToOptions', () => {
  it('maps a connector descriptor action list to {value,label} options', () => {
    expect(
      connectorActionsToOptions([
        { key: 'chat.postMessage', label: 'Post Message' },
        { key: 'send' }, // no label → key is the label
      ]),
    ).toEqual([
      { value: 'chat.postMessage', label: 'Post Message (chat.postMessage)' },
      { value: 'send', label: 'send' },
    ]);
  });

  it('drops malformed entries and tolerates non-arrays', () => {
    expect(connectorActionsToOptions([{ label: 'no key' }, null, { key: '' }, { key: 'ok' }])).toEqual([
      { value: 'ok', label: 'ok' },
    ]);
    expect(connectorActionsToOptions(undefined)).toEqual([]);
    expect(connectorActionsToOptions('nope')).toEqual([]);
  });

  // objectui#11028 — the served descriptor's `description` is a plain string
  // (`ConnectorActionDescriptor.description`); it rides along as the option's
  // hint, and an action that authors none carries no hint at all.
  it('carries an authored description as the option hint, and nothing when none is authored', () => {
    const [described, bare, blank, nonString] = connectorActionsToOptions([
      { key: 'chat.postMessage', label: 'Post Message', description: 'Post a message to a channel' },
      { key: 'chat.delete', label: 'Delete Message' },
      { key: 'chat.update', label: 'Update Message', description: '   ' },
      { key: 'chat.schedule', label: 'Schedule Message', description: { en: 'Schedule a message' } },
    ]);
    expect(described).toEqual({
      value: 'chat.postMessage',
      label: 'Post Message (chat.postMessage)',
      hint: 'Post a message to a channel',
    });
    expect('hint' in bare).toBe(false);
    expect('hint' in blank).toBe(false);
    expect('hint' in nonString).toBe(false);
  });
});

describe('connectorsToOptions (ADR-0096 connector picker)', () => {
  it('maps the runtime registry to {value,label}, annotating declarative instances', () => {
    expect(
      connectorsToOptions([
        { name: 'billing', label: 'Billing API', origin: 'declarative' },
        { name: 'rest', label: 'REST', origin: 'plugin' },
        { name: 'slack', origin: 'plugin' }, // no label → name is the label
      ]),
    ).toEqual([
      { value: 'billing', label: 'Billing API (billing) · declarative' },
      { value: 'rest', label: 'REST (rest)' },
      { value: 'slack', label: 'slack' },
    ]);
  });

  it('tolerates a missing origin (older backend) and malformed entries / non-arrays', () => {
    expect(connectorsToOptions([{ name: 'x', label: 'X' }, null, { label: 'no name' }, { name: '' }])).toEqual([
      { value: 'x', label: 'X (x)' },
    ]);
    expect(connectorsToOptions(undefined)).toEqual([]);
    expect(connectorsToOptions('nope')).toEqual([]);
  });
});
