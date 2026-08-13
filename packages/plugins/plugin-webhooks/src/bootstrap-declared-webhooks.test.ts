// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * bootstrapDeclaredWebhooks — the ingestion bridge that closes #3461.
 *
 * Verifies that stack/connector-declared `webhook` metadata (spec shape:
 * `object` / `isActive`) is materialized into `sys_webhook` data rows
 * (`object_name` / `active` / `definition_json`), idempotently and without
 * clobbering admin edits — and that the dispatcher then sees those rows.
 */

import { describe, expect, it, vi } from 'vitest';
import { AutoEnqueuer, type HttpEnqueueFn } from './auto-enqueuer.js';
import { bootstrapDeclaredWebhooks } from './bootstrap-declared-webhooks.js';
import { bindWebhookProvenanceStamp } from './webhook-provenance.js';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

interface HookEntry {
  event: string;
  handler: (ctx: any) => any;
  object?: string;
  packageId?: string;
}

/**
 * A small engine fake that mirrors the real ObjectQL surface the bridge and
 * provenance hook touch: `find({ filter | where })`, `insert`, update-by-id (the
 * patch carries `id`, no `where`), a `_registry.listItems(type)` for declared
 * metadata, and `beforeUpdate` hooks that run inside `update()`.
 */
class FakeEngine {
  rows: Record<string, any[]> = {};
  private hooks: HookEntry[] = [];
  private declared: Record<string, any[]> = {};

  constructor(seed?: { rows?: Record<string, any[]>; declared?: Record<string, any[]> }) {
    if (seed?.rows) this.rows = JSON.parse(JSON.stringify(seed.rows));
    if (seed?.declared) this.declared = JSON.parse(JSON.stringify(seed.declared));
  }

  // Declared-metadata registry (where manifest decomposition parks stack.webhooks).
  //
  // [#8378] Items are registered EXACTLY as the real engine registers them —
  // the document itself. Boxing each as `{ content: <item> }` made this fake
  // the only producer of that envelope in the tree, which is what kept the
  // production `i?.content ?? i` looking load-bearing.
  get _registry() {
    return {
      listItems: (type: string) => [...(this.declared[type] ?? [])],
    };
  }

  private matches(row: any, cond?: Record<string, any>): boolean {
    if (!cond) return true;
    return Object.entries(cond).every(([k, v]) => row[k] === v);
  }

  async find(name: string, q?: any): Promise<any[]> {
    const all = this.rows[name] ?? [];
    const cond = q?.filter ?? q?.where;
    const out = all.filter((r) => this.matches(r, cond));
    return typeof q?.limit === 'number' ? out.slice(0, q.limit) : out;
  }
  async findOne(name: string, q?: any): Promise<any> {
    return (await this.find(name, q))[0] ?? null;
  }
  async insert(name: string, data: any): Promise<any> {
    const arr = (this.rows[name] = this.rows[name] ?? []);
    arr.push({ ...data });
    return data;
  }
  async update(name: string, data: any, opts?: any): Promise<any> {
    // Run beforeUpdate hooks (the provenance stamp lives here).
    const id = data?.id ?? opts?.where?.id;
    const ctx = { input: { id, data }, session: opts?.context };
    for (const h of this.hooks) {
      if (h.event === 'beforeUpdate' && (!h.object || h.object === name)) {
        await h.handler(ctx);
      }
    }
    const arr = this.rows[name] ?? [];
    const cond = opts?.where ?? (id ? { id } : undefined);
    for (const r of arr) {
      if (this.matches(r, cond)) Object.assign(r, data);
    }
    return { affected: 0 };
  }
  async delete(): Promise<any> {
    return { affected: 0 };
  }
  async count(name: string): Promise<number> {
    return (this.rows[name] ?? []).length;
  }
  async aggregate(): Promise<any[]> {
    return [];
  }

  registerHook(event: string, handler: (ctx: any) => any, options?: Record<string, any>): void {
    this.hooks.push({ event, handler, object: options?.object, packageId: options?.packageId });
  }
  unregisterHooksByPackage(packageId: string): number {
    const before = this.hooks.length;
    this.hooks = this.hooks.filter((h) => h.packageId !== packageId);
    return before - this.hooks.length;
  }
}

class FakeRealtime {
  private subs = new Map<string, { handler: any; opts?: any }>();
  private n = 0;
  async publish(event: any): Promise<void> {
    for (const sub of this.subs.values()) {
      const o = sub.opts ?? {};
      if (o.object && event.object !== o.object) continue;
      await sub.handler(event);
    }
  }
  async subscribe(_channel: string, handler: any, opts?: any): Promise<string> {
    const id = `s-${++this.n}`;
    this.subs.set(id, { handler, opts });
    return id;
  }
  async unsubscribe(id: string): Promise<void> {
    this.subs.delete(id);
  }
}

const ADMIN_CTX = { isSystem: false, positions: [], permissions: [] };

function declaredWebhook(over: Record<string, any> = {}): any {
  return {
    name: 'task_changed',
    label: 'Task Changed',
    object: 'showcase_task',
    triggers: ['create', 'update'],
    url: 'https://hooks.example/task',
    method: 'POST',
    isActive: true,
    ...over,
  };
}

async function flush() {
  await new Promise((r) => setTimeout(r, 0));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('bootstrapDeclaredWebhooks', () => {
  it('materializes a declared webhook into a sys_webhook row (object→object_name, isActive→active)', async () => {
    const engine = new FakeEngine({ declared: { webhook: [declaredWebhook()] } });
    const res = await bootstrapDeclaredWebhooks(engine as any, null);

    expect(res).toEqual({ seeded: 1, skipped: 0 });
    const rows = engine.rows['sys_webhook'];
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.name).toBe('task_changed');
    expect(row.object_name).toBe('showcase_task'); // object → object_name
    expect(row.active).toBe(true); // isActive → active
    expect(row.method).toBe('post'); // lowercased to match the select options
    expect(row.managed_by).toBe('package');
    expect(row.customized).toBe(false);
    // Full validated envelope stashed for the enqueuer's advanced-config read.
    const defn = JSON.parse(row.definition_json);
    expect(defn.object).toBe('showcase_task');
    expect(defn.timeoutMs).toBe(30000); // default filled by WebhookSchema.parse
  });

  it('maps isActive:false → active:false so a placeholder webhook ships inactive', async () => {
    const engine = new FakeEngine({ declared: { webhook: [declaredWebhook({ isActive: false })] } });
    await bootstrapDeclaredWebhooks(engine as any, null);
    expect(engine.rows['sys_webhook'][0].active).toBe(false);
  });

  it('is idempotent — a second boot updates in place, never duplicates', async () => {
    const engine = new FakeEngine({ declared: { webhook: [declaredWebhook()] } });
    await bootstrapDeclaredWebhooks(engine as any, null);
    await bootstrapDeclaredWebhooks(engine as any, null);
    expect(engine.rows['sys_webhook']).toHaveLength(1);
  });

  it('propagates a declared change to a pristine (non-customized) row', async () => {
    const engine = new FakeEngine({ declared: { webhook: [declaredWebhook()] } });
    await bootstrapDeclaredWebhooks(engine as any, null);

    engine['declared'].webhook = [declaredWebhook({ url: 'https://hooks.example/task-v2' })];
    await bootstrapDeclaredWebhooks(engine as any, null);

    expect(engine.rows['sys_webhook']).toHaveLength(1);
    expect(engine.rows['sys_webhook'][0].url).toBe('https://hooks.example/task-v2');
  });

  it('seed-not-clobber: an admin edit (customized) survives the next boot', async () => {
    const engine = new FakeEngine({ declared: { webhook: [declaredWebhook()] } });
    bindWebhookProvenanceStamp(engine as any);
    await bootstrapDeclaredWebhooks(engine as any, null);

    // Admin deactivates the noisy webhook through the CRUD door (non-system).
    const id = engine.rows['sys_webhook'][0].id;
    await engine.update('sys_webhook', { id, active: false }, { context: ADMIN_CTX });
    expect(engine.rows['sys_webhook'][0].customized).toBe(true); // hook stamped it

    // Redeploy re-runs the seeder — the declared row is still active:true, but
    // the admin's active:false must win.
    await bootstrapDeclaredWebhooks(engine as any, null);
    expect(engine.rows['sys_webhook'][0].active).toBe(false);
  });

  it('never overwrites an admin-authored row that collides by name', async () => {
    const engine = new FakeEngine({
      rows: {
        sys_webhook: [
          { id: 'admin-1', name: 'task_changed', url: 'https://admin.example', active: true, managed_by: 'admin', customized: false },
        ],
      },
      declared: { webhook: [declaredWebhook()] },
    });
    const res = await bootstrapDeclaredWebhooks(engine as any, null);
    expect(res).toEqual({ seeded: 0, skipped: 1 });
    expect(engine.rows['sys_webhook']).toHaveLength(1);
    expect(engine.rows['sys_webhook'][0].url).toBe('https://admin.example'); // untouched
  });

  it('skips an invalid declared webhook (bad URL) with a warning, without crashing boot', async () => {
    const warn = vi.fn();
    const engine = new FakeEngine({
      declared: { webhook: [declaredWebhook({ name: 'good' }), declaredWebhook({ name: 'bad', url: 'not-a-url' })] },
    });
    const res = await bootstrapDeclaredWebhooks(engine as any, null, { warn });

    expect(res.seeded).toBe(1); // the good one still lands
    expect(res.skipped).toBe(1);
    expect(engine.rows['sys_webhook'].map((r) => r.name)).toEqual(['good']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('failed validation'), expect.objectContaining({ name: 'bad' }));
  });

  it('is a no-op when nothing is declared', async () => {
    const engine = new FakeEngine();
    const res = await bootstrapDeclaredWebhooks(engine as any, null);
    expect(res).toEqual({ seeded: 0, skipped: 0 });
    expect(engine.rows['sys_webhook']).toBeUndefined();
  });

  it('end-to-end: a declared webhook, once materialized, dispatches on a matching data event', async () => {
    const engine = new FakeEngine({
      declared: {
        webhook: [
          declaredWebhook({
            triggers: ['create'],
            secret: 'shh',
            headers: { 'X-Env': 'prod' },
          }),
        ],
      },
    });
    await bootstrapDeclaredWebhooks(engine as any, null);

    const realtime = new FakeRealtime();
    const calls: any[] = [];
    const enqueue: HttpEnqueueFn = async (input) => {
      calls.push(input);
      return 'id';
    };
    const ae = new AutoEnqueuer(engine as any, realtime as any, enqueue, { refreshIntervalMs: 0 });
    await ae.start();

    await realtime.publish({
      type: 'data.record.created',
      object: 'showcase_task',
      payload: { recordId: 't-1' },
      timestamp: '2026-05-24T00:00:00.000Z',
    });
    await flush();

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://hooks.example/task');
    // Headers come from the definition_json envelope the bridge wrote. The
    // signing secret does NOT (#7799) — it goes to the `signing_secret` column,
    // which this fake engine (no encrypted-field channel) stores verbatim, so
    // the enqueuer reads it back from there.
    expect(calls[0].signingSecret).toBe('shh');
    expect(engine.rows['sys_webhook'][0].definition_json).not.toContain('shh');
    expect(calls[0].headers).toEqual({ 'X-Env': 'prod' });
    await ae.stop();
  });
});
