/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry } from '@object-ui/core';
import type { CommandSchema } from '@object-ui/types';
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '../../ui/command';
// `CommandItem.icon` is an authored lucide NAME that this renderer never read —
// `command-menu.json` and `file-command-palette.json` declare nine of
// them between them and drew none (objectui#5931).
//
// Routed through the RECORD surface (`icons` from 'lucide-react', reached via
// the shared `resolveIcon`), which is what `ui:button`, `action:*`,
// `ui:dropdown-menu` and `ui:context-menu` resolve against, so an unknown or
// RETIRED spelling renders NOTHING. The dynamic surface (`LazyIcon`) is
// deliberately NOT used: it degrades an unknown name to the `Database` glyph,
// trading a no-icon failure for a WRONG-icon one, recorded as ruled out for
// authored icon fields by objectui#5622 and #5633.
import { resolveIcon } from '../action/resolve-icon';

ComponentRegistry.register('command', 
  ({ schema, ...props }: { schema: CommandSchema; [key: string]: any }) => {
    const { 
        'data-obj-id': dataObjId, 
        'data-obj-type': dataObjType,
        style,
        ...commandProps
    } = props;
    
    return (
    <Command 
        className={schema.className} 
        {...commandProps}
        {...{ 'data-obj-id': dataObjId, 'data-obj-type': dataObjType, style }}
    >
      <CommandInput placeholder={schema.placeholder || 'Type a command or search...'} />
      <CommandList>
        <CommandEmpty>{schema.emptyText || 'No results found.'}</CommandEmpty>
        {schema.groups?.map((group, idx) => (
          // `CommandGroup` renders `heading` as a plain string and `CommandGroup`
          // declares no `icon` of its own, so the item arm below is this
          // component's ONLY arm that can carry one — read off the type and the
          // renderer, not assumed.
          <CommandGroup key={idx} heading={group.heading}>
            {group.items?.map((item, itemIdx) => {
              const Icon = resolveIcon(item.icon);
              return (
                <CommandItem key={itemIdx} value={item.value}>
                  {Icon && <Icon className="h-4 w-4" />}
                  {item.label}
                </CommandItem>
              );
            })}
          </CommandGroup>
        ))}
      </CommandList>
    </Command>
  );
  },
  {
    namespace: 'ui',
    label: 'Command',
    inputs: [
      { name: 'placeholder', type: 'string' },
      { name: 'emptyText', type: 'string' },
      { name: 'className', type: 'string' }
    ],
    defaultProps: {
      placeholder: 'Type a command or search...',
      emptyText: 'No results found.',
      groups: []
    }
  }
);
