// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0130 D4 — the engine's `manifest` service registers the OBJECTS of a
 * multi-package stack's residual: top-level objects no package body declares,
 * under the id the residual rule names (`unclaimedTopLevel`,
 * `@objectstack/metadata`).
 *
 * ## The defect these pin
 *
 * The metadata door registers a stack's residual under the stack's own
 * `manifest.id` and the boot warns that every door will report that id as
 * the items' owner. The `manifest` service read the package BODIES only
 * (`resolveArtifactPackageOrder` answers `packages[]` when the key is
 * present), so a residual object never reached the SchemaRegistry: listed by
 * `GET /meta/object`, `404` on `/data/<name>`, through both boot doors. The
 * two-boot reading is `packages/cli/test/serve-config-boot-residual.integration.test.ts`
 * (row 4); these pins hold the engine half on a kernel.
 *
 * ## What each pin is for
 *
 *  - The residual object is RESOLVED by the registry and OWNED by the stack's
 *    manifest id — what the data door reads.
 *  - CONTROL: the bodies' objects keep their own owners, and no package record
 *    appears for the residual's id. The residual is not a package; when its id
 *    names a body (a composed stack keeps one member's manifest) that body's
 *    record must stay the body's.
 *  - A late artifact (after `start()`) reaches the metadata service too.
 *  - The two classes whose registration would REFUSE a boot the residual rule
 *    accepts — a name another package owns, a field naming a picklist no body
 *    declares — are listed and not served, and the boot says so, naming each.
 *    Both were measured refusing the boot when registered.
 *
 * Payloads are handed over the way `AppPlugin` hands them:
 * `{ ...bundle.manifest, ...bundle }`.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { OWNERSHIP_QUEUE_SERVICE, type IMetadataService } from '@objectstack/spec/contracts';
import { ObjectQLPlugin } from './plugin.js';
import type { ObjectQL } from './engine.js';
import { viewContainerNameRefusal } from './view-container-name-refusal.js';

type ManifestService = { register(m: unknown): void | Promise<void> };

const engineOf = (kernel: ObjectKernel): ObjectQL => kernel.getService<ObjectQL>('objectql');

const APP_ID = 'com.example.acme';
const SERVICE_ID = 'com.example.acme.service';
const RELEASE_ID = 'com.example.acme.release';
const OTHER_ID = 'com.example.other';

const caseObj = () => ({ name: 'acme_case', label: 'Case', sharingModel: 'private', fields: { subject: { type: 'text', label: 'Subject' } } });
const accountObj = () => ({ name: 'acme_account', label: 'Account', sharingModel: 'private', fields: { name: { type: 'text', label: 'Name' } } });
const noteObj = (fields: Record<string, unknown> = { title: { type: 'text', label: 'Title' } }) =>
  ({ name: 'acme_note', label: 'Note', sharingModel: 'private', fields });
const statusList = () => ({ name: 'acme_status', label: 'Status', options: [{ label: 'Open', value: 'open' }] });
const statusField = { status: { name: 'status', type: 'select', label: 'Status', picklist: 'acme_status' } };
const svc = { id: SERVICE_ID, name: 'service', namespace: 'acme', version: '2.4.0', type: 'module' };
const app = { id: APP_ID, name: 'acme', namespace: 'acme', version: '1.0.0', type: 'app' };

/** What `AppPlugin.init` hands the `manifest` service. */
const payload = (bundle: Record<string, unknown>) => ({ ...(bundle.manifest as object), ...bundle });

/**
 * Two packages, a `manifest.id` naming neither, and a top-level `acme_note` no
 * body declares. `extra` lands on the top level; `serviceExtra` on the service body.
 */
const residualStack = (
  note = noteObj(),
  extra: Record<string, unknown> = {},
  serviceExtra: Record<string, unknown> = {},
) => payload({
  manifest: { ...app, id: RELEASE_ID },
  objects: [caseObj(), accountObj(), note],
  ...extra,
  packages: [
    { manifest: { ...svc, objects: [caseObj()], ...serviceExtra } },
    { manifest: { ...app, objects: [accountObj()] } },
  ],
});

const owners = (ql: ObjectQL): Record<string, string | undefined> =>
  Object.fromEntries(
    ['acme_account', 'acme_case', 'acme_note'].map((name) => [name, ql.registry.getObjectOwner(name)?.packageId]),
  );

const acmePackageIds = (ql: ObjectQL): string[] =>
  ql.registry
    .getAllPackages()
    .map((p) => p.manifest?.id)
    .filter((id: unknown): id is string => typeof id === 'string' && id.startsWith('com.example.acme'));

/**
 * The kernel hands every plugin ONE logger, so a plugin that inits first can
 * read what the engine says on it. Wrapping in place rather than replacing:
 * the engine's own calls still reach the real (silent) logger.
 */
class WarnRecorder implements Plugin {
  name = 'test.residual-objects.warn-recorder';
  version = '1.0.0';
  readonly warnings: string[] = [];
  init = async (ctx: PluginContext): Promise<void> => {
    const logger = ctx.logger as { warn: (message: string, ...rest: unknown[]) => void };
    const real = logger.warn.bind(logger);
    logger.warn = (message: string, ...rest: unknown[]) => {
      this.warnings.push(String(message));
      real(message, ...rest);
    };
  };
}

/** Registers `artifacts` through the `manifest` service in `init()` — a boot-time registration, as `AppPlugin` makes. */
function registering(name: string, artifacts: unknown[], after: string[] = []): Plugin {
  return {
    name,
    dependencies: ['com.objectstack.engine.objectql', ...after],
    init: async (ctx: PluginContext) => {
      const manifest = ctx.getService<ManifestService>('manifest');
      for (const artifact of artifacts) await manifest.register(artifact);
    },
  } as Plugin;
}

const kernels: ObjectKernel[] = [];

/** Boot a kernel whose plugins register `plugins`' artifacts at boot; `recorder` sees every warning. */
async function boot(...plugins: Plugin[]): Promise<{ kernel: ObjectKernel; recorder: WarnRecorder }> {
  const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
  kernels.push(kernel);
  const recorder = new WarnRecorder();
  await kernel.use(recorder);
  await kernel.use(new ObjectQLPlugin());
  for (const plugin of plugins) await kernel.use(plugin);
  await kernel.bootstrap();
  return { kernel, recorder };
}

/** The engine's line naming residual objects it lists and does not serve. */
const unservedLines = (recorder: WarnRecorder): string[] =>
  recorder.warnings.filter((w) => w.includes('NOT served by the data door'));

afterEach(async () => {
  while (kernels.length) {
    const kernel = kernels.pop()!;
    if (kernel.getState() === 'running') await kernel.shutdown();
  }
});

describe('ADR-0130 D4 — the manifest service registers the residual\'s objects', () => {
  it('registers a residual object under the stack\'s manifest id, beside the bodies\' own', async () => {
    const { kernel, recorder } = await boot(registering('app', [residualStack()]));
    const ql = engineOf(kernel);

    // Before: `acme_note` resolved to nothing — the data door's 404.
    expect(ql.registry.resolveObject('acme_note')?.fields?.title).toBeDefined();
    expect(owners(ql)).toEqual({
      acme_account: APP_ID,
      acme_case: SERVICE_ID,
      acme_note: RELEASE_ID,
    });
    expect((ql.registry.resolveObject('acme_note') as { _packageId?: string } | undefined)?._packageId).toBe(RELEASE_ID);
    // …with the stack's version beside it, as the metadata door stamps the residual (#22689).
    expect((ql.registry.resolveObject('acme_note') as { _packageVersion?: string } | undefined)?._packageVersion).toBe('1.0.0');
    expect(unservedLines(recorder)).toEqual([]);
  });

  it('installs no package record for the residual\'s id — the residual is not a package', async () => {
    const { kernel } = await boot(registering('app', [residualStack()]));
    expect(acmePackageIds(engineOf(kernel)).sort()).toEqual([APP_ID, SERVICE_ID]);
  });

  it('a composed stack whose manifest names a body: the residual takes that id, and the body keeps its own record', async () => {
    const { kernel } = await boot(registering('app', [payload({
      manifest: app,
      objects: [caseObj(), accountObj(), noteObj()],
      packages: [
        { manifest: { ...svc, objects: [caseObj()] } },
        { manifest: { ...app, objects: [accountObj()] } },
      ],
    })]));
    const ql = engineOf(kernel);

    expect(owners(ql)).toEqual({ acme_account: APP_ID, acme_case: SERVICE_ID, acme_note: APP_ID });
    // The app body's record is the app body, not the residual: its own
    // objects, still exactly one.
    const record = ql.registry.getAllPackages().find((p) => p.manifest?.id === APP_ID);
    expect((record?.manifest as { objects?: Array<{ name?: string }> } | undefined)?.objects?.map((o) => o.name))
      .toEqual(['acme_account']);
  });

  it('CONTROL: a normally composed stack (the top level repeats every body) registers nothing beyond the bodies', async () => {
    const { kernel } = await boot(registering('app', [payload({
      manifest: { ...app, id: RELEASE_ID },
      objects: [caseObj(), accountObj()],
      packages: [
        { manifest: { ...svc, objects: [caseObj()] } },
        { manifest: { ...app, objects: [accountObj()] } },
      ],
    })]));
    const ql = engineOf(kernel);
    expect(owners(ql)).toEqual({ acme_account: APP_ID, acme_case: SERVICE_ID, acme_note: undefined });
    expect(acmePackageIds(ql).sort()).toEqual([APP_ID, SERVICE_ID]);
  });

  it('`packages: []` beside a top-level object registers the object under the manifest id', async () => {
    const { kernel } = await boot(registering('app', [payload({
      manifest: { ...app, id: RELEASE_ID },
      objects: [noteObj()],
      packages: [],
    })]));
    const ql = engineOf(kernel);
    expect(ql.registry.getObjectOwner('acme_note')?.packageId).toBe(RELEASE_ID);
    expect(acmePackageIds(ql)).toEqual([]);
  });

  it('a residual object whose field names a picklist a BODY declares is served with that list', async () => {
    const { kernel } = await boot(registering('app', [
      residualStack(noteObj(statusField), {}, { picklists: [statusList()] }),
    ]));
    const ql = engineOf(kernel);
    expect(ql.registry.getObjectOwner('acme_note')?.packageId).toBe(RELEASE_ID);
    const options = (ql.registry.getObject('acme_note')?.fields?.status as { options?: Array<{ value: unknown }> } | undefined)?.options;
    expect(options?.map((o) => o.value)).toEqual(['open']);
  });
});

describe('ADR-0130 D4 — the residual objects the engine lists and does not serve', () => {
  it('an object whose name another package owns: the boot still boots, that package keeps it, and the boot names it', async () => {
    const other = {
      id: OTHER_ID, name: 'other', version: '1.0.0', type: 'app',
      objects: [{ name: 'acme_note', label: 'Other note', fields: { body: { type: 'text', label: 'Body' } } }],
    };
    // Registered as an object this stack does not own would be: by another
    // package, earlier in the same boot.
    const { kernel, recorder } = await boot(
      registering('other', [other]),
      registering('app', [residualStack()], ['other']),
    );
    const ql = engineOf(kernel);

    // Registering it would have refused the boot with OBJECT_OWNERSHIP_CONFLICT.
    expect(owners(ql)).toEqual({ acme_account: APP_ID, acme_case: SERVICE_ID, acme_note: OTHER_ID });
    expect(ql.registry.resolveObject('acme_note')?.fields?.body).toBeDefined();
    const lines = unservedLines(recorder);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`stack '${RELEASE_ID}'`);
    expect(lines[0]).toContain(`'acme_note' (package '${OTHER_ID}' already owns that name)`);
  });

  it('an object whose field names a picklist only the residual declares: the boot still boots, and the boot names it', async () => {
    const { kernel, recorder } = await boot(registering('app', [
      residualStack(noteObj(statusField), { picklists: [statusList()] }),
    ]));
    const ql = engineOf(kernel);

    // Registering it would have refused the boot at `kernel:ready` (INVALID_METADATA,
    // the picklist audit): the residual's own list is metadata only.
    expect(kernel.getState()).toBe('running');
    expect(owners(ql)).toEqual({ acme_account: APP_ID, acme_case: SERVICE_ID, acme_note: undefined });
    const lines = unservedLines(recorder);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(
      "'acme_note' (field 'status' names picklist 'acme_status', which no package body declares)",
    );
  });
});

describe('ADR-0130 D4 — a residual arriving after start()', () => {
  it('reaches the metadata service under the stack\'s manifest id, as a body\'s objects do', async () => {
    const { kernel } = await boot();
    await (kernel.getService('manifest') as ManifestService).register(residualStack());

    expect(engineOf(kernel).registry.getObjectOwner('acme_note')?.packageId).toBe(RELEASE_ID);
    const metadata = kernel.getService<IMetadataService>('metadata');
    const bridged = await metadata.getObject('acme_note') as { _packageId?: string } | undefined;
    expect(bridged?._packageId).toBe(RELEASE_ID);
  });
});

/**
 * [ADR-0015 D7] The residual's CONNECTORS reach the registry too: the
 * connector credential lender and the ADR-0097 reconcile read
 * `registry.listItems('connector')` alone, so a residual instance registered
 * by the metadata door only could not lend at boot, while the composed check
 * accepted a borrow of it. The borrow itself is pinned on a kernel in
 * `service-automation` (`connector-credential-residual-connector.test.ts`).
 */
describe('ADR-0015 D7 — the manifest service registers the residual\'s connectors', () => {
  const sap = (name = 'acme_sap') => ({
    name,
    label: 'SAP',
    type: 'api',
    provider: 'openapi',
    auth: { type: 'bearer', credentialRef: 'acme_sap_token' },
  });
  const connectorOwners = (ql: ObjectQL) =>
    (ql.registry.listItems('connector') as Array<{ name?: string; _packageId?: string; _packageVersion?: string }>)
      .map((c) => [c.name, c._packageId, c._packageVersion])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));

  it('registers a residual connector under the stack\'s manifest id and version, beside a body\'s own', async () => {
    const residualEntry = sap();
    const { kernel } = await boot(registering('app', [
      residualStack(noteObj(), { connectors: [residualEntry] }, { connectors: [sap('acme_crm')] }),
    ]));
    expect(connectorOwners(engineOf(kernel))).toEqual([
      ['acme_crm', SERVICE_ID, '2.4.0'],
      ['acme_sap', RELEASE_ID, '1.0.0'],
    ]);
    // The artifact's own entry is left as it arrived.
    expect((residualEntry as { _packageId?: string })._packageId).toBeUndefined();
  });

  it('registers a residual connector when the stack has no residual object', async () => {
    const { kernel } = await boot(registering('app', [payload({
      manifest: { ...app, id: RELEASE_ID },
      objects: [caseObj(), accountObj()],
      connectors: [sap()],
      packages: [
        { manifest: { ...svc, objects: [caseObj()] } },
        { manifest: { ...app, objects: [accountObj()] } },
      ],
    })]));
    expect(connectorOwners(engineOf(kernel))).toEqual([['acme_sap', RELEASE_ID, '1.0.0']]);
  });

  it('CONTROL: a top-level connector a body repeats is the body\'s, registered once', async () => {
    const { kernel } = await boot(registering('app', [
      residualStack(noteObj(), { connectors: [sap()] }, { connectors: [sap()] }),
    ]));
    expect(connectorOwners(engineOf(kernel))).toEqual([['acme_sap', SERVICE_ID, '2.4.0']]);
  });
});

/**
 * [ADR-0130 D4] The residual's FLOWS reach the registry too: the automation
 * plugin's boot pull reads `registry.listItems('flow')` alone, so a residual
 * flow registered by the metadata door only was listed by `/meta` and never
 * registered with the engine. The boot-and-run reading is pinned on a kernel
 * in `service-automation` (`residual-top-level-flow-boot.test.ts`).
 */
describe('ADR-0130 D4 — the manifest service registers the residual\'s flows', () => {
  const flow = (name = 'acme_escalate') => ({
    name,
    label: 'Escalate',
    type: 'autolaunched',
    nodes: [{ id: 'start', type: 'start', label: 'Start' }, { id: 'end', type: 'end', label: 'End' }],
    edges: [{ id: 'e1', source: 'start', target: 'end' }],
  });
  const flowOwners = (ql: ObjectQL) =>
    (ql.registry.listItems('flow') as Array<{ name?: string; _packageId?: string; _packageVersion?: string }>)
      .map((f) => [f.name, f._packageId, f._packageVersion])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));

  it('registers a residual flow under the stack\'s manifest id and version, beside a body\'s own', async () => {
    const residualEntry = flow();
    const { kernel } = await boot(registering('app', [
      residualStack(noteObj(), { flows: [residualEntry] }, { flows: [flow('acme_route')] }),
    ]));
    expect(flowOwners(engineOf(kernel))).toEqual([
      ['acme_escalate', RELEASE_ID, '1.0.0'],
      ['acme_route', SERVICE_ID, '2.4.0'],
    ]);
    // The artifact's own entry is left as it arrived.
    expect((residualEntry as { _packageId?: string })._packageId).toBeUndefined();
  });

  it('registers a residual flow when the stack has no other residual item', async () => {
    const { kernel } = await boot(registering('app', [payload({
      manifest: { ...app, id: RELEASE_ID },
      objects: [caseObj(), accountObj()],
      flows: [flow()],
      packages: [
        { manifest: { ...svc, objects: [caseObj()] } },
        { manifest: { ...app, objects: [accountObj()] } },
      ],
    })]));
    expect(flowOwners(engineOf(kernel))).toEqual([['acme_escalate', RELEASE_ID, '1.0.0']]);
  });

  it('CONTROL: a top-level flow a body repeats is the body\'s, registered once', async () => {
    const { kernel } = await boot(registering('app', [
      residualStack(noteObj(), { flows: [flow()] }, { flows: [flow()] }),
    ]));
    expect(flowOwners(engineOf(kernel))).toEqual([['acme_escalate', SERVICE_ID, '2.4.0']]);
  });
});

/**
 * [ADR-0130 D4] EVERY other residual type a package body's collections take
 * into the registry reaches it too, under the stack's manifest id and version:
 * the engine registered a residual's objects, connectors and flows only, so a
 * residual item of any other type was registered by the metadata door alone
 * and every reader that asks the registry — the save door's managed-content
 * seal among them — answered as if it were not declared. Two residual types
 * keep a path of their own and are not in this population: objects (above) and
 * picklists, which stay metadata-only for the reason the objects rule names.
 */
describe('ADR-0130 D4 — the manifest service registers every other residual type', () => {
  /** The stack collection of each type, with a minimal named item. */
  const GENERIC: Record<string, string> = {
    apps: 'app', pages: 'page', dashboards: 'dashboard', reports: 'report', actions: 'action',
    workflows: 'workflow', positions: 'position', permissions: 'permission', capabilities: 'capability',
    sharingRules: 'sharing_rule', apis: 'api', webhooks: 'webhook', agents: 'agent', tools: 'tool',
    skills: 'skill', ragPipelines: 'rag_pipeline', hooks: 'hook', mappings: 'mapping',
    analyticsCubes: 'analytics_cube', emailTemplates: 'email_template', docs: 'doc', books: 'book',
  };
  const itemOf = (type: string) => ({ name: `acme_top_${type}`, label: `Top ${type}` });
  /** The registry parses an action on registration, so the residual's action is a valid one too. */
  const ITEM_EXTRA: Record<string, Record<string, unknown>> = { actions: { type: 'url', target: 'https://example.com' } };
  const collectionsOf = (pick: (type: string) => boolean = () => true) => Object.fromEntries(
    Object.entries(GENERIC).filter(([, type]) => pick(type))
      .map(([field, type]) => [field, [{ ...itemOf(type), ...ITEM_EXTRA[field] }]]),
  );
  /**
   * A package BODY is strictly parsed on registration, so the pins that put an
   * item on a body take a schema-valid one: every security-domain type, and
   * one of each other kind the body schema admits with a short item.
   */
  const BODY_VALID: Record<string, Record<string, unknown>> = {
    permissions: { objects: {} },
    positions: {},
    capabilities: {},
    sharingRules: {
      type: 'criteria', object: 'acme_case', condition: "record.subject == 'x'", accessLevel: 'read',
      sharedWith: { type: 'position', value: 'acme_top_position' },
    },
    apps: {},
    pages: {},
    actions: { type: 'url', target: 'https://example.com' },
    hooks: { object: 'acme_case', events: ['beforeInsert'] },
    agents: { role: 'Triage', instructions: 'Triage cases.' },
    webhooks: { object: 'acme_case', url: 'https://example.com/hook', triggers: ['create'] },
    emailTemplates: { subject: 'Subject', bodyHtml: '<p>Body</p>' },
  };
  const bodyCollections = () => Object.fromEntries(
    Object.entries(BODY_VALID).map(([field, extra]) => [field, [{ ...itemOf(GENERIC[field]), ...extra }]]),
  );
  const ownerOf = (ql: ObjectQL, type: string, name: string) => {
    const item = ql.registry.getItem(type, name) as { _packageId?: string; _packageVersion?: string } | undefined;
    return item ? [item._packageId, item._packageVersion] : undefined;
  };
  const namesOf = (ql: ObjectQL, type: string) =>
    (ql.registry.listItems(type) as Array<{ name?: string }>).map((i) => i.name).filter((n) => n?.startsWith('acme_')).sort();

  it.each(Object.values(GENERIC))('registers a residual %s under the stack\'s manifest id and version', async (type) => {
    const { kernel } = await boot(registering('app', [residualStack(noteObj(), collectionsOf((t) => t === type))]));
    expect(ownerOf(engineOf(kernel), type, `acme_top_${type}`)).toEqual([RELEASE_ID, '1.0.0']);
  });

  it('registers every one of them from one stack, and leaves the artifact\'s own entries as they arrived', async () => {
    const collections = collectionsOf();
    const { kernel } = await boot(registering('app', [residualStack(noteObj(), collections)]));
    const ql = engineOf(kernel);
    for (const type of Object.values(GENERIC)) {
      expect(ownerOf(ql, type, `acme_top_${type}`), type).toEqual([RELEASE_ID, '1.0.0']);
    }
    for (const [field] of Object.entries(GENERIC)) {
      expect((collections[field] as Array<{ _packageId?: string }>)[0]._packageId, field).toBeUndefined();
    }
  });

  it('a residual view container registers under its object, expanded into its views, like a body\'s', async () => {
    const container = { object: 'acme_note', list: { type: 'grid', columns: ['title'] } };
    const { kernel } = await boot(registering('app', [residualStack(noteObj(), { views: [container] })]));
    const ql = engineOf(kernel);
    const views = ql.registry.listItems('view') as Array<{ name?: string; _packageId?: string }>;
    const noteViews = views.filter((v) => v.name === 'acme_note' || v.name?.startsWith('acme_note.'));
    expect(noteViews.map((v) => v.name)).toContain('acme_note');
    expect(noteViews.length).toBeGreaterThan(1);
    expect(new Set(noteViews.map((v) => v._packageId))).toEqual(new Set([RELEASE_ID]));
    expect((container as { _packageId?: string })._packageId).toBeUndefined();
  });

  it('a residual view container whose own `name` disagrees with its object is refused, in the body seam\'s words', async () => {
    const container = { name: 'notes_grid', object: 'acme_note', list: { type: 'grid', columns: ['title'] } };
    const expected = viewContainerNameRefusal(container, 'manifest', RELEASE_ID);
    expect(expected).toBeDefined();
    await expect(boot(registering('app', [residualStack(noteObj(), { views: [container] })])))
      .rejects.toThrow(expected!.message);
  });

  it('a residual view entry with no `name` is filed under its slot, as the body seam files it', async () => {
    const entry = { object: 'acme_note', label: 'Notes' };
    const { kernel } = await boot(registering('app', [residualStack(noteObj(), { views: [entry] })]));
    expect(ownerOf(engineOf(kernel), 'view', 'acme_note')).toEqual([RELEASE_ID, '1.0.0']);
    expect((entry as { name?: string }).name).toBeUndefined();
  });

  it.each([
    ['a flattened overlay with no `name`', { object: 'acme_note', type: 'grid', columns: ['title'] }, 'acme_note'],
    ['a ViewItem', { name: 'acme_note_item', object: 'acme_note', viewKind: 'list', config: { type: 'grid' } }, 'acme_note_item'],
  ])('a residual `views:` entry that is not a container (%s) is refused 422, in the body seam\'s words', async (_label, entry, name) => {
    const refusal = await boot(registering('app', [residualStack(noteObj(), { views: [entry] })])).then(() => undefined, (e: unknown) => e);
    expect(refusal).toMatchObject({ code: 'INVALID_METADATA', status: 422, httpStatus: 422 });
    expect((refusal as Error).message).toContain(
      `Invalid \`views:\` entry '${name}' from manifest '${RELEASE_ID}': the stack \`views:\` collection carries view CONTAINERS only.`,
    );
  });

  it('a residual queue and assignment rule register when the ownership-queue service is composed', async () => {
    const queues = { queues: [itemOf('queue')], assignmentRules: [itemOf('assignment_rule')] };
    const queueService: Plugin = {
      name: 'test.ownership-queue',
      init: async (ctx: PluginContext) => { ctx.registerService(OWNERSHIP_QUEUE_SERVICE, {}); },
    } as Plugin;
    const { kernel } = await boot(queueService, registering('app', [residualStack(noteObj(), queues)]));
    const ql = engineOf(kernel);
    expect(ownerOf(ql, 'queue', 'acme_top_queue')).toEqual([RELEASE_ID, '1.0.0']);
    expect(ownerOf(ql, 'assignment_rule', 'acme_top_assignment_rule')).toEqual([RELEASE_ID, '1.0.0']);
  });

  it('…and, like a body\'s, refuse the boot loudly when it is not', async () => {
    const queues = { queues: [itemOf('queue')], assignmentRules: [itemOf('assignment_rule')] };
    await expect(boot(registering('app', [residualStack(noteObj(), queues)])))
      .rejects.toThrow(/declares queues \(1\) and assignmentRules \(1\), but no 'ownership-queue' service is registered/);
  });

  it('a residual permission set whose body `packageId` names another package is refused, as a body\'s is', async () => {
    const set = { ...itemOf('permission'), objects: {}, packageId: OTHER_ID };
    await expect(boot(registering('app', [residualStack(noteObj(), { permissions: [set] })])))
      .rejects.toThrow(/Drop `packageId` from permission set 'acme_top_permission'/);
  });

  it('a top-level item a body repeats is the body\'s, registered once', async () => {
    const { kernel } = await boot(registering('app', [residualStack(noteObj(), bodyCollections(), bodyCollections())]));
    const ql = engineOf(kernel);
    for (const type of Object.keys(BODY_VALID).map((field) => GENERIC[field])) {
      expect(ownerOf(ql, type, `acme_top_${type}`), type).toEqual([SERVICE_ID, '2.4.0']);
      expect(namesOf(ql, type), type).toEqual([`acme_top_${type}`]);
    }
  });

  it('CONTROL: a stack with no residual item of these types registers exactly the bodies\' items', async () => {
    const { kernel } = await boot(registering('app', [residualStack(noteObj(), {}, bodyCollections())]));
    const ql = engineOf(kernel);
    for (const type of Object.keys(BODY_VALID).map((field) => GENERIC[field])) {
      expect(namesOf(ql, type), type).toEqual([`acme_top_${type}`]);
      expect(ownerOf(ql, type, `acme_top_${type}`), type).toEqual([SERVICE_ID, '2.4.0']);
    }
  });
});

/**
 * [ADR-0130 D4] A residual PICKLIST that no object field of the stack names is
 * refused at boot. The residual's picklists stay metadata only (the objects
 * rule above is judged on that premise), so one that no field names was
 * neither registered nor refused: the boot booted, and the list was missing
 * from the engine with nothing said. One that a field names is loud already,
 * and stays as it is: a residual object's field makes that object listed and
 * not served (above), and a body's field fails the boot's picklist audit.
 */
describe('ADR-0130 D4 — a residual picklist that no object field names', () => {
  const unusedList = (name = 'acme_unused') => ({ name, label: 'Unused', options: [{ label: 'A', value: 'a' }] });
  const refusalOf = (booting: Promise<unknown>): Promise<unknown> => booting.then(() => undefined, (e: unknown) => e);

  it('refuses the boot, naming the picklist and the stack, with the prescription', async () => {
    const refusal = await refusalOf(boot(registering('app', [residualStack(noteObj(), { picklists: [unusedList()] })])));
    expect(refusal).toMatchObject({ code: 'INVALID_METADATA', status: 422, httpStatus: 422 });
    const message = (refusal as Error).message;
    expect(message).toContain(`Picklist 'acme_unused' is declared on the top level of stack '${RELEASE_ID}'`);
    expect(message).toContain('no package body declares it and no object field names it');
    expect(message).toContain('Declare it inside the `packages[]` entry of the package whose objects use it');
    expect(message).toContain('name it from a field of the object meant to use it');
    expect(message).toContain('remove it from the top level');
  });

  it('names every such picklist in one refusal, and not one a field names', async () => {
    const refusal = await refusalOf(boot(registering('app', [
      residualStack(noteObj(statusField), { picklists: [statusList(), unusedList(), unusedList('acme_spare')] }),
    ])));
    expect(refusal).toMatchObject({ code: 'INVALID_METADATA' });
    const message = (refusal as Error).message;
    expect(message).toContain(`Picklists 'acme_unused', 'acme_spare' are declared on the top level of stack '${RELEASE_ID}'`);
    expect(message).not.toContain("'acme_status'");
  });

  it('refuses a stack whose `packages: []` leaves only such a picklist', async () => {
    const refusal = await refusalOf(boot(registering('app', [payload({
      manifest: { ...app, id: RELEASE_ID },
      picklists: [unusedList()],
      packages: [],
    })])));
    expect(refusal).toMatchObject({ code: 'INVALID_METADATA' });
    expect((refusal as Error).message).toContain(`Picklist 'acme_unused' is declared on the top level of stack '${RELEASE_ID}'`);
  });

  it('after start(), refuses the artifact before anything of it registers', async () => {
    const { kernel } = await boot();
    const manifest = kernel.getService<ManifestService>('manifest');
    const refusal = await refusalOf(Promise.resolve().then(() =>
      manifest.register(residualStack(noteObj(), { picklists: [unusedList()] }))));
    expect(refusal).toMatchObject({ code: 'INVALID_METADATA' });
    expect(owners(engineOf(kernel))).toEqual({ acme_account: undefined, acme_case: undefined, acme_note: undefined });
    expect(acmePackageIds(engineOf(kernel))).toEqual([]);
  });

  it('CONTROL: one a residual object\'s field names keeps the objects rule\'s line — boots, listed and not served, list unregistered', async () => {
    const { kernel, recorder } = await boot(registering('app', [
      residualStack(noteObj(statusField), { picklists: [statusList()] }),
    ]));
    const ql = engineOf(kernel);
    expect(kernel.getState()).toBe('running');
    expect(owners(ql).acme_note).toBeUndefined();
    expect(ql.registry.resolvePicklistOptions('acme_status')).toBeUndefined();
    expect(unservedLines(recorder)).toHaveLength(1);
  });

  it('CONTROL: one a BODY object\'s field names still fails the boot\'s picklist audit, not this refusal', async () => {
    const refusal = await refusalOf(boot(registering('app', [
      residualStack(noteObj(), { picklists: [statusList()] }, { objects: [{ ...caseObj(), fields: { ...caseObj().fields, ...statusField } }] }),
    ])));
    expect(refusal).toMatchObject({ code: 'INVALID_METADATA' });
    const message = (refusal as Error).message;
    expect(message).toContain("field 'acme_case.status'");
    expect(message).toContain('that no loaded package declares');
    expect(message).not.toContain('is declared on the top level of stack');
  });

  it('CONTROL: a picklist a body declares registers as today, whether or not the top level repeats it', async () => {
    for (const extra of [{ picklists: [statusList()] }, {}]) {
      const { kernel, recorder } = await boot(registering('app', [residualStack(noteObj(), extra, { picklists: [statusList()] })]));
      const ql = engineOf(kernel);
      expect(kernel.getState()).toBe('running');
      expect(ql.registry.resolvePicklistOptions('acme_status')?.map((o) => o.value)).toEqual(['open']);
      expect(unservedLines(recorder)).toEqual([]);
      await kernel.shutdown();
    }
  });

  it('CONTROL: a stack with no residual picklist boots unchanged', async () => {
    const { kernel, recorder } = await boot(registering('app', [residualStack()]));
    expect(kernel.getState()).toBe('running');
    expect(owners(engineOf(kernel))).toEqual({ acme_account: APP_ID, acme_case: SERVICE_ID, acme_note: RELEASE_ID });
    expect(unservedLines(recorder)).toEqual([]);
  });

  it('CONTROL: a stack without `packages[]` has no residual — its unnamed picklist registers as today', async () => {
    const { kernel } = await boot(registering('app', [payload({ manifest: app, objects: [noteObj()], picklists: [unusedList()] })]));
    expect(kernel.getState()).toBe('running');
    expect(engineOf(kernel).registry.resolvePicklistOptions('acme_unused')?.map((o) => o.value)).toEqual(['a']);
  });
});
