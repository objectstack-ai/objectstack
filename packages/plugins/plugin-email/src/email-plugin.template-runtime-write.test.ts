// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #7733 — a runtime `email_template` write must materialize WITHOUT a restart.
//
// The gap these pin. `bootDeclaredTemplates` wired its live path to
// `metadataService.subscribe('email_template', …)`, whose only producer is
// `MetadataManager.register()` → `notifyWatchers()`. `PUT /api/v1/meta/…` does
// NOT go through there: the REST route calls `protocol.saveMetaItem`, which
// persists to `sys_metadata` and then announces on ITS OWN seam —
// `runMutationProjector` (awaited, ADR-0094) and `onMetadataMutation`
// (fire-and-forget, #2588). `notifyWatchers` has no caller outside
// `metadata-manager.ts`, so the plugin's watcher was registered against an
// event the authoring path never emits: the save returned 200, the row never
// reached `sys_email_template`, and only a restart (which re-runs the boot
// sweep against the persisted row) materialized it.
//
// So these tests drive the plugin through the seam the PUT path actually
// announces on, and assert the OBSERVABLE effect the QA repro looked for: a
// `sys_email_template` row, right after the write, with no restart.
//
// The protocol double mirrors `ObjectStackProtocolImplementation`'s two
// registration seams and the `MetadataMutationEvent` shape it emits
// (`{ type: <singular metadata type>, name, state: 'active'|'draft'|'deleted' }`,
// plus `body` on the projector) — the same double every other consumer of this
// seam is tested against (service-i18n's authored-translation sync,
// plugin-security's permission projection).

import { describe, it, expect, vi } from 'vitest';
import { assertEngineUpdateDispatch } from '@objectstack/objectql';
import { EmailServicePlugin } from './email-plugin.js';

const TABLE = 'sys_email_template';

type AnyRecord = Record<string, any>;

// ── doubles ────────────────────────────────────────────────────────────────

/**
 * Row store with the slice of ObjectQL the template bridge and the provenance
 * stamp touch. `update` routes through `assertEngineUpdateDispatch` so this
 * double cannot accept a dispatch shape the real engine would refuse.
 */
function fakeEngine(seed: AnyRecord[] = []) {
  const rows: AnyRecord[] = seed.map((r) => ({ ...r }));
  const matches = (row: AnyRecord, cond?: AnyRecord) =>
    !cond || Object.entries(cond).every(([k, v]) => row[k] === v);
  return {
    rows,
    _registry: { listItems: () => [] },
    async find(object: string, q?: AnyRecord) {
      if (object !== TABLE) return [];
      const out = rows.filter((r) => matches(r, q?.where ?? q?.filter));
      return typeof q?.limit === 'number' ? out.slice(0, q.limit) : out;
    },
    async insert(_object: string, row: AnyRecord) {
      rows.push({ ...row });
      return { id: row.id };
    },
    async update(_object: string, data: AnyRecord, options?: AnyRecord) {
      const dispatch = assertEngineUpdateDispatch(data, options);
      if (dispatch.kind !== 'by-id') throw new Error(`unexpected update dispatch: ${dispatch.kind}`);
      const target = rows.find((r) => r.id === dispatch.id);
      if (target) Object.assign(target, data);
      return { affected: target ? 1 : 0 };
    },
    registerHook() { /* provenance stamp */ },
    unregisterHooksByPackage() { return 0; },
  };
}

/**
 * The two seams `saveMetaItem` / `publishMetaItem` / `deleteMetaItem` announce
 * on. `save`/`remove` replay what the real protocol does after persistence:
 * the awaited per-type projector first (with the just-persisted body), then the
 * fire-and-forget listeners.
 */
function fakeProtocol(opts: { projector?: boolean; listeners?: boolean } = {}) {
  const withProjector = opts.projector !== false;
  const withListeners = opts.listeners !== false;
  const projectors = new Map<string, (evt: AnyRecord) => Promise<void>>();
  const listeners: Array<(evt: AnyRecord) => void> = [];
  const p: AnyRecord = {
    projectorFailures: [] as string[],
    async announce(evt: AnyRecord) {
      const projector = projectors.get(evt.type);
      if (projector) {
        // Mirrors `runMutationProjector`: a throw is caught and reported on
        // the write's response, never propagated to the caller.
        try { await projector(evt); }
        catch (e: any) { p.projectorFailures.push(String(e?.message ?? e)); }
      }
      for (const l of listeners) l(evt);
      await new Promise((r) => setTimeout(r, 0)); // let a fire-and-forget path settle
    },
    /** A `PUT /api/v1/meta/email_template/:name` that landed. */
    save: (name: string, body: unknown, state: 'active' | 'draft' = 'active') =>
      p.announce({ type: 'email_template', name, state, body }),
    /** A `DELETE /api/v1/meta/email_template/:name` that landed. */
    remove: (name: string) => p.announce({ type: 'email_template', name, state: 'deleted' }),
  };
  if (withProjector) {
    p.registerMutationProjector = (type: string, fn: (evt: AnyRecord) => Promise<void>) => {
      projectors.set(type, fn);
    };
  }
  if (withListeners) {
    p.onMetadataMutation = (fn: (evt: AnyRecord) => void) => {
      listeners.push(fn);
      return () => {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      };
    };
  }
  return p;
}

/**
 * A metadata service shaped like `MetadataManager`: `subscribe` registers
 * cleanly (the boot log the QA run saw), and — the fact under test — the
 * runtime-write path NEVER calls it back.
 */
function fakeMetadataService() {
  const watchers: Array<(evt: AnyRecord) => void> = [];
  return {
    watchers,
    list: () => [],
    get: async () => undefined,
    subscribe: (_type: string, cb: (evt: AnyRecord) => void) => {
      watchers.push(cb);
      return () => {};
    },
  };
}

/** Give the protocol double a layered `getMetaItem`, as the real one has. */
function withEffectiveRead(
  protocol: AnyRecord,
  read: (name: string) => Promise<unknown>,
): AnyRecord {
  protocol.getMetaItem = async ({ name }: { name: string }) => read(name);
  return protocol;
}

function fakeCtx(services: Record<string, unknown>) {
  const hooks: Record<string, Array<() => Promise<void> | void>> = {};
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return {
    logger,
    getService: <T,>(name: string): T => {
      if (!(name in services)) throw new Error(`service '${name}' not registered`);
      return services[name] as T;
    },
    registerService: (name: string, svc: unknown) => { services[name] = svc; },
    hook: (name: string, fn: () => Promise<void> | void) => { (hooks[name] ??= []).push(fn); },
    fire: async (name: string) => { for (const fn of hooks[name] ?? []) await fn(); },
  };
}

function template(over: AnyRecord = {}): AnyRecord {
  return {
    name: 'auth.password_reset',
    label: 'Password Reset',
    category: 'auth',
    locale: 'en-US',
    subject: 'Reset your password, {{user.name}}',
    bodyHtml: '<p>Click <a href="{{url}}">here</a></p>',
    ...over,
  };
}

/** Boot the plugin to `kernel:ready`, as the kernel does. */
async function boot(over: { engine?: any; protocol?: any; metadata?: any } = {}) {
  const engine = over.engine ?? fakeEngine();
  const protocol = 'protocol' in over ? over.protocol : fakeProtocol();
  const metadata = over.metadata ?? fakeMetadataService();
  const services: Record<string, unknown> = {
    manifest: { register: () => {} },
    objectql: engine,
    metadata,
  };
  if (protocol) services.protocol = protocol;
  const ctx = fakeCtx(services);
  const plugin = new EmailServicePlugin({ seedTemplates: false });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);
  await ctx.fire('kernel:ready');
  return { plugin, ctx, engine, protocol, metadata };
}

const rowsOf = (engine: any, name: string) =>
  engine.rows.filter((r: AnyRecord) => r.name === name);

// ── tests ──────────────────────────────────────────────────────────────────

describe('#7733 runtime email_template write materializes without a restart', () => {
  it('materializes a PUT /meta save into sys_email_template on the protocol seam', async () => {
    const { engine, protocol, ctx } = await boot();

    await protocol.save('auth.password_reset', template());

    const rows = rowsOf(engine, 'auth.password_reset');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: 'auth.password_reset',
      // #7731 invariant — the loader queries by `(name, locale)`, so the row's
      // `locale` column MUST hold the tag it is queried by.
      locale: 'en-US',
      subject: 'Reset your password, {{user.name}}',
      body_html: '<p>Click <a href="{{url}}">here</a></p>',
      managed_by: 'package',
    });
    expect(protocol.projectorFailures).toEqual([]);
    expect(ctx.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('materialized from a runtime write'),
    );
  });

  it('re-materializes an edit in place rather than adding a second row', async () => {
    const { engine, protocol } = await boot();

    await protocol.save('auth.password_reset', template());
    await protocol.save('auth.password_reset', template({ subject: 'Reset it, {{user.name}}' }));

    const rows = rowsOf(engine, 'auth.password_reset');
    expect(rows).toHaveLength(1);
    expect(rows[0].subject).toBe('Reset it, {{user.name}}');
  });

  it('deactivates the materialized rows when the item is genuinely withdrawn', async () => {
    const { engine, protocol } = await boot();

    await protocol.save('auth.password_reset', template());
    await protocol.remove('auth.password_reset');

    expect(rowsOf(engine, 'auth.password_reset')[0].active).toBe(false);
  });

  it('re-materializes the packaged baseline a DELETE of an overlay reveals', async () => {
    // `DELETE /meta/email_template/:name` discards a CUSTOMIZATION overlay
    // (ADR-0005). On an artifact-backed template the packaged declaration is
    // still shipping, so the reset must restore it — not retire it.
    const protocol = withEffectiveRead(fakeProtocol(), async (name) =>
      name === 'auth.password_reset'
        ? { item: template({ subject: 'The packaged subject' }) }
        : undefined);
    const { engine } = await boot({ protocol });

    await protocol.save('auth.password_reset', template({ subject: 'An operator override' }));
    await protocol.remove('auth.password_reset');

    const rows = rowsOf(engine, 'auth.password_reset');
    expect(rows).toHaveLength(1);
    expect(rows[0].subject).toBe('The packaged subject');
    expect(rows[0].active).not.toBe(false);
  });

  it('restores a baseline served WITH read decorations on it', async () => {
    // `getMetaItem` returns a DECORATED item (`_diagnostics` from
    // `decorateMetadataItem`, `_packageId` / `_provenance` from the registry
    // and the overlay row). `EmailTemplateDefinitionSchema` is a strictObject
    // that declares no underscore key, so an unstripped body would reject the
    // very baseline the reset exists to restore.
    const protocol = withEffectiveRead(fakeProtocol(), async () => ({
      type: 'email_template',
      name: 'auth.password_reset',
      item: {
        ...template({ subject: 'The packaged subject' }),
        _diagnostics: { valid: true },
        _packageId: 'com.objectstack.auth',
        _provenance: { source: 'code' },
      },
    }));
    const { engine } = await boot({ protocol });

    await protocol.save('auth.password_reset', template({ subject: 'An operator override' }));
    await protocol.remove('auth.password_reset');

    const rows = rowsOf(engine, 'auth.password_reset');
    expect(rows).toHaveLength(1);
    expect(rows[0].subject).toBe('The packaged subject');
    expect(rows[0].active).not.toBe(false);
  });

  it('deactivates nothing when the effective read fails — a DB blip is not a withdrawal', async () => {
    const protocol = withEffectiveRead(fakeProtocol(), async () => { throw new Error('db gone'); });
    const { engine, metadata } = await boot({ protocol });
    // No second source can answer either.
    metadata.get = async () => { throw new Error('db gone'); };

    await protocol.save('auth.password_reset', template());
    await protocol.remove('auth.password_reset');

    expect(rowsOf(engine, 'auth.password_reset')[0].active).not.toBe(false);
  });

  it('leaves a draft save inert — the staging buffer is not live', async () => {
    const { engine, protocol } = await boot();

    await protocol.save('auth.password_reset', template(), 'draft');

    expect(engine.rows).toHaveLength(0);
  });

  it('ignores mutations of other metadata types', async () => {
    const { engine, protocol } = await boot();

    await protocol.announce({ type: 'view', name: 'v', state: 'active', body: template() });

    expect(engine.rows).toHaveLength(0);
  });

  it('never clobbers an admin-authored row of the same name', async () => {
    const engine = fakeEngine([{
      id: 'etpl_admin',
      name: 'auth.password_reset',
      locale: 'en-US',
      subject: 'Hand-written by an operator',
      managed_by: 'admin',
    }]);
    const { protocol } = await boot({ engine });

    await protocol.save('auth.password_reset', template());

    expect(rowsOf(engine, 'auth.password_reset')).toHaveLength(1);
    expect(rowsOf(engine, 'auth.password_reset')[0].subject).toBe('Hand-written by an operator');
  });

  it('reports a failed materialization on the write instead of throwing at the author', async () => {
    const { protocol, ctx } = await boot();

    // An item that fails `EmailTemplateDefinitionSchema` — the save persisted,
    // the projection cannot.
    await protocol.save('auth.broken', { name: 'auth.broken' });

    expect(protocol.projectorFailures).toHaveLength(1);
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('runtime email-template sync failed'),
    );
  });

  it('falls back to onMetadataMutation when the protocol has no projector seam', async () => {
    const protocol = fakeProtocol({ projector: false });
    const { engine } = await boot({ protocol });

    await protocol.save('auth.password_reset', template());

    expect(rowsOf(engine, 'auth.password_reset')).toHaveLength(1);
  });

  it('materializes exactly once when both seams announce the same write', async () => {
    const { engine, protocol } = await boot();

    await protocol.save('auth.password_reset', template());

    // Both seams fired (projector + listener); the upsert is keyed on
    // `(name, locale)`, so the second one must find and update, not insert.
    expect(rowsOf(engine, 'auth.password_reset')).toHaveLength(1);
  });

  it('boots, and keeps the boot sweep, on a kernel with no protocol service', async () => {
    const { ctx, engine } = await boot({ protocol: null });

    expect(engine.rows).toHaveLength(0);
    expect(ctx.logger.error).not.toHaveBeenCalled();
  });

  it('detaches both seams on dispose', async () => {
    const { plugin, engine, protocol } = await boot();

    await plugin.dispose();
    await protocol.save('auth.password_reset', template());

    expect(engine.rows).toHaveLength(0);
  });
});
