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
 *    deactivation carve-out of commit e170b0ae5 (row state is not a customization of the
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
 *    landed posture of commit e170b0ae5 ("an ordinary org-owned set with no upgrade
 *    linkage"). Do not re-add them.
 * ─────────────────────────────────────────────────────────────────────
 *
 * Row identity: one row per `(metadata_type, package_id, name)`, spelled as
 * the declared `unique: 'global'` index below (ADR-0150 D4, D8 row R4): two
 * packages may each hold a row for an item of the same name. There is no tenant
 * key part, because there is no tenant column on this table — see
 * `systemFields` for why.
 *
 * Lifecycle: **no `lifecycle` block on purpose.** The absent block is the
 * back-compat `record` class — durable, never swept. This is not telemetry
 * like its `sys_flow_dispatch` / `sys_automation_run` siblings: a row is
 * durable configuration, and reaping one would silently re-arm an artifact an
 * administrator disabled. A retention policy here would be a data-loss bug,
 * not a tuning knob.
 *
 * Writers: the enable/disable actions (ADR-0126 L2/L3). Readers: each runtime's
 * own consult point.
 *
 * Packaged and environment-authored: flows and actions reach this ledger only
 * when a package ships them, but the security catalog's activation door
 * (`POST /security/_activation/:type/:name`) switches every position and
 * permission set the catalog holds, the environment's own included — so
 * `package_id` is empty for those (see the field).
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
  // ADR-0126 §4 — the reference lives in the docblock above, not in the copy.
  description:
    'Activation ledger for metadata artifacts: one row per artifact whose armed state has been changed from its default. No row means the default — active. Packaged artifacts and positions or permission sets authored in this system are both recorded here.',
  displayNameField: 'name',
  nameField: 'name', // [ADR-0079] canonical primary-title pointer (mirrors deprecated displayNameField)
  highlightFields: ['metadata_type', 'name', 'package_id', 'active'],

  // ⛔ NO tenant column on this table, and this key is what keeps it off.
  //
  // (The platform's tenant-scope column is named in words throughout this file
  // rather than spelled literally, so that grepping this object for that column
  // returns nothing — the absence is the contract, and it should be checkable
  // by the same one-line grep an auditor would reach for.)
  //
  // A row here is DEPLOYMENT-level state — "this environment switched this
  // managed item off" — owned by no organization. The tenant column is not
  // merely unused here: there is no scope for it to name. It would be
  // provisioned by INJECTION even with no field declared for it
  // (`resolveInjectedSystemColumns` injects the tenant anchor unless an object
  // opts out), so deleting a declaration alone would leave the column exactly
  // where it was. `systemFields.tenant: false` is the opt-out that actually
  // removes it, and it is the minimal one: it speaks about column injection,
  // which is the thing being decided here.
  //
  // ⚠️ NOT `tenancy: { enabled: false }`, though it too suppresses the column.
  // That key is the ADR-0066 D2 platform-global POSTURE, and it is what the
  // sibling `sys_sso_provider` uses for the opposite shape — a table that KEEPS
  // its tenant column (better-auth writes it unstamped) and needs the wall over
  // it stood down. Here there is no column to wall, so the posture declaration
  // would assert something broader than the fact.
  //
  // Both spellings do reach `plugin-security`'s `tenancyDisabled`, and that is
  // REQUIRED rather than incidental: a Layer 0 tenant wall composing
  // "tenant column equals the caller's organization" over a table with no such
  // column denies every row. What only `tenancy.enabled` additionally reaches
  // is the spec's `isTenancyDisabled` — driver native scoping, the sticky
  // per-table opt-out record — which this table does not need, because with no
  // column the driver's `computeTenantField` already resolves to `null` on its
  // own.
  systemFields: { tenant: false },

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
      description: "The artifact's registry type ('flow', 'action', 'position', 'permission', 'sharing_rule', 'webhook', 'queue', 'assignment_rule').",
      group: 'Identity',
    }),

    name: Field.text({
      label: 'Name',
      required: true,
      searchable: true,
      maxLength: 255,
      description: "The artifact's machine name.",
      group: 'Identity',
    }),

    // Part of the row identity (ADR-0150 D4: the index below is
    // `(metadata_type, package_id, name)`), and the package half of an item's
    // address (ADR-0126 §4's two facts, two columns: ⛔ never a re-encoded
    // `package:name` literal in `name`). No consumer decides anything from it
    // yet: every reader keys a row by type and name until its own type's
    // ADR-0150 child moves it onto the package. It is empty exactly when there
    // is no package to record — a position or permission set the environment
    // authored through the metadata door, which the security catalog's
    // activation door switches as well (#22621 → A). The writer
    // (`ObjectStoreMetadataActivationStore`) stores NO value for such an item
    // and refuses an empty string, so a package-less row has one spelling and
    // can never be read as a package named ''. A row written before the key
    // carried the package is bound to its item's one holder by the boot's
    // backfill (`backfillActivationLedgerPackages`), which never guesses.
    package_id: Field.text({
      label: 'Package',
      maxLength: 255,
      description:
        'The package that ships the artifact. Empty when no package ships it: an item authored in this system.',
      group: 'Identity',
    }),

    active: Field.boolean({
      label: 'Active',
      defaultValue: true,
      description: 'Is the artifact armed for this scope.',
      group: 'State',
    }),
  },

  indexes: [
    // ADR-0126 §4 row identity with the package coordinate (ADR-0150 D4, D8
    // row R4): one row per `(metadata_type, package_id, name)`,
    // installation-wide. It was `(metadata_type, name)`; adding the package
    // relaxes the key, so the new index cannot fail on rows the old one held.
    //
    // ⚠️ NULL-distinct: SQL `UNIQUE` exempts a row whose key part is NULL, and
    // the memory driver follows SQL. An environment-authored item's row has a
    // NULL `package_id`, so for those rows this index constrains nothing; the
    // one-row property rests on the ledger's single writer, which reads by
    // `(metadata_type, name)` before it inserts (`metadata-activation-store.ts`).
    //
    // ⛔ Not bare `unique: true`. On a DECLARED index that is the positional
    // spelling of `'global'` (ADR-0120 D1) — the same materialized shape, but
    // with the scope left unstated, which lint warns on
    // (`unique/unscoped-declared-index`) and protocol 18 rejects. `'global'` is
    // the same intent, said out loud.
    //
    // Before that it read `unique: 'organization'`, which asked the driver to
    // prepend the tenant column in its NULL-safe `COALESCE(…, '__global__')`
    // form (ADR-0120 D3) so that an all-NULL tenant column could not void the
    // constraint — a hand-written composite naming that column verbatim would
    // have been NULL-DISTINCT in SQL and enforced nothing at all (#5030,
    // measured). With the tenant column gone that respelling changed no DDL
    // (`normalizeDeclaredIndex` prepends the tenant part only when the table
    // has one). ⛔ Never `'organization'` here: there is no organization scope
    // on this table to state.
    { fields: ['metadata_type', 'package_id', 'name'], unique: 'global' },
  ],

  enable: {
    // [ADR-0103] Engine-owned: written only by the ADR-0126 enable/disable
    // actions under a system context, never via the generic data API. Reads
    // stay open so operability surfaces can answer "what is disabled here?".
    apiMethods: ['get', 'list'],
  },
});
