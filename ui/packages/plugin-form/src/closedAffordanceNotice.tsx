/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';
import { Lock } from 'lucide-react';
import { createSafeTranslation } from '@object-ui/i18n';
import { useSafeFieldLabel } from '@object-ui/react';
import type { ClosedFormAffordance } from './fieldWriteGate';

/**
 * The sentence a form shows when the managed-object lock (ADR-0092 D4) has
 * disabled every field because the object's affordance for the form's mode is
 * CLOSED for this user (objectui#11000).
 *
 * ## The defect
 *
 * `gateFormFields` locks every drawn field when `create` (on a create form) or
 * `edit` (on an edit form) is closed: the object's `managedBy` bucket keeps it
 * closed, or the server's effective API operation set for the user lacks it.
 * The lock is right, and the server refuses the write as well. But nothing on
 * the form said why: a member without `create` on an object met a form whose
 * every input refused typing, and a wizard whose Next still invited them on.
 *
 * ## What this renders
 *
 * One sentence, naming the object by its localized label and the missing
 * permission, above the fields where the user is looking. Every container that
 * draws the lock renders it through this one component, fed the one verdict the
 * lock itself reads (`closedFormAffordance` in `fieldWriteGate.ts`), so it
 * shows exactly when the form-wide lock is drawn. A per-field lock (a field the
 * caller may read but not edit, a `readonly` field) never shows it: the form's
 * affordance is open there.
 *
 * `role="status"`, the package's pattern for a form state (`UploadInFlightNotice`):
 * nothing has failed, and an assertive live region would interrupt a
 * screen-reader user as the form opens.
 */
const useClosedAffordanceTranslation = createSafeTranslation(
  {
    // Must stay byte-identical to the `en` pack values — `pnpm check:i18n-keys`
    // compares this table against them. What a provider-less host renders.
    'form.noPermissionToCreate': "You don't have permission to create {{object}} records. The fields are read-only.",
    'form.noPermissionToEdit': "You don't have permission to edit {{object}} records. The fields are read-only.",
  },
  'form.noPermissionToCreate',
);

export interface ClosedAffordanceNoticeProps {
  /** `closedFormAffordance`'s answer for the form; nothing renders when `undefined`. */
  affordance: ClosedFormAffordance | undefined;
  /** The form's object. Its label is resolved the way the console resolves it. */
  objectName: string;
  /** The object schema the form resolved; its `label` is the fallback label. */
  objectSchema: { label?: unknown } | null | undefined;
}

export function ClosedAffordanceNotice({
  affordance,
  objectName,
  objectSchema,
}: ClosedAffordanceNoticeProps): React.ReactElement | null {
  const labels = useSafeFieldLabel();
  const { t } = useClosedAffordanceTranslation();
  if (!affordance) return null;

  // The object's label: the app's translation of it when one is loaded
  // (`useObjectLabel`'s convention key), else the label the object declares,
  // else its name.
  const declared =
    typeof objectSchema?.label === 'string' && objectSchema.label ? objectSchema.label : objectName;
  const object =
    'objectLabel' in labels ? labels.objectLabel({ name: objectName, label: declared }) : declared;
  const message =
    affordance === 'edit'
      ? t('form.noPermissionToEdit', { object })
      : t('form.noPermissionToCreate', { object });

  return (
    <p
      role="status"
      className="mb-4 flex items-start gap-2 rounded-md border bg-muted/50 px-3 py-2 text-sm text-muted-foreground"
      data-testid="closed-affordance-notice"
      data-affordance={affordance}
    >
      <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{message}</span>
    </p>
  );
}
