// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21788] "Import as Object" saves through the metadata door's own save.
 *
 * ## The defect this pins closed
 *
 * `ExternalDatasourceServicePlugin` wired `persistObject` to
 * `metadata.register('object', name, definition)`. That put the definition in
 * the metadata service's memory and nothing else: no `sys_metadata` row, no
 * engine schema sync, no external-object registration with the driver. So an
 * object imported under a name that differs from its remote table answered
 * `201` and then `500 no such table: <name>` (the SQL driver resolved the
 * table by the object's name), and every import was gone after a restart.
 * `PUT /api/v1/meta/object/:name` with the same body was durable and served
 * the rows, because it saves through `saveMetaItem` on the `'protocol'`
 * service — the one save that persists the row, writes it through to the
 * engine registry and syncs the object's storage (`syncObjectSchema`, which
 * for a federated object maps the remote table).
 *
 * ## What each case pins
 *
 *  - the import reaches `saveMetaItem` with the request the metadata door
 *    sends for an `object` (env-wide: `object` is not org-overridable), and
 *    registers through no second path;
 *  - [#21841] that request states the import's own write face,
 *    `'external-import'`, so a destructive re-import's refusal prescribes the
 *    remedies that exist from the import route rather than a `?force=true` it
 *    never reads; the face is the server's, and an import's options cannot
 *    carry a `force` or a face of their own into the save;
 *  - the save door is resolved when the import runs, not at `init()` — a
 *    protocol registered after this plugin still receives the save;
 *  - a save the door refuses refuses the import with the door's own error;
 *  - with no save door at all, the import is refused before any remote
 *    introspection and nothing is saved.
 *
 * The plugin is imported through a RELATIVE specifier, so these cases measure
 * `src/` and need no build. The booted-stack half (import, read rows, restart,
 * read again) is the dogfood pin's.
 */

import { describe, it, expect, vi } from 'vitest';
import type { PluginContext } from '@objectstack/core';
import type { IntrospectedSchema, IExternalDatasourceService } from '@objectstack/spec/contracts';
import { ExternalDatasourceServicePlugin } from '../plugin.js';

const remoteSchema = (): IntrospectedSchema =>
  ({
    dialect: 'sqlite',
    tables: {
      customers: {
        name: 'customers',
        columns: [
          { name: 'id', type: 'text', nullable: false, primaryKey: true },
          { name: 'name', type: 'text', nullable: true, primaryKey: false },
        ],
      },
    },
  }) as unknown as IntrospectedSchema;

interface Harness {
  ctx: PluginContext;
  services: Map<string, unknown>;
  introspect: ReturnType<typeof vi.fn>;
  register: ReturnType<typeof vi.fn>;
}

/** A kernel context whose `getService` throws on an unregistered name, as the kernel's does. */
function harness(): Harness {
  const services = new Map<string, unknown>();
  const introspect = vi.fn(async () => remoteSchema());
  const register = vi.fn(async () => undefined);
  services.set('data', { introspectDatasource: introspect });
  services.set('metadata', {
    get: async (type: string, name: string) =>
      type === 'datasource' ? { name, schemaMode: 'external' } : undefined,
    register,
  });
  const ctx = {
    getService: (name: string) => {
      if (!services.has(name)) throw new Error(`Service '${name}' not found`);
      return services.get(name);
    },
    registerService: (name: string, service: unknown) => {
      services.set(name, service);
    },
    trigger: async () => undefined,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  } as unknown as PluginContext;
  return { ctx, services, introspect, register };
}

async function federation(h: Harness): Promise<IExternalDatasourceService> {
  await new ExternalDatasourceServicePlugin().init(h.ctx);
  return h.services.get('external-datasource') as IExternalDatasourceService;
}

describe('importObject saves through the metadata door (#21788)', () => {
  it('reaches saveMetaItem with the metadata door\'s object request, and registers through no second path', async () => {
    const h = harness();
    const saveMetaItem = vi.fn(async () => ({ success: true }));
    h.services.set('protocol', { saveMetaItem });

    const result = await (await federation(h)).importObject('warehouse', 'customers', { name: 'ext_cust' });

    expect(saveMetaItem).toHaveBeenCalledTimes(1);
    expect(saveMetaItem).toHaveBeenCalledWith({
      type: 'object',
      name: 'ext_cust',
      item: result.definition,
      writeFace: 'external-import',
    });
    expect(result.definition).toMatchObject({
      name: 'ext_cust',
      datasource: 'warehouse',
      external: { remoteName: 'customers' },
    });
    expect(h.register).not.toHaveBeenCalled();
  });

  it('[#21841] states the face itself: options carrying a `force` or a face reach the save as neither', async () => {
    const h = harness();
    const saveMetaItem = vi.fn(async () => ({ success: true }));
    h.services.set('protocol', { saveMetaItem });

    // What a caller can put in the import body. `ImportObjectOpts` declares
    // neither key, so they arrive here only as untyped wire input.
    const smuggled = { name: 'ext_cust', force: true, writeFace: 'meta-envelope' } as Record<string, unknown>;
    await (await federation(h)).importObject('warehouse', 'customers', smuggled);

    expect(saveMetaItem).toHaveBeenCalledTimes(1);
    const request = (saveMetaItem.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(request.writeFace).toBe('external-import');
    expect('force' in request).toBe(false);
    expect(Object.keys(request).sort()).toEqual(['item', 'name', 'type', 'writeFace']);
  });

  it('resolves the save door when the import runs, so a protocol registered after init still receives it', async () => {
    const h = harness();
    const service = await federation(h);
    const saveMetaItem = vi.fn(async () => ({ success: true }));
    h.services.set('protocol', { saveMetaItem });

    await service.importObject('warehouse', 'customers', { name: 'ext_cust' });

    expect(saveMetaItem).toHaveBeenCalledTimes(1);
    expect(h.register).not.toHaveBeenCalled();
  });

  it('refuses the import with the door\'s own refusal when the save is refused', async () => {
    const h = harness();
    const refusal = Object.assign(new Error('object/ext_cust failed validation'), {
      code: 'INVALID_METADATA',
      status: 422,
    });
    h.services.set('protocol', { saveMetaItem: vi.fn(async () => { throw refusal; }) });

    const outcome = await (await federation(h))
      .importObject('warehouse', 'customers', { name: 'ext_cust' })
      .catch((e: unknown) => e);

    expect(outcome).toBe(refusal);
    expect(outcome).toMatchObject({ code: 'INVALID_METADATA', status: 422 });
    expect(h.register).not.toHaveBeenCalled();
  });

  it('with no save door, refuses before any remote introspection and saves nothing', async () => {
    const h = harness();

    const outcome = await (await federation(h))
      .importObject('warehouse', 'customers', { name: 'ext_cust' })
      .catch((e: unknown) => e);

    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toMatch(/requires a writable metadata store/);
    expect(h.introspect).not.toHaveBeenCalled();
    expect(h.register).not.toHaveBeenCalled();
  });
});
