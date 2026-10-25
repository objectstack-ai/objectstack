/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Re-export only. The matcher moved to `@object-ui/core`
 * (`utils/resolve-view-id.ts`) when a second layer needed it: a page
 * component's `dataSource.view` names a saved view exactly the way a nav item
 * names one, and `@object-ui/plugin-list` cannot import from app-shell
 * (objectstack#5576). Kept as a re-export so this module path — and its
 * dedicated test — stay valid.
 */
export { resolveViewId } from '@object-ui/core';
