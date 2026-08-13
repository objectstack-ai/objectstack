// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * bootstrapDeclaredEmailTemplates — the ingestion bridge that closes #4509 (1).
 *
 * Verifies that declared `email_template` metadata is materialized into the
 * `sys_email_template` rows `sendTemplate` actually reads — keyed by
 * `(name, locale)`, idempotently, without clobbering admin edits — and that a
 * withdrawn template stops being sent.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  bootstrapDeclaredEmailTemplates,
  upsertDeclaredEmailTemplate,
  deactivateDeclaredEmailTemplate,
  mapTemplateToRow,
} from './bootstrap-declared-email-templates.js';
import { bindEmailTemplateProvenanceStamp } from './email-template-provenance.js';

// ---------------------------------------------------------------------------
// Fakes — mirrors the ObjectQL surface the bridge and the stamp hook touch.
// ---------------------------------------------------------------------------

interface HookEntry {
  event: string;
  handler: (ctx: any) => any;
  object?: string;
  packageId?: string;
}

class FakeEngine {
  rows: Record<string, any[]> = {};
  private hooks: HookEntry[] = [];
  private declared: Record<string, any[]> = {};

  constructor(seed?: { rows?: Record<string, any[]>; declared?: Record<string, any[]> }) {
    if (seed?.rows) this.rows = JSON.parse(JSON.stringify(seed.rows));
    if (seed?.declared) this.declared = JSON.parse(JSON.stringify(seed.declared));
  }

  // [#8378] Registers items EXACTLY as the real engine does — the document
  // itself. This fake used to box each one as `{ content: <item> }`, which made
  // it the only producer of that envelope anywhere in the tree: a fiction that
  // kept the production `i?.content ?? i` looking load-bearing while nothing
  // real ever wrote the shape (`registerMetadataCollections` registers items
  // as-is; `loadMetaFromDb` registers the parsed body, not the row).
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
  async insert(name: string, data: any): Promise<any> {
    const arr = (this.rows[name] = this.rows[name] ?? []);
    arr.push({ ...data });
    return data;
  }
  async update(name: string, data: any, opts?: any): Promise<any> {
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

  registerHook(event: string, handler: (ctx: any) => any, options?: Record<string, any>): void {
    this.hooks.push({ event, handler, object: options?.object, packageId: options?.packageId });
  }
  unregisterHooksByPackage(packageId: string): number {
    const before = this.hooks.length;
    this.hooks = this.hooks.filter((h) => h.packageId !== packageId);
    return before - this.hooks.length;
  }
}

const ADMIN_CTX = { isSystem: false, positions: [], permissions: [] };
const TABLE = 'sys_email_template';

function declaredTemplate(over: Record<string, any> = {}): any {
  return {
    name: 'auth.password_reset',
    label: 'Password Reset',
    category: 'auth',
    subject: 'Reset your password, {{user.name}}',
    bodyHtml: '<p>Click <a href="{{url}}">here</a></p>',
    variables: [{ name: 'url', type: 'string', required: true }],
    ...over,
  };
}

function rowsOf(engine: FakeEngine): any[] {
  return engine.rows[TABLE] ?? [];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('bootstrapDeclaredEmailTemplates', () => {
  it('materializes a declared template into a sys_email_template row with the shared mapping', async () => {
    const engine = new FakeEngine({ declared: { email_template: [declaredTemplate()] } });

    const result = await bootstrapDeclaredEmailTemplates(engine as any, undefined);

    expect(result).toEqual({ seeded: 1, skipped: 0 });
    expect(rowsOf(engine)).toHaveLength(1);
    const row = rowsOf(engine)[0];
    // Spec camelCase → row snake_case, and schema defaults applied.
    expect(row.name).toBe('auth.password_reset');
    expect(row.body_html).toBe('<p>Click <a href="{{url}}">here</a></p>');
    expect(row.locale).toBe('en-US');
    expect(row.active).toBe(true);
    expect(row.is_system).toBe(false);
    expect(JSON.parse(row.variables_json)).toEqual([
      { name: 'url', type: 'string', required: true },
    ]);
    expect(row.managed_by).toBe('package');
    expect(row.customized).toBe(false);
  });

  it('keys rows by (name, locale) — the same template in two locales is two rows', async () => {
    const engine = new FakeEngine({
      declared: {
        email_template: [
          declaredTemplate({ locale: 'en-US' }),
          declaredTemplate({ locale: 'zh-CN', subject: '重置密码' }),
        ],
      },
    });

    await bootstrapDeclaredEmailTemplates(engine as any, undefined);

    expect(rowsOf(engine)).toHaveLength(2);
    expect(rowsOf(engine).map((r) => r.locale).sort()).toEqual(['en-US', 'zh-CN']);
  });

  it('is idempotent — re-seeding updates in place rather than duplicating', async () => {
    const engine = new FakeEngine({ declared: { email_template: [declaredTemplate()] } });

    await bootstrapDeclaredEmailTemplates(engine as any, undefined);
    await bootstrapDeclaredEmailTemplates(engine as any, undefined);

    expect(rowsOf(engine)).toHaveLength(1);
  });

  it('propagates an edited declaration to a pristine seeded row', async () => {
    const engine = new FakeEngine({ declared: { email_template: [declaredTemplate()] } });
    await bootstrapDeclaredEmailTemplates(engine as any, undefined);

    (engine as any).declared = {
      email_template: [declaredTemplate({ subject: 'New subject' })],
    };
    await bootstrapDeclaredEmailTemplates(engine as any, undefined);

    expect(rowsOf(engine)).toHaveLength(1);
    expect(rowsOf(engine)[0].subject).toBe('New subject');
  });

  it('never clobbers a row an admin has customized (the seed-not-clobber contract)', async () => {
    const engine = new FakeEngine({ declared: { email_template: [declaredTemplate()] } });
    await bootstrapDeclaredEmailTemplates(engine as any, undefined);

    // Admin edits the seeded row through a normal (non-system) write; the
    // provenance stamp freezes it.
    bindEmailTemplateProvenanceStamp(engine as any);
    const seeded = rowsOf(engine)[0];
    await engine.update(TABLE, { id: seeded.id, subject: 'Admin wording' }, { context: ADMIN_CTX });
    expect(rowsOf(engine)[0].customized).toBe(true);

    (engine as any).declared = {
      email_template: [declaredTemplate({ subject: 'Redeploy wording' })],
    };
    const result = await bootstrapDeclaredEmailTemplates(engine as any, undefined);

    expect(result).toEqual({ seeded: 0, skipped: 1 });
    expect(rowsOf(engine)[0].subject).toBe('Admin wording');
  });

  it('skips an admin-authored row of the same (name, locale) with a warning', async () => {
    const engine = new FakeEngine({
      rows: {
        [TABLE]: [{
          id: 'etpl_admin',
          name: 'auth.password_reset',
          locale: 'en-US',
          subject: 'Admin original',
          managed_by: 'admin',
        }],
      },
      declared: { email_template: [declaredTemplate()] },
    });
    const warn = vi.fn();

    const result = await bootstrapDeclaredEmailTemplates(engine as any, undefined, { warn });

    expect(result).toEqual({ seeded: 0, skipped: 1 });
    expect(rowsOf(engine)[0].subject).toBe('Admin original');
    expect(warn).toHaveBeenCalled();
  });

  it('adopts a pristine pre-provenance row so future boots recognize it', async () => {
    const engine = new FakeEngine({
      rows: {
        [TABLE]: [{
          id: 'etpl_legacy',
          name: 'auth.password_reset',
          locale: 'en-US',
          subject: 'Legacy',
        }],
      },
      declared: { email_template: [declaredTemplate()] },
    });

    await bootstrapDeclaredEmailTemplates(engine as any, undefined);

    expect(rowsOf(engine)).toHaveLength(1);
    expect(rowsOf(engine)[0].managed_by).toBe('package');
    expect(rowsOf(engine)[0].subject).toBe('Reset your password, {{user.name}}');
  });

  it('skips an invalid declaration without aborting the rest of the batch', async () => {
    const engine = new FakeEngine({
      declared: {
        email_template: [
          { name: 'broken' }, // no subject / bodyHtml / label
          declaredTemplate({ name: 'ops.digest', category: 'notification' }),
        ],
      },
    });
    const warn = vi.fn();

    const result = await bootstrapDeclaredEmailTemplates(engine as any, undefined, { warn });

    expect(result).toEqual({ seeded: 1, skipped: 1 });
    expect(rowsOf(engine).map((r) => r.name)).toEqual(['ops.digest']);
    expect(warn).toHaveBeenCalled();
  });

  it('no-ops when nothing is declared', async () => {
    const engine = new FakeEngine();

    const result = await bootstrapDeclaredEmailTemplates(engine as any, undefined);

    expect(result).toEqual({ seeded: 0, skipped: 0 });
    expect(rowsOf(engine)).toHaveLength(0);
  });

  it('falls back to the metadata service when the registry is empty', async () => {
    const engine = new FakeEngine();
    // [#8378] `IMetadataService.list` answers the documents themselves; the
    // `{ content: … }` box this fixture used to build had no producer.
    const metadataService = { list: () => [declaredTemplate()] };

    const result = await bootstrapDeclaredEmailTemplates(engine as any, metadataService);

    expect(result.seeded).toBe(1);
    expect(rowsOf(engine)[0].name).toBe('auth.password_reset');
  });
});

describe('upsertDeclaredEmailTemplate (the live runtime-write path)', () => {
  it('materializes a single item — a Studio save takes effect without a restart', async () => {
    const engine = new FakeEngine();

    const written = await upsertDeclaredEmailTemplate(
      engine as any,
      declaredTemplate({ subject: 'Saved in Studio' }),
    );

    expect(written).toBe(true);
    expect(rowsOf(engine)[0].subject).toBe('Saved in Studio');
  });

  it('rejects a malformed item by throwing, so the caller can warn', async () => {
    const engine = new FakeEngine();

    await expect(upsertDeclaredEmailTemplate(engine as any, { name: 'broken' }))
      .rejects.toThrow();
    expect(rowsOf(engine)).toHaveLength(0);
  });
});

describe('deactivateDeclaredEmailTemplate (withdrawal)', () => {
  it('deactivates every locale of a withdrawn template without deleting rows', async () => {
    const engine = new FakeEngine({
      declared: {
        email_template: [
          declaredTemplate({ locale: 'en-US' }),
          declaredTemplate({ locale: 'zh-CN' }),
        ],
      },
    });
    await bootstrapDeclaredEmailTemplates(engine as any, undefined);

    const count = await deactivateDeclaredEmailTemplate(engine as any, 'auth.password_reset');

    expect(count).toBe(2);
    expect(rowsOf(engine)).toHaveLength(2);
    expect(rowsOf(engine).every((r) => r.active === false)).toBe(true);
  });

  it('leaves admin-authored and customized rows alone', async () => {
    const engine = new FakeEngine({
      rows: {
        [TABLE]: [
          { id: 'a', name: 'ops.digest', locale: 'en-US', active: true, managed_by: 'admin' },
          { id: 'b', name: 'ops.digest', locale: 'zh-CN', active: true, managed_by: 'package', customized: true },
        ],
      },
    });

    const count = await deactivateDeclaredEmailTemplate(engine as any, 'ops.digest');

    expect(count).toBe(0);
    expect(rowsOf(engine).every((r) => r.active === true)).toBe(true);
  });
});

describe('mapTemplateToRow', () => {
  it('omits optional columns rather than nulling them, so a re-seed never blanks a field', () => {
    const row = mapTemplateToRow({
      name: 'ops.digest',
      label: 'Digest',
      category: 'notification',
      locale: 'en-US',
      subject: 'Digest',
      bodyHtml: '<p>hi</p>',
      variables: [],
      active: true,
      isSystem: false,
    } as any);

    expect(row).not.toHaveProperty('body_text');
    expect(row).not.toHaveProperty('reply_to');
    expect(row).not.toHaveProperty('from_address');
    expect(row).not.toHaveProperty('variables_json');
  });
});

// ---------------------------------------------------------------------------
// [#8378] The retired `i?.content ?? i` unwrap
// ---------------------------------------------------------------------------

/**
 * `content` is a spelling an author really can write on an email template —
 * `EmailTemplateDefinitionSchema` lists it in its `strictObject` **aliases**
 * table (`content: 'bodyHtml'`). That table is a REJECTION facility, not a
 * conversion: it feeds `strictUnknownKeyError`, which runs only on the
 * `unrecognized_keys` path and only builds a *message*. Nothing rewrites the
 * key — the ADR-0087 conversion registry has zero `email_template` entries, so
 * `normalizeStackInput` emits no notice and leaves `content` where it was
 * written.
 *
 * So when the key reaches this bridge (a `defineStack(…, { strict: false })`
 * load, a hand-built manifest, a direct registry write — every validating door
 * refuses it first), the schema is ready with the author's fix. The unwrap was
 * the one thing standing between the author and their own prescription: it
 * replaced the document with the HTML string, and a string cannot carry a
 * key-level rejection.
 *
 * Both cases below put a `content` key genuinely IN PLAY — the point of the
 * fixture. A template that never spells `content` exercises the unwrap's
 * `?? i` arm only, and would pass against a completely unfixed tree.
 */
describe('declared email templates carrying the `content` alias spelling (#8378)', () => {
  it('reaches the schema as a DOCUMENT, so the rejection carries the `content` → `bodyHtml` fix', async () => {
    const engine = new FakeEngine({
      declared: {
        email_template: [
          // `bodyHtml` deliberately absent — `content` is the author's attempt
          // at it, which is exactly what the alias table exists to answer.
          { name: 'auth.welcome', label: 'Welcome', subject: 'Hi', content: '<h1>Welcome</h1>' },
        ],
      },
    });
    const warn = vi.fn();

    const result = await bootstrapDeclaredEmailTemplates(engine as any, undefined, { warn });

    expect(result).toEqual({ seeded: 0, skipped: 1 });
    expect(rowsOf(engine)).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);

    const [, meta] = warn.mock.calls[0];
    // The unwrap used to hand `.parse()` a bare string, so the diagnostic could
    // name neither the offending key nor the template it came from.
    expect(meta.name).toBe('auth.welcome');
    expect(meta.error).toContain('content');
    expect(meta.error).toContain('bodyHtml');
    expect(meta.error).not.toContain('expected object, received string');
  });

  it('does not silently vanish when `content` is the empty string', async () => {
    const engine = new FakeEngine({
      declared: {
        email_template: [
          // `''` is falsy but NON-nullish, so it passed `??` and was then
          // dropped by the reader's own `filter(Boolean)` — the template
          // disappeared with no warning, no count and no row.
          { name: 'ops.digest', label: 'Digest', subject: 'Daily', content: '' },
        ],
      },
    });
    const warn = vi.fn();

    const result = await bootstrapDeclaredEmailTemplates(engine as any, undefined, { warn });

    expect(result).toEqual({ seeded: 0, skipped: 1 });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][1].name).toBe('ops.digest');
  });
});
