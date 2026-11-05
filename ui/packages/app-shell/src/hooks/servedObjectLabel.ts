/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The served-object-label rule (objectstack#30311, objectstack#30390), for
 * app-shell's importers. The rule itself lives in `@object-ui/core`
 * (`utils/served-object-label.ts`) since objectstack#30486, so the related
 * list and reference rail in `@object-ui/plugin-detail`, which cannot import
 * this package, read the very same functions. ⛔ Keep this a re-export: a
 * second body here is the drift that move closed. Internal to app-shell: ⛔ not
 * re-exported from the package entry.
 *
 * @module
 */

export {
  metadataText,
  servedObjectLabel,
  servedObjectPluralLabel,
  type ObjectLabelLookup,
  type ObjectPluralLabelLookup,
} from '@object-ui/core';
