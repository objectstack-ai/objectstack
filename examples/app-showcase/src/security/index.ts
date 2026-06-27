// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Security capability chain — a role hierarchy, a permission set that layers
 * object CRUD + field-level security (FLS) + row-level security (RLS), two
 * sharing rules (criteria- and owner-based), and an org security policy.
 * Together these exercise RBAC, FLS, RLS, and sharing in one place. These are
 * plain objects validated by `defineStack` (which coerces string predicates
 * and fills CRUD defaults).
 */

// ── Roles (hierarchy) ──────────────────────────────────────────────────────
export const ContributorRole = {
  name: 'contributor',
  label: 'Contributor',
  description: 'Works tasks on their own projects.',
};

export const ManagerRole = {
  name: 'manager',
  label: 'Project Manager',
  description: 'Manages projects and the contributors on them.',
  parent: 'contributor',
};

export const ExecRole = {
  name: 'exec',
  label: 'Executive',
  description: 'Read-all visibility for reporting.',
  parent: 'manager',
};

// ── Permission set: CRUD + FLS + RLS ──────────────────────────────────────
export const ContributorPermissionSet = {
  name: 'showcase_contributor',
  label: 'Showcase Contributor',
  description: 'Standard access for contributors, with budget fields hidden and row-level scoping to own records.',
  isProfile: false,
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
  fields: {
    budget: { readable: true, editable: false },
    spent: { readable: true, editable: false },
    budget_remaining: { readable: true, editable: false },
  },
  // Row-level security — contributors only see tasks assigned to them.
  rowLevelSecurity: [
    {
      name: 'task_own_rows',
      label: 'Own Tasks Only',
      description: 'Contributors can only select tasks assigned to them.',
      object: 'showcase_task',
      operation: 'select' as const,
      using: "assignee == current_user.email",
      roles: ['contributor'],
      enabled: true,
      priority: 10,
    },
    // Owner RLS on the MASTER invoice. Because `showcase_invoice_line` is
    // `controlled_by_parent`, a contributor seeing only their own invoices also
    // sees only those invoices' lines — and can by-id read/write a line only when
    // they can read/write its master (ADR-0055). No line rule is authored here.
    {
      name: 'invoice_own_rows',
      label: 'Own Invoices Only',
      description: "Contributors only see invoices they own; their lines follow via controlled_by_parent.",
      object: 'showcase_invoice',
      operation: 'select' as const,
      using: "owner == current_user.email",
      roles: ['contributor'],
      enabled: true,
      priority: 10,
    },
    // [ADR-0058 D4] RLS `check` — write-side post-image validation (NOT a read
    // filter). On UPDATE the new row must still be owned by the caller, so a
    // contributor cannot reassign an invoice they own to someone else. `check`
    // is compiled by the canonical CEL compiler and matched against the post-
    // image (pre-image ∪ change set); a violating write is denied (fail-closed).
    {
      name: 'invoice_owner_immutable',
      label: 'Invoice Owner Cannot Be Reassigned',
      description: 'A contributor cannot change an invoice they own to a different owner (write-time CHECK, ADR-0058 D4).',
      object: 'showcase_invoice',
      operation: 'update' as const,
      check: "owner == current_user.email",
      roles: ['contributor'],
      enabled: true,
      priority: 10,
    },
  ],
};

// ── App-declared DEFAULT PROFILE (ADR-0056 D7) ──────────────────────────────
/**
 * The showcase's default access posture for a freshly signed-up user who holds
 * no explicit grants. `isDefault: true` makes the app declare what "a new member
 * can do" instead of inheriting the built-in `member_default` wildcard. The CLI
 * (`pnpm dev`) reads this off the stack and wires it as the SecurityPlugin
 * fallback (ADR-0056 D7) — without that wiring an `isDefault` flag in app
 * metadata is silently ignored. Deliberately read-mostly: a brand-new member can
 * browse the shared catalog + announcements and file tasks/inquiries, but cannot
 * edit or delete anyone's records (owner/OWD enforcement still applies on top).
 */
export const MemberDefaultProfile = {
  name: 'showcase_member_default',
  label: 'Showcase Member (Default)',
  description: 'App-declared default profile for new sign-ups — read-mostly baseline (ADR-0056 D7).',
  isProfile: true,
  isDefault: true,
  objects: {
    showcase_account: { allowRead: true },
    showcase_product: { allowRead: true },
    showcase_project: { allowRead: true },
    showcase_task: { allowRead: true, allowCreate: true },
    showcase_announcement: { allowRead: true },
    showcase_inquiry: { allowRead: true, allowCreate: true },
  },
};

// ── Sharing rules ──────────────────────────────────────────────────────────
/** criteria-based: red-health projects are shared up to executives. */
export const RedProjectSharingRule = {
  type: 'criteria' as const,
  name: 'share_red_projects_with_execs',
  label: 'Red Projects → Executives',
  description: 'Automatically share at-risk (red health) projects with executives.',
  object: 'showcase_project',
  condition: "record.health == 'red'",
  accessLevel: 'read' as const,
  sharedWith: { type: 'role' as const, value: 'exec' },
  active: true,
};

/**
 * [ADR-0058 D3 / closes #1887] criteria-based with a COMPOUND CEL condition.
 * Before #1887 a multi-clause `&&` condition was silently skipped (the sharing
 * rule was decorative metadata); now it compiles to a compound `criteria_json`
 * and enforces. Shares only projects that are BOTH at-risk (red) AND high-budget
 * with managers — the AND matters: a red but low-budget project is NOT shared.
 */
export const HighValueRedProjectRule = {
  type: 'criteria' as const,
  name: 'share_high_value_red_projects_with_managers',
  label: 'High-Value Red Projects → Managers',
  description: 'Share at-risk (red health) projects over the budget threshold with managers (compound condition, ADR-0058 D3).',
  object: 'showcase_project',
  condition: "record.health == 'red' && record.budget > 100000",
  accessLevel: 'read' as const,
  sharedWith: { type: 'role' as const, value: 'manager' },
  active: true,
};

/** owner-based: a contributor's tasks are shared read-only with managers. */
export const ContributorTaskSharingRule = {
  type: 'owner' as const,
  name: 'share_contributor_tasks_with_manager',
  label: "Contributor Tasks → Manager",
  description: "Share each contributor's tasks with managers for oversight.",
  object: 'showcase_task',
  ownedBy: { type: 'role' as const, value: 'contributor' },
  accessLevel: 'read' as const,
  sharedWith: { type: 'role' as const, value: 'manager' },
  active: true,
};


export const allRoles = [ContributorRole, ManagerRole, ExecRole];
export const allPermissionSets = [ContributorPermissionSet, MemberDefaultProfile];
export const allSharingRules = [RedProjectSharingRule, HighValueRedProjectRule, ContributorTaskSharingRule];
