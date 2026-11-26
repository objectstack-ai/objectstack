/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import {
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  EmptyValue,
  Popover,
  PopoverContent,
  PopoverTrigger,
  cn,
} from '@object-ui/components';
import { unitPickerOptions, type UnitPickerOption } from '@object-ui/core';
import type { FieldWidgetComponentProps } from './types.js';
import { toDomProps } from './toDomProps.js';
import { useFieldTranslation } from './useFieldTranslation.js';
import { useQuantityUnit, useStandardUnitLabel, useUnitCatalog } from './useQuantityUnit.js';

/**
 * UnitCodeField — the control a unit code field renders (ADR-0158 Open item 8,
 * ruled A, objectstack#37471): a `text` field declaring `unitMode: 'code'`, or
 * the `unitField` a `record`-mode quantity points at (the form stamps that
 * pointer, `withUnitCodePointer`). A searchable list of the units the server's
 * write check accepts: the organization's own non-retired units, then the
 * standard codes, each by its name in the reader's language and restricted to
 * the field's `unitDimension`. It stores the code.
 *
 * Read-only, it shows the unit's name, the face the grid and detail cells
 * draw (a retired or unreadable unit shows its bare code). A stored code the
 * list no longer offers (a unit retired since) stays selected and is shown;
 * nothing rewrites it until the user picks another.
 */
export function UnitCodeField({
  value,
  onChange,
  field,
  readonly,
  error,
  className,
  dependentValues,
  ...props
}: FieldWidgetComponentProps<string> & { dependentValues?: Record<string, unknown> }) {
  const { t } = useFieldTranslation();
  const current = typeof value === 'string' && value !== '' ? value : undefined;
  const shown = useQuantityUnit(field, dependentValues, current);
  const standardLabel = useStandardUnitLabel();
  const catalog = useUnitCatalog(!readonly);
  const [open, setOpen] = React.useState(false);

  if (readonly) {
    return current ? (
      <span className="text-sm" title={shown?.label ? current : undefined}>
        {shown?.label ?? current}
      </span>
    ) : (
      <EmptyValue />
    );
  }

  const options = unitPickerOptions(catalog, dependentValues, standardLabel, (field as { unitConfig?: unknown } | undefined)?.unitConfig);
  const own = options.filter((o) => !o.standard);
  const standard = options.filter((o) => o.standard);
  const item = (option: UnitPickerOption) => (
    <CommandItem
      key={`${option.standard ? 's' : 'o'}:${option.code}`}
      value={option.code}
      keywords={[option.label]}
      onSelect={() => {
        onChange(option.code);
        setOpen(false);
      }}
    >
      <Check className={cn('mr-2 h-4 w-4', current === option.code ? 'opacity-100' : 'opacity-0')} />
      <span className="truncate">{option.label}</span>
      {option.label !== option.code && <span className="ml-auto pl-2 text-xs text-muted-foreground">{option.code}</span>}
    </CommandItem>
  );
  const domProps = toDomProps(props);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          {...domProps}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={!!error}
          className={cn('w-full min-w-0 justify-between font-normal', className)}
          disabled={domProps.disabled}
          data-unit-code={current}
        >
          <span className="truncate">{current ? (shown?.label ?? current) : field?.placeholder || t('common.select')}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-[240px] p-0">
        <Command>
          <CommandInput placeholder={t('table.search')} />
          <CommandList>
            <CommandEmpty>{t('common.noResults')}</CommandEmpty>
            {own.length > 0 && <CommandGroup>{own.map(item)}</CommandGroup>}
            {own.length > 0 && standard.length > 0 && <CommandSeparator />}
            {standard.length > 0 && <CommandGroup>{standard.map(item)}</CommandGroup>}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
