/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import {
  cn,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SortBuilder,
} from '@object-ui/components';
import { cva } from 'class-variance-authority';
import { ArrowUp } from 'lucide-react';
import type { SortItem } from '@object-ui/components';
import type { SortUISchema } from '@object-ui/types';
import { notifyViewHandlerChannels } from './viewHandlerChannels';

export type SortUIProps = {
  schema: SortUISchema;
  className?: string;
  onChange?: (sort: SortUISchema['sort']) => void;
  [key: string]: any;
};

type SortEntry = {
  field: string;
  direction: 'asc' | 'desc';
};

const sortContainerVariants = cva('', {
  variants: {
    variant: {
      buttons: 'flex flex-wrap gap-2',
      dropdown: 'flex flex-wrap items-center gap-3',
      builder: 'space-y-3',
    },
  },
  defaultVariants: {
    variant: 'dropdown',
  },
});

const toSortEntries = (sort?: SortUISchema['sort']): SortEntry[] => {
  if (!sort) return [];
  return sort.map(item => ({
    field: item.field,
    direction: item.direction,
  }));
};

const toSortItems = (sort: SortEntry[]): SortItem[] => {
  return sort.map(item => ({
    id: `${item.field}-${item.direction}`,
    field: item.field,
    order: item.direction,
  }));
};

const toSortEntriesFromItems = (items: SortItem[]): SortEntry[] => {
  return items
    .filter(item => item.field)
    .map(item => ({
      field: item.field,
      direction: item.order,
    }));
};

export const SortUI: React.FC<SortUIProps> = ({
  schema,
  className,
  onChange,
}) => {
  const [sortState, setSortState] = React.useState<SortEntry[]>(() => toSortEntries(schema.sort));
  const [builderItems, setBuilderItems] = React.useState<SortItem[]>(() => toSortItems(toSortEntries(schema.sort)));

  React.useEffect(() => {
    const entries = toSortEntries(schema.sort);
    setSortState(entries);
    setBuilderItems(toSortItems(entries));
  }, [schema.sort]);

  const notifyChange = React.useCallback((nextSort: SortEntry[]) => {
    setSortState(nextSort);
    // Host function, then the authored event name (objectui#6124). The helper
    // calls the prop only when it is a function: through `SchemaRenderer` the
    // prop can hold the authored string (objectui#10616).
    notifyViewHandlerChannels(onChange, schema.onChange, nextSort, { sort: nextSort });
  }, [onChange, schema.onChange]);

  const handleToggle = React.useCallback((field: string) => {
    const existing = sortState.find(item => item.field === field);
    const multiple = Boolean(schema.multiple);

    if (!existing) {
      const next = multiple
        ? [...sortState, { field, direction: 'asc' as const }]
        : [{ field, direction: 'asc' as const }];
      notifyChange(next);
      return;
    }

    if (existing.direction === 'asc') {
      const next = sortState.map(item =>
        item.field === field ? { ...item, direction: 'desc' as const } : item
      );
      notifyChange(next);
      return;
    }

    const next = sortState.filter(item => item.field !== field);
    notifyChange(next);
  }, [notifyChange, schema.multiple, sortState]);

  const variant = schema.variant || 'dropdown';

  if (variant === 'buttons') {
    return (
      <div className={cn(sortContainerVariants({ variant: 'buttons' }), className)}>
        {schema.fields.map(field => {
          const current = sortState.find(item => item.field === field.field);
          // Single icon that rotates between asc (0°) and desc (180°) so
          // toggling direction is a smooth, motion-safe transition rather
          // than a hard icon swap.
          return (
            <Button
              key={field.field}
              type="button"
              variant={current ? 'secondary' : 'outline'}
              size="sm"
              onClick={() => handleToggle(field.field)}
              className="gap-2"
            >
              <span>{field.label || field.field}</span>
              {current && (
                <ArrowUp
                  className={cn(
                    'h-3.5 w-3.5 motion-safe:transition-transform motion-safe:duration-200',
                    current.direction === 'desc' && 'rotate-180'
                  )}
                  aria-label={current.direction === 'asc' ? 'ascending' : 'descending'}
                />
              )}
            </Button>
          );
        })}
      </div>
    );
  }

  if (schema.multiple) {
    return (
      <div className={cn(sortContainerVariants({ variant: 'builder' }), className)}>
        <SortBuilder
          fields={schema.fields.map(field => ({ value: field.field, label: field.label || field.field }))}
          value={builderItems}
          onChange={(items) => {
            setBuilderItems(items);
            notifyChange(toSortEntriesFromItems(items));
          }}
        />
      </div>
    );
  }

  const singleSort = sortState[0];

  return (
    <div className={cn(sortContainerVariants({ variant: 'dropdown' }), className)}>
      <Select
        value={singleSort?.field || ''}
        onValueChange={(value) => {
          if (!value) {
            notifyChange([]);
            return;
          }
          notifyChange([{ field: value, direction: singleSort?.direction || 'asc' }]);
        }}
      >
        <SelectTrigger className="w-56">
          <SelectValue placeholder="Select field" />
        </SelectTrigger>
        <SelectContent>
          {schema.fields.map(field => (
            <SelectItem key={field.field} value={field.field}>
              {field.label || field.field}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={singleSort?.direction || 'asc'}
        onValueChange={(value) => {
          if (!singleSort?.field) return;
          notifyChange([{ field: singleSort.field, direction: value as 'asc' | 'desc' }]);
        }}
      >
        <SelectTrigger className="w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="asc">Ascending</SelectItem>
          <SelectItem value="desc">Descending</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
};
