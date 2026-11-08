/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

export * from './ActionRunner.js';
// Named, not `export *`: `RegisteredAction` stays in the module as the type of
// `ActionEngine`'s private registry and off the public entry
// (objectstack#25921: zero consumers).
export {
  ActionEngine,
  ACTION_LOCATIONS,
  type ActionLocation,
  type ShortcutBinding,
} from './ActionEngine.js';
export {
  ACTION_DEF_KEYS,
  SPEC_ACTION_KEYS,
  RETIRED_ACTION_KEYS,
  warnOnUnknownActionKeys,
  // `resetActionKeyWarnings` is test-only and stays off the barrel;
  // `NAVIGATION_ALIAS_KEYS`, `HOST_DISPATCH_ACTION_KEYS`, `KNOWN_ACTION_KEYS`,
  // `classifyActionKeys`, `hasDeprecatedObjectParams` and
  // `warnOnDeprecatedObjectParams` stay in the module for `ActionRunner` and
  // its pins, off the public entry (objectstack#25921: zero consumers)
} from './actionKeys.js';
export * from './TransactionManager.js';
export * from './UndoManager.js';
export * from './bulkFastPath.js';
export * from './actionErrorDetail.js';
// Named, not `export *`: `isLegacyActionEnvelope` stays in the module for its
// in-package readers and off the public entry (objectstack#25921: zero
// consumers).
export {
  readActionPayload,
  interpretActionResponse,
  refusalFieldErrors,
  type ActionResponseOutcome,
} from './actionResponse.js';
export * from './serverActionHandler.js';
export * from './recordIdParam.js';
export * from './recordDelete.js';
export * from './navigationTarget.js';
// Named, not `export *`: `actionCopyText`, `fillTransitionalCopy` stay in the
// module for its in-package readers and off the public entry
// (objectstack#25921: zero consumers).
export {
  isActionCopyEnvelope,
  actionCopySource,
  hasTemplateHoles,
  fillTemplateHoles,
  type ActionCopyTemplate,
} from './actionCopyTemplate.js';
