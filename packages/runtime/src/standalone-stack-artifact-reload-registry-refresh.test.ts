// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// An artifact hot reload refreshes every item the boot registered, on every
// read of it. The composition is the one `os dev` serves (`createStandaloneStack`:
// the artifact door plus the `AppPlugin` that registers the same artifact
// through the `manifest` service), and the reload is the door's own
// `_reloadAndAnnounce`, the body both the artifact-file watcher and the HMR POST
// run.
//
// THE DEFECT. The boot registers the artifact twice: the artifact door into the
// metadata service, and `AppPlugin` into the SchemaRegistry through the
// `manifest` service. A reload re-registered only the first, and the
// `metadata:reloaded` hook re-ingested objects alone. The by-name read asks the
// metadata service first, so it served the edit; the list read and its
// execution face (`getMetaItemsForExecution`) lay the registry over the metadata
// service, so they kept the boot copy until a cold restart. That execution face
// is what the email plugin renders a send from, and what the automation engine
// re-binds flows from on the same reload.
//
// Measured before the fix on this rig (each type v1 at boot, v2 in the file):
// email_template, dashboard, flow, page and action listed v1 on both list faces
// and served v2 by name; object served v2 on all three (its own re-ingest).
//
// What the fix must leave alone is pinned beside it: the cold boot (each case's
// v1 control), the installed package's record, one binding per hook and per
// action with the object's one owner, fields and indexes (the reload now walks
// the object twice: the package re-registration and the object re-ingest), and
// an environment save through
// the protocol, which still wins on every read after the reload re-registers
// the package beneath it.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ObjectQL } from '@objectstack/objectql';
import { Runtime } from './runtime.js';
import { createStandaloneStack } from './standalone-stack.js';

// [#10126] Pay the first transform of the dist-resolved workspace deps the
// boot reaches through a dynamic `import()` at MODULE LOAD, never inside a
// clocked `it` (`scripts/check-test-source-alias.mjs`).
import '@objectstack/metadata';
import '@objectstack/objectql';
import '@objectstack/service-datasource';

const BOOT_TIMEOUT = 90_000;
const PACKAGE_ID = 'com.test.artifact-reload';

/** One artifact, every display string carrying `v`. */
const artifact = (v: string) => ({
  manifest: { id: PACKAGE_ID, name: 'artifact_reload', type: 'app', version: '1.0.0' },
  objects: [{
    name: 'arl_note',
    label: `Note ${v}`,
    fields: { title: { type: 'text', label: 'Title' }, status: { type: 'text', label: 'Status' } },
    indexes: [{ name: 'arl_note_title', fields: ['title'] }],
  }],
  emailTemplates: [{ name: 'arl_mail', label: 'Mail', locale: 'en-US', subject: `Subject ${v}`, bodyHtml: `<p>${v}</p>` }],
  dashboards: [{ name: 'arl_dash', label: `Dash ${v}`, widgets: [] }],
  flows: [{
    name: 'arl_flow', label: `Flow ${v}`, type: 'autolaunched',
    nodes: [{ id: 'start', type: 'start', label: 'Start' }, { id: 'end', type: 'end', label: 'End' }],
    edges: [{ id: 'e1', source: 'start', target: 'end' }],
  }],
  pages: [{ name: 'arl_page', label: `Page ${v}`, type: 'app', regions: [] }],
  actions: [
    { name: 'arl_action', label: `Action ${v}`, type: 'url', target: 'https://example.com' },
    {
      name: 'arl_complete', label: `Complete ${v}`, objectName: 'arl_note', type: 'script',
      body: { language: 'js', source: 'return { ran: true };' },
    },
  ],
  hooks: [{
    name: 'arl_stamp',
    object: 'arl_note',
    events: ['beforeInsert'],
    // Appends, so a hook bound twice is visible on the input.
    body: { language: 'js', source: "ctx.input.status = (typeof ctx.input.status === 'string' ? ctx.input.status : '') + 'stamped';" },
  }],
});

/** `[type, name, the key whose value carries the version, that value's prefix]` for each item above. */
const PROBES = [
  ['email_template', 'arl_mail', 'subject', 'Subject'],
  ['dashboard', 'arl_dash', 'label', 'Dash'],
  ['flow', 'arl_flow', 'label', 'Flow'],
  ['page', 'arl_page', 'label', 'Page'],
  ['action', 'arl_action', 'label', 'Action'],
  ['object', 'arl_note', 'label', 'Note'],
] as const;

/** What every read of every probe serves when version `v` is the one in force. */
const everywhere = (v: string) => Object.fromEntries(PROBES.map(([type, , , prefix]) => {
  const value = `${prefix} ${v}`;
  return [type, { list: [value], execution: [value], byName: value }];
}));

describe('an artifact hot reload refreshes every read of every item the boot registered', () => {
  const dirs: string[] = [];
  const kernels: any[] = [];

  afterEach(async () => {
    for (const k of kernels.splice(0)) {
      try { await k.shutdown(); } catch { /* noop */ }
    }
    for (const d of dirs.splice(0)) {
      try { rmSync(d, { recursive: true, force: true }); } catch { /* noop */ }
    }
  });

  async function bootOverArtifact() {
    const dir = mkdtempSync(join(tmpdir(), 'os-artifact-reload-'));
    dirs.push(dir);
    const artifactPath = join(dir, 'objectstack.json');
    writeFileSync(artifactPath, JSON.stringify(artifact('v1')), 'utf-8');
    const stack = await createStandaloneStack({
      artifactPath,
      projectRoot: dir,
      databaseUrl: ':memory:',
      skipSeedData: true,
      runPlatformMigrations: false,
    });
    let pluginCtx: any;
    const runtime = new Runtime({ cluster: false });
    const kernel = runtime.getKernel();
    kernels.push(kernel);
    for (const p of stack.plugins) await kernel.use(p as any);
    // Only to hand the reload body a kernel context, as the watcher's closure
    // holds the door's own.
    await kernel.use({ name: 'test.context-probe', version: '0.0.0', init: async (ctx: any) => { pluginCtx = ctx; } } as any);
    await kernel.bootstrap();
    const door: any = stack.plugins.find((p: any) => typeof p?._reloadAndAnnounce === 'function');
    expect(door, 'the stack composes the artifact door').toBeDefined();
    const reload = async (v: string) => {
      writeFileSync(artifactPath, JSON.stringify(artifact(v)), 'utf-8');
      await door._reloadAndAnnounce(pluginCtx, { path: artifactPath }, [artifactPath]);
    };
    return { kernel, protocol: kernel.getService('protocol') as any, reload };
  }

  /** Each probe's value on the list, the list's execution face and the by-name read. */
  async function readAll(protocol: any) {
    const out: Record<string, { list: unknown[]; execution: unknown[]; byName: unknown }> = {};
    for (const [type, name, key] of PROBES) {
      const pick = (res: any) => (res?.items ?? []).filter((i: any) => i?.name === name).map((i: any) => i[key]);
      const one: any = await protocol.getMetaItem({ type, name });
      out[type] = {
        list: pick(await protocol.getMetaItems({ type })),
        execution: pick(await protocol.getMetaItemsForExecution({ type })),
        byName: one?.item?.[key],
      };
    }
    return out;
  }

  it('after a reload, the list and its execution face serve the edit the by-name read serves', async () => {
    const { protocol, reload } = await bootOverArtifact();

    // Positive control: the boot itself agrees everywhere, with one item each.
    expect(await readAll(protocol)).toEqual(everywhere('v1'));

    await reload('v2');
    expect(await readAll(protocol)).toEqual(everywhere('v2'));

    // A second edit, so the refresh is not a one-shot.
    await reload('v3');
    expect(await readAll(protocol)).toEqual(everywhere('v3'));
  }, BOOT_TIMEOUT);

  it('the reload keeps the package record the boot installed: same source, still enabled', async () => {
    const { kernel, reload } = await bootOverArtifact();
    const registry = kernel.getService<ObjectQL>('objectql').registry;
    const before = registry.getPackage(PACKAGE_ID);
    expect(before).toMatchObject({ source: 'code', enabled: true, status: 'installed' });

    await reload('v2');

    expect(registry.getPackage(PACKAGE_ID)).toMatchObject({ source: 'code', enabled: true, status: 'installed' });
  }, BOOT_TIMEOUT);

  it('a reload binds each hook and action once, and the object keeps its one owner, its fields and its indexes', async () => {
    const { kernel, protocol, reload } = await bootOverArtifact();
    const ql = kernel.getService<ObjectQL>('objectql');
    const read = async () => {
      const ctx: any = { object: 'arl_note', event: 'beforeInsert', input: { title: 'probe' }, session: {} };
      await ql.triggerHooks('beforeInsert', ctx);
      const object = ql.registry.getObject('arl_note') as any;
      return {
        hookRuns: ctx.input.status,
        boundActions: ql.listRegisteredActions().filter((r) => r.actionName === 'arl_complete').length,
        listedActions: ((await protocol.getMetaItems({ type: 'action' })).items ?? []).filter((i: any) => i?.name === 'arl_complete').length,
        listedHooks: ((await protocol.getMetaItems({ type: 'hook' })).items ?? []).filter((i: any) => i?.name === 'arl_stamp').length,
        contributors: ql.registry.getObjectContributors('arl_note').map((c: any) => `${c.packageId}:${c.ownership}:${c.priority}`),
        owner: ql.registry.getPackagedObjectOwner('arl_note')?.packageId,
        fields: Object.keys(object?.fields ?? {}).filter((f) => f === 'title' || f === 'status'),
        indexes: (object?.indexes ?? []).filter((i: any) => i?.name === 'arl_note_title').length,
      };
    };
    const boot = await read();
    // Positive control: the boot binds the hook and the action once.
    expect(boot).toMatchObject({ hookRuns: 'stamped', boundActions: 1, listedActions: 1, listedHooks: 1, owner: PACKAGE_ID, indexes: 1 });
    expect(boot.contributors).toEqual([`${PACKAGE_ID}:own:100`]);

    await reload('v2');
    expect(await read()).toEqual(boot);
    await reload('v3');
    expect(await read()).toEqual(boot);
  }, BOOT_TIMEOUT);

  it('an environment save of the template still wins on every read after a reload re-registers the package', async () => {
    const { protocol, reload } = await bootOverArtifact();
    const subjects = async () => {
      const pick = (res: any) => (res?.items ?? []).filter((i: any) => i?.name === 'arl_mail').map((i: any) => i.subject);
      return {
        list: pick(await protocol.getMetaItems({ type: 'email_template' })),
        execution: pick(await protocol.getMetaItemsForExecution({ type: 'email_template' })),
        byName: (await protocol.getMetaItem({ type: 'email_template', name: 'arl_mail' }))?.item?.subject,
      };
    };
    await protocol.saveMetaItem({
      type: 'email_template',
      name: 'arl_mail',
      item: { name: 'arl_mail', label: 'Mail', locale: 'en-US', subject: 'Saved subject', bodyHtml: '<p>saved</p>' },
    });
    const saved = { list: ['Saved subject'], execution: ['Saved subject'], byName: 'Saved subject' };
    // Positive control: the save is live before any reload.
    expect(await subjects()).toEqual(saved);

    await reload('v2');

    expect(await subjects()).toEqual(saved);
  }, BOOT_TIMEOUT);
});
