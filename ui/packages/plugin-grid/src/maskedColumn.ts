/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { isMaskedFieldType } from '@object-ui/fields';

/**
 * Is this grid column's cell drawn as a MASK, given the type the column
 * carries, the type the object schema declares for its field, and whether the
 * object's field types are known yet? (objectui#10583, objectui#10657)
 *
 * `ObjectGrid` stamps `TableColumn.masked` from this answer, and `data-table`
 * obeys the flag: no Ctrl+C / Cmd+C copy, no `title` tooltip, no column in its
 * CSV export, no inline edit, no client search or sort, no auto width from the
 * values. `ObjectGrid` also asks it directly where it handles values itself:
 * its client export (CSV and JSON) leaves masked fields out, its mobile card
 * draws them through `cell`, and its grouping refuses them as keys.
 * `@object-ui/components` cannot import `@object-ui/fields`, which is why the
 * answer is computed HERE, on the producer side, and handed across as a flag.
 *
 * The rule itself is NOT restated here — it is `isMaskedFieldType()` from
 * `@object-ui/fields`, the one authority for "is this field type's cell drawn
 * as a mask" (objectui#8686). A type the fields package masks, declared
 * (`password`, `secret`) or registered at runtime, sets the flag with no edit
 * to this file. The detail page asks the same authority through the same shape
 * (`isMaskedDetailFieldType` in `@object-ui/plugin-detail`, objectui#8440).
 *
 * **Narrow-only**: the answer is the UNION of the two types, so an authored
 * column `type` can add the refusal but never withdraw it (objectui#3355). A
 * view authoring `type: 'text'` over an object column declared `secret` keeps
 * the flag: a PRESENTATION override has no business widening access to a
 * credential. The declared cost is the mirror case — an object `text` column
 * a view authors as `password` is masked AND flagged, which is the answer its
 * cell already gives.
 *
 * **Fail closed while the object's types are unknown** (the third argument,
 * see {@link isWithheldGridColumn}): a column with no type of its own is
 * answered as masked until they are known, and for good if their read failed.
 * The argument is required so that no caller can forget the window.
 */
export function isMaskedGridColumn(
  columnType: unknown,
  objectFieldType: unknown,
  objectTypesPending: boolean,
): boolean {
  return isMaskedType(columnType)
    || isMaskedType(objectFieldType)
    || isWithheldGridColumn(columnType, objectTypesPending);
}

/**
 * Is this grid column WITHHELD: handled as masked because nothing can say yet
 * whether it is? (objectui#10657, which folded objectui#10706)
 *
 * An untyped view column over an object field takes its type from the object
 * schema. While an object-bound grid is still waiting for that schema (its
 * rows can paint first: a host hands them down as `data`), or after the read
 * failed, the column's field could be a `password` / `secret` one, and
 * drawing it as text would print the credential. So the column is withheld:
 * its cell draws the mask (`MaskedCellRenderer` from `@object-ui/fields`),
 * it carries the masked flag, and every path `isMaskedGridColumn` guards
 * treats it as masked. It is never drawn as text in the meantime, and it stays
 * withheld when the read fails (fail closed).
 *
 * A column that authors its own `type` is not withheld: that type decides its
 * draw (`type: 'password'` masks, `type: 'text'` draws the text it was told
 * to), exactly as it does once the schema has loaded. A host that already
 * holds the object's fields hands them to the grid (`objectFields`, as
 * `ListView` does), so there is no window to withhold anything in.
 *
 * `objectTypesPending` is the grid's own reading: an object to ask about, a
 * data source that can answer `getObjectSchema`, and no field catalogue in
 * hand. With no `getObjectSchema` there is nothing to wait for, and the
 * authored column types are all the grid will ever know.
 */
export function isWithheldGridColumn(columnType: unknown, objectTypesPending: boolean): boolean {
  return objectTypesPending && !(typeof columnType === 'string' && columnType.length > 0);
}

function isMaskedType(fieldType: unknown): boolean {
  return typeof fieldType === 'string' && isMaskedFieldType(fieldType);
}
