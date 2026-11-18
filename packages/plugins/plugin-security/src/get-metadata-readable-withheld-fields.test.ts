// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0106 D1/D7, #34901] `getMetadataReadableWithheldFields` — which of the
 * fields a disabled package withholds from an object's served schema may be
 * disclosed to a caller, judged against the STORAGE definition.
 *
 * The object and the extension are registered on a REAL `SchemaRegistry`, so
 * the withheld names and the stored definition are the registry's own answers
 * (`getWithheldExtensionFields`, `getStorageObject`), not a double's. Package
 * `PROJECTS` extends `m1_deal` with `m1_project` (guarded by the capability
 * `view_projects`) and `m1_margin` (computed from the live field `amount`), and
 * is disabled in every case that expects something withheld.
 *
 * The control beside each denial: `getMetadataReadableFields` answers the same
 * live field set to every caller here, so it cannot tell them apart — which is
 * why this member exists.
 */

import { describe, it, expect, vi } from 'vitest';
import { SchemaRegistry } from '@objectstack/objectql';
import type { PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';

const DEALS = 'com.qa.m1.deals';
const PROJECTS = 'com.qa.m1.projects';
const OBJECT = 'm1_deal';

const set = (name: string, extra: Record<string, unknown> = {}): PermissionSet =>
  ({ name, label: name, objects: { [OBJECT]: { allowRead: true } }, ...extra }) as unknown as PermissionSet;

const SETS: PermissionSet[] = [
  set('member_default'),
  // Holds the capability, but its field entry denies the read.
  set('deny_project', { systemPermissions: ['view_projects'], fields: { [`${OBJECT}.m1_project`]: { readable: false, editable: false } } }),
  // Reads the object; holds no capability.
  set('open'),
  set('projects_viewer', { systemPermissions: ['view_projects'] }),
  // Holds the capability; denies the live field `m1_margin` is computed from.
  set('deny_amount', { systemPermissions: ['view_projects'], fields: { [`${OBJECT}.amount`]: { readable: false, editable: false } } }),
];

/** Denied by a permission set's `readable: false`; denied by the stored field's `requiredPermissions`; admitted. */
const CALLERS = {
  deniedBySet: { userId: 'u_deny', positions: [], permissions: ['deny_project'] },
  deniedByCapability: { userId: 'u_open', positions: [], permissions: ['open'] },
  admitted: { userId: 'u_viewer', positions: [], permissions: ['projects_viewer'] },
} as const;

function registryWithExtension(options: { disabled?: boolean; extensionFields?: Record<string, unknown> } = {}) {
  const registry = new SchemaRegistry({ multiTenant: false });
  (registry as any).logLevel = 'silent';
  registry.installPackage({ id: DEALS, name: DEALS, version: '1.0.0', type: 'app', namespace: 'm1' } as any, 'code');
  registry.installPackage({ id: PROJECTS, name: PROJECTS, version: '1.0.0', type: 'module', namespace: 'm1', dependencies: { [DEALS]: '^1.0.0' } } as any, 'code');
  registry.registerObject({
    name: OBJECT, label: 'Deal',
    fields: { name: { name: 'name', type: 'text', label: 'Name' }, amount: { name: 'amount', type: 'number', label: 'Amount' } },
  } as any, DEALS, 'm1', 'own');
  registry.registerObject({
    name: OBJECT,
    fields: options.extensionFields ?? {
      m1_project: { name: 'm1_project', type: 'text', label: 'Project', requiredPermissions: ['view_projects'] },
      m1_margin: { name: 'm1_margin', type: 'formula', label: 'Margin', expression: 'record.amount * 2' },
    },
  } as any, PROJECTS, 'm1', 'extend');
  if (options.disabled !== false) registry.disablePackage(PROJECTS);
  return registry;
}

async function boot(options: { registry?: unknown; sets?: PermissionSet[] } = {}) {
  const registry = options.registry === undefined ? registryWithExtension() : options.registry;
  // The sets live where the plugin's catalog reads them: the plugin binds its
  // catalog to the engine's registry at start, and from then on that catalog,
  // not `metadata.list`, answers every by-name request.
  for (const s of options.sets ?? SETS) (registry as any)?.registerItem?.('permission', s, 'name');
  const ql: any = {
    registerMiddleware: () => {},
    getSchema: (name: string) => (registry as any)?.getObject?.(name) ?? null,
    findOne: async () => null,
    registry,
  };
  const metadata: any = {
    get: async (_type: string, name: string) => (registry as any)?.getObject?.(name) ?? null,
    list: async () => options.sets ?? SETS,
  };
  const services: Record<string, any> = { manifest: { register: vi.fn() }, objectql: ql, metadata };
  const registerService = vi.fn();
  const ctx: any = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService,
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' } as any);
  await plugin.init(ctx);
  await plugin.start(ctx);
  const security = registerService.mock.calls.find((c: unknown[]) => c[0] === 'security')?.[1];
  return { plugin, security };
}

describe('[ADR-0106 D1, #34901] SecurityPlugin.getMetadataReadableWithheldFields', () => {
  it('judges each withheld name against its stored definition: a set\'s readable:false and the field\'s requiredPermissions deny, a holder is admitted', async () => {
    const { security } = await boot();
    const answers: Record<string, unknown> = {};
    const readable: Record<string, unknown> = {};
    for (const [label, caller] of Object.entries(CALLERS)) {
      answers[label] = (await security.getMetadataReadableWithheldFields(OBJECT, caller))?.slice().sort();
      readable[label] = (await security.getMetadataReadableFields(OBJECT, caller))?.filter((f: string) => f.startsWith('m1_'));
    }
    expect(answers).toEqual({
      deniedBySet: ['m1_margin'],
      deniedByCapability: ['m1_margin'],
      admitted: ['m1_margin', 'm1_project'],
    });
    // Control: the live-field answer names no withheld field for anyone.
    expect(readable).toEqual({ deniedBySet: [], deniedByCapability: [], admitted: [] });
  });

  it('is served on the registered `security` service, and the plugin answers the same', async () => {
    const { plugin, security } = await boot();
    expect(typeof security.getMetadataReadableWithheldFields).toBe('function');
    await expect(security.getMetadataReadableWithheldFields(OBJECT, CALLERS.admitted))
      .resolves.toEqual(await plugin.getMetadataReadableWithheldFields(OBJECT, CALLERS.admitted));
  });

  it('a computed withheld field reading a field the caller may not read is not admitted', async () => {
    const { security } = await boot();
    const answer = await security.getMetadataReadableWithheldFields(OBJECT, { userId: 'u_amount', positions: [], permissions: ['deny_amount'] });
    expect(answer).toEqual(['m1_project']);
  });

  it('a computed withheld field reading through a reference is not admitted (fail closed: the referenced object is not walked)', async () => {
    const registry = registryWithExtension({
      extensionFields: { m1_owner_name: { name: 'm1_owner_name', type: 'formula', label: 'Owner', expression: 'record.owner.name' } },
    });
    const { security } = await boot({ registry });
    await expect(security.getMetadataReadableWithheldFields(OBJECT, CALLERS.admitted)).resolves.toEqual([]);
  });

  it('a zero-set caller is judged by the D7 fallback set', async () => {
    const fallbackDenies = SETS.map((s) => (s.name === 'member_default'
      ? set('member_default', { fields: { [`${OBJECT}.m1_margin`]: { readable: false, editable: false } } })
      : s));
    const { security } = await boot({ sets: fallbackDenies });
    // No `userId`: no baseline is applied, so the caller resolves no set and the fallback decides.
    const guest = { positions: [], permissions: [] };
    await expect(security.getMetadataReadableWithheldFields(OBJECT, guest)).resolves.toEqual([]);
    // Control: the same caller under a fallback that denies nothing reads m1_margin (m1_project needs a capability it lacks).
    const { security: open } = await boot();
    await expect(open.getMetadataReadableWithheldFields(OBJECT, guest)).resolves.toEqual(['m1_margin']);
  });

  it('an on-behalf-of caller is narrowed by the delegator: denied there ⇒ not admitted; a dangling delegator answers nothing', async () => {
    const { plugin, security } = await boot();
    const delegated = { ...CALLERS.admitted, onBehalfOf: { userId: 'u_delegator' } };
    const spy = vi.spyOn(plugin as any, 'resolveDelegatorForContext')
      .mockResolvedValue({ kind: 'resolved', context: { userId: 'u_delegator', positions: [], permissions: ['deny_project'] } });
    await expect(security.getMetadataReadableWithheldFields(OBJECT, delegated)).resolves.toEqual(['m1_margin']);
    spy.mockResolvedValue({ kind: 'missing', userId: 'u_delegator' });
    await expect(security.getMetadataReadableWithheldFields(OBJECT, delegated)).resolves.toEqual([]);
  });

  it('a system context is told every withheld name; nothing withheld answers []', async () => {
    const { security } = await boot();
    await expect(security.getMetadataReadableWithheldFields(OBJECT, { isSystem: true }).then((a: string[]) => a.sort()))
      .resolves.toEqual(['m1_margin', 'm1_project']);
    const { security: enabled } = await boot({ registry: registryWithExtension({ disabled: false }) });
    await expect(enabled.getMetadataReadableWithheldFields(OBJECT, CALLERS.admitted)).resolves.toEqual([]);
  });

  it('answers undefined when the registry offers no storage read, so the consumer drops every entry', async () => {
    const { security } = await boot({ registry: { getObject: () => ({ name: OBJECT, fields: { name: { name: 'name', type: 'text' } } }) } });
    await expect(security.getMetadataReadableWithheldFields(OBJECT, CALLERS.admitted)).resolves.toBeUndefined();
  });
});
