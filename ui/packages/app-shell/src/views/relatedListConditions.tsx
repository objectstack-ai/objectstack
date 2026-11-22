/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The condition row a record page's related tab draws (objectstack#35892):
 * the list page's own Sort and Filter, `@object-ui/plugin-list`'s
 * `ListConditionsBlock`. `@object-ui/plugin-detail` draws the tab but cannot
 * import `plugin-list` (which depends on it), so the record page hands the
 * block in through `RelatedListConditionsSlotContext`. It loads with the first
 * tab that draws it, as `plugin-list` loads for the list page.
 */

import { lazy, Suspense } from 'react';
import type { RelatedListConditionsProps } from '@object-ui/plugin-detail';

const ListConditionsBlock = lazy(() =>
  import('@object-ui/plugin-list').then((m) => ({ default: m.ListConditionsBlock })),
);

/** The record page's `RelatedListConditionsSlotContext` value. */
export function renderRelatedListConditions(props: RelatedListConditionsProps) {
  return (
    <Suspense fallback={null}>
      <ListConditionsBlock {...props} />
    </Suspense>
  );
}
