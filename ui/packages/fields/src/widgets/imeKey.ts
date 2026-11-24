/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The input-method key guard every widget in this package that reads its own
 * keys asks. It is NOT defined here: the one definition is `isImeKey` on the
 * `@object-ui/components` entry (objectstack#35996), which the list grid asks
 * too. This module only passes it through so the widgets keep one local
 * import path; it is not re-exported from this package's entry.
 */
export { isImeKey } from '@object-ui/components';
