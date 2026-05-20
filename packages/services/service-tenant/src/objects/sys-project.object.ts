// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * Resolve the root domain that subdomains are appended to when users
 * leave the hostname blank or change it via the `change_hostname`
 * action. Mirrors the precedence used in
 * `ProjectProvisioningService.provisionProject` and
 * `service-cloud/routes/project-lifecycle.ts::resolveNewHostname`.
 */
function getRootDomainForUiHints(): string {
  return (
    process.env.OS_ROOT_DOMAIN ||
    process.env.ROOT_DOMAIN ||
    (process.env.NODE_ENV === 'production' ? 'objectstack.app' : 'localhost')
  );
}
const ROOT_DOMAIN_HINT = getRootDomainForUiHints();

/**
 * sys_project — Control Plane Project Registry
 *
 * One row per project. An organization owns N projects
 * (dev/test/prod/sandbox/preview/…). Physical database connection info
 * is stored directly on this row (database_url, database_driver, etc.)
 * so a single JOIN-free lookup gives both logical and physical addressing.
 *
 * **This table lives in the Control Plane only.** Project DBs contain
 * only business data rows — zero system tables.
 *
 * **UX**: the default CRUD `create` form is disabled; users go through
 * the `create_project` toolbar wizard which wraps
 * {@link ProjectProvisioningService.provisionProject} so a real database
 * is allocated atomically. Status transitions go through dedicated
 * actions (suspend/resume/archive/set_default/change_plan/change_hostname/
 * clone_project) — `status` is `readonly` and must not be edited inline.
 *
 * @namespace sys
 */
export const SysProject = ObjectSchema.create({
  name: 'sys_project',
  label: 'Environment',
  pluralLabel: 'Environments',
  icon: 'globe',
  isSystem: true,
  managedBy: 'config',
  description: 'Control-plane registry of runtime environments (prod/test/dev/sandbox). ' +
    'Each row owns a hostname, a dedicated database, and a plan/quota envelope. ' +
    'Note: the underlying table is still named `sys_project` for backwards compatibility; ' +
    'the conceptual rename to "Environment" matches ADR-0006 (3-layer tenancy).',
  titleFormat: '{display_name}',
  compactLayout: ['display_name', 'plan', 'status', 'hostname', 'is_default'],

  // Users must use the Create Project wizard (which actually provisions a
  // database). Direct row insert would leave the project with no
  // database_url and break the runtime.
  userActions: { create: false, edit: true, delete: true, import: false },

  listViews: {
    my_projects: {
      type: 'grid',
      name: 'my_projects',
      label: 'My Projects',
      data: { provider: 'object', object: 'sys_project' },
      columns: ['display_name', 'plan', 'status', 'hostname', 'is_default', 'updated_at'],
      filter: [{ field: 'created_by', operator: 'equals', value: '{current_user_id}' }],
      sort: [{ field: 'updated_at', order: 'desc' }],
      pagination: { pageSize: 25 },
      searchableFields: ['display_name', 'hostname'],
    },
    active: {
      type: 'grid',
      name: 'active',
      label: 'Active',
      data: { provider: 'object', object: 'sys_project' },
      columns: ['display_name', 'organization_id', 'plan', 'hostname', 'storage_limit_mb', 'updated_at'],
      filter: [{ field: 'status', operator: 'equals', value: 'active' }],
      sort: [{ field: 'updated_at', order: 'desc' }],
      pagination: { pageSize: 50 },
      searchableFields: ['display_name', 'hostname'],
    },
    provisioning: {
      type: 'grid',
      name: 'provisioning',
      label: 'Provisioning',
      data: { provider: 'object', object: 'sys_project' },
      columns: ['display_name', 'plan', 'database_driver', 'created_by', 'created_at'],
      filter: [{ field: 'status', operator: 'equals', value: 'provisioning' }],
      sort: [{ field: 'created_at', order: 'desc' }],
      pagination: { pageSize: 25 },
    },
    by_plan: {
      type: 'kanban',
      name: 'by_plan',
      label: 'By Plan',
      data: { provider: 'object', object: 'sys_project' },
      columns: ['display_name', 'status', 'hostname'],
      kanban: {
        groupByField: 'plan',
        columns: ['display_name', 'status', 'hostname'],
      },
      sort: [{ field: 'updated_at', order: 'desc' }],
    },
    archive: {
      type: 'grid',
      name: 'archive',
      label: 'Archived & Failed',
      data: { provider: 'object', object: 'sys_project' },
      columns: ['display_name', 'organization_id', 'status', 'plan', 'updated_at'],
      filter: [
        { field: 'status', operator: 'in', value: ['archived', 'failed'] },
      ],
      sort: [{ field: 'updated_at', order: 'desc' }],
      pagination: { pageSize: 50 },
    },
  },

  actions: [
    // ────────────────────────────────────────────────────────────────────
    // Environment provisioning wizard — replaces the disabled default
    // CRUD `create` form. Wraps ProjectProvisioningService.provisionProject
    // so a real database is allocated atomically.
    //
    // Conceptually this creates an Environment (see ADR-0006). The backend
    // route is still `/cloud/projects` for backwards compatibility with
    // existing SDK clients; the conceptual rename is UI-visible only.
    // ────────────────────────────────────────────────────────────────────
    {
      name: 'create_project',
      label: 'Create Environment',
      icon: 'plus',
      variant: 'primary',
      type: 'api',
      locations: ['list_toolbar'],
      target: '/api/v1/cloud/projects',
      method: 'POST',
      mode: 'create',
      refreshAfter: true,
      successMessage: 'Environment provisioned.',
      params: [
        { name: 'displayName', label: 'Display Name', type: 'text', required: true, placeholder: 'My new environment' },
        {
          name: 'driver',
          label: 'Database Driver',
          type: 'select',
          required: true,
          defaultValue: 'memory',
          options: [
            { label: 'In-Memory (dev)', value: 'memory' },
            { label: 'SQLite (local)', value: 'sqlite' },
            { label: 'Turso (cloud)', value: 'turso' },
          ],
        },
        {
          name: 'plan',
          label: 'Plan',
          type: 'select',
          required: true,
          defaultValue: 'free',
          options: [
            { label: 'Free', value: 'free' },
            { label: 'Starter', value: 'starter' },
            { label: 'Pro', value: 'pro' },
            { label: 'Enterprise', value: 'enterprise' },
          ],
        },
        {
          // Storage limit as a select avoids the spinbutton-with-implicit-zero-min/max
          // rendering bug and matches the discrete tier model the backend actually
          // honours via the `plan` column.
          name: 'storageLimitMb',
          label: 'Storage Limit',
          type: 'select',
          required: false,
          defaultValue: '1024',
          options: [
            { label: '1 GB',  value: '1024' },
            { label: '4 GB',  value: '4096' },
            { label: '16 GB', value: '16384' },
            { label: '64 GB', value: '65536' },
          ],
        },
        {
          name: 'visibility',
          label: 'Visibility',
          type: 'select',
          required: true,
          defaultValue: 'private',
          options: [
            { label: 'Private (share-by-link)', value: 'private' },
            { label: 'Public (listed)', value: 'public' },
          ],
        },
      ],
    },

    // ────────────────────────────────────────────────────────────────────
    // Status-machine row actions (replace direct status field edits).
    // ────────────────────────────────────────────────────────────────────
    {
      name: 'suspend_project',
      label: 'Suspend',
      icon: 'pause-circle',
      variant: 'secondary',
      type: 'script',
      locations: ['list_item', 'record_header'],
      confirmText: 'Suspend this environment? All runtime traffic to it will be blocked until you resume.',
      successMessage: 'Environment suspended.',
      refreshAfter: true,
    },
    {
      name: 'resume_project',
      label: 'Resume',
      icon: 'play-circle',
      variant: 'secondary',
      type: 'script',
      locations: ['list_item', 'record_header'],
      successMessage: 'Environment resumed.',
      refreshAfter: true,
    },
    {
      name: 'archive_project',
      label: 'Archive',
      icon: 'archive',
      variant: 'danger',
      type: 'script',
      locations: ['list_item', 'record_header'],
      confirmText: 'Archive this environment? It will be removed from active views. Data is retained for 30 days before deletion.',
      successMessage: 'Environment archived.',
      refreshAfter: true,
      params: [
        { name: 'reason', label: 'Reason (optional)', type: 'text', required: false },
      ],
    },
    {
      name: 'set_default_project',
      label: 'Set as Default',
      icon: 'star',
      variant: 'secondary',
      type: 'script',
      locations: ['list_item', 'record_header'],
      successMessage: 'Default environment updated.',
      refreshAfter: true,
    },
    {
      name: 'change_plan',
      label: 'Change Plan',
      icon: 'sliders',
      variant: 'secondary',
      type: 'script',
      locations: ['list_item', 'record_header'],
      successMessage: 'Plan updated.',
      refreshAfter: true,
      params: [
        {
          name: 'plan',
          label: 'New Plan',
          type: 'select',
          required: true,
          options: [
            { label: 'Free', value: 'free' },
            { label: 'Starter', value: 'starter' },
            { label: 'Pro', value: 'pro' },
            { label: 'Enterprise', value: 'enterprise' },
            { label: 'Custom', value: 'custom' },
          ],
        },
      ],
    },
    {
      name: 'change_hostname',
      label: 'Change Hostname',
      icon: 'globe',
      variant: 'secondary',
      type: 'script',
      locations: ['list_item', 'record_header'],
      successMessage: 'Hostname updated.',
      refreshAfter: true,
      params: [
        {
          name: 'subdomain',
          label: 'New Subdomain',
          type: 'text',
          required: true,
          placeholder: 'my-project',
          helpText:
            `Just the subdomain — the root domain (.${ROOT_DOMAIN_HINT}) is appended automatically. Allowed: lowercase letters, digits, hyphens.`,
        },
      ],
    },
  ],

  fields: {
    // ── Basics ────────────────────────────────────────────────────────
    display_name: Field.text({
      label: 'Display Name',
      required: true,
      maxLength: 255,
      description: 'Display name shown in Studio and APIs.',
      group: 'Basics',
    }),

    organization_id: Field.lookup('sys_organization', {
      label: 'Organization',
      required: true,
      description: 'Owning organization.',
      group: 'Basics',
    }),

    plan: Field.select({
      label: 'Plan',
      required: true,
      defaultValue: 'free',
      description: 'Plan tier applied to this project for quota and billing. Change via Change Plan action.',
      readonly: true,
      group: 'Basics',
      options: [
        { value: 'free', label: 'Free' },
        { value: 'starter', label: 'Starter' },
        { value: 'pro', label: 'Pro' },
        { value: 'enterprise', label: 'Enterprise' },
        { value: 'custom', label: 'Custom' },
      ],
    }),

    status: Field.select({
      label: 'Status',
      required: true,
      defaultValue: 'provisioning',
      description: 'Project lifecycle status. Driven by status-machine actions; not directly editable.',
      readonly: true,
      group: 'Basics',
      options: [
        { value: 'provisioning', label: 'Provisioning' },
        { value: 'active', label: 'Active' },
        { value: 'suspended', label: 'Suspended' },
        { value: 'archived', label: 'Archived' },
        { value: 'failed', label: 'Failed' },
        { value: 'migrating', label: 'Migrating' },
      ],
    }),

    // ── Access ────────────────────────────────────────────────────────
    //
    // `hostname` is THE access point for this project. After provisioning,
    // users open the project at `https://{hostname}/_console` (admin UI)
    // or hit `https://{hostname}/api/v1/...` (REST). The Open Console /
    // API Reference actions at the top of the page are shortcuts to this
    // URL, derived from the hostname value below.
    hostname: Field.text({
      label: 'Public Hostname',
      required: false,
      maxLength: 255,
      unique: true,
      readonly: true,
      description:
        'The canonical hostname where this project is served. Use the Change Hostname action to update.',
      group: 'Access',
    }),

    // Clickable console URL — pre-computed at provisioning time so the
    // detail page renders a real `<a>` link (Field.url widget) without
    // needing template substitution at view-render time.
    console_url: Field.url({
      label: 'Open Console',
      required: false,
      readonly: true,
      description:
        'Click to open this project\'s admin Console in a new tab. Auto-derived from hostname.',
      group: 'Access',
    }),

    api_base_url: Field.url({
      label: 'API Base URL',
      required: false,
      readonly: true,
      description:
        'Root of this project\'s REST API. Append `/sys_user`, `/data/<object>`, etc. Auto-derived from hostname.',
      group: 'Access',
    }),

    visibility: Field.select({
      label: 'Visibility',
      required: true,
      defaultValue: 'private',
      description:
        '`private` (default) hides the project from public enumeration but allows anonymous artifact downloads via share-by-link. `public` lists the project at /pub/v1/projects/:id/*.',
      group: 'Access',
      options: [
        { value: 'private', label: 'Private (share-by-link)' },
        { value: 'public', label: 'Public (listed)' },
      ],
    }),

    is_default: Field.boolean({
      label: 'Default Project',
      required: true,
      defaultValue: false,
      readonly: true,
      description: 'Exactly one default project per organization. Set via Set as Default action.',
      group: 'Access',
    }),

    // ── Quota ─────────────────────────────────────────────────────────
    storage_limit_mb: Field.number({
      label: 'Storage Limit (MB)',
      required: false,
      defaultValue: 1024,
      description: 'Storage quota in megabytes.',
      group: 'Quota',
    }),

    // ── Connection (sensitive — never include in list view columns) ───
    database_driver: Field.text({
      label: 'Database Driver',
      required: false,
      maxLength: 50,
      readonly: true,
      description: 'Data-plane driver key (turso, libsql, sqlite, memory, postgres).',
      group: 'Connection',
    }),

    database_url: Field.url({
      label: 'Database URL',
      required: false,
      readonly: true,
      hidden: true,
      description: 'Connection URL for the project database. Sensitive — admin only.',
      group: 'Connection',
    }),

    provisioned_at: Field.datetime({
      label: 'Provisioned At',
      required: false,
      readonly: true,
      description: 'When the physical database was provisioned.',
      group: 'Connection',
    }),

    // ── Internal (system-managed; hidden from forms) ──────────────────
    id: Field.text({
      label: 'Project ID',
      required: true,
      readonly: true,
      hidden: true,
      description: 'UUID of the project (stable, never reused).',
      group: 'Internal',
    }),

    is_system: Field.boolean({
      label: 'Is System',
      required: true,
      defaultValue: false,
      readonly: true,
      hidden: true,
      description: 'Platform infrastructure project (not user data).',
      group: 'Internal',
    }),

    created_by: Field.lookup('sys_user', {
      label: 'Created By',
      required: true,
      readonly: true,
      description: 'User that created the project.',
      group: 'Internal',
    }),

    created_at: Field.datetime({
      label: 'Created At',
      defaultValue: 'NOW()',
      readonly: true,
      description: 'Creation timestamp.',
      group: 'Internal',
    }),

    updated_at: Field.datetime({
      label: 'Updated At',
      defaultValue: 'NOW()',
      readonly: true,
      description: 'Last update timestamp.',
      group: 'Internal',
    }),

    metadata: Field.textarea({
      label: 'Metadata',
      required: false,
      hidden: true,
      description: 'JSON-serialized free-form metadata (feature flags, tags, …).',
      group: 'Internal',
    }),
  },

  indexes: [
    { fields: ['organization_id'] },
    { fields: ['organization_id', 'is_default'] },
    { fields: ['status'] },
    { fields: ['database_driver'] },
    { fields: ['hostname'], unique: true },
  ],

  enable: {
    trackHistory: true,
    searchable: true,
    apiEnabled: true,
    apiMethods: ['get', 'list', 'create', 'update', 'delete'],
    trash: false,
    mru: true,
  },
});
