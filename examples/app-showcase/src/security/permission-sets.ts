// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Permission sets — the CAPABILITY layer of the ADR-0090 permission model.
 *
 * A user's capability is the UNION of every set they hold (additive only —
 * to withhold, don't grant; there are no subtraction sets). Together these
 * sets exercise the full authoring surface:
 *
 *   • object CRUD + field-level security (FLS) + row-level security (RLS)
 *     — `showcase_contributor`
 *   • scope DEPTH (`readScope`/`writeScope`, ADR-0057 D1; the open-edition
 *     dials `own`/`org` — hierarchy depths are enterprise) —
 *     `showcase_manager`, `showcase_executive`
 *   • View/Modify-All bypass (VAMA) — `showcase_auditor`, `showcase_ops`
 *   • system permissions (platform capabilities) — `showcase_ops`
 *   • the `everyone` baseline suggestion (`isDefault`, ADR-0090 D5) —
 *     `showcase_member_default`
 *   • guest-safe capability for the `guest` anchor (ADR-0090 D9) —
 *     `showcase_guest_portal`
 *   • delegated administration (`adminScope`, ADR-0090 D12) —
 *     `showcase_field_ops_delegate`
 *
 * DEPTH vs VAMA, in one line: depth widens a grant along the org geometry
 * (BU tree + manager chain) and still flows through sharing/RLS; VAMA
 * bypasses record-level checks outright and is therefore high-privilege
 * (lint-blocked on `everyone`/`guest` bindings).
 */

import { definePermissionSet } from '@objectstack/spec/security';

// ── CRUD + FLS + RLS ───────────────────────────────────────────────────────
export const ContributorPermissionSet = definePermissionSet({
  name: 'showcase_contributor',
  label: 'Showcase Contributor',
  objects: {
    showcase_project: { allowRead: true, allowCreate: false, allowEdit: true, allowDelete: false },
    showcase_task: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: false },
    showcase_account: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false },
    // Invoice graph: contributors fully manage invoices + their lines. Read/write
    // is scoped by the owner RLS below (invoice) and DERIVED for the lines, which
    // are `controlled_by_parent` — no line RLS is authored (ADR-0055).
    showcase_invoice: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: false },
    showcase_invoice_line: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: false },
  },
  // Field-level security — contributors can read but not edit budget figures.
  // Keys MUST be `<object>.<field>` qualified: the runtime evaluator matches
  // by object prefix, so a bare `budget` key silently enforces NOTHING (the
  // showcase shipped exactly that bug — caught by the permission-zoo audit,
  // now rejected at compile time by `security-fls-unqualified-key`).
  fields: {
    'showcase_project.budget': { readable: true, editable: false },
    'showcase_project.spent': { readable: true, editable: false },
    'showcase_project.budget_remaining': { readable: true, editable: false },
  },
  // Row-level security — contributors only see tasks assigned to them.
  rowLevelSecurity: [
    {
      name: 'task_own_rows',
      label: 'Own Tasks Only',
      description: 'Contributors can only select tasks assigned to them.',
      object: 'showcase_task',
      operation: 'select' as const,
      using: 'assignee == current_user.email',
      positions: ['contributor'],
      enabled: true,
    },
    // Owner RLS on the MASTER invoice. Because `showcase_invoice_line` is
    // `controlled_by_parent`, a contributor seeing only their own invoices also
    // sees only those invoices' lines — and can by-id read/write a line only when
    // they can read/write its master (ADR-0055). No line rule is authored here.
    {
      name: 'invoice_own_rows',
      label: 'Own Invoices Only',
      description:
        'Contributors only see invoices they own; their lines follow via controlled_by_parent.',
      object: 'showcase_invoice',
      operation: 'select' as const,
      using: 'owner == current_user.email',
      positions: ['contributor'],
      enabled: true,
    },
    // [ADR-0058 D4] RLS `check` — write-side post-image validation (NOT a read
    // filter). On UPDATE the new row must still be owned by the caller, so a
    // contributor cannot reassign an invoice they own to someone else. `check`
    // is compiled by the canonical CEL compiler and matched against the post-
    // image (pre-image ∪ change set); a violating write is denied (fail-closed).
    {
      name: 'invoice_owner_immutable',
      label: 'Invoice Owner Cannot Be Reassigned',
      description:
        'A contributor cannot change an invoice they own to a different owner (write-time CHECK, ADR-0058 D4).',
      object: 'showcase_invoice',
      operation: 'update' as const,
      check: 'owner == current_user.email',
      positions: ['contributor'],
      enabled: true,
    },
  ],
});

// ── Scope depth (ADR-0057 D1) ──────────────────────────────────────────────
/**
 * Depth widens a grant on PRIVATE objects along the org geometry — a public
 * object's baseline is already org-wide, so depth only matters where the
 * baseline stops. Managers demonstrate the READ/WRITE ASYMMETRY the two
 * dials allow: org-wide read over inquiries, but edit only their own
 * (`readScope: 'org'`, `writeScope: 'own'`).
 *
 * The intermediate HIERARCHY depths (`own_and_reports` / `unit` /
 * `unit_and_below`) are an enterprise capability (`requires:
 * ['hierarchy-security']`, shipped by @objectstack/security-enterprise) —
 * the open edition fails closed to owner-only, so this open example does not
 * author them (declared ≠ enforced is the one thing a showcase must never
 * do). BUSINESS-UNIT-shaped visibility in the open edition is instead
 * demonstrated by the `share_new_inquiries_with_field_ops` sharing rule
 * (BU-subtree recipient — see sharing-rules.ts).
 */
export const ManagerPermissionSet = definePermissionSet({
  name: 'showcase_manager',
  label: 'Showcase Manager',
  objects: {
    showcase_inquiry: { allowRead: true, allowEdit: true, readScope: 'org', writeScope: 'own' },
    showcase_contact: { allowRead: true, readScope: 'org' },
  },
});

/**
 * Executives read org-wide via DEPTH (`readScope: 'org'`) — contrast with the
 * auditor's VAMA below: `org` depth still respects RLS narrowing; VAMA is a
 * record-level bypass.
 */
export const ExecutivePermissionSet = definePermissionSet({
  name: 'showcase_executive',
  label: 'Showcase Executive',
  objects: {
    showcase_private_note: { allowRead: true, readScope: 'org' },
    showcase_inquiry: { allowRead: true, readScope: 'org' },
  },
});

// ── VAMA: View-All / Modify-All (record-level bypass) ─────────────────────
/**
 * Compliance read-only: `viewAllRecords` bypasses OWD/sharing/depth on the
 * named objects — the auditor sees every private note, inquiry, and invoice,
 * but holds no write bit anywhere. High-privilege by definition: the D7 lint
 * blocks binding this set to the `everyone`/`guest` anchors.
 */
export const AuditorPermissionSet = definePermissionSet({
  name: 'showcase_auditor',
  label: 'Showcase Auditor',
  objects: {
    showcase_private_note: { allowRead: true, viewAllRecords: true },
    showcase_inquiry: { allowRead: true, viewAllRecords: true },
    showcase_invoice: { allowRead: true, viewAllRecords: true },
    showcase_invoice_line: { allowRead: true, viewAllRecords: true },
  },
});

// ── System permissions + Modify-All ────────────────────────────────────────
/**
 * Back-office operations. Two distinct capabilities on one set:
 *   • `systemPermissions: ['setup.access']` — platform capability
 *     (ADR-0066): ops users can open Setup without being platform admins.
 *     System permissions also drive app-tab reachability: an app declaring
 *     `requiredPermissions` (Setup does) only appears in `/me/apps` when the
 *     union of the caller's sets carries every listed capability.
 *   • `modifyAllRecords` on announcements — announcements are OWD
 *     `public_read` (owner-writes-only), so Modify-All is what lets ops fix
 *     ANYONE's announcement. On an already-`public_read_write` object it
 *     would grant nothing — bypasses only matter where the baseline stops.
 *
 * (`tabPermissions` — per-app visible/hidden votes — is deliberately NOT
 * demoed here: an 'app'-type package carries at most one app (ADR-0019 D3),
 * and hiding someone else's platform app would demo against surface this
 * package doesn't own. The enforced consumer is `/me/apps`, which drops apps
 * whose merged vote is `hidden`.)
 */
export const OpsPermissionSet = definePermissionSet({
  name: 'showcase_ops',
  label: 'Showcase Operations',
  objects: {
    showcase_announcement: { allowRead: true, allowCreate: true, allowEdit: true, modifyAllRecords: true },
    showcase_inquiry: { allowRead: true, allowEdit: true, readScope: 'org', writeScope: 'org' },
    showcase_invoice: { allowRead: true },
  },
  // `setup.access` is a platform capability; `showcase.export_data` is a
  // PACKAGE capability this app DECLARES via defineCapability (see
  // capabilities.ts) — the grant side of the ADR-0066 three-way separation.
  systemPermissions: ['setup.access', 'showcase.export_data'],
});

// ── FLS: withholding a field's READ (ADR-0090 D10) ─────────────────────────
/**
 * Client Liaison — the app's `readable: false` demonstration (#9308 fixture 4).
 *
 * `showcase_contributor` above governs the SAME three budget figures on the
 * SAME object with `readable: true, editable: false`: it exercises the WRITE
 * half of field-level security — the value is visible, the edit is refused. The
 * READ half had no fixture at all. Nothing in the stock app authored a
 * `readable: false` grant, so `plugin-security`'s field masker
 * (`field-masker.ts`) — the code that STRIPS a withheld key out of every record
 * before it leaves the server — was reachable only from a permission set
 * invented inside a test, which a console render can never be driven off.
 *
 * The two sets side by side are the whole point: same object, same three
 * fields, two personas, two verdicts.
 *
 * ## What `readable: false` actually does, and why the persona must be clean
 *
 * Field permissions merge MOST-PERMISSIVE across the sets a caller holds
 * (`permission-evaluator.ts` → `getFieldPermissions`): a field enters the map
 * as `{ readable: false }` the moment ANY held set names it, and only a held
 * set saying `readable: true` can turn it back on. So the mask is observable on
 * a member holding this set and the `everyone` baseline — which names no fields
 * at all — and is correctly NOT observable on someone who also holds
 * `showcase_contributor`. That is the merge behaving as declared, not a defect:
 * grant one persona, not both.
 *
 * The masked verdict is a STRIP, not a blur — the key is absent from the
 * record, not nulled and not replaced. (The partial-masking path — a value
 * replaced by `138****5678` — is `maskingRule` on the FIELD, a different
 * mechanism this app does not yet declare anywhere.)
 *
 * `showcase_client_brief` is granted alongside because that is what the persona
 * is FOR: they write the client-facing brief and publish it by share link. It
 * also makes the two halves of the fixture legible together — the fields a
 * client may not see through a link (`redactFields` on the object) and the
 * fields this persona may not see at all (below).
 */
export const ClientLiaisonPermissionSet = definePermissionSet({
  name: 'showcase_client_liaison',
  label: 'Showcase Client Liaison',
  objects: {
    showcase_project: { allowRead: true },
    showcase_client_brief: { allowRead: true, allowCreate: true, allowEdit: true },
  },
  // Keys are `<object>.<field>` qualified — a bare key enforces NOTHING and is
  // rejected at compile time by `security-fls-unqualified-key`.
  //
  // All three, not just `budget`: `budget_remaining` is a formula over
  // `budget - spent`, so withholding `budget` alone would leak it back through
  // arithmetic. A mask with a documented hole is worse than no mask, because it
  // teaches the hole.
  fields: {
    'showcase_project.budget': { readable: false, editable: false },
    'showcase_project.spent': { readable: false, editable: false },
    'showcase_project.budget_remaining': { readable: false, editable: false },
  },
});

// ── The `everyone` baseline suggestion (ADR-0090 D5) ───────────────────────
/**
 * `isDefault: true` is a SUGGESTION: "bind this set to the built-in
 * `everyone` position" — consumed at install time, never auto-bound in a
 * package install (the admin confirms). The dev CLI wires it as the additive
 * per-request baseline, so every authenticated member holds it IN ADDITION
 * to their explicit grants (no fallback cliff — a first explicit grant does
 * not cost the baseline; ADR-0090 D5 abolished that).
 *
 * Deliberately read-mostly and low-privilege: the D7 lint hard-blocks
 * high-privilege bits (VAMA, delete/purge/transfer, system permissions,
 * wildcards) on any everyone-suggested set.
 */
export const MemberDefaultPermissionSet = definePermissionSet({
  name: 'showcase_member_default',
  label: 'Showcase Member (Default)',
  isDefault: true,
  objects: {
    showcase_account: { allowRead: true },
    showcase_product: { allowRead: true },
    showcase_project: { allowRead: true },
    showcase_task: { allowRead: true, allowCreate: true },
    showcase_announcement: { allowRead: true },
    showcase_inquiry: { allowRead: true, allowCreate: true },
    // Personal data on a `private`-OWD object: every member may keep private
    // notes, and the OWD baseline — not the grant — is what keeps them
    // owner-scoped (ADR-0090 D1: granting Read never means reading others').
    // The D7 linter flags this owner-only read as `security-private-no-
    // readscope` (info) — here it is exactly the intent.
    showcase_private_note: { allowRead: true, allowCreate: true, allowEdit: true },
  },
});

// ── Guest-safe capability (ADR-0090 D9) ────────────────────────────────────
/**
 * Capability shaped for the built-in `guest` position: anonymous visitors
 * may read announcements and file an inquiry (public form intake) — nothing
 * else. Guest bindings face the STRICTEST lint tier: named objects only (no
 * wildcard), read-only by default (create case-by-case), never `allowEdit`,
 * never VAMA/system permissions. The runtime anchor gate
 * (`assertAudienceAnchorBindingGate`) enforces the same rules on the binding
 * write itself.
 *
 * Binding is an ADMIN action (Setup → Access Control → bind `guest` →
 * `showcase_guest_portal`); the app only ships the capability.
 */
export const GuestPortalPermissionSet = definePermissionSet({
  name: 'showcase_guest_portal',
  label: 'Showcase Guest Portal',
  objects: {
    showcase_announcement: { allowRead: true },
    showcase_inquiry: { allowCreate: true },
  },
});

// ── Delegated administration (ADR-0090 D12) ────────────────────────────────
/**
 * An admin scope makes ADMINISTRATION ITSELF a scoped grant: the holder may
 * manage user↔position assignments INSIDE the Field Operations business-unit
 * subtree (seeded in src/data/seed/ as `bu_field_ops` + descendants), and may
 * only hand out the sets on the allowlist — to others OR themselves (no
 * self-escalation, enforced by the runtime `DelegatedAdminGate`).
 *
 * The `adminScope` authorizes WHAT may be administered; the plain CRUD bits
 * on the RBAC link tables below let the requests through at all (both are
 * required — holders of table CRUD with NO scope are refused).
 * `manageBindings` stays false: this delegate re-staffs positions, they do
 * not re-compose what a position means.
 */
export const FieldOpsDelegatePermissionSet = definePermissionSet({
  name: 'showcase_field_ops_delegate',
  label: 'Field Ops Delegate Admin',
  objects: {
    sys_user_position: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
    sys_position: { allowRead: true },
    sys_permission_set: { allowRead: true },
    sys_business_unit: { allowRead: true },
    sys_business_unit_member: { allowRead: true },
    sys_user: { allowRead: true },
  },
  adminScope: {
    businessUnit: 'Field Operations',
    includeSubtree: true,
    manageAssignments: true,
    manageBindings: false,
    authorEnvironmentSets: false,
    assignablePermissionSets: ['showcase_contributor', 'showcase_manager'],
  },
});

export const allPermissionSets = [
  ContributorPermissionSet,
  ManagerPermissionSet,
  ExecutivePermissionSet,
  AuditorPermissionSet,
  OpsPermissionSet,
  MemberDefaultPermissionSet,
  GuestPortalPermissionSet,
  FieldOpsDelegatePermissionSet,
  ClientLiaisonPermissionSet,
];
