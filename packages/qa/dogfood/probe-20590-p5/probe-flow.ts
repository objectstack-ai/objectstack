// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #20590 position 5 — the probe flow, shared by the reach probe and the
 * `os validate` / `os lint` fixture. MEASUREMENT ONLY (see
 * `vitest.probe.config.mts`). Every value below is a probe sentinel, not a
 * credential.
 */

/** Probe-only sentinels. Each names the position it stands in. */
export const S = {
  topAuthz: 'p5-top-authz-literal-20590',
  topApiKey: 'p5-top-apikey-literal-20590',
  nestedAuthz: 'p5-nested-authz-literal-20590',
  connToken: 'p5-conn-token-literal-20590',
  connNested: 'p5-conn-nested-secret-literal-20590',
  signingTop: 'p5-signing-top-sentinel-20590',
  signingNested: 'p5-signing-nested-sentinel-20590',
  /** A credential carried in the URL itself (a query key) — the shape the Slack-webhook examples teach. */
  urlSecret: 'p5-url-secret-literal-20590',
  controlHeader: 'p5-control-header-value-20590',
  controlInput: 'p5-control-input-value-20590',
} as const;

/** Which sentinels are credential-shaped literals, which are controls. */
export const CREDENTIAL_LITERALS = ['topAuthz', 'topApiKey', 'nestedAuthz', 'connToken', 'connNested'] as const;
export const DECLARED_KEY_CONTROLS = ['signingTop', 'signingNested'] as const;
export const NON_CREDENTIAL_CONTROLS = ['controlHeader', 'controlInput'] as const;
/** Beside the open maps: a credential-bearing `url` (reported apart, never folded into the open-map counts). */
export const URL_LITERALS = ['urlSecret'] as const;
/** A `{token}` template in a credential-named header: not a literal, recorded apart. */
export const TEMPLATE_HEADER = 'Bearer {api_token}';

export function probeFlow(name: string) {
  return {
    name,
    label: 'P5 open-map probe',
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
            'X-Trace-Label': S.controlHeader,
            'X-Templated-Auth': TEMPLATE_HEADER,
          },
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
            path: S.controlInput,
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
  };
}

