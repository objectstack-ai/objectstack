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
import {
  FLOW_CREDENTIAL_LITERAL,
  lintFlowCredentialLiterals as lintFlowCredentialLiteralsUnrecorded,
} from './lint-flow-credential-literals.js';
import { ConnectorInstanceAuthSchema } from '@objectstack/spec/integration';

import { explainRule } from './rule-explanations.js';
import { runRuntimeAuthoringRules, runtimeAuthoringRulesFor } from './runtime-gate.js';
import * as barrel from './index.js';

// [#22161] Each finding is one verdict sentence; the reasoning it used to
// carry is `os explain flow-credential-literal`. Every direct call below
// records what it fired, and the last cases in this file hold each recorded
// verdict to one line of at most 200 characters — every firing variant this
// suite exercises, not a chosen few. Run the whole file: those cases read what
// the cases above fired.
const fired: Array<{ rule: string; message: string; hint: string }> = [];
const lintFlowCredentialLiterals: typeof lintFlowCredentialLiteralsUnrecorded = (...args) => {
  const findings = lintFlowCredentialLiteralsUnrecorded(...args);
  fired.push(...findings);
  return findings;
};

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
          'X-Auth-Token': '{{ run_token }}', // control: a template, not a literal
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
          'X-Templated-Auth': 'Bearer {{ api_token }}', // control: a template
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
    // [#22161] A short route rides the MESSAGE: `os lint`'s text face prints
    // the hint only under `--fix`. The route by auth variant is the hint's
    // (the `fix:` line `os validate` and `os build` print).
    expect(header.message).toContain("move it to a connector's `auth.credentialRef`");
    // Routed by shape, to an auth variant the connector schema really has.
    expect(header.hint).toContain("type: 'bearer', credentialRef");
    expect(header.hint).toContain("type: 'api-key', headerName, credentialRef");
    expect(header.hint).toContain('connector_action');

    const url = byPath.get('flows[2].nodes[1].config.url')!;
    expect(url.message).toContain("query parameter 'api_key'");
    expect(url.message).toContain("move it to a connector's `auth.credentialRef`");
    expect(url.hint).toContain("type: 'api-key', paramName, credentialRef");

    const input = byPath.get('flows[2].nodes[3].connectorConfig.input.auth.clientSecret')!;
    expect(input.message).toContain("connector input 'auth.clientSecret'");
    expect(input.message).toContain('the connector authenticates through `auth.credentialRef`');
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
                url: 'https://example.invalid/x?api_key={{ api_token }}&page=2',
                headers: {
                  Authorization: 'Bearer {{ api_token }}',
                  'X-Auth-Token': '{{ run_token }}',
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
    expect(b.lintFlowCredentialLiterals).toBe(lintFlowCredentialLiteralsUnrecorded);
    expect(b.FLOW_CREDENTIAL_LITERAL).toBe(FLOW_CREDENTIAL_LITERAL);
  });
});

describe('[#22161] one-line verdicts — flow-credential-literal', () => {
  it('reads as one sentence per position, the short route included', () => {
    const byPath = new Map(lintFlowCredentialLiterals(controlStack()).map((f) => [f.path, f.message]));
    expect(byPath.get('flows[0].nodes[0].config.headers["X-Api-Key"]')).toBe(
      "header 'X-Api-Key' holds a credential-shaped literal, readable by every member who can read flows; "
        + "move it to a connector's `auth.credentialRef`",
    );
    expect(byPath.get('flows[2].nodes[1].config.url')).toBe(
      "url query parameter 'api_key' holds a credential-shaped literal, readable by every member who can read "
        + "flows; move it to a connector's `auth.credentialRef`",
    );
    expect(byPath.get('flows[2].nodes[3].connectorConfig.input.auth.clientSecret')).toBe(
      "connector input 'auth.clientSecret' holds a credential-shaped literal, readable by every member who can "
        + 'read flows; drop it: the connector authenticates through `auth.credentialRef`',
    );
  });

  it('`os explain` carries what the verdict no longer says', () => {
    const entry = explainRule(FLOW_CREDENTIAL_LITERAL);
    expect(entry, 'no `os explain flow-credential-literal` entry').toBeDefined();
    const text = entry!.paragraphs.join('\n');
    for (const fact of [
      'served, as authored, to every member who can read flows',
      'cannot withhold a value here',
      'ADR-0097 §3',
      '`bearer` or a header `api-key`',
      '`api-key` with `paramName`',
      'No variant carries a secret in a url path',
      'a heuristic',
      'A `{variable}` template is not a literal',
      'never the value itself',
    ]) {
      expect(text, `explanation names ${fact}`).toContain(fact);
    }
  });

  it('each position and each region kind the explanation names fires', () => {
    // The explanation module imports nothing, so its positions are held to the
    // rule by running the rule: one probe per position, top level and inside
    // each region kind it names.
    const text = explainRule(FLOW_CREDENTIAL_LITERAL)!.paragraphs.join('\n');
    for (const named of ['`config.headers`', '`config.url`', '`connectorConfig.input`', '`try_catch`', '`loop`', '`parallel`']) {
      expect(text, named).toContain(named);
    }
    const call = (id: string) => ({
      id,
      type: 'http',
      config: { url: 'https://x.invalid/p?api_key=probe-url-sentinel', headers: { Authorization: 'Bearer probe-sentinel' } },
    });
    const stack = {
      flows: [
        {
          name: 'regions',
          nodes: [
            { id: 'loop', type: 'loop', config: { collection: { dialect: 'cel', source: 'items' }, body: { nodes: [call('in_loop')], edges: [] } } },
            {
              id: 'par',
              type: 'parallel',
              config: { branches: [{ nodes: [call('in_branch')], edges: [] }] },
            },
            {
              id: 'conn',
              type: 'connector_action',
              connectorConfig: { connectorId: 'rest', actionId: 'request', input: { token: 'probe-input-sentinel' } },
            },
          ],
          edges: [],
        },
      ],
    };
    const paths = lintFlowCredentialLiterals(stack).map((f) => f.path);
    expect(paths).toEqual([
      'flows[0].nodes[0].config.body.nodes[0].config.headers.Authorization',
      'flows[0].nodes[0].config.body.nodes[0].config.url',
      'flows[0].nodes[1].config.branches[0].nodes[0].config.headers.Authorization',
      'flows[0].nodes[1].config.branches[0].nodes[0].config.url',
      'flows[0].nodes[2].connectorConfig.input.token',
    ]);
  });

  it('every verdict the cases in this file fired is one line of at most 200 characters', () => {
    const converted = fired.filter((f) => f.rule === FLOW_CREDENTIAL_LITERAL);
    // The coverage control first: all three positions fired.
    for (const opening of ['header ', 'url query parameter ', 'connector input ']) {
      expect(converted.some((f) => f.message.startsWith(opening)), opening).toBe(true);
    }
    for (const f of converted) {
      expect(f.message, f.rule).not.toContain('\n');
      expect(f.message.length, `${f.rule}: ${f.message}`).toBeLessThanOrEqual(200);
    }
  });
});

// [#22161] Slice 13: the `fix:` line. Each position's hint is one remedy line:
// the auth variant that holds the credential and the node that calls the
// connector. Where `credentialRef` resolves, the connector's `provider`, the
// Basic variant, that a template draws nothing and that nothing is refused are
// the explanation's.
describe('[#22161] one-line fixes — flow-credential-literal', () => {
  it('every `fix:` line the cases in this file fired is one line of at most 200 characters', () => {
    const converted = fired.filter((f) => f.rule === FLOW_CREDENTIAL_LITERAL);
    // Coverage control: all three positions fired, each with its own route.
    for (const opening of ['header ', 'url query parameter ', 'connector input ']) {
      expect(converted.some((f) => f.message.startsWith(opening)), opening).toBe(true);
    }
    expect(new Set(converted.map((f) => f.hint)).size).toBe(3);
    for (const f of converted) {
      expect(f.hint, f.rule).not.toContain('\n');
      expect(f.hint.length, `${f.rule}: ${f.hint}`).toBeLessThanOrEqual(200);
    }
  });

  it('`os explain` carries what the `fix:` line no longer says', () => {
    const text = explainRule(FLOW_CREDENTIAL_LITERAL)!.paragraphs.join('\n');
    for (const fact of [
      'resolved at boot (an environment variable in the open tier)',
      "names a `provider` ('rest' for a plain HTTP API)",
      "`auth: { type: 'basic', username, credentialRef }`",
      'A `{variable}` template is not a literal and draws nothing',
      'nothing is refused',
      'content/docs/automation/connectors.mdx',
    ]) {
      expect(text, `explanation names ${fact}`).toContain(fact);
    }
  });

  it('every auth variant the `fix:` lines and the explanation name is one the connector auth schema accepts', () => {
    // The explanation module imports nothing, so the variants it and the
    // `fix:` lines spell out are held to the spec's schema here.
    for (const auth of [
      { type: 'bearer', credentialRef: 'PROBE_REF' },
      { type: 'api-key', headerName: 'X-Api-Key', credentialRef: 'PROBE_REF' },
      { type: 'api-key', paramName: 'api_key', credentialRef: 'PROBE_REF' },
      { type: 'basic', username: 'probe', credentialRef: 'PROBE_REF' },
    ]) {
      expect(ConnectorInstanceAuthSchema.safeParse(auth).success, JSON.stringify(auth)).toBe(true);
    }
    // The connector-input line offers every secret-bearing variant by name.
    const input = lintFlowCredentialLiteralsUnrecorded(controlStack()).find((f) =>
      f.message.startsWith('connector input '),
    )!;
    expect(input.hint).toContain("type: 'bearer' | 'api-key' | 'basic', credentialRef");
  });
});
