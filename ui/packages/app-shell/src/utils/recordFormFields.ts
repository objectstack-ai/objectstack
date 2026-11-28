/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The fields a record create or edit form lists — ONE answer for every
 * console host that opens one: the New/Edit dialog (`AppContent`), the
 * full-page form (`RecordFormPage`) and an action-opened form
 * (`useActionModal`), so the three draw the same fields
 * (objectstack-ai/objectstack#36425).
 *
 *  - Every field the object lists (`isObjectFieldListed`: the static `hidden`
 *    only; a `visibleWhen` is evaluated by the form, where the record is
 *    bound).
 *  - On a create, less a field declaring `showOnCreate: false`
 *    (`isFieldAskedOnFlow`). An edit lists it.
 *
 * The form lays the list out by the object's field groups; no internal form
 * view selects, orders or groups it.
 */

import { isObjectFieldListed } from '../providers/ExpressionProvider.js';
import { isFieldAskedOnFlow, type RecordFormFlow } from './recordFormNavigation.js';

export function recordFormFieldNames(fields: unknown, flow: RecordFormFlow): string[] {
  if (!fields || typeof fields !== 'object') return [];
  if (Array.isArray(fields)) {
    return fields
      .filter((f: any) => typeof f === 'string' || (isObjectFieldListed(f) && isFieldAskedOnFlow(f, flow)))
      .map((f: any) => (typeof f === 'string' ? f : f?.name))
      .filter((name): name is string => typeof name === 'string' && name !== '');
  }
  return Object.entries(fields as Record<string, any>)
    .filter(([, f]) => isObjectFieldListed(f) && isFieldAskedOnFlow(f, flow))
    .map(([name]) => name);
}
