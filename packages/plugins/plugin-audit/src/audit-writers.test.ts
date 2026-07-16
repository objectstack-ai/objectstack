// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { installAuditWriters } from './audit-writers.js';

/**
 * Regression coverage for #1532 — on single-tenant stacks the
 * SchemaRegistry does NOT auto-inject `organization_id` into
 * `sys_audit_log` / `sys_activity`, so the audit writer must not emit that
 * column. Previously it stamped `organization_id` unconditionally, making
 * every audit INSERT fail with "table sys_audit_log has no column named
 * organization_id" (swallowed → audit logging silently non-functional).
 */

interface CapturedRow {
  object: string;
  row: Record<string, any>;
}

/**
 * Build a fake ObjectQL engine that records hook registrations and the rows
 * written through `api.sudo().object(name).create(row)`.
 *
 * @param schemas Map of object short-name → declared field set. Mirrors what
 *   `engine.getSchema(name)` returns after `applySystemFields` has (or has
 *   not) injected `organization_id`.
 */
function makeEngine(
  schemas: Record<string, string[] | Record<string, any>>,
  objectDefs: Record<string, any> = {},
) {
  const hooks = new Map<string, Array<(ctx: any) => any>>();
  const created: CapturedRow[] = [];

  const sudoApi = {
    object(name: string) {
      return {
        async create(row: Record<string, any>) {
          created.push({ object: name, row });
          return { id: 'generated-id', ...row };
        },
      };
    },
  };
  // `writeAudit` calls `ctx.api.sudo()` to get the object accessor above.
  const api = { sudo: () => sudoApi };

  const engine = {
    getSchema(name: string) {
      const fields = schemas[name];
      if (!fields) return undefined;
      const fieldMap = Array.isArray(fields)
        ? Object.fromEntries(fields.map((f) => [f, { type: 'text' }]))
        : fields;
      return { name, fields: fieldMap, ...(objectDefs[name] || {}) };
    },
    registerHook(event: string, fn: (ctx: any) => any) {
      const list = hooks.get(event) ?? [];
      list.push(fn);
      hooks.set(event, list);
    },
    unregisterHooksByPackage() {
      /* no-op */
    },
    logger: { warn() {} },
  };

  async function fire(event: string, ctx: any) {
    for (const fn of hooks.get(event) ?? []) {
      await fn({ ...ctx, event, api });
    }
  }

  return { engine, fire, created };
}

const SINGLE_TENANT = {
  // No `organization_id` — single-tenant stacks skip the auto-injection.
  sys_audit_log: ['id', 'action', 'user_id', 'actor', 'object_name', 'record_id', 'old_value', 'new_value', 'tenant_id'],
  sys_activity: ['id', 'type', 'timestamp', 'summary', 'actor_id', 'object_name', 'record_id', 'record_label', 'metadata'],
};

const MULTI_TENANT = {
  sys_audit_log: [...SINGLE_TENANT.sys_audit_log, 'organization_id'],
  sys_activity: [...SINGLE_TENANT.sys_activity, 'organization_id'],
};

describe('audit writers — organization_id stamping (#1532)', () => {
  it('omits organization_id on single-tenant tables that lack the column', async () => {
    const { engine, fire, created } = makeEngine(SINGLE_TENANT);
    installAuditWriters(engine as any, 'test.audit');

    await fire('afterInsert', {
      object: 'crm_lead',
      input: { id: 'lead-1' },
      result: { id: 'lead-1', name: 'Acme' },
      session: {},
    });

    const audit = created.find((c) => c.object === 'sys_audit_log');
    const activity = created.find((c) => c.object === 'sys_activity');
    expect(audit).toBeDefined();
    expect(activity).toBeDefined();
    // The fix: no undeclared column is emitted, so the INSERT would succeed.
    expect('organization_id' in audit!.row).toBe(false);
    expect('organization_id' in activity!.row).toBe(false);
    // tenant_id is schema-declared and still written.
    expect('tenant_id' in audit!.row).toBe(true);
  });

  it('stamps organization_id on multi-tenant tables when the column exists', async () => {
    const { engine, fire, created } = makeEngine(MULTI_TENANT);
    installAuditWriters(engine as any, 'test.audit');

    await fire('afterInsert', {
      object: 'crm_lead',
      input: { id: 'lead-1' },
      result: { id: 'lead-1', name: 'Acme', organization_id: 'org-9' },
      session: { tenantId: 'org-9', userId: 'user-1' },
    });

    const audit = created.find((c) => c.object === 'sys_audit_log');
    const activity = created.find((c) => c.object === 'sys_activity');
    expect(audit?.row.organization_id).toBe('org-9');
    expect(activity?.row.organization_id).toBe('org-9');
  });
});

describe('audit writers — actor attribution (ADR-0014 D2, cloud#340)', () => {
  it('records a real user id on actor + user_id', async () => {
    const { engine, fire, created } = makeEngine(SINGLE_TENANT);
    installAuditWriters(engine as any, 'test.audit');
    await fire('afterInsert', {
      object: 'crm_lead',
      input: { id: 'lead-1' },
      result: { id: 'lead-1', name: 'Acme' },
      session: { userId: 'user-7' },
    });
    const audit = created.find((c) => c.object === 'sys_audit_log');
    expect(audit?.row.user_id).toBe('user-7');
    expect(audit?.row.actor).toBe('user-7');
  });

  it('attributes a service-token write (no userId) via session.actor → actor, user_id stays null', async () => {
    const { engine, fire, created } = makeEngine(SINGLE_TENANT);
    installAuditWriters(engine as any, 'test.audit');
    // The os-790m7q class: a service-token delete with no real user.
    await fire('afterDelete', {
      object: 'sys_environment',
      input: { id: 'os-790m7q' },
      __previous: { id: 'os-790m7q', name: 'test' },
      result: { id: 'os-790m7q' },
      session: { actor: 'svc:cloud-control' },
    });
    const audit = created.find((c) => c.object === 'sys_audit_log');
    expect(audit?.row.action).toBe('delete');
    // user_id (sys_user lookup) stays null — a service principal isn't a user…
    expect(audit?.row.user_id).toBeNull();
    // …but the action is now ATTRIBUTABLE on actor.
    expect(audit?.row.actor).toBe('svc:cloud-control');
  });

  it('leaves actor null when neither a user nor a service principal is present', async () => {
    const { engine, fire, created } = makeEngine(SINGLE_TENANT);
    installAuditWriters(engine as any, 'test.audit');
    await fire('afterInsert', {
      object: 'crm_lead',
      input: { id: 'lead-2' },
      result: { id: 'lead-2', name: 'Beta' },
      session: {},
    });
    const audit = created.find((c) => c.object === 'sys_audit_log');
    expect(audit?.row.actor).toBeNull();
    expect(audit?.row.user_id).toBeNull();
  });
});

describe('audit writers — declarative trackHistory activity (ADR-0052 §5b)', () => {
  // crm_opportunity with a tracked select field (Stage) carrying option labels.
  const SCHEMA = {
    sys_audit_log: SINGLE_TENANT.sys_audit_log,
    sys_activity: SINGLE_TENANT.sys_activity,
    crm_opportunity: {
      id: { type: 'text' },
      name: { type: 'text', label: 'Name' },
      amount: { type: 'currency', label: 'Amount' },
      stage: {
        type: 'select',
        label: 'Stage',
        trackHistory: true,
        options: [
          { value: 'proposal', label: 'Proposal' },
          { value: 'closed_won', label: 'Closed Won' },
        ],
      },
    },
  };

  it('renders a tracked field change as "<label>: <old> → <new>" with option labels', async () => {
    const { engine, fire, created } = makeEngine(SCHEMA);
    installAuditWriters(engine as any, 'test.audit');

    await fire('afterUpdate', {
      object: 'crm_opportunity',
      input: { id: 'opp-1', stage: 'closed_won' },
      result: { id: 'opp-1', name: 'Acme Renewal', stage: 'closed_won' },
      __previous: { id: 'opp-1', name: 'Acme Renewal', stage: 'proposal' },
      session: {},
    });

    const activity = created.find((c) => c.object === 'sys_activity');
    // Platform-generated, human-readable — no app code wrote this.
    expect(activity?.row.summary).toBe('Stage: Proposal → Closed Won');
  });

  it('falls back to the generic summary when only untracked fields change', async () => {
    const { engine, fire, created } = makeEngine(SCHEMA);
    installAuditWriters(engine as any, 'test.audit');

    await fire('afterUpdate', {
      object: 'crm_opportunity',
      input: { id: 'opp-1', amount: 200 },
      result: { id: 'opp-1', name: 'Acme Renewal', amount: 200, stage: 'proposal' },
      __previous: { id: 'opp-1', name: 'Acme Renewal', amount: 100, stage: 'proposal' },
      session: {},
    });

    const activity = created.find((c) => c.object === 'sys_activity');
    expect(activity?.row.summary).toBe('Updated crm_opportunity "Acme Renewal"');
  });
});

describe('audit writers — declarative milestones (ADR-0052 §5b.2)', () => {
  const FIELDS = {
    id: { type: 'text' },
    name: { type: 'text', label: 'Name' },
    stage: {
      type: 'select',
      label: 'Stage',
      trackHistory: true,
      options: [
        { value: 'negotiation', label: 'Negotiation' },
        { value: 'closed_won', label: 'Closed Won' },
      ],
    },
  };
  const SCHEMA = {
    sys_audit_log: SINGLE_TENANT.sys_audit_log,
    sys_activity: SINGLE_TENANT.sys_activity,
    crm_opportunity: FIELDS,
  };
  // Object-level milestone: when stage enters closed_won → "Deal won: {name}".
  const OBJECT_DEFS = {
    crm_opportunity: {
      activityMilestones: [
        { field: 'stage', value: 'closed_won', summary: 'Deal won: {name}', type: 'completed' },
      ],
    },
  };

  it('emits the interpolated milestone summary (precedence over field-change) on transition', async () => {
    const { engine, fire, created } = makeEngine(SCHEMA, OBJECT_DEFS);
    installAuditWriters(engine as any, 'test.audit');

    await fire('afterUpdate', {
      object: 'crm_opportunity',
      input: { id: 'opp-1', stage: 'closed_won' },
      result: { id: 'opp-1', name: 'Acme Renewal', stage: 'closed_won' },
      __previous: { id: 'opp-1', name: 'Acme Renewal', stage: 'negotiation' },
      session: {},
    });

    const activity = created.find((c) => c.object === 'sys_activity');
    // Milestone summary wins over the "Stage: Negotiation → Closed Won" diff.
    expect(activity?.row.summary).toBe('Deal won: Acme Renewal');
    expect(activity?.row.type).toBe('completed');
  });

  it('does not fire the milestone when the field does not transition into the value', async () => {
    const { engine, fire, created } = makeEngine(SCHEMA, OBJECT_DEFS);
    installAuditWriters(engine as any, 'test.audit');

    await fire('afterUpdate', {
      object: 'crm_opportunity',
      input: { id: 'opp-1', stage: 'negotiation' },
      result: { id: 'opp-1', name: 'Acme Renewal', stage: 'negotiation' },
      __previous: { id: 'opp-1', name: 'Acme Renewal', stage: 'proposal' },
      session: {},
    });

    const activity = created.find((c) => c.object === 'sys_activity');
    // Falls back to the field-change render (trackHistory), not the milestone.
    // `proposal` has no option entry here → raw value; `negotiation` → its label.
    expect(activity?.row.summary).toBe('Stage: proposal → Negotiation');
  });
});

describe('audit writers — enable.activities opt-out gate (#2707)', () => {
  const SCHEMA = {
    sys_audit_log: SINGLE_TENANT.sys_audit_log,
    sys_activity: SINGLE_TENANT.sys_activity,
    crm_lead: ['id', 'name'],
  };

  it('mirrors CRUD into sys_activity by default (absent enable block)', async () => {
    const { engine, fire, created } = makeEngine(SCHEMA);
    installAuditWriters(engine as any, 'test.audit');

    await fire('afterInsert', {
      object: 'crm_lead',
      input: { id: 'lead-1' },
      result: { id: 'lead-1', name: 'Acme' },
      session: {},
    });

    expect(created.some((c) => c.object === 'sys_audit_log')).toBe(true);
    expect(created.some((c) => c.object === 'sys_activity')).toBe(true);
  });

  it('skips ONLY the sys_activity mirror on explicit activities:false — audit row still written', async () => {
    const { engine, fire, created } = makeEngine(SCHEMA, {
      crm_lead: { enable: { activities: false } },
    });
    installAuditWriters(engine as any, 'test.audit');

    await fire('afterInsert', {
      object: 'crm_lead',
      input: { id: 'lead-1' },
      result: { id: 'lead-1', name: 'Acme' },
      session: {},
    });

    // Compliance ledger is NOT gated by the capability flag…
    expect(created.some((c) => c.object === 'sys_audit_log')).toBe(true);
    // …but the timeline mirror is.
    expect(created.some((c) => c.object === 'sys_activity')).toBe(false);
  });
});

describe('audit writers — enable.feeds server-side enforcement (#2707)', () => {
  const SCHEMA = {
    sys_audit_log: SINGLE_TENANT.sys_audit_log,
    sys_activity: SINGLE_TENANT.sys_activity,
    crm_lead: ['id', 'name'],
  };

  const commentInsert = (threadId?: unknown) => ({
    object: 'sys_comment',
    input: { data: { thread_id: threadId, body: 'hello' } },
    session: {},
  });

  it('rejects sys_comment creation targeting an object with explicit feeds:false (403 FEEDS_DISABLED)', async () => {
    const { engine, fire } = makeEngine(SCHEMA, {
      crm_lead: { enable: { feeds: false } },
    });
    installAuditWriters(engine as any, 'test.audit');

    await expect(fire('beforeInsert', commentInsert('crm_lead:rec-1'))).rejects.toMatchObject({
      code: 'FEEDS_DISABLED',
      status: 403,
      object: 'crm_lead',
    });
  });

  it('allows comments when feeds is absent (opt-out default) or explicitly true', async () => {
    const absent = makeEngine(SCHEMA);
    installAuditWriters(absent.engine as any, 'test.audit');
    await expect(absent.fire('beforeInsert', commentInsert('crm_lead:rec-1'))).resolves.toBeUndefined();

    const explicit = makeEngine(SCHEMA, { crm_lead: { enable: { feeds: true } } });
    installAuditWriters(explicit.engine as any, 'test.audit');
    await expect(explicit.fire('beforeInsert', commentInsert('crm_lead:rec-1'))).resolves.toBeUndefined();
  });

  it('lets unconventional/missing thread_id through (capability gate, not access control)', async () => {
    const { engine, fire } = makeEngine(SCHEMA, {
      crm_lead: { enable: { feeds: false } },
    });
    installAuditWriters(engine as any, 'test.audit');

    await expect(fire('beforeInsert', commentInsert(undefined))).resolves.toBeUndefined();
    await expect(fire('beforeInsert', commentInsert('free-form-thread'))).resolves.toBeUndefined();
    // Unknown target object → no def → allowed.
    await expect(fire('beforeInsert', commentInsert('ghost_object:rec-9'))).resolves.toBeUndefined();
  });
});

describe('audit writers — enable.files server-side enforcement (#2727)', () => {
  const SCHEMA = {
    sys_audit_log: SINGLE_TENANT.sys_audit_log,
    sys_activity: SINGLE_TENANT.sys_activity,
    crm_lead: ['id', 'name'],
  };

  const attachmentInsert = (parentObject?: unknown) => ({
    object: 'sys_attachment',
    input: { data: { parent_object: parentObject, parent_id: 'rec-1', file_id: 'file-1' } },
    session: {},
  });

  it('allows sys_attachment creation when the parent object declares files: true', async () => {
    const { engine, fire } = makeEngine(SCHEMA, {
      crm_lead: { enable: { files: true } },
    });
    installAuditWriters(engine as any, 'test.audit');

    await expect(fire('beforeInsert', attachmentInsert('crm_lead'))).resolves.toBeUndefined();
  });

  it('rejects when the flag is absent — opt-in means explicit (403 FILES_DISABLED)', async () => {
    const noBlock = makeEngine(SCHEMA);
    installAuditWriters(noBlock.engine as any, 'test.audit');
    await expect(noBlock.fire('beforeInsert', attachmentInsert('crm_lead'))).rejects.toMatchObject({
      code: 'FILES_DISABLED',
      status: 403,
      object: 'crm_lead',
    });

    const explicitFalse = makeEngine(SCHEMA, { crm_lead: { enable: { files: false } } });
    installAuditWriters(explicitFalse.engine as any, 'test.audit');
    await expect(explicitFalse.fire('beforeInsert', attachmentInsert('crm_lead'))).rejects.toMatchObject({
      code: 'FILES_DISABLED',
    });
  });

  it('rejects an unknown parent object (fail-closed, unlike the opt-out feeds gate)', async () => {
    const { engine, fire } = makeEngine(SCHEMA);
    installAuditWriters(engine as any, 'test.audit');
    await expect(fire('beforeInsert', attachmentInsert('ghost_object'))).rejects.toMatchObject({
      code: 'FILES_DISABLED',
      object: 'ghost_object',
    });
  });

  it('leaves a missing parent_object to schema validation (no gate error)', async () => {
    const { engine, fire } = makeEngine(SCHEMA, { crm_lead: { enable: { files: false } } });
    installAuditWriters(engine as any, 'test.audit');
    await expect(fire('beforeInsert', attachmentInsert(undefined))).resolves.toBeUndefined();
  });
});

// timeout: the FIRST localized case pays the one-off cost of dynamically
// importing @objectstack/core + the shipped translation bundle (and, with the
// #3071 src aliases, their vite transforms). On a shared 4-vCPU CI runner that
// cold start alone was measured at ~5s — right at vitest's default timeout —
// while every warmed case runs in ~1ms. 20s bounds the cold start without
// masking a real hang.
describe('audit writers — localized activity summaries (framework#3039)', { timeout: 20_000 }, () => {
  // Real memory i18n (what the kernel registers as the 'i18n' fallback) loaded
  // with this plugin's shipped bundle plus an app-contributed object label —
  // exercises the actual key shapes (`messages.activityCreated`,
  // `objects.{name}.label`) end to end.
  async function makeI18n() {
    const { createMemoryI18n } = await import('@objectstack/core');
    const { AuditTranslations } = await import('./translations/index.js');
    const i18n = createMemoryI18n();
    for (const [locale, data] of Object.entries(AuditTranslations)) {
      i18n.loadTranslations(locale, data as Record<string, any>);
    }
    i18n.loadTranslations('zh-CN', {
      objects: { person_qualification: { label: '人员资质' } },
    });
    return i18n;
  }

  function setup(
    locale: string | undefined,
    i18n?: { t: Function },
    objectDefs: Record<string, any> = {},
    schemas: Record<string, string[] | Record<string, any>> = SINGLE_TENANT,
  ) {
    const { engine, fire, created } = makeEngine(schemas, objectDefs);
    let localeCalls = 0;
    installAuditWriters(engine as any, 'test.audit', {
      getI18n: () => i18n as any,
      getLocale: async () => {
        localeCalls += 1;
        return locale;
      },
    });
    return { fire, created, localeCalls: () => localeCalls };
  }

  const insertCtx = (object = 'person_qualification') => ({
    object,
    input: { id: 'q-1' },
    result: { id: 'q-1', name: 'OC-00001' },
    session: { tenantId: 'org-1', userId: 'user-1' },
  });

  it('localizes verb + object label to the workspace locale (zh-CN)', async () => {
    const { fire, created } = setup('zh-CN', await makeI18n());

    await fire('afterInsert', insertCtx());
    await fire('afterDelete', { ...insertCtx(), result: null, __previous: { id: 'q-1', name: 'OC-00001' } });

    const summaries = created.filter((c) => c.object === 'sys_activity').map((c) => c.row.summary);
    expect(summaries).toEqual(['创建了 人员资质 "OC-00001"', '删除了 人员资质 "OC-00001"']);
  });

  it('localizes the generic update fallback', async () => {
    const { fire, created } = setup('zh-CN', await makeI18n());
    await fire('afterUpdate', {
      ...insertCtx(),
      __previous: { id: 'q-1', name: 'OC-00001', status: 'draft' },
      result: { id: 'q-1', name: 'OC-00001', status: 'active' },
    });
    const activity = created.find((c) => c.object === 'sys_activity');
    expect(activity!.row.summary).toBe('更新了 人员资质 "OC-00001"');
  });

  it('falls back to the object def label, then English, when a translation misses', async () => {
    // Locale resolves but the object has no zh-CN label entry → verb is
    // localized, label falls back to the authored def label.
    const { fire, created } = setup(
      'zh-CN',
      await makeI18n(),
      { crm_lead: { label: 'Lead' } },
      { ...SINGLE_TENANT, crm_lead: ['id', 'name'] },
    );
    await fire('afterInsert', { ...insertCtx('crm_lead'), result: { id: 'q-1', name: 'Acme' } });
    expect(created.find((c) => c.object === 'sys_activity')!.row.summary).toBe('创建了 Lead "Acme"');
  });

  it('keeps English summaries when no i18n service is resolvable', async () => {
    const { fire, created } = setup('zh-CN', undefined);
    await fire('afterInsert', insertCtx());
    expect(created.find((c) => c.object === 'sys_activity')!.row.summary).toBe(
      'Created person_qualification "OC-00001"',
    );
  });

  it('keeps English summaries without a locale resolver (status quo)', async () => {
    const { engine, fire, created } = makeEngine(SINGLE_TENANT);
    installAuditWriters(engine as any, 'test.audit', { getI18n: () => undefined });
    await fire('afterInsert', insertCtx());
    expect(created.find((c) => c.object === 'sys_activity')!.row.summary).toBe(
      'Created person_qualification "OC-00001"',
    );
  });

  it('memoizes the locale lookup per tenant/user scope (hot-path guard)', async () => {
    const { fire, localeCalls } = setup('zh-CN', await makeI18n());
    await fire('afterInsert', insertCtx());
    await fire('afterInsert', { ...insertCtx(), result: { id: 'q-2', name: 'OC-00002' } });
    expect(localeCalls()).toBe(1);
  });
});
