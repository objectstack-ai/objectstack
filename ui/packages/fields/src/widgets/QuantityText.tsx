/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';
import type { FieldMetadata } from '@object-ui/types';
import { useDisplayLocale } from '@object-ui/i18n';
import { useQuantityUnit } from './useQuantityUnit.js';
import { formatQuantity } from './quantity-format.js';

/**
 * A quantity with its unit (ADR-0158 R1 display): the face `NumberCellRenderer`
 * draws in a grid or detail row and `NumberField`'s read-only branch draws in
 * a form, so the three surfaces show one quantity identically.
 *
 * `record` is the row or form values the quantity sits in: a `record`-mode
 * quantity reads its code from it, and its organization picks the setting row.
 */
export function QuantityText({
  value,
  field,
  record,
  className,
}: {
  value: number;
  field: FieldMetadata;
  record?: Readonly<Record<string, unknown>> | null;
  className?: string;
}): React.ReactElement {
  const locale = useDisplayLocale();
  const unit = useQuantityUnit(field, record);
  const display = formatQuantity(value, field, unit, locale);
  return (
    <span className={className} data-quantity-unit={unit?.code}>
      {display.number}
      {display.unit ? (
        <>
          {'\u00a0'}
          <span className="text-muted-foreground" title={unit?.label ? unit.code : undefined}>
            {display.unit}
          </span>
        </>
      ) : null}
    </span>
  );
}

/**
 * A unit-code field (`text` with `unitConfig: { unitMode: 'code' }`, ADR-0158
 * Open item 8 ruled A): the code's label, with the code itself as its title,
 * or the bare code when the unit has no label to show.
 */
export function UnitCodeText({
  value,
  field,
  record,
  className,
}: {
  value: string;
  field: FieldMetadata;
  record?: Readonly<Record<string, unknown>> | null;
  className?: string;
}): React.ReactElement {
  const unit = useQuantityUnit(field, record, value);
  return (
    <span className={className} data-quantity-unit={unit?.code} title={unit?.label ? unit.code : undefined}>
      {unit?.label ?? value}
    </span>
  );
}
