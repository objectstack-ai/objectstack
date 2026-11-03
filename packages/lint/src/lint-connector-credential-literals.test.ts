// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `connector-credential-literal` — the pin set, the controls, and the registry
 * entry.
 *
 * Every value is a probe sentinel, not a credential.
 */

import { describe, expect, it } from 'vitest';
import { getMetadataTypeRedactor } from '@objectstack/spec/kernel';

import { AUTHORING_COMMANDS, AUTHORING_RULES, authoringRulesFor, runAuthoringRules } from './authoring-rules.js';
import {
  CONNECTOR_CREDENTIAL_LITERAL,
  CONNECTOR_CREDENTIAL_LITERAL_MAPS,
  lintConnectorCredentialLiterals,
} from './lint-connector-credential-literals.js';
import { explainRule } from './rule-explanations.js';
import { runRuntimeAuthoringRules, runtimeAuthoringRulesFor, stackKeyForType } from './runtime-gate.js';
import * as barrel from './index.js';

/** The probe sentinels. Each names the map it stands in. */
const S = {
  headers: 'probe-headers-sentinel',
  defaultHeaders: 'probe-default-headers-sentinel',
  transportHeaders: 'probe-transport-headers-sentinel',
  env: 'probe-env-sentinel',
} as const;

/** A `rest` entry with a bearer literal in each of its two header maps, beside a plain `Accept`. */
const restEntry = () => ({
  name: 'vendor_api',
  label: 'Vendor API',
  type: 'api',
  provider: 'rest',
  providerConfig: {
    baseUrl: 'https://api.vendor.invalid/v1',
    headers: { Authorization: `Bearer ${S.headers}`, Accept: 'application/json' },
    defaultHeaders: { 'X-Vendor-Trace': `Bearer ${S.defaultHeaders}`, Accept: 'application/json' },
  },
});

/** An `mcp` http entry and an `mcp` stdio entry, one bearer literal each. */
const mcpHttpEntry = () => ({
  name: 'search_tools',
  label: 'Search Tools',
  type: 'api',
  provider: 'mcp',
  providerConfig: {
    transport: {
      kind: 'http',
      url: 'https://mcp.vendor.invalid/mcp',
      headers: { Authorization: `Bearer ${S.transportHeaders}`, Accept: 'application/json' },
    },
  },
});

const mcpStdioEntry = () => ({
  name: 'local_tools',
  label: 'Local Tools',
  type: 'api',
  provider: 'mcp',
  providerConfig: {
    transport: {
      kind: 'stdio',
      command: 'local-mcp-server',
      env: { MCP_UPSTREAM: `Bearer ${S.env}`, LOG_LEVEL: 'info' },
    },
  },
});

/** The same three shapes, routed through `auth.credentialRef` and carrying only ordinary entries. */
const routedStack = () => ({
  connectors: [
    {
      ...restEntry(),
      providerConfig: {
        baseUrl: 'https://api.vendor.invalid/v1',
        headers: { Accept: 'application/json' },
        defaultHeaders: { Accept: 'application/json', 'User-Agent': 'objectstack' },
      },
      auth: { type: 'bearer', credentialRef: 'VENDOR_API_TOKEN' },
    },
    {
      ...mcpHttpEntry(),
      providerConfig: {
        transport: { kind: 'http', url: 'https://mcp.vendor.invalid/mcp', headers: { Accept: 'application/json' } },
      },
      auth: { type: 'api-key', headerName: 'X-Api-Key', credentialRef: 'SEARCH_TOOLS_KEY' },
    },
    {
      ...mcpStdioEntry(),
      providerConfig: { transport: { kind: 'stdio', command: 'local-mcp-server', env: { LOG_LEVEL: 'info' } } },
    },
  ],
});

const litStack = () => ({ connectors: [restEntry(), mcpHttpEntry(), mcpStdioEntry()] });

const LIT_PATHS = [
  'connectors[0].providerConfig.headers.Authorization',
  'connectors[0].providerConfig.defaultHeaders["X-Vendor-Trace"]',
  'connectors[1].providerConfig.transport.headers.Authorization',
  'connectors[2].providerConfig.transport.env.MCP_UPSTREAM',
];

describe('connector-credential-literal — the pin set', () => {
  it('a `Bearer …` literal in each of the four maps draws one warning, at its own path', () => {
    const findings = lintConnectorCredentialLiterals(litStack());
    expect(findings.map((f) => f.path)).toEqual(LIT_PATHS);
    expect(findings.every((f) => f.severity === 'warning')).toBe(true);
    expect(new Set(findings.map((f) => f.rule))).toEqual(new Set([CONNECTOR_CREDENTIAL_LITERAL]));
    expect(findings.map((f) => f.where)).toEqual([
      "connector 'vendor_api'",
      "connector 'vendor_api'",
      "connector 'search_tools'",
      "connector 'local_tools'",
    ]);
  });

  it('a credential NAME alone draws too (the predicate\'s R1), whatever the value opens with', () => {
    const stack = {
      connectors: [
        {
          name: 'named',
          providerConfig: {
            defaultHeaders: { 'x-api-key': 'probe-named-sentinel' },
            transport: { kind: 'stdio', command: 'x', env: { GITHUB_TOKEN: 'probe-env-named-sentinel' } },
          },
        },
      ],
    };
    expect(lintConnectorCredentialLiterals(stack).map((f) => f.path)).toEqual([
      'connectors[0].providerConfig.defaultHeaders["x-api-key"]',
      'connectors[0].providerConfig.transport.env.GITHUB_TOKEN',
    ]);
  });

  it('names the position and the route, and never echoes the value', () => {
    const findings = lintConnectorCredentialLiterals(litStack());
    for (const f of findings) {
      expect(f.message).toContain('auth.credentialRef');
      expect(f.hint).toContain('credentialRef');
    }
    const wire = JSON.stringify(findings);
    for (const sentinel of Object.values(S)) expect(wire.includes(sentinel), sentinel).toBe(false);
  });

  it('reads as one sentence per map; the stdio env verdict names `auth.credentialRef` with `transport.credentialEnv`', () => {
    const byPath = new Map(lintConnectorCredentialLiterals(litStack()).map((f) => [f.path, f]));
    expect(byPath.get(LIT_PATHS[0])!.message).toBe(
      "header 'Authorization' in providerConfig.headers holds a credential-shaped literal, kept in metadata, "
        + "not the secrets layer; move it to the connector's `auth.credentialRef`",
    );
    expect(byPath.get(LIT_PATHS[3])!.message).toBe(
      "env 'MCP_UPSTREAM' in providerConfig.transport.env holds a credential-shaped literal, kept in metadata, "
        + "not the secrets layer; move it to the connector's `auth.credentialRef` with `transport.credentialEnv`",
    );
    for (const f of byPath.values()) {
      expect(f.message.includes('\n'), f.path).toBe(false);
      expect(f.message.length, f.path).toBeLessThanOrEqual(210);
    }
  });

  it('the stdio env hint names the credentialEnv route, spelling `auth` as the header hint does', () => {
    const byPath = new Map(lintConnectorCredentialLiterals(litStack()).map((f) => [f.path, f]));
    const env = byPath.get(LIT_PATHS[3])!.hint;
    const header = byPath.get(LIT_PATHS[0])!.hint;
    const shared = "auth: { type: 'bearer', credentialRef }";
    expect(header).toContain(shared);
    expect(env).toContain(shared);
    expect(env).toContain('transport.credentialEnv');
    expect(env).not.toContain("kind: 'http'");
  });
});

describe('connector-credential-literal — what draws nothing', () => {
  it('a non-credential header (`Accept: application/json`) and an `auth.credentialRef`-routed connector', () => {
    expect(lintConnectorCredentialLiterals(routedStack())).toEqual([]);
  });

  it('a template, a blank value and a non-string value are not literals', () => {
    const stack = {
      connectors: [
        {
          name: 'quiet',
          providerConfig: {
            headers: { Authorization: 'Bearer {{ token }}', 'X-Api-Key': '', Cookie: 42 },
            transport: { kind: 'stdio', command: 'x', env: { API_TOKEN: '${API_TOKEN}' } },
          },
        },
      ],
    };
    expect(lintConnectorCredentialLiterals(stack)).toEqual([]);
  });

  it('a credential-shaped value OUTSIDE the four maps is not this rule\'s', () => {
    const stack = {
      connectors: [
        {
          name: 'elsewhere',
          providerConfig: { baseUrl: 'https://x.invalid', query: { token: 'probe-off-map-sentinel' } },
          metadata: { headers: { Authorization: 'Bearer probe-off-map-sentinel' } },
        },
      ],
    };
    expect(lintConnectorCredentialLiterals(stack)).toEqual([]);
  });

  it('never throws on a malformed stack', () => {
    for (const connectors of [undefined, null, 'x', [null, 1, 'x'], [{ providerConfig: 'x' }], [{ providerConfig: { transport: [] } }]]) {
      expect(() => lintConnectorCredentialLiterals({ connectors } as Record<string, unknown>)).not.toThrow();
    }
  });
});

describe('connector-credential-literal — the four maps are the redactor\'s', () => {
  it('judges exactly the maps the connector read path withholds whole', () => {
    // The spec does not export its map list, so it is read through the
    // redactor's own answer: an entry with every map filled with a plain
    // value, nothing else credential-shaped, reports the maps it withheld.
    const redact = getMetadataTypeRedactor('connector');
    expect(redact, 'no built-in connector redactor').toBeDefined();
    const plain = { Accept: 'application/json' };
    const { redactedKeys } = redact!({
      name: 'probe',
      label: 'Probe',
      type: 'api',
      provider: 'mcp',
      auth: { type: 'none' },
      providerConfig: { headers: plain, defaultHeaders: plain, transport: { kind: 'http', url: 'https://x.invalid', headers: plain, env: plain } },
    });
    expect([...redactedKeys].sort()).toEqual([...CONNECTOR_CREDENTIAL_LITERAL_MAPS].sort());
  });
});

describe('connector-credential-literal — registered once, at every door, as an advisory', () => {
  const entry = AUTHORING_RULES.find((r) => r.name === 'lintConnectorCredentialLiterals');

  it('is an advisory registry entry on all three commands and the runtime publish door for `connector`', () => {
    expect(entry).toBeDefined();
    expect(entry!.tier).toBe('advisory');
    expect([...entry!.commands].sort()).toEqual([...AUTHORING_COMMANDS].sort());
    expect(entry!.surfaces).toContain('runtime-publish');
    expect(entry!.runtimeTypes).toEqual(['connector']);
    for (const command of AUTHORING_COMMANDS) {
      expect(authoringRulesFor(command).map((r) => r.name)).toContain('lintConnectorCredentialLiterals');
    }
    expect(runtimeAuthoringRulesFor('connector').map((r) => r.name)).toContain('lintConnectorCredentialLiterals');
  });

  it('reaches the CLI commands through the registry as warnings', () => {
    for (const command of AUTHORING_COMMANDS) {
      const findings = runAuthoringRules(command, { normalized: litStack() }).filter(
        (f) => f.rule === CONNECTOR_CREDENTIAL_LITERAL,
      );
      expect(findings.map((f) => f.path), command).toEqual(LIT_PATHS);
      expect(findings.every((f) => f.severity === 'warning'), command).toBe(true);
    }
  });

  it('a connector write lands in the snapshot at the key the rule reads', () => {
    expect(stackKeyForType('connector')).toBe('connectors');
  });

  it('reaches the runtime publish gate for a connector write as advisories, never errors', () => {
    const result = runRuntimeAuthoringRules({ type: 'connector', item: restEntry() });
    expect(result.rulesRun).toContain('lintConnectorCredentialLiterals');
    expect(result.errors.filter((f) => f.rule === CONNECTOR_CREDENTIAL_LITERAL)).toEqual([]);
    expect(result.advisories.filter((f) => f.rule === CONNECTOR_CREDENTIAL_LITERAL).map((f) => f.path)).toEqual([
      'connectors[0].providerConfig.headers.Authorization',
      'connectors[0].providerConfig.defaultHeaders["X-Vendor-Trace"]',
    ]);
  });

  it('a routed connector write draws none at the runtime gate', () => {
    const result = runRuntimeAuthoringRules({ type: 'connector', item: routedStack().connectors[0] });
    expect(result.advisories.filter((f) => f.rule === CONNECTOR_CREDENTIAL_LITERAL)).toEqual([]);
  });

  it('exports the rule and its id from the package entry', () => {
    const b = barrel as Record<string, unknown>;
    expect(b.lintConnectorCredentialLiterals).toBe(lintConnectorCredentialLiterals);
    expect(b.CONNECTOR_CREDENTIAL_LITERAL).toBe(CONNECTOR_CREDENTIAL_LITERAL);
  });
});

describe('connector-credential-literal — `os explain`', () => {
  it('carries what the verdict does not say, and names every judged map', () => {
    const explained = explainRule(CONNECTOR_CREDENTIAL_LITERAL);
    expect(explained, 'no `os explain connector-credential-literal` entry').toBeDefined();
    const text = explained!.paragraphs.join('\n');
    for (const map of CONNECTOR_CREDENTIAL_LITERAL_MAPS) expect(text, map).toContain(`\`${map}\``);
    for (const fact of [
      'withholds each of them whole',
      'ADR-0097 §3',
      'A stdio MCP server takes the same `auth`',
      '`providerConfig.transport.credentialEnv`',
      'a heuristic',
      'A `{variable}` template is not a literal',
      'never the value itself',
    ]) {
      expect(text, `explanation names ${fact}`).toContain(fact);
    }
  });
});
