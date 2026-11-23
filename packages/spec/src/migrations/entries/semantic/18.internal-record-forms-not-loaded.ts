// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// objectstack-ai/objectstack#36425 — the Console's record create and edit
// surfaces stop loading an object's internal form view. No key is retired and
// no stored row is rewritten: an internal form still parses and installs, and
// steers nothing. The lint rule `form-view-internal-not-loaded` names each one.
export const entry: SemanticMigration = {
  id: 'internal-record-forms-not-loaded',
  surface:
    'view.form / view.formViews.default / view.formViews.create, and a form view item that is `isDefault` '
    + 'or named OBJECT.create — the internal create / edit form of an object',
  replacement:
    'Lay the record out with the object\'s `fieldGroups` (a master-detail sub-table is the group\'s '
    + '`relatedList`), put `required`, `requiredWhen`, `visibleWhen` and `readonlyWhen` on the fields, give '
    + 'a field `defaultValue` where the form had `defaults`, and set `showOnCreate: false` on a field the '
    + 'create should not ask for. A form shared publicly (`sharing.enabled: true`) and a form an action of '
    + 'type `form` opens by name are unchanged.',
  reason:
    'The Console\'s create dialog, edit dialog, full-page create and edit, and the create or edit an action '
    + 'opens no longer read the internal form: its `sections`, `type` (tabbed / wizard), `defaultTab`, '
    + '`tabPosition`, `subforms`, `modalSize`, `buttons`, `layout` and `defaults` change nothing, and a '
    + '`required` written on a form field entry is no longer asked for. Nothing converts it, because the '
    + 'right field groups and field rules are a judgment about the object, not a rewrite of the form.',
  acceptanceCriteria:
    '`os validate` reports no `form-view-internal-not-loaded` warning, or each one is a form you keep on '
    + 'purpose as inert. Opening New and Edit on each object that had an internal form shows the sections, '
    + 'required fields and create defaults you want, from the field groups and the field rules.',
};
