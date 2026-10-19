// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineForm } from '../ui/view.zod';

/**
 * PermissionSet — canonical FormView layout.
 *
 * Serves the `permission` metadata kind, and only that one. There is no
 * Profile concept: ADR-0090 D2 removed it (`isProfile` deleted, not
 * deprecated), leaving permission sets as the only capability container —
 * union-merged and purely additive. So `METADATA_FORM_REGISTRY` has no
 * `profile` key, `MetadataTypeSchema` admits no `profile` kind, and
 * `PermissionSetSchema` answers an authored `isProfile` or `profiles` with a
 * retirement tombstone rather than a silent strip.
 *
 * The form surfaces no flag: `isDefault` (ADR-0090 D5) is the schema's only
 * boolean and it records a boot-time binding hint, not a grant.
 *
 * The object/field permission maps are intentionally kept as JSON for
 * now — they're typically managed via the dedicated permission matrix
 * UI on a record-by-record basis, not free-form editing.
 */
export const permissionForm = defineForm({
  schemaId: 'permission',
  type: 'simple',
  sections: [
    {
      label: 'Identity',
      description:
        'Permission sets are the only capability container: a user gets the union of every set they hold, so sets only ever add access. Positions distribute sets to people.',
      columns: 2,
      fields: [
        { field: 'name', required: true, colSpan: 1, helpText: 'Machine name (snake_case)' },
        { field: 'label', colSpan: 1, helpText: 'Display label for admins' },
        // #19331 — four declared keys had no control, so the only door to any of
        // them was the Source tab's free-text JSON. `description` is persisted on
        // sys_permission_set and shown in Setup; of the other three, `packageId`
        // (ADR-0086 D3) and the ADR-0090 D5 baseline flag keep their rows. The
        // help texts are an admin's words; the decision records stay here:
        //  - `isDefault` (ADR-0090 D5): an app-level set is auto-bound to the
        //    built-in `everyone` position at boot, after the high-privilege check;
        //    a package-level set materializes a `sys_audience_binding_suggestion`
        //    an admin confirms in Setup.
        //  - `managedBy` left this form with its key (#23891, ADR-0049
        //    enforce-or-remove): nothing read the authored value, so its labels
        //    promised upgrade behaviour no code kept.
        //  - `packageId` (ADR-0086 D3): a value that disagrees with the package
        //    the set ships in or is saved into is refused
        //    (`judgePermissionSetOwnerBinding`).
        { field: 'description', type: 'textarea', colSpan: 2, helpText: 'Human-readable description shown in Setup.' },
        { field: 'isDefault', type: 'boolean', colSpan: 1, helpText: 'Gives this set to everyone who signs in, through the built-in everyone position. A set the app itself declares is granted at startup; a set from an installed package becomes a suggestion an admin confirms in Setup. A set with high-privilege permissions is never granted this way. Default false.' },
        { field: 'packageId', type: 'text', colSpan: 2, helpText: 'The package that ships this set; a value naming any other package is refused. Leave empty for a set created in this environment.' },
      ],
    },
    {
      label: 'System Permissions',
      description: 'High-level capabilities not tied to a specific object — e.g. manage_users, view_audit_logs.',
      columns: 1,
      fields: [
        { field: 'systemPermissions', type: 'tags', helpText: 'List of system capability keys' },
        // #20349 — `adminScope` (ADR-0090 D12) had no control, so delegated
        // administration could only be written in source. `json`, the hint every
        // structured row on this form carries. `json` is not a registered
        // widget, so the renderer derives the face from the node: this one is an
        // object with properties, so it renders its keys as a nested form
        // whose edits merge into the stored scope — no key an author did not
        // touch is rewritten. #23488: the help text names the scope's four
        // live keys only; `manageBindings` and `authorEnvironmentSets` are
        // retired tombstones, not rights a set can grant.
        { field: 'adminScope', widget: 'json', helpText: 'Delegated administration: lets holders of this set administer one business-unit subtree. businessUnit is the subtree root (sys_business_unit.name) and is required, non-blank; includeSubtree defaults to true; manageAssignments defaults to false and lets the holder assign people to positions, and grant sets directly, inside that subtree; a delegate may hand out only the sets named in assignablePermissionSets. Leave empty for a set that delegates nothing.' },
      ],
    },
    {
      label: 'Object & Field Permissions',
      description: 'Per-object CRUD + per-field FLS. Edit via the matrix editor or paste JSON here.',
      columns: 1,
      fields: [
        { field: 'objects', widget: 'json', helpText: '{ "account": { allowRead: true, allowEdit: true, ... } }' },
        { field: 'fields', widget: 'json', helpText: '{ "account.amount": { readable: true, editable: false } }' },
      ],
    },
    {
      label: 'Tab & Row-Level Security',
      description: 'Tab visibility and RLS policies.',
      columns: 1,
      fields: [
        { field: 'tabPermissions', widget: 'json', helpText: '{ "app_crm": "visible", "app_admin": "hidden" }' },
        { field: 'rowLevelSecurity', widget: 'json', helpText: 'Array of RLS policies (see rls.zod.ts)' },
      ],
    },
  ],
});
