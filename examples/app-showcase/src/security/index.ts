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
      using: "assignee == current_user.name",
      roles: ['contributor'],
      enabled: true,
      priority: 10,
    },
  ],
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

// ── Org security policy ─────────────────────────────────────────────────────
export const ShowcasePolicy = {
  name: 'showcase_default_policy',
  password: {
    minLength: 12,
    requireUppercase: true,
    requireLowercase: true,
    requireNumbers: true,
    requireSymbols: true,
    expirationDays: 90,
    historyCount: 5,
  },
  session: { idleTimeout: 30, absoluteTimeout: 480, forceMfa: false },
  audit: { logRetentionDays: 365, sensitiveFields: ['budget', 'spent'], captureRead: false },
  isDefault: true,
};

export const allRoles = [ContributorRole, ManagerRole, ExecRole];
export const allPermissionSets = [ContributorPermissionSet];
export const allSharingRules = [RedProjectSharingRule, ContributorTaskSharingRule];
export const allPolicies = [ShowcasePolicy];
