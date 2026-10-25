/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry } from '@object-ui/core';
import type { SwitchSchema } from '@object-ui/types';
import { Switch, Label } from '../../ui';
import { toFormControlDomProps } from '../../lib/form-control-dom-props';

ComponentRegistry.register('switch', 
  ({ schema, className, ...props }: { schema: SwitchSchema; className?: string; [key: string]: any }) => {
    // Extract designer-related props
    const { 
        'data-obj-id': dataObjId, 
        'data-obj-type': dataObjType,
        style, 
        ...switchProps 
    } = props;

    return (
    <div 
        className={`flex items-center space-x-2 ${schema.wrapperClass || ''}`}
        data-obj-id={dataObjId}
        data-obj-type={dataObjType}
        style={style}
    >
      <Switch id={schema.id} className={className} {...toFormControlDomProps(switchProps)} />
      <Label htmlFor={schema.id}>{schema.label}</Label>
    </div>
  );
  },
  {
    namespace: 'ui',
    label: 'Switch',
    inputs: [
      { name: 'label', type: 'string', required: true },
      { name: 'id', type: 'string', required: true },
      { name: 'checked', type: 'boolean' }
    ],
    defaultProps: {
      label: 'Switch label',
      id: 'switch-field' // Will be made unique by designer's ensureNodeIds
    }
  }
);
