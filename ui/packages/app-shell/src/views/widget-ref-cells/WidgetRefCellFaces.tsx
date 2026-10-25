/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The console's faces for the two widget-hinted reference keys of
 * `@object-ui/fields` (objectui#12613). A textual field declaring
 * `widget: 'object-ref'` or `widget: 'recipient-picker'` resolves to that key
 * (`resolveCellRendererType`), and these name what the stored value references
 * instead of printing the api name — the Sharing Rules list read `crm_account`
 * and `sales_manager` where the edit form reads "Account" and "Sales Manager".
 *
 * Loaded lazily by `./widget-ref-cell-renderers.tsx`; see `./refLabelDirectory.ts`
 * for where the labels come from and why the faces live in this package.
 */

import * as React from 'react';
import {
  TextCellRenderer,
  UnresolvedReferenceMark,
  coerceToSafeValue,
  objectRefOptionLabel,
  type CellRendererProps,
} from '@object-ui/fields';
import { EmptyValue, LazyIcon } from '@object-ui/components';
import { isEmptyValue } from '@object-ui/core';
import { useObjectLabel } from '@object-ui/i18n';
import { useObjectRefLabel, useRecipientLabel } from './refLabelDirectory.js';

/**
 * The stored value the directory could NOT name: raw and muted, never a blank,
 * in the shipped unresolved-reference presentation, so this state looks the
 * same here as on a lookup cell. Its tooltip is the stored value itself: the
 * lookup family's sentence names a RECORD, which an object or a position is not.
 */
function Unresolved({ text }: { text: string }) {
  return <UnresolvedReferenceMark raw={text} hint={text} />;
}

/**
 * `object-ref`: the object's icon and label, the label translated through the
 * app bundle like every other object label, with the picker's own
 * `Label (name)` spelling as its tooltip so the api name stays one hover away.
 * The icon is drawn the way the console's navigation draws an object's —
 * `LazyIcon`, which falls back to the database glyph for an object that names
 * no icon (or one Lucide does not have).
 */
export function ObjectRefCellFace({ value, field }: CellRendererProps) {
  const ref = useObjectRefLabel(value);
  const { objectLabel } = useObjectLabel();
  const safe = coerceToSafeValue(value);
  if (isEmptyValue(safe)) return <EmptyValue />;
  if (ref.state === 'resolved' && typeof value === 'string') {
    const label = objectLabel({ name: value, label: ref.label || value });
    return (
      <span className="inline-flex max-w-full items-center gap-1.5" title={objectRefOptionLabel(value, label)}>
        <LazyIcon name={ref.icon} className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" data-slot="object-ref-icon" />
        <span className="truncate">{label}</span>
      </span>
    );
  }
  if (ref.state === 'unresolved') return <Unresolved text={String(safe)} />;
  return <TextCellRenderer value={value} field={field} />;
}

/**
 * `recipient-picker`: the label of the user, team, business unit, position or
 * user column the stored value names — the label the picker shows for it.
 * Which of those it names is the row's `recipient_type`, so the face reads
 * `dependentValues`; without them it draws the stored text as the text cell
 * does.
 */
export function RecipientCellFace({ value, field, dependentValues }: CellRendererProps) {
  const ref = useRecipientLabel(value, dependentValues);
  const safe = coerceToSafeValue(value);
  if (isEmptyValue(safe)) return <EmptyValue />;
  if (ref.state === 'resolved') {
    return (
      <span className="block max-w-full truncate" title={ref.label}>
        {ref.label}
      </span>
    );
  }
  if (ref.state === 'unresolved') return <Unresolved text={String(safe)} />;
  return <TextCellRenderer value={value} field={field} />;
}
