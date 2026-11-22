/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The record's owner on an edit form, read-only, with the host's Change Owner
 * action beside it (objectstack#35403; the maintainer's ruling on #35315:
 * "On the default form. `owner_id` shows read-only, with the action beside
 * it.").
 *
 * ## Why a line of its own, and not the owner field
 *
 * The form never renders `owner_id` as a field and never writes it unless the
 * user changed it: `filterSystemFields` and `sanitizeFormData` read one roster
 * (`SERVER_OWNED_FIELD_NAMES`), so the default form stays free of system
 * fields. A change of owner is its own action, with its own permission and its
 * own endpoint — not an edit of a field. So the owner is SHOWN here, read-only,
 * above the form's fields, and the change is the host's action beside it.
 *
 * ## Who opts in
 *
 * A host that mounts {@link FormOwnerLineContext}. The line is drawn on an
 * edit form of a record whose object carries `owner_id`; the host's
 * `renderAction` decides whether the action appears (the Console offers
 * Change Owner where the object offers it and the explain engine allows this
 * caller to transfer this record). Without a provider nothing is drawn, so an
 * embedded form is unchanged.
 */

import * as React from 'react';
import { getLazyFieldWidget } from '@object-ui/fields';
import { useSafeFieldLabel } from '@object-ui/react';
import { FormOwnerLineContext } from './formOwnerLineContext';

/** The owner column, as the spec names it (`SystemFieldName.OWNER_ID`). */
const OWNER_FIELD = 'owner_id';

/** The `user` widget the owner is displayed with, read-only (lazy until drawn). */
const UserWidget = getLazyFieldWidget('user');

const noop = () => {};

/** The owner field's own definition, or `undefined` when the object carries none. */
function ownerFieldOf(objectSchema: unknown): Record<string, unknown> | undefined {
  const fields = (objectSchema as { fields?: unknown } | null | undefined)?.fields;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return undefined;
  if (!Object.prototype.hasOwnProperty.call(fields, OWNER_FIELD)) return undefined;
  const def = (fields as Record<string, unknown>)[OWNER_FIELD];
  return def && typeof def === 'object' ? (def as Record<string, unknown>) : {};
}

export interface FormOwnerLineProps {
  mode?: string;
  objectName: string;
  recordId?: string | number | null;
  /** The record the form read; `null` while it has not. */
  record: Record<string, unknown> | null | undefined;
  objectSchema: unknown;
}

/** The read-only owner line, drawn under a {@link FormOwnerLineContext} host only. */
export function FormOwnerLine({ mode, objectName, recordId, record, objectSchema }: FormOwnerLineProps) {
  const host = React.useContext(FormOwnerLineContext);
  const { fieldLabel } = useSafeFieldLabel();
  const ownerField = ownerFieldOf(objectSchema);
  if (!host || mode !== 'edit' || recordId == null || recordId === '' || !record || !ownerField) return null;
  const declared = typeof ownerField.label === 'string' && ownerField.label ? ownerField.label : 'Owner';
  const label = fieldLabel(objectName, OWNER_FIELD, declared);
  const field = { name: OWNER_FIELD, type: 'user', label, readonly: true };
  return (
    <div className="mb-4 grid gap-1.5" data-testid="form-owner-line">
      <span className="text-sm font-medium" id="form-owner-line-label">{label}</span>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1" aria-labelledby="form-owner-line-label">
          <React.Suspense fallback={<div className="h-10 animate-pulse rounded-md bg-muted" aria-hidden="true" />}>
            <UserWidget value={record[OWNER_FIELD] ?? null} onChange={noop} field={field as never} readonly />
          </React.Suspense>
        </div>
        {host.renderAction({
          objectName,
          recordId: String(recordId),
          record,
          objectSchema: objectSchema as Record<string, unknown>,
        })}
      </div>
    </div>
  );
}
