/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import { useSafeFieldLabel } from '@object-ui/react';
import type { FieldChangeEntry } from '@object-ui/types';
import type { ActivityFieldChange } from './renderers/recordActivityFeed';
import { useDetailTranslation } from './useDetailTranslation';

interface ObjectSchemaFields {
  fields?: Record<string, { label?: unknown; options?: Array<{ value?: unknown; label?: unknown }> }>;
}

/**
 * How the record page words one changed field (objectstack#36290): its label,
 * and each side of the change as this reader reads it. One reading for every
 * surface that draws a change, the activity stream's lines and a field's
 * change-history card, so the two cannot word the same change apart.
 *
 * - The label: the object's field label through the translated `fieldLabel`
 *   the record's own sections use; the machine name where no schema names it.
 * - A side, `null` when it is empty: an option by the field's option label in
 *   the reader's language (the served text, the label the writer read, when
 *   the field declares none for it), a yes/no by the pack's word, anything
 *   else by its served text.
 */
export function useFieldChangeWording(objectName: string | undefined, objectSchema: unknown) {
  const { t } = useDetailTranslation();
  const { fieldLabel, fieldOptionLabel } = useSafeFieldLabel();
  const fields = (objectSchema as ObjectSchemaFields | undefined)?.fields;

  const labelOfField = React.useCallback(
    (name: string): string => {
      const def = fields?.[name];
      const authored = typeof def?.label === 'string' && def.label ? def.label : name;
      return objectName ? fieldLabel(objectName, name, authored) : authored;
    },
    [objectName, fields, fieldLabel],
  );

  const changeSideText = React.useCallback(
    (change: FieldChangeEntry, side: 'old' | 'new'): string | null => {
      const facts = change as ActivityFieldChange;
      const option = side === 'old' ? facts.oldOption : facts.newOption;
      const value = side === 'old' ? change.oldValue : change.newValue;
      const display = side === 'old' ? change.oldDisplayValue : change.newDisplayValue;
      if (option !== undefined) {
        const options = fields?.[change.field]?.options;
        const declared = Array.isArray(options) ? options.find((o) => String(o?.value) === option) : undefined;
        const authored = typeof declared?.label === 'string' && declared.label ? declared.label : (display ?? option);
        return objectName ? fieldOptionLabel(objectName, change.field, option, authored) : authored;
      }
      if (display !== undefined && display !== '') return display;
      if (typeof value === 'boolean') {
        return value ? t('common.yes', { defaultValue: 'Yes' }) : t('common.no', { defaultValue: 'No' });
      }
      return value === null || value === undefined || value === '' ? null : String(value);
    },
    [objectName, fields, fieldOptionLabel, t],
  );

  return { labelOfField, changeSideText };
}
