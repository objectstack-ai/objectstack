// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #20590 position 5 — POSITIVE CONTROL for scan-open-map-credentials.mjs
// (`--control`). Plain string literals, so the scanner's LITERAL arm is shown
// able to fire. Every value is a probe sentinel, not a credential.
export const scanControlFlow = {
  name: 'scan_control',
  nodes: [
    {
      id: 'h',
      type: 'http',
      config: {
        url: 'https://x.invalid/hook?api_key=control-url-literal',
        headers: {
          Authorization: 'Bearer control-header-literal-1',
          'X-Api-Key': 'control-header-literal-2',
          'X-Plain': 'plain-value',
          'X-Auth-Token': '{run_token}',
        },
      },
    },
    {
      id: 'c',
      type: 'connector_action',
      connectorConfig: {
        connectorId: 'rest',
        actionId: 'request',
        input: { headers: { Authorization: 'Basic control-input-literal-1' }, token: 'control-input-literal-2', path: '/p' },
      },
    },
  ],
};
