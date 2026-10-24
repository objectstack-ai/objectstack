// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * fieldTypeName — the name Studio shows an author for a field type, in the
 * designer locale.
 *
 * A type is named by its catalog row's `engine.fieldType.<id>` string
 * (`select` reads "Picklist" in en-US), the row the type picker
 * (`FieldTypePicker`) and the metadata form canvas (`ObjectFormCanvas`) read,
 * never by the spec id the metadata stores. A type the catalog
 * (`FIELD_TYPE_META`) does not list has no row, so it is shown as itself.
 *
 * Its own module beside the catalog, so a surface outside this folder (the
 * Studio form designer's field card, objectui#13148) reads the name through
 * this one lookup instead of spelling the key again, and `field-types.ts`
 * stays free of the string tables. That the card and the picker agree is
 * pinned by `ObjectFormDesigner.typeName-13148.test.tsx`, which compares the
 * two as rendered.
 */

import { FIELD_TYPE_META, type FieldTypeId } from './field-types.js';
import { t, type SupportedLocale } from '../i18n.js';

/**
 * The display name of `type` in `locale`: its `engine.fieldType.<id>` row when
 * the catalog lists it, else `type` itself. Own keys only, so an inherited
 * object key (`toString`) is an unlisted type, not a catalog row.
 */
export function fieldTypeName(type: string, locale?: SupportedLocale | string): string {
  return Object.prototype.hasOwnProperty.call(FIELD_TYPE_META, type)
    ? t(`engine.fieldType.${FIELD_TYPE_META[type as FieldTypeId].id}`, locale)
    : type;
}
