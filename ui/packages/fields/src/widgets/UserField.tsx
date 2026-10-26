import React from 'react';
import { FieldWidgetComponentProps } from './types.js';
import { LookupField } from './LookupField.js';

/**
 * UserField — person picker for the `user` field type.
 *
 * `user` is a lookup specialized to the `sys_user` system object (see framework
 * "lookup → sys_user" specialization). Rather than re-implement candidate search,
 * the searchable picker, the record-picker dialog and id resolution, this widget
 * **delegates to the shared {@link LookupField}** with the reference fixed to
 * `sys_user`. The author writes `Field.user({ multiple })`; we normalise the field
 * metadata so the lookup machinery targets users with a sensible display field.
 *
 * Table-cell display (avatars / initials) is handled separately by
 * `UserCellRenderer`; this is the form/editor widget.
 *
 * By default the user picker is the search-first {@link PeoplePicker}
 * (`picker: 'search'`) with a department·email subtitle, avatar, and banned
 * users excluded from candidates. Authors can override any of these, or opt
 * back to the classic table dialog with `picker: 'default'`.
 */

/** Exclude deactivated (`banned`) users unless the author already filters on it. */
function withBannedFilter(filters?: any[]): any[] {
  const base = Array.isArray(filters) ? filters : [];
  return base.some(f => f?.field === 'banned')
    ? base
    : [...base, { field: 'banned', operator: 'ne', value: true }];
}

export function UserField(props: FieldWidgetComponentProps<any>) {
  const raw = props.field as any;

  // The objectSchema field metadata may live directly on `field`, or nested at
  // `field.field` — the form renderer's declared metadata slot (objectui#3090).
  // Mirror the unwrap LookupField itself performs. (Formerly attributed to the
  // docs-demo `createFieldRenderer` wrapper, removed in objectui#3910.)
  const metaIsNested = raw?.field && typeof raw.field === 'object'
    && ('reference' in raw.field || 'type' in raw.field);
  const meta = metaIsNested ? raw.field : raw;

  // The picker always targets sys_user, presents user names by default, and
  // defaults to the search-first PeoplePicker with sensible person display +
  // candidate hygiene. The target is a constant of the `user` type
  // (objectstack#24952): the spec refuses a foreign `reference` on a `user`
  // field and `referenceTargetOf` resolves every `user` field to `sys_user`, so
  // an authored `reference` is not read — a stored body that still carries a
  // foreign one picks users, as the runtime resolves it.
  const normalized = {
    ...(meta || {}),
    reference: 'sys_user',
    displayField: meta?.displayField || meta?.reference_field || 'name',
    picker: meta?.picker ?? 'search',
    subtitle: meta?.subtitle ?? ['primary_business_unit_id.name', 'email'],
    avatar_field: meta?.avatar_field ?? meta?.avatarField ?? 'image',
    lookupFilters: withBannedFilter(meta?.lookupFilters),
  };

  const fieldProp = metaIsNested ? { ...raw, field: normalized } : normalized;

  return <LookupField {...(props as any)} field={fieldProp} />;
}
