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
function makeEngine(schemas: Record<string, string[] | Record<string, any>>) {
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
      return { name, fields: fieldMap };
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
  sys_audit_log: ['id', 'action', 'user_id', 'object_name', 'record_id', 'old_value', 'new_value', 'tenant_id'],
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
