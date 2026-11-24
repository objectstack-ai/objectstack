import { defineStack } from '@objectstack/spec';
import * as objects from './src/objects';
import * as views from './src/views';
import * as actions from './src/actions';
import * as flows from './src/flows';
import * as dashboards from './src/dashboards';
import * as apps from './src/apps';
import * as skills from './src/skills';
import * as picklists from './src/picklists';
import * as permissions from './src/security';
import * as datasets from './src/datasets';

// Every value a barrel exports, as the list a stack key takes: typed by what
// the barrel exports, and an empty list while it exports nothing yet.
const exportsOf = <M extends object>(barrel: M): M[keyof M][] => Object.values(barrel);

// This file is a MODULE, and the whole module is the stack: the default
// export below is the base, and every NAMED export is merged onto it as a
// top-level stack key under its own name. A helper exported from here is
// therefore read as a stack key and the build refuses it — keep helpers in a
// sibling module and import them. Only names the stack schema declares
// (onEnable, functions, the collections) belong here as named exports.
export default defineStack({
  manifest: {
    id: 'com.example.blank',
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
    engines: { protocol: '^18' },
  },

  // `automation` backs flow execution and materializes any declarative
  // `connectors:` entry into a live, dispatchable connector at boot. A
  // connector executor you add to `plugins:` registers its provider factory
  // with it — without `automation` loaded it has nowhere to register and boot
  // fails, so keep this capability whenever `plugins:` lists a connector.
  //
  // `triggers` fires a flow that starts on a record change, the kind
  // `objectstack generate flow NAME` writes: without it this config stops
  // loading once it holds such a flow. It can go if this project will never
  // hold one.
  requires: ['automation', 'triggers'],

  // No `plugins:` yet, on purpose. A plugin is code, and code is the one thing
  // a template install cannot copy: an app with an entry in `plugins:` installs
  // only as a managed package, never as an editable copy (`installModes:
  // ['unmanaged']`, how a marketplace trial is installed). So the scaffold adds
  // none until the app needs one.
  //
  // To call an external system from a flow as pure metadata, add a
  // `connectors:` entry naming `provider: 'rest' | 'openapi' | 'mcp'`, install
  // that provider's package (`@objectstack/connector-rest`, `-openapi`, `-mcp`)
  // and list its executor here, e.g. `plugins: [new ConnectorRestPlugin()]`.
  // Security: a declarative `mcp` stdio transport spawns a local process from
  // metadata, so it is denied by default — opt in per host with
  // `new ConnectorMcpPlugin({ declarativeStdio: ['<trusted-command>'] })`.
  // Authoring guide: https://objectstack.ai/docs/automation/connectors

  // Every directory `objectstack generate` writes into is wired here: its
  // index.ts exports what the directory holds, and each list below hands
  // those exports to the stack. `objectstack generate view NAME` adds a file
  // and one export line, and the view is part of this stack with no edit to
  // this file. A directory that is not wired here is never loaded, and
  // `objectstack validate` neither counts nor checks what it holds.
  objects: exportsOf(objects),
  views: exportsOf(views),
  actions: exportsOf(actions),
  flows: exportsOf(flows),
  dashboards: exportsOf(dashboards),
  apps: exportsOf(apps),
  skills: exportsOf(skills),
  picklists: exportsOf(picklists),
  permissions: exportsOf(permissions),
  datasets: exportsOf(datasets),
});
