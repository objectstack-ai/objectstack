// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_metadata_activation — the packaged-metadata ACTIVATION LEDGER
 * (ADR-0126 §4, decision D2).
 *
 * The disable+clone family shares **one data-plane platform object**. A row
 * here says one thing about one packaged artifact: is it armed. Absence of a
 * row means the packaged default — **active** — so an empty ledger changes
 * nothing anywhere, which is the property that lets this declaration land
 * before any consumer exists.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  What this object is NOT (ADR-0126 §4, verbatim posture):
 *
 *  • ⛔ **Not a definition store.** `sys_metadata` remains the sole definition
 *    ledger. This table holds a boolean per artifact and nothing else — never
 *    fields, nodes, grants, or any fragment of an artifact body. The recorded
 *    grounds are the #6190 phantom-overlay wall and the upgrade-vs-choice
 *    separation (ADR-0126 §6).
 *
 *  • ⛔ **Not a metadata type.** It is an ordinary platform object with
 *    ordinary rows and an ordinary read path — declared here beside its
 *    data-plane siblings, so it needs **zero `packages/spec` surface**. The
 *    #11513 deactivation carve-out (row state is not a customization of the
 *    definition, #4669) is the precedent validating this plane split.
 *
 *  • **Not a central interceptor.** Consult points stay per-runtime: the
 *    automation engine consults it in `execute()` beside the existing
 *    `FLOW_DISABLED` guard; the permission projection keeps its own row-state
 *    door until convergence (ADR-0126 §8). Each consumer documents its own
 *    consult point; this ledger imposes no global dispatch layer.
 *
 *  • ⛔ **No designation linkage.** An earlier ADR-0126 draft carried
 *    `replaced_by` / `cloned_from`; amendment ruling 2 removed them
 *    (「行为类 能否搞一个启用停用的功能，我不想要可以停用，然后克隆一个。」).
 *    There is **no recorded link** between a clone and its base — matching the
 *    landed #11513 posture ("an ordinary org-owned set with no upgrade
 *    linkage"). Do not re-add them.
 * ─────────────────────────────────────────────────────────────────────
 *
 * Row identity: one row per `(metadata_type, name, organization_id)`, spelled
 * as the declared `unique: 'organization'` index below — see the comment there
 * for why that spelling, and not a hand-written composite, is what makes the
 * NULL-organization rows this line writes actually unique.
 *
 * Lifecycle: **no `lifecycle` block on purpose.** The absent block is the
 * back-compat `record` class — durable, never swept. This is not telemetry
 * like its `sys_flow_dispatch` / `sys_automation_run` siblings: a row is
 * durable configuration, and reaping one would silently re-arm an artifact an
 * administrator disabled. A retention policy here would be a data-loss bug,
 * not a tuning knob.
 *
 * Writers: the enable/disable actions (ADR-0126 L2/L3 — **not this leg**; no
 * writer sets any column here yet, and `organization_id` in particular stays
 * NULL on this whole line). Readers: each runtime's own consult point.
 *
 * @namespace sys
 */
export const SysMetadataActivation = ObjectSchema.create({
  name: 'sys_metadata_activation',
  label: 'Metadata Activation',
  pluralLabel: 'Metadata Activations',
  icon: 'badge-check',
  isSystem: true,
  managedBy: 'engine-owned',
  description:
    'Activation ledger for packaged metadata artifacts (ADR-0126 §4): one row per packaged artifact whose armed state has been changed from the packaged default. No row means the packaged default — active.',
  displayNameField: 'name',
  nameField: 'name', // [ADR-0079] canonical primary-title pointer (mirrors deprecated displayNameField)
  highlightFields: ['metadata_type', 'name', 'package_id', 'active'],

  fields: {
    // The primary key. Provisioned by the driver on every physical table
    // regardless of this declaration (`resolveInjectedSystemColumns` reports
    // it unconditionally); declared here to match every data-plane sibling.
    id: Field.text({ label: 'ID', required: true, readonly: true, group: 'System' }),

    metadata_type: Field.text({
      label: 'Metadata Type',
      required: true,
      searchable: true,
      maxLength: 100,
      description: "The artifact's registry type ('flow', 'permission', …).",
      group: 'Identity',
    }),

    name: Field.text({
      label: 'Name',
      required: true,
      searchable: true,
      maxLength: 255,
      description: "The packaged artifact's machine name.",
      group: 'Identity',
    }),

    package_id: Field.text({
      label: 'Package',
      required: true,
      maxLength: 255,
      description: 'The package that ships the base artifact.',
      group: 'Identity',
    }),

    // ADR-0126 §4: **nullable — reserved**. NULL on this whole line (the row
    // is install-level, §5); the per-org dimension is an additive column
    // later, never a redesign. It is declared rather than left to injection so
    // the row identity below can name it and so the column is visible to
    // author-time readers of `fields` — the sibling idiom
    // (`sys_metadata_history`, `sys_automation_run`).
    organization_id: Field.lookup('sys_organization', {
      label: 'Organization',
      required: false,
      group: 'System',
      description:
        'Reserved for the per-organization activation dimension (ADR-0126 §5). NULL on every row this line writes — no writer sets it yet.',
    }),

    active: Field.boolean({
      label: 'Active',
      defaultValue: true,
      description: 'Is the packaged artifact armed for this scope.',
      group: 'State',
    }),
  },

  indexes: [
    // ADR-0126 §4 row identity: one row per
    // `(metadata_type, name, organization_id NULL-collapsed)`.
    //
    // ⛔ NOT a hand-written `{ fields: ['metadata_type', 'name', 'organization_id'] }`
    // composite, and ⛔ not bare `unique: true`. Both spell the wrong thing here:
    //
    //   - bare `true` on a DECLARED index is the positional spelling of
    //     `'global'` (ADR-0120 D1) — installation-wide over exactly the listed
    //     columns — and is warned by lint `unique/unscoped-declared-index` in
    //     17.x, rejected at protocol 18.
    //   - a hand-written composite naming `organization_id` verbatim is
    //     NULL-DISTINCT in SQL, so on this line — where the column is NULL on
    //     every row by construction — it would enforce **nothing at all**
    //     (#5030, measured). A ledger whose row identity is void would let one
    //     artifact carry two contradictory `active` rows.
    //
    // `'organization'` is the arm that closes exactly that hole: the driver
    // prepends the tenant column in its NULL-safe form,
    // `COALESCE(organization_id, '__global__')` (ADR-0120 D3), which IS the
    // "NULL-collapsed" of the ADR-0126 §4 sentence.
    { fields: ['metadata_type', 'name'], unique: 'organization' },
  ],

  enable: {
    // [ADR-0103] Engine-owned: written only by the ADR-0126 enable/disable
    // actions under a system context, never via the generic data API. Reads
    // stay open so operability surfaces can answer "what is disabled here?".
    apiMethods: ['get', 'list'],
  },
});
