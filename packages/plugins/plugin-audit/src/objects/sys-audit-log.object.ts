// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_audit_log — System Audit Log Object
 *
 * Immutable audit trail for all significant platform events.
 * Records who did what, when, and the before/after state.
 *
 * Every field is `readonly: true` — audit logs are written only by
 * internal system hooks, never via UI forms. API exposes only `get` + `list`.
 *
 * @namespace sys
 */
export const SysAuditLog = ObjectSchema.create({
  name: 'sys_audit_log',
  label: 'Audit Log',
  pluralLabel: 'Audit Logs',
  icon: 'scroll-text',
  isSystem: true,
  managedBy: 'append-only',
  // ADR-0057: compliance ledger — retain hot 90d, then archive-then-delete.
  // The LifecycleService NEVER hot-deletes rows with `archive` declared until
  // the archive copy succeeded; deployments without an 'archive' datasource
  // simply retain everything (today's behavior).
  lifecycle: {
    class: 'audit',
    retention: { maxAge: '90d' },
    archive: { after: '90d', to: 'archive', keep: '7y' },
  },
  description: 'Immutable audit trail for platform events',
  displayNameField: 'action',
  nameField: 'action', // [ADR-0079] canonical primary-title pointer (mirrors deprecated displayNameField)
  titleFormat: '{action} · {object_name}',
  highlightFields: ['created_at', 'action', 'object_name', 'record_id', 'user_id'],

  listViews: {
    recent: {
      type: 'grid',
      name: 'recent',
      label: 'Recent',
      data: { provider: 'object', object: 'sys_audit_log' },
      columns: ['created_at', 'action', 'object_name', 'record_id', 'user_id'],
      sort: [{ field: 'created_at', order: 'desc' }],
      pagination: { pageSize: 50 },
      emptyState: { title: 'No audit events', message: 'Activity will appear here as users interact with the platform.' },
    },
    writes_only: {
      type: 'grid',
      name: 'writes_only',
      label: 'Writes',
      data: { provider: 'object', object: 'sys_audit_log' },
      columns: ['created_at', 'action', 'object_name', 'record_id', 'user_id'],
      // `restore` removed (#8315): the value is retired from the enum, so the
      // filter would have matched nothing for the rest of time. The three that
      // remain are exactly what `actionFor()` in `audit-writers.ts` can emit.
      filter: [{ field: 'action', operator: 'in', value: ['create', 'update', 'delete'] }],
      sort: [{ field: 'created_at', order: 'desc' }],
      pagination: { pageSize: 50 },
    },
    auth_events: {
      type: 'grid',
      name: 'auth_events',
      label: 'Auth',
      data: { provider: 'object', object: 'sys_audit_log' },
      columns: ['created_at', 'action', 'user_id'],
      // `permission_change` removed (#8147): the value is retired from the enum,
      // so the filter would have matched nothing for the rest of time. Permission
      // object writes are already on the ledger as ordinary create/update rows.
      filter: [{ field: 'action', operator: 'in', value: ['login', 'logout'] }],
      sort: [{ field: 'created_at', order: 'desc' }],
      pagination: { pageSize: 50 },
    },
    // [#8992] The `read` action's shipped surface. A ledger value with no view
    // is half of the empty-widget defect the 2026-08-12 ruling named; this card
    // adds the action and the screen that answers its question in one stroke.
    // `record_views` is the "who viewed this record" query as a list: actor
    // first, because that is the column an auditor scans.
    //
    // [#9539, maintainer ruling 2026-08-18 + triage auto-adjudication
    // 2026-08-19, both Option 1] `ip_address` was dropped from this column
    // list: `buildRow` in `read-audit.ts` never stamps it (client-fingerprint
    // fields are populated on auth events only — see the README), so on every
    // `read` row this column could ever show, it was structurally empty. On a
    // compliance screen a blank cell reads as "captured, and none" rather than
    // "not captured" — 审计面宁窄勿谎, the same principle #7675/#8147/#8315
    // applied to enum values, one layer down on a column. Replaced with
    // `actor`, which the read writer DOES stamp on every row and which is the
    // one column that attributes a service principal (`svc:<name>`) rather
    // than just falling back to a null `user_id`. Pinned by
    // `sys-audit-log-record-views-columns.test.ts`: this view's columns must
    // stay a subset of the read writer's actually-stamped key set.
    record_views: {
      type: 'grid',
      name: 'record_views',
      label: 'Record Views',
      data: { provider: 'object', object: 'sys_audit_log' },
      columns: ['created_at', 'user_id', 'object_name', 'record_id', 'actor'],
      filter: [{ field: 'action', operator: 'in', value: ['read'] }],
      sort: [{ field: 'created_at', order: 'desc' }],
      pagination: { pageSize: 50 },
      emptyState: {
        title: 'No record views recorded',
        message:
          'Record-view auditing is opt-in per object. Rows appear here once an object is added to the audit '
          + "plugin's readAudit.objects list and someone opens one of its records.",
      },
    },
    config_changes: {
      type: 'grid',
      name: 'config_changes',
      label: 'Config',
      data: { provider: 'object', object: 'sys_audit_log' },
      columns: ['created_at', 'action', 'object_name', 'user_id'],
      // `export` removed (#8147) — retired from the enum, nothing ever wrote it.
      // `import` KEPT deliberately: `plugin-auth`'s admin user-import writes a
      // real run-level row (`admin-import-users.ts`, `action: 'import'` with
      // `record_id: null`), pinned by the W4 case in
      // `packages/qa/dogfood/test/admin-identity-audit-trail.dogfood.test.ts`.
      // This view is the only shipped surface that lists those rows.
      filter: [{ field: 'action', operator: 'in', value: ['config_change', 'import'] }],
      sort: [{ field: 'created_at', order: 'desc' }],
      pagination: { pageSize: 50 },
    },
    all_events: {
      type: 'grid',
      name: 'all_events',
      label: 'All',
      data: { provider: 'object', object: 'sys_audit_log' },
      columns: ['created_at', 'action', 'object_name', 'record_id', 'user_id'],
      sort: [{ field: 'created_at', order: 'desc' }],
      pagination: { pageSize: 100 },
    },
  },

  fields: {
    // ── Event ────────────────────────────────────────────────────
    created_at: Field.datetime({
      label: 'Timestamp',
      required: true,
      defaultValue: 'NOW()',
      readonly: true,
      group: 'Event',
    }),

    // ADR-0087 retirement (#8147, ruling 2026-08-12): `export` and
    // `permission_change` left this enum. Neither had a writer anywhere in the
    // repo — the only two `sys_audit_log` writers are `audit-writers.ts` (whose
    // `actionFor` emits create/update/delete and nothing else) and
    // `plugin-auth`'s admin user-import. A declared action nothing ever writes
    // is an empty widget and a filter that can never match: 审计面宁窄勿谎.
    // Permission-object writes are already on the ledger as create/update rows.
    //
    // ADR-0087 retirement (#8315, the same ruling carried by triage): `restore`
    // left this enum for the same reason and by the same measurement. It was
    // never a near-miss — `actionFor()` in `audit-writers.ts` returns
    // `'create' | 'update' | 'delete' | null`, so the record-level writer
    // STRUCTURALLY cannot produce it, and no other writer in the repo emits it
    // either. ⚠ This is not a product stance against undelete: soft
    // delete/restore is an unbuilt capability parked on #1883 (`pm:on-hold`)
    // and #3146 (`status:parked`). If it lands, this value returns WITH its
    // writer — the emission point, its tests, and the view that surfaces it —
    // never as a bare enum row again.
    //
    // ⚠ `import` was named in the same ruling but is NOT retired: it has a live,
    // deliberate writer (`plugin-auth/src/admin-import-users.ts`, run-level row
    // with `record_id: null`) pinned by dogfood case W4. Retiring it would make
    // this enum deny a value the platform writes on every admin import run —
    // and silently, because every field here is `readonly: true` and
    // `validateRecord` skips readonly fields, so nothing would ever go red.
    // See #8147 for the escalation.
    // [#8992, maintainer ruling 2026-08-16] `read` joins the enum WRITER-FIRST,
    // which is the only way a value is allowed back onto this surface (the
    // docblock in `sys-audit-log-retired-actions.test.ts` states the rule and
    // the pin enforces it). Its writer is `read-audit.ts`'s `afterFind` hook,
    // its shipped surface is the `record_views` list view above, and both
    // landed in the same PR as this line. Scope is the ruling's MVP:
    // record-detail views on per-object opt-in, batched off the request path —
    // so a deployment that opts nothing in never writes one, and the value is
    // narrow rather than absent (审计面宁窄勿谎).
    action: Field.select(
      ['create', 'read', 'update', 'delete', 'login', 'logout', 'config_change', 'import'],
      {
        label: 'Action',
        required: true,
        readonly: true,
        searchable: true,
        description: 'Action type (snake_case)',
        group: 'Event',
      },
    ),

    user_id: Field.lookup('sys_user', {
      label: 'User',
      required: false,
      readonly: true,
      searchable: true,
      description: 'User who performed the action (null for non-user / service actions — see actor)',
      group: 'Event',
    }),

    // First-class principal label, independent of the sys_user lookup. Records
    // WHO acted even when there is no real user row: a user id, a service-token
    // principal (`svc:<name>`), or null/'system'. `user_id` stays a strict
    // sys_user lookup (a service principal can't be stuffed there), so this is
    // the field that makes service-token writes attributable (ADR-0014 D2).
    actor: Field.text({
      label: 'Actor',
      required: false,
      readonly: true,
      searchable: true,
      maxLength: 255,
      description: 'Principal that performed the action: a user id, svc:<name>, or null',
      group: 'Event',
    }),

    // ── Target record ────────────────────────────────────────────
    object_name: Field.text({
      label: 'Object',
      required: false,
      readonly: true,
      searchable: true,
      maxLength: 255,
      description: 'Target object (e.g. sys_user, project_task)',
      group: 'Target',
    }),

    record_id: Field.text({
      label: 'Record ID',
      required: false,
      readonly: true,
      searchable: true,
      description: 'ID of the affected record',
      group: 'Target',
    }),

    // ── Change payload ───────────────────────────────────────────
    old_value: Field.textarea({
      label: 'Old Value',
      required: false,
      readonly: true,
      description: 'JSON-serialized previous state',
      group: 'Changes',
    }),

    new_value: Field.textarea({
      label: 'New Value',
      required: false,
      readonly: true,
      description: 'JSON-serialized new state',
      group: 'Changes',
    }),

    // ── Client fingerprint ───────────────────────────────────────
    ip_address: Field.text({
      label: 'IP Address',
      required: false,
      readonly: true,
      maxLength: 45,
      group: 'Client',
    }),

    user_agent: Field.textarea({
      label: 'User Agent',
      required: false,
      readonly: true,
      group: 'Client',
    }),

    // ── Context ──────────────────────────────────────────────────
    tenant_id: Field.lookup('sys_organization', {
      label: 'Tenant',
      required: false,
      readonly: true,
      description: 'Tenant context for multi-tenant isolation',
      group: 'Context',
    }),

    metadata: Field.textarea({
      label: 'Metadata',
      required: false,
      readonly: true,
      description: 'JSON-serialized additional context',
      group: 'Context',
    }),

    // ── System ───────────────────────────────────────────────────
    id: Field.text({
      label: 'Audit Log ID',
      required: true,
      readonly: true,
      group: 'System',
    }),
  },

  indexes: [
    { fields: ['created_at'] },
    { fields: ['user_id'] },
    { fields: ['object_name', 'record_id'] },
    { fields: ['action'] },
    { fields: ['tenant_id'] },
  ],

  enable: {
    trackHistory: false, // Audit logs are themselves the audit trail
    searchable: true,
    apiEnabled: true,
    apiMethods: ['get', 'list'], // Read-only — creation happens via internal system hooks only
    clone: false,
  },
});
