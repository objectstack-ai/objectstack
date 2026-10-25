/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry } from '@object-ui/core';
import type { FilterBuilderSchema } from '@object-ui/types';
import { useDisplayLocale } from '@object-ui/i18n';
// Aliased on import, following PR #4169's convention (and `AppSchemaRenderer`'s
// use of it): this repo has its OWN `resolveKeyedI18nLabel` over a DIFFERENT
// vocabulary, and neither resolver accepts the other's shape. `schema.label` is
// the spec's INLINE locale map — see `BaseSchema.label` (objectui#4580).
import { resolveI18nLabel as resolveInlineI18nLabel } from '@objectstack/spec/ui';
import { FilterBuilder } from '../../custom/filter-builder';

ComponentRegistry.register('filter-builder',
  ({ schema, className, onChange, ...props }: { schema: FilterBuilderSchema; className?: string; onChange?: (event: any) => void; [key: string]: any }) => {
    // Read-time resolution against the display locale (objectui#4580 revised
    // Q1-A). `BaseSchema.label` accepts `string | I18nLabel`; rendering the map
    // straight into a text node THREW "Objects are not valid as a React child".
    const locale = useDisplayLocale();
    const handleChange = (value: any) => {
      if (onChange) {
        onChange({
          target: {
            name: schema.name,
            value: value,
          },
        });
      }
    };

    return (
      <div className={schema.wrapperClass || ''}>
        {schema.label && (
          <label className="text-sm font-medium mb-2 block">
            {resolveInlineI18nLabel(schema.label, locale)}
          </label>
        )}
        <FilterBuilder
          fields={(schema.fields || []) as any}
          value={schema.value || props.value}
          onChange={handleChange}
          className={className}
          {...props}
        />
      </div>
    );
  },
  {
    namespace: 'ui',
    label: 'Filter Builder',
    inputs: [
      { name: 'label', type: 'string' },
      { name: 'name', type: 'string', required: true },
      { 
        name: 'fields', 
        type: 'array', 
        description: 'Array of { value: string, label: string, type?: string } objects',
        required: true
      },
      { 
        name: 'value', 
        type: 'object', 
        description: 'FilterGroup object with conditions'
      }
    ],
    defaultProps: {
      label: 'Filters',
      name: 'filters',
      fields: [
        { value: 'name', label: 'Name', type: 'text' },
        { value: 'email', label: 'Email', type: 'text' },
        { value: 'age', label: 'Age', type: 'number' },
        { value: 'status', label: 'Status', type: 'text' }
      ],
      value: {
        id: 'root',
        logic: 'and',
        conditions: []
      }
    }
  }
);
