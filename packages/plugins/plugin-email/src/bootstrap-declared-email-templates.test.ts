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
  bootstrapEffectiveEmailTemplates,
  upsertDeclaredEmailTemplate,
  deactivateDeclaredEmailTemplate,
  mapTemplateToRow,
  SWEEP_NAMES_PER_READ,
  SWEEP_ROWS_PER_READ,
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
    // [#22062] `$in` as the real engine reads it: the boot sweep's bulk read.
    return Object.entries(cond).every(([k, v]) =>
      v && typeof v === 'object' && Array.isArray(v.$in) ? v.$in.includes(row[k]) : row[k] === v);
  }

  async find(name: string, q?: any): Promise<any[]> {
    const all = this.rows[name] ?? [];
    const cond = q?.filter ?? q?.where;
    const out = all.filter((r) => this.matches(r, cond));
    // [#22062] Rows leave as COPIES, as a real driver's do. Handing out the
    // stored objects let a later write reach into a row the caller had
    // already read, which no real read does — and it hid a stale copy in the
    // sweep's bulk read from every pin here.
    return (typeof q?.limit === 'number' ? out.slice(0, q.limit) : out).map((r) => ({ ...r }));
  }
  async insert(name: string, data: any): Promise<any> {
    const arr = (this.rows[name] = this.rows[name] ?? []);
    arr.push({ ...data });
    return data;
  }
  async update(name: string, data: any, opts?: any): Promise<any> {
    const id = data?.id ?? opts?.where?.id;
    // [#15302] `previous` is bound BEFORE the beforeUpdate dispatch, as the
    // real engine binds it (#5574 / #5846 - by-id reads the prior row ahead of
    // the dispatch; each per-row context of a predicate write carries its own).
    // Withholding it here is what let this fake model a pre-#5574 engine, and
    // a hook reading `ctx.previous` would have gone silently unstamped against
    // a fake no production caller resembles.
    const cond0 = opts?.where ?? (id ? { id } : undefined);
    const previous = (this.rows[name] ?? []).filter((r) => this.matches(r, cond0)).map((r) => ({ ...r }))[0];
    const ctx = { input: { id, data }, previous, session: opts?.context };
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

// ---------------------------------------------------------------------------
// [#21785] The boot sweep projects the EFFECTIVE template
// ---------------------------------------------------------------------------

/**
 * A `protocol.getMetaItems` stand-in that answers the way the layered list
 * does for ONE org-scoped overlay: read in the overlay's organization, the
 * overlay wins its slot; read env-wide (no organization), the declaration is
 * served. Each item carries the `_diagnostics` read decoration the real
 * served list carries, which the strict schema refuses unless it is stripped.
 * Every request is recorded, so the organization the sweep read in is
 * asserted rather than assumed.
 */
function layeredProtocol(declared: any[], overlay?: { organizationId: string; items: any[] }) {
  const requests: Array<{ type: string; organizationId?: string }> = [];
  return {
    requests,
    async getMetaItems(request: { type: string; organizationId?: string }) {
      requests.push({ ...request });
      const items = overlay && request.organizationId === overlay.organizationId ? overlay.items : declared;
      return { type: request.type, items: items.map((i) => ({ ...i, _diagnostics: { valid: true } })) };
    },
  };
}

const ORG = 'org_default';
const PACKAGE_WORDING = 'Reset your password, {{user.name}}';
const OVERLAY_WORDING = 'Admin reworded: reset for {{user.name}}';

/** The row as the live path leaves it after `PUT /meta`: package provenance, overlay wording, NOT customized. */
function rowProjectedFromOverlay(over: Record<string, any> = {}): any {
  return {
    id: 'etpl_seeded',
    name: 'auth.password_reset',
    locale: 'en-US',
    subject: OVERLAY_WORDING,
    managed_by: 'package',
    customized: false,
    ...over,
  };
}

describe('bootstrapDeclaredEmailTemplates — the effective template (#21785)', () => {
  it('projects the org-scoped overlay the metadata door serves, read in the default organization', async () => {
    // The registry holds ONLY the declaration: boot hydration leaves an
    // org-scoped overlay out of it. Reading it is the reverted-on-restart defect.
    const engine = new FakeEngine({
      rows: { [TABLE]: [rowProjectedFromOverlay()] },
      declared: { email_template: [declaredTemplate()] },
    });
    const protocol = layeredProtocol(
      [declaredTemplate()],
      { organizationId: ORG, items: [declaredTemplate({ subject: OVERLAY_WORDING })] },
    );

    const result = await bootstrapEffectiveEmailTemplates(engine as any, undefined, {
      protocol,
      tenancy: { defaultOrgId: async () => ORG },
    });

    expect(protocol.requests).toEqual([{ type: 'email_template', organizationId: ORG }]);
    expect(result).toEqual({ seeded: 1, skipped: 0 });
    expect(rowsOf(engine)).toHaveLength(1);
    expect(rowsOf(engine)[0].subject).toBe(OVERLAY_WORDING);
  });

  it('reads env-wide when the tenancy service names no organization (a walled posture never guesses one)', async () => {
    const engine = new FakeEngine({ rows: { [TABLE]: [rowProjectedFromOverlay()] } });
    const protocol = layeredProtocol(
      [declaredTemplate()],
      { organizationId: ORG, items: [declaredTemplate({ subject: OVERLAY_WORDING })] },
    );

    await bootstrapEffectiveEmailTemplates(engine as any, undefined, {
      protocol,
      tenancy: { defaultOrgId: async () => null },
    });

    // No organization on the request: the tenancy contract named none, so the
    // read is env-wide and the declaration is what the row carries.
    expect(protocol.requests).toEqual([{ type: 'email_template' }]);
    expect(rowsOf(engine)[0].subject).toBe(PACKAGE_WORDING);
  });

  it('projects nothing on a failed effective read, never the package layer in its place', async () => {
    const engine = new FakeEngine({
      rows: { [TABLE]: [rowProjectedFromOverlay()] },
      declared: { email_template: [declaredTemplate()] },
    });
    const warn = vi.fn();
    const protocol = {
      async getMetaItems(): Promise<never> { throw new Error('sys_metadata read failed'); },
    };

    const result = await bootstrapEffectiveEmailTemplates(engine as any, undefined, {
      protocol,
      tenancy: { defaultOrgId: async () => ORG },
    }, { warn });

    expect(result).toEqual({ seeded: 0, skipped: 0 });
    expect(rowsOf(engine)[0].subject).toBe(OVERLAY_WORDING);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][1]).toEqual({ error: 'sys_metadata read failed' });
  });

  it('keeps seed-not-clobber over the effective read: admin-authored and customized rows are skipped', async () => {
    const engine = new FakeEngine({
      rows: {
        [TABLE]: [
          { id: 'a', name: 'ops.digest', locale: 'en-US', subject: 'Admin original', managed_by: 'admin' },
          rowProjectedFromOverlay({ subject: 'Data-door wording', customized: true }),
        ],
      },
    });
    const warn = vi.fn();
    const protocol = layeredProtocol([], {
      organizationId: ORG,
      items: [
        declaredTemplate({ name: 'ops.digest', category: 'notification', subject: 'Overlay digest' }),
        declaredTemplate({ subject: OVERLAY_WORDING }),
      ],
    });

    const result = await bootstrapEffectiveEmailTemplates(engine as any, undefined, {
      protocol,
      tenancy: { defaultOrgId: async () => ORG },
    }, { warn });

    expect(result).toEqual({ seeded: 0, skipped: 2 });
    expect(rowsOf(engine).map((r) => r.subject)).toEqual(['Admin original', 'Data-door wording']);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// [#22062] What a boot costs: a bulk read, and no write for an unchanged row
// ---------------------------------------------------------------------------

/**
 * Before, the sweep looked every template up on its own and rewrote its row
 * unconditionally: on a steady boot, one lookup, one UPDATE and the engine's two
 * read-backs per template. These pin the three halves of the fix: the bulk read
 * (and what happens to a key it does not answer), the compare before the write
 * (and the controls that must still be written), and the provenance rules the
 * compare must not touch. The row-choice pin over several organizations runs on
 * the real engine and SQL driver, in `packages/qa/dogfood`
 * (`email-template-boot-sweep.test.ts`): this package cannot import a driver.
 */
describe('[#22062] the boot sweep reads stored rows in bulk and rewrites only what changed', () => {
  const isBulkRead = (q: any) => Array.isArray(q?.where?.name?.$in);

  /** One template carrying a string, a boolean, an optional column and `variables_json`. */
  const fullTemplate = () => declaredTemplate({ bodyText: 'Plain body', description: 'Reset mail' });

  /** Boot once, then change the stored row the way a case says. `before` is the row as the boot left it. */
  async function steadyWith(mutate: (row: any) => void) {
    const engine = new FakeEngine({ declared: { email_template: [fullTemplate()] } });
    await bootstrapDeclaredEmailTemplates(engine as any, undefined);
    const before = { ...rowsOf(engine)[0] };
    mutate(rowsOf(engine)[0]);
    return { engine, before };
  }

  it('a boot over unchanged templates writes nothing and reads once per 200 names', async () => {
    const declared = Array.from({ length: 450 }, (_, i) => declaredTemplate({ name: `tpl.n${i}` }));
    const engine = new FakeEngine({ declared: { email_template: declared } });
    await bootstrapDeclaredEmailTemplates(engine as any, undefined);

    const find = vi.spyOn(engine, 'find');
    const update = vi.spyOn(engine, 'update');
    const insert = vi.spyOn(engine, 'insert');
    const result = await bootstrapDeclaredEmailTemplates(engine as any, undefined);

    expect(result).toEqual({ seeded: 0, skipped: 450 });
    expect(update).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    // ceil(450 / 200): the bulk reads only. A steady boot has no key the bulk
    // read leaves unanswered, so no per-template lookup is added.
    expect(SWEEP_NAMES_PER_READ).toBe(200);
    expect(find).toHaveBeenCalledTimes(3);
    expect(find.mock.calls.every(([, q]) => isBulkRead(q))).toBe(true);
    expect(rowsOf(engine)).toHaveLength(450);
  });

  it.each([
    ['a string column (`subject`)', (r: any) => { r.subject = 'Stale wording'; }, 'subject'],
    ['a boolean column holding the other boolean (`active`)', (r: any) => { r.active = false; }, 'active'],
    ['a boolean column holding the other 0/1 (`active`)', (r: any) => { r.active = 0; }, 'active'],
    ['an optional column that is null (`body_text`)', (r: any) => { r.body_text = null; }, 'body_text'],
    ['an optional column that is absent (`body_text`)', (r: any) => { delete r.body_text; }, 'body_text'],
    ['`variables_json` holding other text', (r: any) => { r.variables_json = '[]'; }, 'variables_json'],
    [
      '`variables_json` handed back parsed, and different',
      (r: any) => { r.variables_json = [{ name: 'other', type: 'string', required: false }]; },
      'variables_json',
    ],
  ] as const)('control: rewrites a package row whose projected column differs: %s', async (_case, mutate, column) => {
    const { engine, before } = await steadyWith(mutate);
    const update = vi.spyOn(engine, 'update');

    const result = await bootstrapDeclaredEmailTemplates(engine as any, undefined);

    expect(result).toEqual({ seeded: 1, skipped: 0 });
    expect(update).toHaveBeenCalledTimes(1);
    expect(rowsOf(engine)[0][column]).toEqual(before[column]);
  });

  it.each([
    ['a boolean stored as 1 (`active: true`)', (r: any) => { r.active = 1; }],
    ['a boolean stored as 0 (`is_system: false`)', (r: any) => { r.is_system = 0; }],
    ['`variables_json` handed back parsed', (r: any) => { r.variables_json = JSON.parse(r.variables_json); }],
    ['a column the projection omits, holding a value (`from_address`)', (r: any) => { r.from_address = 'ops@example.com'; }],
  ] as const)('leaves a package row that already holds the projection unwritten: %s', async (_case, mutate) => {
    const { engine } = await steadyWith(mutate);
    const update = vi.spyOn(engine, 'update');

    const result = await bootstrapDeclaredEmailTemplates(engine as any, undefined);

    expect(result).toEqual({ seeded: 0, skipped: 1 });
    expect(update).not.toHaveBeenCalled();
  });

  it('still adopts a legacy row with no `managed_by`, even one that already holds the projection', async () => {
    const { engine } = await steadyWith((r) => { delete r.managed_by; });
    const update = vi.spyOn(engine, 'update');

    const result = await bootstrapDeclaredEmailTemplates(engine as any, undefined);

    expect(result).toEqual({ seeded: 1, skipped: 0 });
    expect(update).toHaveBeenCalledTimes(1);
    expect(rowsOf(engine)[0].managed_by).toBe('package');
  });

  it('keeps the first row a key meets in the bulk read: the row the per-template lookup returns', async () => {
    const stale = (id: string, organization_id: string) => ({
      id, organization_id, name: 'auth.password_reset', locale: 'en-US', subject: `stale ${id}`, managed_by: 'package',
    });
    const engine = new FakeEngine({
      rows: { [TABLE]: [stale('etpl_first', 'org_b'), stale('etpl_second', 'org_a')] },
      declared: { email_template: [declaredTemplate()] },
    });
    const [chosen] = await engine.find(TABLE, { where: { name: 'auth.password_reset', locale: 'en-US' }, limit: 1 });
    expect(chosen.id).toBe('etpl_first');

    await bootstrapDeclaredEmailTemplates(engine as any, undefined);

    expect(rowsOf(engine).map((r) => [r.id, r.subject])).toEqual([
      ['etpl_first', PACKAGE_WORDING],
      ['etpl_second', 'stale etpl_second'],
    ]);
  });

  it('looks a key the bulk read did not answer up on its own BEFORE inserting anything', async () => {
    const engine = new FakeEngine({ declared: { email_template: [declaredTemplate({ name: 'ops.new' })] } });
    const find = vi.spyOn(engine, 'find');
    const insert = vi.spyOn(engine, 'insert');

    const result = await bootstrapDeclaredEmailTemplates(engine as any, undefined);

    expect(result).toEqual({ seeded: 1, skipped: 0 });
    expect(find).toHaveBeenCalledTimes(2);
    expect(isBulkRead(find.mock.calls[0][1])).toBe(true);
    expect(find.mock.calls[1][1]).toMatchObject({ where: { name: 'ops.new', locale: 'en-US' }, limit: 1 });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(find.mock.invocationCallOrder[1]).toBeLessThan(insert.mock.invocationCallOrder[0]);
  });

  it('never inserts a row twice when a bulk read is cut short at its bound', async () => {
    // Other locales of the same name fill the bound, stored BEFORE the declared
    // slot's own row, so the bulk read stops exactly where that row would come.
    const filler = Array.from({ length: SWEEP_ROWS_PER_READ }, (_, i) => ({
      id: `etpl_fill_${i}`, name: 'auth.password_reset', locale: `x-${i}`, subject: 'Other locale', managed_by: 'package',
    }));
    const engine = new FakeEngine({ rows: { [TABLE]: filler }, declared: { email_template: [declaredTemplate()] } });
    expect(await bootstrapDeclaredEmailTemplates(engine as any, undefined)).toEqual({ seeded: 1, skipped: 0 });
    // ANTI-VACUITY: the bulk read really does not reach the slot's row.
    const page = await engine.find(TABLE, {
      where: { name: { $in: ['auth.password_reset'] } },
      limit: SWEEP_ROWS_PER_READ,
    });
    expect(page.some((r) => r.locale === 'en-US')).toBe(false);

    const result = await bootstrapDeclaredEmailTemplates(engine as any, undefined);

    expect(result).toEqual({ seeded: 0, skipped: 1 });
    expect(rowsOf(engine).filter((r) => r.locale === 'en-US')).toHaveLength(1);
    expect(rowsOf(engine)).toHaveLength(SWEEP_ROWS_PER_READ + 1);
  });

  it('looks every template up on its own when the bulk read fails, inserting nothing twice', async () => {
    class FailingBulkRead extends FakeEngine {
      override async find(name: string, q?: any): Promise<any[]> {
        if (Array.isArray(q?.where?.name?.$in)) throw new Error('bulk read failed');
        return super.find(name, q);
      }
    }
    const declared = [declaredTemplate(), declaredTemplate({ name: 'ops.digest', category: 'notification' })];
    const engine = new FailingBulkRead({ declared: { email_template: declared } });
    const warn = vi.fn();
    expect(await bootstrapDeclaredEmailTemplates(engine as any, undefined, { warn })).toEqual({ seeded: 2, skipped: 0 });

    const result = await bootstrapDeclaredEmailTemplates(engine as any, undefined, { warn });

    expect(result).toEqual({ seeded: 0, skipped: 2 });
    expect(rowsOf(engine)).toHaveLength(2);
    // Said once per boot, never once per template.
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[1][1]).toEqual({ error: 'bulk read failed' });
  });

  it('meets the row as it now is when the list names one slot twice (a package entry, then its env-wide overlay)', async () => {
    const overlay = declaredTemplate({ subject: OVERLAY_WORDING });
    const engine = new FakeEngine({ declared: { email_template: [overlay] } });
    await bootstrapDeclaredEmailTemplates(engine as any, undefined);
    // The registry lists an env-wide overlay AFTER the package entry it overrides.
    (engine as any).declared = { email_template: [declaredTemplate(), overlay] };

    await bootstrapDeclaredEmailTemplates(engine as any, undefined);

    expect(rowsOf(engine)).toHaveLength(1);
    expect(rowsOf(engine)[0].subject).toBe(OVERLAY_WORDING);
  });

  it('the live door shares the write step: an unchanged save writes nothing, a changed one writes', async () => {
    const engine = new FakeEngine();
    expect(await upsertDeclaredEmailTemplate(engine as any, declaredTemplate())).toBe(true);
    const update = vi.spyOn(engine, 'update');

    expect(await upsertDeclaredEmailTemplate(engine as any, declaredTemplate())).toBe(false);
    expect(update).not.toHaveBeenCalled();

    expect(await upsertDeclaredEmailTemplate(engine as any, declaredTemplate({ subject: 'Saved again' }))).toBe(true);
    expect(update).toHaveBeenCalledTimes(1);
    expect(rowsOf(engine)[0].subject).toBe('Saved again');
  });
});
