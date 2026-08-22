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
    // Protocol compatibility range: the metadata-protocol major this app is
    // authored against. The runtime checks it before it loads anything, so a
    // runtime outside the range refuses this app at the boundary with the exact
    // migration command instead of crashing later. Scaffolding stamped it to
    // match the ObjectStack version you installed — change it when you
    // deliberately move to a new protocol major, not to silence a mismatch.
    // Guide: https://objectstack.ai/docs/upgrading
    engines: { protocol: '^17' },
  },

  // `automation` backs flow execution and materializes any declarative
  // `connectors:` entry into a live, dispatchable connector at boot. The
  // connector executors below register their provider factories with it —
  // without `automation` loaded they have nowhere to register and boot fails,
  // so keep this capability whenever `plugins:` lists a connector.
  requires: ['automation'],

  // Generic connector executors, default-present so you can add a `connectors:`
  // entry naming `provider: 'rest' | 'openapi' | 'mcp'` and have it materialize
  // with zero host code. Zero-arg = contribute the provider factory only. Brand
  // connectors (Slack, …) stay marketplace/opt-in.
  // Security: a declarative `mcp` stdio transport spawns a local process from
  // metadata, so it is denied by default — opt in per host with
  // `new ConnectorMcpPlugin({ declarativeStdio: ['<trusted-command>'] })`.
  // Authoring guide: https://objectstack.ai/docs/automation/connectors
  plugins: [
    new ConnectorRestPlugin(),
    new ConnectorOpenApiPlugin(),
    new ConnectorMcpPlugin(),
  ],

  objects: Object.values(objects),
});
