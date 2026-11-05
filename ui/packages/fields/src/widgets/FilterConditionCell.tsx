/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The READ face of the `filter-condition` key: a list or detail cell of a
 * textual field declaring `widget: 'filter-condition'`
 * (`resolveCellRendererType`) draws the criteria the way the widget's own
 * read-only display does, as a sentence in the object's field and option
 * labels (`优先级 等于 紧急`), instead of the stored JSON. The object the
 * criteria is scoped to is the row's `object_name`, so the face reads
 * `dependentValues`, as the `recipient-picker` face does.
 *
 * The widget module loads LAZILY, on the first cell that draws one, so a page
 * that shows no criteria pays nothing; until it arrives the cell draws the
 * stored text, exactly what the text cell drew.
 */

import React from 'react';
import { EmptyValue } from '@object-ui/components';
import { isEmptyValue } from '@object-ui/core';
import { coerceToSafeValue } from '../coerceToSafeValue.js';
import type { CellRendererProps } from '../index.js';

const LazyFilterConditionField = React.lazy(() =>
  import('./FilterConditionField.js').then((m) => ({ default: m.FilterConditionField })),
);

function StoredText({ text }: { text: string }) {
  return (
    <span className="block truncate" title={text}>
      {text}
    </span>
  );
}

export function FilterConditionCell({ value, field, dependentValues }: CellRendererProps) {
  const safe = coerceToSafeValue(value);
  if (isEmptyValue(safe)) return <EmptyValue />;
  const text = String(safe);
  // The key's storage is JSON text (a `textarea`); any other value is not a
  // stored criteria and reads as the text cell reads it.
  if (typeof value !== 'string') return <StoredText text={text} />;
  return (
    <React.Suspense fallback={<StoredText text={text} />}>
      <LazyFilterConditionField
        value={value}
        onChange={ignoreChange}
        readonly
        field={field}
        dependentValues={dependentValues}
      />
    </React.Suspense>
  );
}

function ignoreChange(): void {}
