/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';

/**
 * `true` inside the record page's related column (objectstack#26678): a
 * fixed rail about 20rem wide, where a related list draws as a card — title,
 * count, its first rows, View All, New — instead of a table cut off at the
 * column's edge. `RelatedList` then keeps its first column (the row's
 * identity: no second column fits beside it) and lets its header wrap so the
 * title is never squeezed out by the actions.
 *
 * Set by `RecordPageColumns` only, so a related list anywhere else — the
 * Related tab, an authored page — draws exactly as before. Package-internal:
 * not exported from the barrel.
 */
export const RelatedListCompactContext = React.createContext(false);
