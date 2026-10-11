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
import type { IMetadataService } from '@objectstack/spec/contracts';
import { ObjectQLPlugin } from './plugin.js';
import type { ObjectQL } from './engine.js';

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
