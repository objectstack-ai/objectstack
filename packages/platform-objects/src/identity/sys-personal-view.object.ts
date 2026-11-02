// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_personal_view — a reader's own named list view (「我的视图」).
 *
 * A named personal view is a row of USER DATA, not view metadata (ruling
 * 6570568131 on #28971, letter C; ADR-0131 D13: "if pulled, it returns as a user-owned D3 object").
 * One row is one saved list: its owner, the object it lists, the name the owner
 * gave it, the list configuration in spec's `ListView` shape, and whether it is
 * the owner's default for that object.
 *
 * What it is NOT, each on purpose:
 *  - not a view item: `/meta` never serves it and the metadata write door
 *    never writes it, so a package export never carries it and a walled
 *    environment can still save one (it is data, not metadata);
 *  - not `ViewScopeSchema`'s `personal` value or `sharing.type: 'personal'`,
 *    which stay as the spec lane leaves them;
 *  - not addressed by the `object.key` view syntax: its id is the engine's
 *    record id, which never carries a `.`, so it cannot collide with a package
 *    view's name;
 *  - not shared: no sharing, no team view, no admin management in this
 *    version.
 *
 * Modelled on `sys_user_preference` (the template the ruling names): the same
 * owner column, the same owner-only default row scope, the same organization
 * scoping under ADR-0131 (the table carries the organization column, so the
 * Layer 0 wall bounds it and the row scope applies inside that wall), and the
 * same registrar (`plugin-auth`'s identity manifest).
 *
 * Two behaviours live in the registrar's hooks, not here
 * (`plugin-auth/src/personal-view-hooks.ts`): a save whose `config` is not a
 * valid `ListView` is refused with `400 VALIDATION_FAILED`, and a write that
 * makes a row the owner's default clears the default flag on the owner's other
 * rows for the same object in the same write.
 *
 * @namespace sys
 */
export const SysPersonalView = ObjectSchema.create({
  name: 'sys_personal_view',
  label: 'Personal View',
  pluralLabel: 'Personal Views',
  icon: 'list',
  isSystem: true,
  // [ADR-0103] User-writable DATA on a platform-defined schema, like
  // `sys_user_preference`: a reader saves, renames and re-defaults their own
  // views from the list page; no admin authors them. The bucket default is
  // full CRUD, so no `userActions` block is needed; the row scope below is the
  // authz.
  managedBy: 'system-data',
  description: "A reader's own named list views (My Views). Visible only to the owner.",
  nameField: 'label', // [ADR-0079] canonical primary-title pointer
  titleFormat: '{label}',
  highlightFields: ['object_name', 'is_default'],

  // [ADR-0066 D2] `private`: a plain `'*'` wildcard grant does not cover this
  // object, so a reader reaches it only through the explicit grant the
  // platform baseline (`member_default`) names. An application's wildcard set
  // never widens who reads another reader's views.
  access: { default: 'private' },

  // [ADR-0095 D1] Owner-only, for every operation: the same literal
  // `sys_user_preference` declares. The organization column puts the table
  // behind the Layer 0 wall, and this scope applies inside it. The
  // organization administrator's wildcard super-user bypass is closed by an
  // explicit entry for this object in that set (`default-permission-sets.ts`).
  defaultRowScope: {
    name: 'sys_personal_view_self',
    operation: 'all',
    using: 'user_id == current_user.id',
  },

  fields: {
    id: Field.text({
      label: 'Personal View ID',
      required: true,
      readonly: true,
    }),

    created_at: Field.datetime({
      label: 'Created At',
      defaultValue: 'NOW()',
      readonly: true,
    }),

    updated_at: Field.datetime({
      label: 'Updated At',
      defaultValue: 'NOW()',
      readonly: true,
    }),

    user_id: Field.lookup('sys_user', {
      label: 'Owner',
      required: true,
      description: 'The user this view belongs to. Only this user reads or changes it.',
    }),

    object_name: Field.text({
      label: 'Object',
      required: true,
      maxLength: 255,
      description: 'The object this view lists (its machine name).',
    }),

    label: Field.text({
      label: 'Name',
      required: true,
      maxLength: 255,
      description: 'The name the owner gave this view.',
    }),

    config: Field.json({
      label: 'View Configuration',
      required: true,
      description: "The list configuration, in spec's ListView shape. Validated on every save.",
    }),

    is_default: Field.boolean({
      label: 'My Default',
      defaultValue: false,
      description: "The owner's default view for this object. At most one per owner and object.",
    }),
  },

  indexes: [
    // A list page reads one owner's views of one object.
    { fields: ['user_id', 'object_name'], unique: false },
  ],

  enable: {
    trackHistory: false,
    searchable: false,
    apiEnabled: true,
    // No `apiMethods` — default-open, like `sys_user_preference`. The owner's
    // delete is not granted by any shipped set yet; see `member_default`.
  },
});
