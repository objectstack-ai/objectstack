/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The message of a record save (`ux-conventions.write-feedback`): the save
 * names the record it wrote — `Task "Quarterly review" created`.
 *
 * ONE builder for every save surface: the console's record dialogs, the
 * record form page and the `object-form` block's drawer and modal containers.
 * It lives here, below both `@object-ui/app-shell` and
 * `@object-ui/plugin-form`, because its four keys live in this package's packs
 * and both of those packages already depend on it.
 *
 * @module recordSaveMessage
 */

import { getRecordDisplayName } from '@object-ui/core';
import type { TranslateFn } from './translateFn.js';

export interface RecordSaveMessageInput {
  /** The singular label of the saved record's object, already translated. */
  label: string;
  /** The definition of the object being saved; may be absent or partial. */
  objectDef: unknown;
  /** The record the write answered with. */
  saved: unknown;
  /** `create` for an insert, `edit` for an update. */
  mode: 'create' | 'edit';
}

/**
 * The record-named save message, or the object-label message when the record
 * has nothing nameable.
 *
 * The name is the saved record's display name from the ONE ADR-0079 resolver,
 * read through the object being saved. The resolver's floor (`Record #<id>`,
 * or the empty fallback for an id-less row) is not a name, so such a record
 * keeps the object-label message.
 */
export function recordSaveMessage(t: TranslateFn, input: RecordSaveMessageInput): string {
  const { label, objectDef, saved, mode } = input;
  const resolved = saved && typeof saved === 'object'
    ? getRecordDisplayName(objectDef, saved, { fallback: '' })
    : '';
  const record = saved && typeof saved === 'object' ? (saved as { id?: unknown; _id?: unknown }) : undefined;
  const id = record?.id ?? record?._id;
  const title = resolved && !(id !== null && id !== undefined && resolved === `Record #${id}`)
    ? resolved
    : undefined;
  if (mode === 'create') {
    return title
      ? t('form.createdNamed', { object: label, title })
      : t('form.createSuccess', { object: label });
  }
  return title
    ? t('form.updatedNamed', { object: label, title })
    : t('form.updateSuccess', { object: label });
}
