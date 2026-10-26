/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry } from '@object-ui/core';
import type { RadioGroupSchema } from '@object-ui/types';
import { RadioGroup, RadioGroupItem, Label } from '../../ui';
import { cn } from '../../lib/utils';
import { toControlValue } from './option-value';
import { toFormControlDomProps } from '../../lib/form-control-dom-props';

/**
 * The declared default (`packages/types/src/form.ts` — `@default 'vertical'`).
 * Applied here rather than left to Radix's own `undefined`, because a default
 * the type documents and nothing applies is the same declared-but-unenforced
 * defect as the key itself was (objectui#6158). Vertical is also what the
 * group has always LOOKED like — the `grid gap-2` stack — so this makes the
 * announced orientation agree with the rendered one instead of being absent.
 */
const DEFAULT_ORIENTATION = 'vertical' as const;

/**
 * Layout utilities per orientation. `vertical` deliberately names no class:
 * the `ui/radio-group` wrapper already applies `grid gap-2`, and that stack IS
 * the vertical layout. Author `className` is composed LAST so tailwind-merge
 * resolves every conflict in the author's favour — these are a default, not an
 * override.
 */
const ORIENTATION_CLASS: Record<'horizontal' | 'vertical', string | undefined> = {
  horizontal: 'flex flex-row flex-wrap items-center gap-4',
  vertical: undefined,
};

ComponentRegistry.register('radio-group', 
  ({ schema, className, ...props }: { schema: RadioGroupSchema; className?: string; [key: string]: any }) => {
    // Extract designer-related props
    const { 
        'data-obj-id': dataObjId, 
        'data-obj-type': dataObjType,
        style, 
        ...radioProps 
    } = props;

    // Forwarded BY NAME, not by reopening the spread: `toFormControlDomProps`
    // is a closed whitelist and `orientation` is not on it, which is exactly
    // the objectui#4435 route that file documents for a key like this. Radix's
    // `RadioGroup` takes `orientation` natively with the same two-value
    // vocabulary, and puts it on the root as both `aria-orientation` and (via
    // RovingFocusGroup) `data-orientation`.
    const orientation = schema.orientation ?? DEFAULT_ORIENTATION;

    return (
    // Radix speaks strings — stringify authored (possibly numeric) values for
    // the control; ids stay stable via the same stringification (#3090).
    <RadioGroup
        defaultValue={toControlValue(schema.defaultValue)}
        orientation={orientation}
        className={cn(ORIENTATION_CLASS[orientation], className)}
        {...toFormControlDomProps(radioProps)}
        // Apply designer props to the root element
        {...{ 'data-obj-id': dataObjId, 'data-obj-type': dataObjType, style }}
    >
      {schema.options?.map((item) => (
        <div key={String(item.value)} className="flex items-center space-x-2">
          <RadioGroupItem value={String(item.value)} id={`${schema.id}-${String(item.value)}`} />
          <Label htmlFor={`${schema.id}-${String(item.value)}`}>{item.label}</Label>
        </div>
      ))}
    </RadioGroup>
  );
  },
  {
    namespace: 'ui',
    label: 'Radio Group',
    inputs: [
      { name: 'defaultValue', type: 'string' },
      { name: 'id', type: 'string', required: true },
      { 
        name: 'options', 
        type: 'array', 
        description: 'Array of {label, value} objects'
      },
      { name: 'orientation', type: 'enum', enum: ['horizontal', 'vertical'] },
      { name: 'className', type: 'string' }
    ],
    defaultProps: {
      id: 'radio-group', // Will be made unique by designer's ensureNodeIds
      options: [
        { label: 'Option 1', value: 'option1' },
        { label: 'Option 2', value: 'option2' },
        { label: 'Option 3', value: 'option3' }
      ]
    }
  }
);
