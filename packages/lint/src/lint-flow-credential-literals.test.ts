// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `flow-credential-literal` — the pin set, the controls, and the registry entry.
 *
 * ## The pin set is the measured scanner's positive control
 *
 * The rule was measured first as an exposure scanner, and that scanner proved
 * each of its arms able to fire on a positive-control fixture before it was
 * trusted with a zero. The flows below are that fixture — the scanner's
 * literal arm (`scan_control`), its doc-block arm (`doc_control`) and its
 * probe flow (`probe_open_map`) — carried over as the stack a door hands this
 * rule. One difference is deliberate and is the point: the scanner read SOURCE,
 * so it had a third class, `computed` (an expression evaluated when the stack
 * loads). A rule reads the EVALUATED stack, where a computed value is simply
 * the literal it evaluated to — which is exactly what the read path serves. So
 * every computed arm of the scanner is a literal here, and draws.
 *
 * Every value is a probe sentinel, not a credential.
 */

import { describe, expect, it } from 'vitest';

import {
  AUTHORING_COMMANDS,
  AUTHORING_RULES,
  authoringRulesFor,
  runAuthoringRules,
} from './authoring-rules.js';
import { FLOW_CREDENTIAL_LITERAL, lintFlowCredentialLiterals } from './lint-flow-credential-literals.js';
import { runRuntimeAuthoringRules, runtimeAuthoringRulesFor } from './runtime-gate.js';
import * as barrel from './index.js';

/** The probe sentinels. Each names the position it stands in. */
const S = {
  controlHeader1: 'control-header-literal-1',
  controlHeader2: 'control-header-literal-2',
  controlUrl: 'control-url-literal',
  controlInput1: 'control-input-literal-1',
  controlInput2: 'control-input-literal-2',
  docHeader: 'control-doc-literal',
  topAuthz: 'p5-top-authz-literal',
  topApiKey: 'p5-top-apikey-literal',
  nestedAuthz: 'p5-nested-authz-literal',
  connToken: 'p5-conn-token-literal',
  connNested: 'p5-conn-nested-secret-literal',
  urlSecret: 'p5-url-secret-literal',
  signingTop: 'p5-signing-top-sentinel',
  signingNested: 'p5-signing-nested-sentinel',
} as const;

/** The scanner's literal arm: plain string literals, and two controls. */
const scanControl = () => ({
  name: 'scan_control',
  nodes: [
    {
      id: 'h',
      type: 'http',
      config: {
        url: `https://x.invalid/hook?api_key=${S.controlUrl}`,
        headers: {
          Authorization: `Bearer ${S.controlHeader1}`,
          'X-Api-Key': S.controlHeader2,
          'X-Plain': 'plain-value', // control: not a credential
          'X-Auth-Token': '{run_token}', // control: a template, not a literal
        },
      },
    },
    {
      id: 'c',
      type: 'connector_action',
      connectorConfig: {
        connectorId: 'rest',
        actionId: 'request',
        input: { headers: { Authorization: `Basic ${S.controlInput1}` }, token: S.controlInput2, path: '/p' },
      },
    },
  ],
  edges: [],
});

/** The scanner's doc-block arm: the bare-object shape the flows guide uses. */
const docControl = () => ({
  name: 'doc_control',
  nodes: [
    { id: 'doc_call', type: 'http', config: { url: 'https://x.invalid', headers: { Authorization: `Bearer ${S.docHeader}` } } },
  ],
  edges: [],
});

/** The scanner's probe flow: top level, inside a region, a connector, and the controls. */
const probeFlow = () => ({
  name: 'probe_open_map',
  type: 'autolaunched',
  variables: [{ name: 'api_token', type: 'text', isInput: true }],
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    {
      id: 'call_top',
      type: 'http',
      label: 'Call (top level)',
      config: {
        url: `https://example.invalid/p5-top?api_key=${S.urlSecret}`,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${S.topAuthz}`,
          'x-api-key': S.topApiKey,
          'X-Trace-Label': 'p5-control-header-value', // control: not a credential
          'X-Templated-Auth': 'Bearer {api_token}', // control: a template
        },
        // The DECLARED credential slot — withheld by the read projection, not
        // an open map, so not this rule's position.
        signingSecret: S.signingTop,
      },
    },
    {
      id: 'guard',
      type: 'try_catch',
      label: 'Guard',
      config: {
        try: {
          nodes: [
            {
              id: 'call_nested',
              type: 'http',
              label: 'Call (inside a region)',
              config: {
                url: 'https://example.invalid/p5-nested',
                method: 'POST',
                headers: { Authorization: `Bearer ${S.nestedAuthz}` },
                signingSecret: S.signingNested,
              },
            },
          ],
          edges: [],
        },
        catch: { nodes: [{ id: 'handled', type: 'assignment', label: 'Handled' }] },
      },
    },
    {
      id: 'conn',
      type: 'connector_action',
      label: 'Connector',
      connectorConfig: {
        connectorId: 'rest',
        actionId: 'request',
        input: {
          method: 'GET',
          path: 'p5-control-input-value', // control: not a credential
          apiKey: S.connToken,
          auth: { clientSecret: S.connNested },
        },
      },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'call_top' },
    { id: 'e2', source: 'call_top', target: 'guard' },
    { id: 'e3', source: 'guard', target: 'conn' },
    { id: 'e4', source: 'conn', target: 'end' },
  ],
});

const controlStack = () => ({ flows: [scanControl(), docControl(), probeFlow()] });

/** The pin set: one advisory per credential-shaped literal, and no other. */
const PINNED_PATHS = [
  'flows[0].nodes[0].config.headers.Authorization',
  'flows[0].nodes[0].config.headers["X-Api-Key"]',
  'flows[0].nodes[0].config.url',
  'flows[0].nodes[1].connectorConfig.input.headers.Authorization',
  'flows[0].nodes[1].connectorConfig.input.token',
  'flows[1].nodes[0].config.headers.Authorization',
  'flows[2].nodes[1].config.headers.Authorization',
  'flows[2].nodes[1].config.headers["x-api-key"]',
  'flows[2].nodes[1].config.url',
  'flows[2].nodes[2].config.try.nodes[0].config.headers.Authorization',
  'flows[2].nodes[3].connectorConfig.input.apiKey',
  'flows[2].nodes[3].connectorConfig.input.auth.clientSecret',
];

describe('flow-credential-literal — the pin set', () => {
  it('draws exactly one advisory per credential-shaped literal on the positive control', () => {
    const findings = lintFlowCredentialLiterals(controlStack());
    expect(findings.map((f) => f.path)).toEqual(PINNED_PATHS);
    expect(new Set(findings.map((f) => f.rule))).toEqual(new Set([FLOW_CREDENTIAL_LITERAL]));
  });

  it('every finding is a warning — never an error', () => {
    const findings = lintFlowCredentialLiterals(controlStack());
    expect(findings.length).toBe(PINNED_PATHS.length);
    expect(findings.every((f) => f.severity === 'warning')).toBe(true);
  });

  it('names the position and the connector route, and never carries the value', () => {
    const findings = lintFlowCredentialLiterals(controlStack());
    const byPath = new Map(findings.map((f) => [f.path, f]));

    const header = byPath.get('flows[0].nodes[0].config.headers["X-Api-Key"]')!;
    expect(header.where).toBe("flow 'scan_control' · node 'h' (http)");
    expect(header.message).toContain("header 'X-Api-Key'");
    expect(header.message).toContain('every member who can read flows');
    // The route rides the MESSAGE: the CLI text faces print `where: message`
    // and leave the hint to `--json`.
    // Routed by shape, to an auth variant the connector schema really has.
    expect(header.message).toContain('`bearer` or `api-key` (a header), with `auth.credentialRef`');
    expect(header.hint).toContain("type: 'api-key', headerName, credentialRef");
    expect(header.hint).toContain('connector_action');

    const url = byPath.get('flows[2].nodes[1].config.url')!;
    expect(url.message).toContain("query parameter 'api_key'");
    expect(url.message).toContain('`api-key` with `paramName`');
    expect(url.hint).toContain("type: 'api-key', paramName, credentialRef");

    const input = byPath.get('flows[2].nodes[3].connectorConfig.input.auth.clientSecret')!;
    expect(input.message).toContain("connector input 'auth.clientSecret'");
    expect(input.message).toContain('authenticates through its own `auth.credentialRef`');
    expect(input.hint).toContain('credentialRef');

    const nested = byPath.get('flows[2].nodes[2].config.try.nodes[0].config.headers.Authorization')!;
    expect(nested.where).toBe(`flow 'probe_open_map' · try_catch "Guard" › try · node 'call_nested' (http)`);

    // No auth variant carries a secret in a url PATH, so no route may promise
    // one: the text never sends an author to a webhook-url shape.
    for (const f of findings) expect(`${f.message} ${f.hint}`).not.toMatch(/webhook/i);

    // The finding travels into CI logs, the gate's server log and the save
    // response: none of it may copy the credential it asks the author to move.
    const wire = JSON.stringify(findings);
    for (const [key, sentinel] of Object.entries(S)) {
      expect(wire.includes(sentinel), `${key} echoed into a finding`).toBe(false);
    }
  });
});

describe('flow-credential-literal — what draws nothing', () => {
  it('templates, ordinary values and the declared signingSecret slot are silent', () => {
    const quiet = {
      flows: [
        {
          name: 'quiet',
          nodes: [
            {
              id: 'call',
              type: 'http',
              config: {
                url: 'https://example.invalid/x?api_key={api_token}&page=2',
                headers: {
                  Authorization: 'Bearer {api_token}',
                  'X-Auth-Token': '{run_token}',
                  'Content-Type': 'application/json',
                  'X-Trace-Label': 'plain-value',
                },
                signingSecret: 'declared-slot-sentinel',
              },
            },
            {
              id: 'conn',
              type: 'connector_action',
              connectorConfig: {
                connectorId: 'billing_api',
                actionId: 'request',
                input: { method: 'GET', path: '/invoices', token: '{run_token}', retries: 3, auth: { enabled: true } },
              },
            },
          ],
          edges: [],
        },
      ],
    };
    expect(lintFlowCredentialLiterals(quiet)).toEqual([]);
  });

  it('a stack with no flows, and malformed flow members, draw nothing and do not throw', () => {
    expect(lintFlowCredentialLiterals({})).toEqual([]);
    const malformed = {
      flows: [
        null,
        { name: 'm', nodes: [null, { id: 'a', type: 'http' }, { id: 'b', type: 'http', config: { headers: 'x', url: 7 } }] },
        { name: 'n', nodes: [{ id: 'c', type: 'connector_action', connectorConfig: { input: ['x'] } }] },
        { name: 'o', nodes: 'not-a-list' },
      ],
    };
    expect(() => lintFlowCredentialLiterals(malformed as never)).not.toThrow();
    expect(lintFlowCredentialLiterals(malformed as never)).toEqual([]);
  });

  it('a connector input array is walked, each element judged under its parent key', () => {
    const stack = {
      flows: [
        {
          name: 'arr',
          nodes: [
            {
              id: 'conn',
              type: 'connector_action',
              connectorConfig: {
                connectorId: 'rest',
                actionId: 'request',
                input: { api_keys: ['array-element-sentinel', '{t}'], items: [{ name: 'x', value: 'Bearer array-object-sentinel' }] },
              },
            },
          ],
          edges: [],
        },
      ],
    };
    expect(lintFlowCredentialLiterals(stack).map((f) => f.path)).toEqual([
      'flows[0].nodes[0].connectorConfig.input.api_keys[0]',
      'flows[0].nodes[0].connectorConfig.input.items[0].value',
    ]);
  });
});

describe('flow-credential-literal — registered once, at every door, as an advisory', () => {
  const entry = AUTHORING_RULES.find((r) => r.name === 'lintFlowCredentialLiterals');

  it('is an advisory registry entry on all three commands and the runtime publish door for `flow`', () => {
    expect(entry).toBeDefined();
    expect(entry!.tier).toBe('advisory');
    expect([...entry!.commands].sort()).toEqual([...AUTHORING_COMMANDS].sort());
    expect(entry!.surfaces).toContain('runtime-publish');
    expect(entry!.runtimeTypes).toEqual(['flow']);
    for (const command of AUTHORING_COMMANDS) {
      expect(authoringRulesFor(command).map((r) => r.name)).toContain('lintFlowCredentialLiterals');
    }
    expect(runtimeAuthoringRulesFor('flow').map((r) => r.name)).toContain('lintFlowCredentialLiterals');
  });

  it('reaches the CLI commands through the registry as warnings', () => {
    for (const command of AUTHORING_COMMANDS) {
      const findings = runAuthoringRules(command, { normalized: controlStack() }).filter(
        (f) => f.rule === FLOW_CREDENTIAL_LITERAL,
      );
      expect(findings.map((f) => f.path), command).toEqual(PINNED_PATHS);
      expect(findings.every((f) => f.severity === 'warning'), command).toBe(true);
    }
  });

  it('reaches the runtime publish gate for a flow write as advisories, never errors', () => {
    const result = runRuntimeAuthoringRules({ type: 'flow', item: probeFlow() });
    expect(result.rulesRun).toContain('lintFlowCredentialLiterals');
    expect(result.errors.filter((f) => f.rule === FLOW_CREDENTIAL_LITERAL)).toEqual([]);
    // The written flow is the per-write snapshot's sole `flows` member, and
    // `flows` is not a name-keyed context collection, so the wire path keeps
    // its index — `flows[0]…`, the same spelling the CLI reports for a
    // one-flow stack.
    expect(result.advisories.filter((f) => f.rule === FLOW_CREDENTIAL_LITERAL).map((f) => f.path)).toEqual([
      'flows[0].nodes[1].config.headers.Authorization',
      'flows[0].nodes[1].config.headers["x-api-key"]',
      'flows[0].nodes[1].config.url',
      'flows[0].nodes[2].config.try.nodes[0].config.headers.Authorization',
      'flows[0].nodes[3].connectorConfig.input.apiKey',
      'flows[0].nodes[3].connectorConfig.input.auth.clientSecret',
    ]);
  });

  it('exports the rule and its id from the package entry', () => {
    const b = barrel as Record<string, unknown>;
    expect(b.lintFlowCredentialLiterals).toBe(lintFlowCredentialLiterals);
    expect(b.FLOW_CREDENTIAL_LITERAL).toBe(FLOW_CREDENTIAL_LITERAL);
  });
});
