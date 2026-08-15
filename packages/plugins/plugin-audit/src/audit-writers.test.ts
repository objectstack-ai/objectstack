// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { installAuditWriters } from './audit-writers.js';
// STATIC on purpose (#4186). These were `await import(...)` inside the first
// localized test's helper, so that one test paid the whole cold-start cost of
// resolving + transforming @objectstack/core and the translation bundle, while
// every later case ran warmed in ~1ms. That is a per-test timeout budget spent
// on module loading: it grew past the 20s override this file used to carry and
// failed the suite under parallel load. As module-level imports the same work
// happens during collection, which no single test's timeout is charged for.
// Do not make these lazy again.
import { createMemoryI18n } from '@objectstack/core';
import { AuditTranslations } from './translations/index.js';

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
      previous: { id: 'os-790m7q', name: 'test' },
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

  /**
   * [#4586] The `sys_member` case the issue is about: better-auth authorizes
   * identity writes as the SYSTEM on purpose, so the session names no caller
   * and every grade change used to record as "system". The human arrives on
   * PROVENANCE instead — attribution, never authorization.
   */
  it('credits the attributed human when the write authorized as the system', async () => {
    const { engine, fire, created } = makeEngine(SINGLE_TENANT);
    installAuditWriters(engine as any, 'test.audit');
    await fire('afterUpdate', {
      object: 'sys_member',
      input: { id: 'mem-1' },
      previous: { id: 'mem-1', role: 'member' },
      result: { id: 'mem-1', role: 'admin' },
      // Exactly the envelope `withSystemContext` produces for an
      // `organization/update-member-role` call.
      session: { isSystem: true },
      provenance: { attributedUserId: 'user-admin' },
    });
    const audit = created.find((c) => c.object === 'sys_audit_log');
    expect(audit?.row.action).toBe('update');
    // WHO changed the grade — a real sys_user id, so the lookup still joins
    // (ADR-0118 D1: an id or null, never a sentinel like 'system').
    expect(audit?.row.user_id).toBe('user-admin');
    expect(audit?.row.actor).toBe('user-admin');
  });

  it('a genuinely machine-originated write still records as the system (null)', async () => {
    // Boot sync / migration / the kernel:ready backfill: no scope, no actor.
    // Absence must stay absence — never upgraded into some ambient user.
    const { engine, fire, created } = makeEngine(SINGLE_TENANT);
    installAuditWriters(engine as any, 'test.audit');
    await fire('afterInsert', {
      object: 'sys_member',
      input: { id: 'mem-2' },
      result: { id: 'mem-2', role: 'member' },
      session: { isSystem: true },
    });
    const audit = created.find((c) => c.object === 'sys_audit_log');
    expect(audit?.row.user_id).toBeNull();
    expect(audit?.row.actor).toBeNull();
  });

  it('a real caller outranks attribution — the session subject wins', async () => {
    const { engine, fire, created } = makeEngine(SINGLE_TENANT);
    installAuditWriters(engine as any, 'test.audit');
    await fire('afterInsert', {
      object: 'crm_lead',
      input: { id: 'lead-3' },
      result: { id: 'lead-3', name: 'Gamma' },
      session: { userId: 'user-7' },
      provenance: { attributedUserId: 'user-admin' },
    });
    const audit = created.find((c) => c.object === 'sys_audit_log');
    expect(audit?.row.user_id).toBe('user-7');
  });
});

describe('audit writers — operational plumbing is excluded (#5193, ADR-0057 D5)', () => {
  // The queue table as `DbQueueAdapter` writes it, alongside the two audit
  // sinks. Everything here goes through the SAME wildcard hooks a business
  // object does — `SKIP_OBJECTS` is the only thing standing between the queue
  // and the ledger (there is no "system context writes are not audited" rule).
  const SCHEMA = {
    sys_audit_log: SINGLE_TENANT.sys_audit_log,
    sys_activity: SINGLE_TENANT.sys_activity,
    sys_job_queue: ['id', 'queue', 'status', 'attempts', 'locked_by', 'locked_until', 'completed_at'],
    crm_lead: ['id', 'name'],
  };
  // Every write `service-queue` performs for ONE message, in order: publish,
  // lease (`pending→running`), terminal (`→completed`), and the #5192 reaper's
  // periodic DELETE of completed rows.
  const QUEUE_MESSAGE_LIFECYCLE: Array<[string, Record<string, any>]> = [
    [
      'afterInsert',
      {
        input: { id: 'msg-1' },
        result: { id: 'msg-1', queue: 'email_delivery', status: 'pending', attempts: 0 },
      },
    ],
    [
      'afterUpdate',
      {
        input: { id: 'msg-1', status: 'running' },
        previous: { id: 'msg-1', queue: 'email_delivery', status: 'pending', attempts: 0 },
        result: { id: 'msg-1', queue: 'email_delivery', status: 'running', attempts: 1, locked_by: 'worker-1' },
      },
    ],
    [
      'afterUpdate',
      {
        input: { id: 'msg-1', status: 'completed' },
        previous: { id: 'msg-1', queue: 'email_delivery', status: 'running', attempts: 1, locked_by: 'worker-1' },
        result: { id: 'msg-1', queue: 'email_delivery', status: 'completed', attempts: 1, completed_at: '2026-08-04T00:00:00.000Z' },
      },
    ],
    [
      'afterDelete',
      {
        input: { id: 'msg-1' },
        previous: { id: 'msg-1', queue: 'email_delivery', status: 'completed', attempts: 1 },
        result: { id: 'msg-1' },
      },
    ],
  ];

  it('writes NO audit/activity row for a full sys_job_queue message lifecycle', async () => {
    const { engine, fire, created } = makeEngine(SCHEMA);
    installAuditWriters(engine as any, 'test.audit');

    for (const [event, ctx] of QUEUE_MESSAGE_LIFECYCLE) {
      await fire(event, { object: 'sys_job_queue', session: { isSystem: true }, ...ctx });
    }

    // Not "fewer rows" — zero. One email used to cost ≥3 audit + ≥3 activity
    // rows here, and the reaper's sweep another delete row apiece (#5160).
    expect(created).toEqual([]);
  });

  it('pins sys_job_queue in the same exemption group as its siblings sys_job / sys_job_run', async () => {
    const SIBLINGS = ['sys_job', 'sys_job_run', 'sys_job_queue', 'sys_automation_run'];
    for (const object of SIBLINGS) {
      const { engine, fire, created } = makeEngine({ ...SCHEMA, [object]: ['id', 'status'] });
      installAuditWriters(engine as any, 'test.audit');
      await fire('afterInsert', {
        object,
        input: { id: 'row-1' },
        result: { id: 'row-1', status: 'pending' },
        session: { isSystem: true },
      });
      expect(created, `${object} must not reach the audit ledger`).toEqual([]);
    }
  });

  it('pays no before-phase snapshot read — for the skipped object OR the business one (#6656)', async () => {
    // [#6656] This case used to assert the saving for `sys_job_queue` only,
    // with `crm_lead` as the CONTROL that still paid — because #5860 could
    // only narrow the scope of a read the plugin was still issuing. The read
    // itself is now retired for every object (the engine binds `previous`
    // before each `before*` dispatch), so the control's direction inverts: the
    // business object must pay nothing either.
    //
    // The case therefore still bites, and on a strictly larger surface —
    // restoring `captureBefore` turns it red on `crm_lead` where the old
    // version REQUIRED that read. What replaces the control is the two cases
    // above: `crm_lead` still reaches the ledger, so this zero is a read that
    // disappeared, not a hook that stopped running.
    const { engine, fire } = makeEngine(SCHEMA);
    installAuditWriters(engine as any, 'test.audit');
    const reads: string[] = [];
    const ql = {
      async findOne(object: string) {
        reads.push(object);
        return { id: 'msg-1' };
      },
    };

    await fire('beforeUpdate', { object: 'sys_job_queue', input: { id: 'msg-1', status: 'running' }, ql });
    await fire('beforeDelete', { object: 'sys_job_queue', input: { id: 'msg-1' }, ql });
    await fire('beforeUpdate', { object: 'crm_lead', input: { id: 'lead-1', name: 'Acme' }, ql });
    await fire('beforeDelete', { object: 'crm_lead', input: { id: 'lead-1' }, ql });
    expect(reads).toEqual([]);
  });

  it('still audits ordinary business writes (the skip stays narrow)', async () => {
    const { engine, fire, created } = makeEngine(SCHEMA);
    installAuditWriters(engine as any, 'test.audit');
    await fire('afterInsert', {
      object: 'crm_lead',
      input: { id: 'lead-1' },
      result: { id: 'lead-1', name: 'Acme' },
      session: { userId: 'user-1' },
    });
    expect(created.map((c) => c.object)).toEqual(['sys_audit_log', 'sys_activity']);
  });
});

describe('audit writers — chunked upload sessions are excluded (#5202, ADR-0057 D5)', () => {
  // The upload-session table as `StorageMetadataStore` writes it, plus
  // `sys_file` (its sibling, deliberately NOT exempted) and a business object.
  // Same wildcard hooks a business object goes through — `SKIP_OBJECTS` is the
  // only thing between an upload and the ledger.
  const SCHEMA = {
    sys_audit_log: SINGLE_TENANT.sys_audit_log,
    sys_activity: SINGLE_TENANT.sys_activity,
    sys_upload_session: ['id', 'file_id', 'status', 'uploaded_chunks', 'uploaded_size', 'parts', 'started_at', 'expires_at', 'updated_at'],
    sys_file: ['id', 'name', 'size', 'status'],
    crm_lead: ['id', 'name'],
  };

  /**
   * Every write `StorageMetadataStore` performs for ONE chunked upload of
   * `chunks` parts, in order: `createSession()` insert, one `updateSession()`
   * per chunk, the terminal `updateSession()`, and the row's removal.
   *
   * `updateSession()` writes the MERGED FULL record, so `parts` — the JSON blob
   * that grows by one entry per chunk — is in every single diff. The fixture
   * grows it for real rather than sending a placeholder, because the size of
   * those `old_value`/`new_value` payloads is half of what #5202 is about.
   */
  function uploadLifecycle(
    chunks: number,
    terminal: { status: string; via: 'afterUpdate' | 'afterDelete' },
  ): Array<[string, Record<string, any>]> {
    const partsAfter = (n: number) =>
      JSON.stringify(Array.from({ length: n }, (_, i) => ({ part: i + 1, etag: `etag-${i + 1}` })));
    const snapshot = (n: number, status: string) => ({
      id: 'ups-1',
      file_id: 'file-1',
      status,
      uploaded_chunks: n,
      uploaded_size: n * 5_242_880,
      parts: partsAfter(n),
      updated_at: `2026-08-04T00:00:${String(n).padStart(2, '0')}.000Z`,
    });

    const writes: Array<[string, Record<string, any>]> = [
      // createSession() — engine.insert with the full seeded record.
      ['afterInsert', { input: { id: 'ups-1' }, result: snapshot(0, 'in_progress') }],
    ];
    // updateSession() — ONE per chunk, each carrying the whole grown record.
    for (let n = 1; n <= chunks; n += 1) {
      writes.push([
        'afterUpdate',
        {
          input: snapshot(n, 'in_progress'),
          previous: snapshot(n - 1, 'in_progress'),
          result: snapshot(n, 'in_progress'),
        },
      ]);
    }
    // complete() / abort() — a final updateSession() flipping status…
    writes.push([
      'afterUpdate',
      {
        input: { id: 'ups-1', status: terminal.status },
        previous: snapshot(chunks, 'in_progress'),
        result: snapshot(chunks, terminal.status),
      },
    ]);
    // …then deleteSession(), or the ADR-0057 TTL/retention reaper.
    if (terminal.via === 'afterDelete') {
      writes.push([
        'afterDelete',
        { input: { id: 'ups-1' }, previous: snapshot(chunks, terminal.status), result: { id: 'ups-1' } },
      ]);
    }
    return writes;
  }

  it('writes NO audit/activity row for a completed 8-chunk upload (create → 8 × update → complete → delete)', async () => {
    const { engine, fire, created } = makeEngine(SCHEMA);
    installAuditWriters(engine as any, 'test.audit');

    const writes = uploadLifecycle(8, { status: 'completed', via: 'afterDelete' });
    // Sanity-check the fixture itself: 1 insert + 8 chunk updates + 1 terminal
    // update + 1 delete. Without the exemption that is 2 × 11 = 22 ledger rows
    // for one file — the 2 × (1 + N) amplifier #5202 names.
    expect(writes).toHaveLength(11);

    for (const [event, ctx] of writes) {
      await fire(event, { object: 'sys_upload_session', session: { isSystem: true }, ...ctx });
    }

    // Not "fewer rows" — zero.
    expect(created).toEqual([]);
  });

  it('writes NO audit/activity row when the session is aborted and reaped instead', async () => {
    const { engine, fire, created } = makeEngine(SCHEMA);
    installAuditWriters(engine as any, 'test.audit');

    // Abandoned mid-upload: the terminal write is the TTL reaper's DELETE of a
    // row 1d past `expires_at`, not a user action.
    for (const [event, ctx] of uploadLifecycle(3, { status: 'expired', via: 'afterDelete' })) {
      await fire(event, { object: 'sys_upload_session', session: { isSystem: true }, ...ctx });
    }
    expect(created).toEqual([]);
  });

  it('does not re-read the growing session row before every chunk update', async () => {
    const { engine, fire } = makeEngine(SCHEMA);
    installAuditWriters(engine as any, 'test.audit');
    const reads: string[] = [];
    const ql = {
      async findOne(object: string) {
        reads.push(object);
        return { id: 'ups-1' };
      },
    };

    // `captureBefore` would otherwise snapshot the row — `parts` blob and all —
    // once per chunk, on top of the write the store is already doing.
    for (let n = 1; n <= 4; n += 1) {
      await fire('beforeUpdate', { object: 'sys_upload_session', input: { id: 'ups-1', uploaded_chunks: n }, ql });
    }
    await fire('beforeDelete', { object: 'sys_upload_session', input: { id: 'ups-1' }, ql });
    // [#6656] `crm_lead` was the control that still paid this read. The read is
    // retired for every object now, so it joins the assertion instead of
    // opposing it — see the twin case in the `sys_job_queue` group for why
    // that makes the pin stronger rather than weaker.
    await fire('beforeUpdate', { object: 'crm_lead', input: { id: 'lead-1', name: 'Acme' }, ql });
    expect(reads).toEqual([]);
  });

  it('still audits sys_file — mostly permanent business truth, deliberately NOT exempted', async () => {
    const { engine, fire, created } = makeEngine(SCHEMA);
    installAuditWriters(engine as any, 'test.audit');

    // `sys_file` also declares `lifecycle.class: 'transient'`, but only to reap
    // tombstones and unfinished uploads; the rows themselves are business truth
    // with compliance value. #5202 exempts the SESSION, never the FILE — if a
    // later "finish the sweep" change adds `sys_file` to `SKIP_OBJECTS`, this
    // is the test that says no.
    await fire('afterInsert', {
      object: 'sys_file',
      input: { id: 'file-1' },
      result: { id: 'file-1', name: 'contract.pdf', size: 41_943_040, status: 'ready' },
      session: { userId: 'user-1' },
    });
    expect(created.map((c) => c.object)).toEqual(['sys_audit_log', 'sys_activity']);
  });

  it('still audits ordinary business writes (the skip stays narrow)', async () => {
    const { engine, fire, created } = makeEngine(SCHEMA);
    installAuditWriters(engine as any, 'test.audit');
    await fire('afterInsert', {
      object: 'crm_lead',
      input: { id: 'lead-1' },
      result: { id: 'lead-1', name: 'Acme' },
      session: { userId: 'user-1' },
    });
    expect(created.map((c) => c.object)).toEqual(['sys_audit_log', 'sys_activity']);
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
      previous: { id: 'opp-1', name: 'Acme Renewal', stage: 'proposal' },
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
      previous: { id: 'opp-1', name: 'Acme Renewal', amount: 100, stage: 'proposal' },
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
      previous: { id: 'opp-1', name: 'Acme Renewal', stage: 'negotiation' },
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
      previous: { id: 'opp-1', name: 'Acme Renewal', stage: 'proposal' },
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

describe('audit writers — update diff hygiene (objectui detail-history report)', () => {
  // gantt_plan-shaped object: a formula helper alongside real fields. The diff
  // must not record a computed field as a change, whichever way the two sides
  // disagree. The contexts below keep the ORIGINAL asymmetry (`before` from the
  // query path carries the formula, `after` does not) because that is the shape
  // the objectui History tab reported — #5504 later made the real write path
  // hydrate `after` as well, and the exclusion is keyed on the field TYPE, so it
  // holds in both worlds.
  const SCHEMA = {
    sys_audit_log: SINGLE_TENANT.sys_audit_log,
    sys_activity: SINGLE_TENANT.sys_activity,
    gantt_plan: {
      id: { type: 'text' },
      name: { type: 'text', label: 'Name' },
      plan_start: { type: 'datetime', label: 'Plan Start' },
      deps_rendered: { type: 'formula', label: 'Deps (rendered)' },
    },
  };

  it('excludes computed (formula) fields from the update diff', async () => {
    const { engine, fire, created } = makeEngine(SCHEMA);
    installAuditWriters(engine as any, 'test.audit');

    await fire('afterUpdate', {
      object: 'gantt_plan',
      input: { id: 'p-1', plan_start: '2026-08-04T12:00:00.000Z' },
      // before: query-path snapshot carries the computed formula value…
      previous: { id: 'p-1', name: 'Plan C', plan_start: '2026-07-26T00:00:00.000Z', deps_rendered: ['LnLJIsTwXbv1E2gF'] },
      // …after: raw write result does not.
      result: { id: 'p-1', name: 'Plan C', plan_start: '2026-08-04T12:00:00.000Z' },
      session: { userId: 'user-1' },
    });

    const audit = created.find((c) => c.object === 'sys_audit_log');
    expect(audit).toBeDefined();
    const oldValue = JSON.parse(audit!.row.old_value);
    const newValue = JSON.parse(audit!.row.new_value);
    expect(newValue).toEqual({ plan_start: '2026-08-04T12:00:00.000Z' });
    expect(oldValue).toEqual({ plan_start: '2026-07-26T00:00:00.000Z' });
    expect('deps_rendered' in oldValue).toBe(false);
    expect('deps_rendered' in newValue).toBe(false);
  });

  it('writes NO audit row when only computed fields differ', async () => {
    const { engine, fire, created } = makeEngine(SCHEMA);
    installAuditWriters(engine as any, 'test.audit');

    await fire('afterUpdate', {
      object: 'gantt_plan',
      input: { id: 'p-1' },
      previous: { id: 'p-1', name: 'Plan C', deps_rendered: ['LnLJIsTwXbv1E2gF'] },
      result: { id: 'p-1', name: 'Plan C' },
      session: { userId: 'user-1' },
    });

    expect(created.find((c) => c.object === 'sys_audit_log')).toBeUndefined();
    expect(created.find((c) => c.object === 'sys_activity')).toBeUndefined();
  });

  it('treats an absent key (undefined) and an explicit null as equal — no noise row', async () => {
    const { engine, fire, created } = makeEngine(SCHEMA);
    installAuditWriters(engine as any, 'test.audit');

    await fire('afterUpdate', {
      object: 'gantt_plan',
      input: { id: 'p-1', plan_start: null },
      // `plan_start` key absent before, explicit null after: not a change.
      previous: { id: 'p-1', name: 'Plan C' },
      result: { id: 'p-1', name: 'Plan C', plan_start: null },
      session: { userId: 'user-1' },
    });

    expect(created.find((c) => c.object === 'sys_audit_log')).toBeUndefined();
  });

  it('still records a real transition to null (value cleared)', async () => {
    const { engine, fire, created } = makeEngine(SCHEMA);
    installAuditWriters(engine as any, 'test.audit');

    await fire('afterUpdate', {
      object: 'gantt_plan',
      input: { id: 'p-1', plan_start: null },
      previous: { id: 'p-1', name: 'Plan C', plan_start: '2026-07-26T00:00:00.000Z' },
      result: { id: 'p-1', name: 'Plan C', plan_start: null },
      session: { userId: 'user-1' },
    });

    const audit = created.find((c) => c.object === 'sys_audit_log');
    expect(JSON.parse(audit!.row.old_value)).toEqual({ plan_start: '2026-07-26T00:00:00.000Z' });
    expect(JSON.parse(audit!.row.new_value)).toEqual({ plan_start: null });
  });
});

// No timeout override: the cold-start cost that used to need one moved to this
// file's static imports (#4186). Every case here runs in ~1ms, so the default
// timeout is the honest bound — a case that exceeds it is a real hang.
describe('audit writers — localized activity summaries (framework#3039)', () => {
  // Real memory i18n (what the kernel registers as the 'i18n' fallback) loaded
  // with this plugin's shipped bundle plus an app-contributed object label —
  // exercises the actual key shapes (`messages.activityCreated`,
  // `objects.{name}.label`) end to end.
  function makeI18n() {
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
    const { fire, created } = setup('zh-CN', makeI18n());

    await fire('afterInsert', insertCtx());
    await fire('afterDelete', { ...insertCtx(), result: null, previous: { id: 'q-1', name: 'OC-00001' } });

    const summaries = created.filter((c) => c.object === 'sys_activity').map((c) => c.row.summary);
    expect(summaries).toEqual(['创建了 人员资质 "OC-00001"', '删除了 人员资质 "OC-00001"']);
  });

  it('localizes the generic update fallback', async () => {
    const { fire, created } = setup('zh-CN', makeI18n());
    await fire('afterUpdate', {
      ...insertCtx(),
      previous: { id: 'q-1', name: 'OC-00001', status: 'draft' },
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
      makeI18n(),
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
    const { fire, localeCalls } = setup('zh-CN', makeI18n());
    await fire('afterInsert', insertCtx());
    await fire('afterInsert', { ...insertCtx(), result: { id: 'q-2', name: 'OC-00002' } });
    expect(localeCalls()).toBe(1);
  });

  // Collaboration notification titles (assignment / @mention) are localized to
  // the RECIPIENT's locale with the same key shapes, and fall back to the
  // authored object label (not the API name) in English.
  function setupWithMessaging(
    locale: string | undefined,
    i18n: { t: Function } | undefined,
    objectDefs: Record<string, any> = {},
    schemas: Record<string, string[] | Record<string, any>> = SINGLE_TENANT,
  ) {
    const { engine, fire } = makeEngine(schemas, objectDefs);
    const emits: any[] = [];
    installAuditWriters(engine as any, 'test.audit', {
      getI18n: () => i18n as any,
      getLocale: async () => locale,
      getMessaging: () => ({
        emit: async (e: any) => {
          emits.push(e);
          return {};
        },
      }),
    });
    return { fire, emits };
  }

  it('localizes the @mention notification title to the recipient locale', async () => {
    const { fire, emits } = setupWithMessaging('zh-CN', makeI18n());
    await fire('afterInsert', {
      object: 'sys_comment',
      input: {},
      result: {
        id: 'c-1',
        thread_id: 'crm_lead:l-1',
        author_id: 'user-1',
        author_name: 'Alice',
        body: 'hello',
        mentions: '["user-2"]',
      },
      session: { tenantId: 'org-1', userId: 'user-1' },
    });
    const mention = emits.find((e) => e.topic === 'collab.mention');
    expect(mention).toBeDefined();
    expect(mention.audience).toEqual(['user-2']);
    expect(mention.payload.title).toBe('Alice 提到了你');
  });

  // framework#3403 — the kernel no longer emits assignment notifications from
  // owner/assignee field changes (that policy moved to user-space automation
  // flows). Setting owner_id must NOT produce a `collab.assignment` emit.
  it('does NOT emit an assignment notification when an owner field is set (framework#3403)', async () => {
    const { fire, emits } = setupWithMessaging(
      undefined,
      undefined,
      { crm_lead: { label: 'Lead' } },
      { ...SINGLE_TENANT, crm_lead: ['id', 'name', 'owner_id'] },
    );
    await fire('afterInsert', {
      object: 'crm_lead',
      input: { id: 'l-1' },
      result: { id: 'l-1', name: 'Acme', owner_id: 'user-2' },
      session: { tenantId: 'org-1', userId: 'user-1' },
    });
    expect(emits.find((e) => e.topic === 'collab.assignment')).toBeUndefined();
  });
});

/**
 * #5226 — a lost audit row is a DURABILITY degradation, so it is reported at
 * `error`, not `warn`.
 *
 * The `warn` this replaces is the exact #4420 shape one table over: the audited
 * write itself succeeds and returns 200, its row is on disk, and every counter
 * reads clean — only the compliance ledger entry that records WHO did it never
 * landed, and nothing retries it. By AGENTS.md's one question ("does the system
 * still look normal from the outside, while something it claims is persisted
 * has not actually landed?") that is `error`, and `pnpm check:durability-log-level`
 * now holds the level there (`persistAuditTrailRow` is in its vocabulary).
 *
 * The failure these tests inject is the real one from the #5226 repro: on a
 * `os dev --fresh` stack, ADR-0057 §3.6 routes `sys_audit_log` to the dedicated
 * `telemetry` datasource, so an audited write running inside a transaction on
 * the PRIMARY datasource reaches a connection where that table does not exist.
 * 50 of 52 audit inserts in that boot succeeded; the 2 that ran inside a
 * transaction raised exactly this SqliteError.
 */
describe('audit writers — a lost audit row is reported at error (#5226)', () => {
  interface LogLine { level: string; message: string; meta?: any }

  /** Engine whose `sys_audit_log` insert always fails, capturing every log line. */
  function makeFailingEngine(failWith = 'no such table: sys_audit_log') {
    const hooks = new Map<string, Array<(ctx: any) => any>>();
    const logs: LogLine[] = [];
    const sudoApi = {
      object(name: string) {
        return {
          async create(_row: Record<string, any>) {
            if (name === 'sys_audit_log') throw new Error(failWith);
            return { id: 'generated-id' };
          },
        };
      },
    };
    const api = { sudo: () => sudoApi };
    const engine = {
      getSchema(name: string) {
        const fields = (SINGLE_TENANT as Record<string, string[]>)[name];
        if (!fields) return undefined;
        return { name, fields: Object.fromEntries(fields.map((f) => [f, { type: 'text' }])) };
      },
      registerHook(event: string, fn: (ctx: any) => any) {
        const list = hooks.get(event) ?? [];
        list.push(fn);
        hooks.set(event, list);
      },
      unregisterHooksByPackage() { /* no-op */ },
      logger: {
        error(message: string, _err?: unknown, meta?: any) { logs.push({ level: 'error', message, meta }); },
        warn(message: string, meta?: any) { logs.push({ level: 'warn', message, meta }); },
        debug(message: string, meta?: any) { logs.push({ level: 'debug', message, meta }); },
        info() { /* unused */ },
      },
    };
    async function fire(event: string, ctx: any) {
      for (const fn of hooks.get(event) ?? []) await fn({ ...ctx, event, api });
    }
    return { engine, fire, logs };
  }

  const aWrite = (id: string) => ({
    object: 'crm_lead',
    input: { id },
    result: { id, name: 'Acme' },
    session: { tenantId: 'org-1', userId: 'user-1' },
  });

  it('logs at error — never warn — when the audit row cannot be written', async () => {
    const { engine, fire, logs } = makeFailingEngine();
    installAuditWriters(engine as any);

    await fire('afterInsert', aWrite('l-1'));

    // The whole point of the change: this used to be the ONLY line, at `warn`.
    expect(logs.filter((l) => l.level === 'warn')).toEqual([]);
    const errors = logs.filter((l) => l.level === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].meta).toMatchObject({ object: 'crm_lead', action: 'create' });
  });

  it('names both the CONSEQUENCE and the FIX in the first line it prints', async () => {
    const { engine, fire, logs } = makeFailingEngine();
    installAuditWriters(engine as any);

    await fire('afterInsert', aWrite('l-1'));

    const msg = logs.find((l) => l.level === 'error')!.message;
    // Consequence: the audited write SUCCEEDED, so nothing looks broken, while
    // the ledger entry is missing and nothing retries it.
    expect(msg).toMatch(/compliance trail is now INCOMPLETE/);
    expect(msg).toMatch(/SUCCEEDED/);
    expect(msg).toMatch(/nothing retries it/);
    // Fix: where the table actually lives, and the opt-out that collapses the split.
    expect(msg).toMatch(/telemetry/);
    expect(msg).toMatch(/OS_TELEMETRY_DB=0/);
  });

  it('says it ONCE, not once per failed write (AGENTS.md)', async () => {
    const { engine, fire, logs } = makeFailingEngine();
    installAuditWriters(engine as any);

    // An audit write runs on EVERY mutation, so a systemic cause would emit one
    // `error` per write and train everyone to skim the channel — the reflex
    // that made #4420's warn unreadable in the first place.
    for (const id of ['l-1', 'l-2', 'l-3', 'l-4', 'l-5']) {
      await fire('afterInsert', aWrite(id));
    }

    expect(logs.filter((l) => l.level === 'error')).toHaveLength(1);
    // The rest stay recoverable at a higher log level rather than vanishing.
    expect(logs.filter((l) => l.level === 'debug')).toHaveLength(4);
    expect(logs.filter((l) => l.level === 'warn')).toEqual([]);
  });

  it('never lets a logging failure break the audited write', async () => {
    const { engine, fire } = makeFailingEngine();
    // A logger that throws must not turn a swallowed audit failure into a
    // user-facing 500 — the audited write already succeeded.
    (engine as any).logger = { error() { throw new Error('logger exploded'); } };
    installAuditWriters(engine as any);

    await expect(fire('afterInsert', aWrite('l-1'))).resolves.toBeUndefined();
  });
});

/**
 * [#8707] Which organization an audit row is stamped with — the RECORD'S own,
 * honouring the maintainer's ruling on #8287.
 *
 * The precedence these cases pin is `recordOrgId ?? sess.tenantId`. Read the
 * pair together: the first four cases are the flip itself, the next three are
 * the RLS fallback the flip must not weaken (it is why the fallback exists at
 * all — an audit row with a NULL organization is hidden from everyone forever),
 * and the last three are the column-resolution rules, including the one
 * derivation that is deliberately NOT used.
 */
describe('audit writers — the record\'s own organization stamps the row (#8707, #8287)', () => {
  /** `sys_audit_log` / `sys_activity` with the tenant column, + one audited object. */
  const withObject = (fields: string[], defs: Record<string, any> = {}) => ({
    schemas: {
      ...MULTI_TENANT,
      crm_lead: ['id', 'name', ...fields],
    },
    defs,
  });

  const stampOf = (created: CapturedRow[]) => ({
    audit: created.find((c) => c.object === 'sys_audit_log')?.row,
    activity: created.find((c) => c.object === 'sys_activity')?.row,
  });

  it('stamps the record\'s organization, NOT the actor\'s active one', async () => {
    const { schemas } = withObject(['organization_id']);
    const { engine, fire, created } = makeEngine(schemas);
    installAuditWriters(engine as any, 'test.audit');

    // The geometry the card names: the actor is acting from org-B while the
    // record belongs to org-A. Before this change the row was stamped `org-B`,
    // so the tenant admin of org-A — the only party the row concerns — could
    // not read it, while org-B, which has no claim to the record, could.
    await fire('afterInsert', {
      object: 'crm_lead',
      input: { id: 'lead-1' },
      result: { id: 'lead-1', name: 'Acme', organization_id: 'org-A' },
      session: { tenantId: 'org-B', userId: 'user-1' },
    });

    const { audit, activity } = stampOf(created);
    expect(audit?.organization_id).toBe('org-A');
    expect(audit?.tenant_id).toBe('org-A');
    // The activity mirror is read through the same wall and must agree.
    expect(activity?.organization_id).toBe('org-A');
  });

  it('takes the record\'s organization from the pre-image on delete', async () => {
    const { schemas } = withObject(['organization_id']);
    const { engine, fire, created } = makeEngine(schemas);
    installAuditWriters(engine as any, 'test.audit');

    // A delete has no `result` row to read, so the org must come off the bound
    // pre-image — the side that carries the record's last known organization.
    await fire('afterDelete', {
      object: 'crm_lead',
      input: { id: 'lead-1' },
      result: true,
      previous: { id: 'lead-1', name: 'Acme', organization_id: 'org-A' },
      session: { tenantId: 'org-B', userId: 'user-1' },
    });

    expect(stampOf(created).audit?.organization_id).toBe('org-A');
  });

  it('stamps the record\'s organization on update too', async () => {
    const { schemas } = withObject(['organization_id']);
    const { engine, fire, created } = makeEngine(schemas);
    installAuditWriters(engine as any, 'test.audit');

    await fire('afterUpdate', {
      object: 'crm_lead',
      input: { id: 'lead-1' },
      previous: { id: 'lead-1', name: 'Acme', organization_id: 'org-A' },
      result: { id: 'lead-1', name: 'Acme Corp', organization_id: 'org-A' },
      session: { tenantId: 'org-B', userId: 'user-1' },
    });

    expect(stampOf(created).audit?.organization_id).toBe('org-A');
  });

  it('agrees with the session on the ordinary write, where both name one org', async () => {
    const { schemas } = withObject(['organization_id']);
    const { engine, fire, created } = makeEngine(schemas);
    installAuditWriters(engine as any, 'test.audit');

    // The overwhelming majority of writes, and the case the `isolated` posture
    // makes structural: Layer 0 (`organization_id = activeOrganizationId`)
    // cannot be satisfied by a cross-org write, so the two sides agree by
    // construction and the flip is a no-op.
    await fire('afterInsert', {
      object: 'crm_lead',
      input: { id: 'lead-1' },
      result: { id: 'lead-1', name: 'Acme', organization_id: 'org-A' },
      session: { tenantId: 'org-A', userId: 'user-1' },
    });

    expect(stampOf(created).audit?.organization_id).toBe('org-A');
  });

  // ── the RLS fallback the flip must not weaken ──────────────────────────

  it('falls back to the session tenant when the record carries no organization', async () => {
    const { schemas } = withObject(['organization_id']);
    const { engine, fire, created } = makeEngine(schemas);
    installAuditWriters(engine as any, 'test.audit');

    // A NULL organization column must never reach the row: the SecurityPlugin's
    // RLS predicate then hides the audit row from everyone, permanently.
    await fire('afterInsert', {
      object: 'crm_lead',
      input: { id: 'lead-1' },
      result: { id: 'lead-1', name: 'Acme', organization_id: null },
      session: { tenantId: 'org-B', userId: 'user-1' },
    });

    expect(stampOf(created).audit?.organization_id).toBe('org-B');
  });

  it('falls back to the session tenant when the object has no organization column', async () => {
    const { schemas } = withObject([]);
    const { engine, fire, created } = makeEngine(schemas);
    installAuditWriters(engine as any, 'test.audit');

    await fire('afterInsert', {
      object: 'crm_lead',
      input: { id: 'lead-1' },
      result: { id: 'lead-1', name: 'Acme' },
      session: { tenantId: 'org-B', userId: 'user-1' },
    });

    expect(stampOf(created).audit?.organization_id).toBe('org-B');
  });

  it('still uses the record\'s organization when the session carries no tenant', async () => {
    const { schemas } = withObject(['organization_id']);
    const { engine, fire, created } = makeEngine(schemas);
    installAuditWriters(engine as any, 'test.audit');

    // The two cases the fallback was originally written for — a background job
    // or sudo path with no `tenantId`, and better-auth's `activeOrganizationId`
    // cache miss right after sign-in. Behaviour here is byte-identical to
    // before the flip: those sessions carry no tenant either way.
    await fire('afterInsert', {
      object: 'crm_lead',
      input: { id: 'lead-1' },
      result: { id: 'lead-1', name: 'Acme', organization_id: 'org-A' },
      session: {},
    });

    expect(stampOf(created).audit?.organization_id).toBe('org-A');
  });

  // ── which column carries the organization ──────────────────────────────

  it('leaves an ADR-0066 platform-global object on the actor\'s organization', async () => {
    const { schemas } = withObject(['organization_id'], {});
    const { engine, fire, created } = makeEngine(schemas, {
      crm_lead: { tenancy: { enabled: false } },
    });
    installAuditWriters(engine as any, 'test.audit');

    // `tenancy.enabled: false` (e.g. `sys_sso_provider`) keeps an optional org
    // FK while explicitly NOT being tenant-scoped. Stamping the audit row from
    // that FK would scope a global object's trail into one organization and
    // hide it from the platform admin who acted — strictly LESS visible than
    // before the flip, which is the one outcome the flip must not produce.
    await fire('afterInsert', {
      object: 'crm_lead',
      input: { id: 'lead-1' },
      result: { id: 'lead-1', name: 'Acme', organization_id: 'org-A' },
      session: { tenantId: 'org-B', userId: 'user-1' },
    });

    expect(stampOf(created).audit?.organization_id).toBe('org-B');
  });

  it('honours a declared `tenancy.tenantField`, and only when the field exists', async () => {
    const { schemas } = withObject(['workspace_id']);
    const { engine, fire, created } = makeEngine(schemas, {
      crm_lead: { tenancy: { enabled: true, tenantField: 'workspace_id' } },
    });
    installAuditWriters(engine as any, 'test.audit');

    await fire('afterInsert', {
      object: 'crm_lead',
      input: { id: 'lead-1' },
      result: { id: 'lead-1', name: 'Acme', workspace_id: 'ws-1' },
      session: { tenantId: 'org-B', userId: 'user-1' },
    });
    expect(stampOf(created).audit?.organization_id).toBe('ws-1');

    // A declared name pointing at a column the object does not have falls
    // through to the canonical one — the same guard `computeTenantField`
    // applies (#5315), rather than resolving to nothing.
    const missing = makeEngine(
      { ...MULTI_TENANT, crm_lead: ['id', 'name', 'organization_id'] },
      { crm_lead: { tenancy: { enabled: true, tenantField: 'workspace_id' } } },
    );
    installAuditWriters(missing.engine as any, 'test.audit');
    await missing.fire('afterInsert', {
      object: 'crm_lead',
      input: { id: 'lead-1' },
      result: { id: 'lead-1', name: 'Acme', organization_id: 'org-A' },
      session: { tenantId: 'org-B', userId: 'user-1' },
    });
    expect(stampOf(missing.created).audit?.organization_id).toBe('org-A');
  });

  it('⛔ never reads a `sys_organization` lookup that is not the tenant column', async () => {
    const { engine, fire, created } = makeEngine({
      ...MULTI_TENANT,
      // `sys_organization` as it really ships: no `organization_id` of its own,
      // and exactly ONE lookup to `sys_organization` — `parent_organization_id`.
      sys_organization: ['id', 'name', 'parent_organization_id'],
    });
    installAuditWriters(engine as any, 'test.audit');

    // This is why the writer resolves the column from the tenancy declaration
    // instead of scanning for "a lookup whose reference is sys_organization":
    // that scan would stamp every organization's audit rows with its PARENT's
    // id, hiding them from the very tenant they concern. It would also read
    // `parent_organization_id` for a visibility decision — an ADR-0105 D6 red
    // line that `validateOrgAxisRedLines` makes a build error for RLS policies,
    // sharing rules and scopes.
    await fire('afterUpdate', {
      object: 'sys_organization',
      input: { id: 'org-self' },
      previous: { id: 'org-self', name: 'Sub', parent_organization_id: 'org-parent' },
      result: { id: 'org-self', name: 'Subsidiary', parent_organization_id: 'org-parent' },
      session: { tenantId: 'org-self', userId: 'user-1' },
    });

    expect(stampOf(created).audit?.organization_id).toBe('org-self');
    expect(stampOf(created).audit?.organization_id).not.toBe('org-parent');
  });

  it('⛔ KNOWN GAP — `sys_api_key.active_organization_id` is still unreachable', async () => {
    const { engine, fire, created } = makeEngine({
      ...MULTI_TENANT,
      // As it really ships since #8287: no `organization_id` (better-auth
      // managed tables get no injected system columns), and the org the key
      // authenticates into under a deliberately different name.
      sys_api_key: ['id', 'name', 'user_id', 'active_organization_id', 'revoked'],
    });
    installAuditWriters(engine as any, 'test.audit');

    // The card's repro: revoking a key whose organization differs from the
    // revoker's active one. The precedence above is now correct, but the column
    // is not resolvable — `active_organization_id` is NOT this object's
    // tenant-scope column and must not be declared as one (`tenancy.tenantField`
    // feeds `applyTenantScope` / `injectTenantOnInsert`, so declaring it would
    // wall the credential table on an equality that excludes NULL and make
    // pre-#8287 keys vanish from their own owner's list — the defect #8287
    // exists to have removed).
    //
    // ⚠️ This case pins the REMAINING HALF of #8707, not a decision. It must go
    // red — and be rewritten to expect `org-key` — on the day a read-neutral,
    // stamp-only organization declaration lands in `packages/spec`.
    await fire('afterUpdate', {
      object: 'sys_api_key',
      input: { id: 'key-1' },
      previous: { id: 'key-1', name: 'ci', active_organization_id: 'org-key', revoked: false },
      result: { id: 'key-1', name: 'ci', active_organization_id: 'org-key', revoked: true },
      session: { tenantId: 'org-actor', userId: 'user-1' },
    });

    expect(stampOf(created).audit?.organization_id).toBe('org-actor');
  });
});
