import { defineStack } from '@objectstack/spec';
import { ConnectorRestPlugin } from '@objectstack/connector-rest';
import { ConnectorOpenApiPlugin } from '@objectstack/connector-openapi';
import { ConnectorMcpPlugin } from '@objectstack/connector-mcp';
import * as objects from './src/objects/index.js';

export default defineStack({
  manifest: {
    id: 'blank',
    namespace: 'blank',
    version: '0.1.0',
    type: 'app',
    name: 'Blank Starter',
    description: 'Minimal ObjectStack environment — a clean slate for building.',
    // Protocol compatibility range (ADR-0087 D1): lets an incompatible runtime
    // refuse this package at the boundary with the exact migration command,
    // instead of crashing later. Kept in lockstep with releases by
    // scripts/sync-template-versions.mjs.
    engines: { protocol: '^15' },
  },

  // `automation` backs flow execution and, per ADR-0097, materializes any
  // declarative `connectors:` entry into a live, dispatchable connector at boot.
  // The connector executors below register their provider factories with it —
  // without `automation` loaded they have nowhere to register and boot fails, so
  // keep this capability whenever `plugins:` lists a connector.
  requires: ['automation'],

  // Generic connector executors (ADR-0022/0023/0024 + ADR-0097), default-present
  // so you can add a `connectors:` entry naming `provider: 'rest' | 'openapi' |
  // 'mcp'` and have it materialize with zero host code. Zero-arg = contribute the
  // provider factory only. Brand connectors (Slack, …) stay marketplace/opt-in.
  // Security (#3055): a declarative `mcp` stdio transport spawns a local process
  // from metadata and is denied by default — opt in per host with
  // `new ConnectorMcpPlugin({ declarativeStdio: ['<trusted-command>'] })`.
  plugins: [
    new ConnectorRestPlugin(),
    new ConnectorOpenApiPlugin(),
    new ConnectorMcpPlugin(),
  ],

  objects: Object.values(objects),
});
