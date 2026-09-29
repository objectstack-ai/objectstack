// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The SAVE door's half of the `flow-credential-literal` advisory.
 *
 * `@objectstack/lint`'s own tests prove the rule is registered for `flow`
 * writes and that its runner reports it. This file asks the host's question:
 * does the shipped gate a Studio / REST `/meta` / MCP author's flow publish
 * passes through carry the advisory back — on the advisory channel, with the
 * write NOT refused — and stay silent on the template control?
 *
 * Harness: none. {@link evaluateRuntimeAuthoringGate} is pure by construction
 * (its impure reads arrive as arguments), so nothing about the door is stubbed.
 *
 * Every value is a probe sentinel, not a credential.
 */
import { describe, expect, it } from 'vitest';
import { FLOW_CREDENTIAL_LITERAL } from '@objectstack/lint';

import { evaluateRuntimeAuthoringGate } from './runtime-authoring-gate.js';

const SENTINELS = ['door-header-sentinel', 'door-url-sentinel', 'door-input-sentinel'] as const;

/** One flow, three served positions. `literal: false` is the same flow with `{var}` templates. */
const credentialFlow = (literal: boolean) => ({
  name: literal ? 'door_cred_lit' : 'door_cred_dark',
  label: 'Door credential probe',
  type: 'autolaunched',
  variables: [{ name: 'api_token', type: 'text', isInput: true }],
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    {
      id: 'call',
      type: 'http',
      label: 'Call',
      config: {
        url: literal
          ? `https://example.invalid/hook?api_key=${SENTINELS[1]}`
          : 'https://example.invalid/hook?api_key={api_token}',
        method: 'POST',
        headers: {
          Authorization: literal ? `Bearer ${SENTINELS[0]}` : 'Bearer {api_token}',
          'X-Trace-Label': 'plain-value',
        },
      },
    },
    {
      id: 'conn',
      type: 'connector_action',
      label: 'Connector',
      connectorConfig: {
        connectorId: 'rest',
        actionId: 'request',
        input: { method: 'GET', path: '/p', auth: { clientSecret: literal ? SENTINELS[2] : '{api_token}' } },
      },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'call' },
    { id: 'e2', source: 'call', target: 'conn' },
    { id: 'e3', source: 'conn', target: 'end' },
  ],
});

const save = (body: { name: string }, state: 'active' | 'draft' = 'active') =>
  evaluateRuntimeAuthoringGate({
    type: 'flow',
    name: body.name,
    state,
    body,
    objects: [],
    permissions: [],
    books: [],
    datasets: [],
  });

const ofRule = (advisories: ReturnType<typeof save>['advisories']) =>
  advisories.filter((a) => a.rule === FLOW_CREDENTIAL_LITERAL);

describe('the save door carries flow-credential-literal as an advisory', () => {
  it('⭐ LIT — one advisory per literal, on the advisory channel; the publish is NOT refused', () => {
    const verdict = save(credentialFlow(true));

    // An advisory, never a refusal: the caller throws `error`, so null here
    // is what "the save went through" means at this seam.
    expect(verdict.error).toBeNull();
    const advisories = ofRule(verdict.advisories);
    expect(advisories.map((a) => a.path)).toEqual([
      'flows[0].nodes[1].config.headers.Authorization',
      'flows[0].nodes[1].config.url',
      'flows[0].nodes[2].connectorConfig.input.auth.clientSecret',
    ]);
    for (const a of advisories) {
      expect(a.severity).toBe('warning');
      expect(a.message).toContain('every member who can read flows');
      expect(a.message).toContain('auth.credentialRef');
      expect(a.hint).toContain('credentialRef');
    }

    // The advisory rides the save response and the gate's server log line:
    // it must not copy the credential it asks the author to move.
    const wire = JSON.stringify(verdict.advisories);
    for (const sentinel of SENTINELS) expect(wire.includes(sentinel), sentinel).toBe(false);
  });

  it('DARK — the same flow with `{var}` templates draws no such advisory', () => {
    const verdict = save(credentialFlow(false));
    expect(verdict.error).toBeNull();
    expect(ofRule(verdict.advisories)).toEqual([]);
  });

  it('a draft save is not judged (D1), so the literal draws nothing until it is published', () => {
    const verdict = save(credentialFlow(true), 'draft');
    expect(verdict.error).toBeNull();
    expect(verdict.advisories).toEqual([]);
  });
});
