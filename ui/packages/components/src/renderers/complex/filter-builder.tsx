/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry } from '@object-ui/core';
import type { FilterBuilderSchema, FilterGroup } from '@object-ui/types';
import { useDisplayLocale } from '@object-ui/i18n';
// Aliased on import, following PR #4169's convention (and `AppSchemaRenderer`'s
// use of it): this repo has its OWN `resolveKeyedI18nLabel` over a DIFFERENT
// vocabulary, and neither resolver accepts the other's shape. `schema.label` is
// the spec's INLINE locale map — see `BaseSchema.label` (objectui#4580).
import { resolveI18nLabel as resolveInlineI18nLabel, VIEW_FILTER_OPERATORS } from '@objectstack/spec/ui';
import { FilterBuilder, type FilterBuilderRowGroup } from '../../custom/filter-builder';
import type { RendererHostProps } from '../../lib/renderer-host-props';

const PROTOCOL_OPERATOR_IDS: ReadonlySet<string> = new Set(VIEW_FILTER_OPERATORS);

/**
 * Is every row of the builder's group on the protocol's operator vocabulary,
 * i.e. is it the `FilterGroup` that `FilterBuilderSchema.onChange` declares?
 *
 * The builder's own row also admits the opt-in `exists` / `notExists`, which a
 * `FilterGroup` cannot carry. This node never grants them: `FilterBuilderSchema`
 * declares no `extraOperators`, and the renderer below keeps a host's
 * `extraOperators` out of the builder. Its `value` is a `FilterGroup`, whose zod
 * mirror refuses an operator outside the protocol. A group that fails here
 * therefore came from a stored `value` that skipped that validation.
 */
function isAuthoredFilterGroup(group: FilterBuilderRowGroup): group is FilterBuilderRowGroup & FilterGroup {
  return group.conditions.every((condition) => PROTOCOL_OPERATOR_IDS.has(condition.operator));
}

ComponentRegistry.register('filter-builder',
  // `value` is declared because it is read by name: a host that binds the node
  // (a form field) forwards the group it holds, the same authored `FilterGroup`
  // the node's own `value` is.
  //
  // `onChange` is typed by the schema's own declaration and is called with the
  // group (#26382). It was typed `(event: any) => void` and called with a
  // form-style `{ target: { name, value } }` event, so a handler written from
  // `FilterBuilderSchema.onChange` read `.logic` / `.conditions` off the event
  // and got `undefined`, and the `any` kept the compiler from saying so.
  //
  // `extraOperators` is taken out of the host spread and never reaches
  // `FilterBuilder`. It is the builder's only operator-granting prop, and what
  // it grants (`exists` / `notExists`) is outside the `FilterGroup` that
  // `onChange` declares. `FilterBuilderSchema` declares no such key, so a host
  // that forwards one is off contract, and the builder offers only protocol
  // operators.
  ({ schema, className, onChange, extraOperators: _refusedExtraOperators, ...props }: { schema: FilterBuilderSchema; className?: string; onChange?: FilterBuilderSchema['onChange']; value?: FilterGroup; [key: string]: unknown } & RendererHostProps) => {
    // Read-time resolution against the display locale (objectui#4580 revised
    // Q1-A). `BaseSchema.label` accepts `string | I18nLabel`; rendering the map
    // straight into a text node THREW "Objects are not valid as a React child".
    const locale = useDisplayLocale();
    const handleChange = (group: FilterBuilderRowGroup) => {
      if (!onChange) return;
      // No dropdown on this node offers an operator outside the protocol, so
      // only a stored `value` that skipped its zod validation reaches this
      // branch. Handing the group on would make the declared `FilterGroup`
      // false, and a throw here would crash a click in the user's hands, so the
      // emit is skipped and the console names the operator.
      if (!isAuthoredFilterGroup(group)) {
        const offending = group.conditions.find((condition) => !PROTOCOL_OPERATOR_IDS.has(condition.operator));
        console.error(
          `filter-builder: onChange not called. A row holds the operator "${offending?.operator}", which is ` +
            "outside the protocol's view-filter operators, so the FilterGroup that onChange hands over cannot carry it. " +
            'Fix the stored filter value.',
        );
        return;
      }
      onChange(group);
    };

    return (
      <div className={schema.wrapperClass || ''}>
        {schema.label && (
          <label className="text-sm font-medium mb-2 block">
            {resolveInlineI18nLabel(schema.label, locale)}
          </label>
        )}
        <FilterBuilder
          fields={schema.fields || []}
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
