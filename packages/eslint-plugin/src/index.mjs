// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// One plugin object per rule namespace. The root `eslint.config.mjs` registers
// each under its historical prefix (`slot-lookup`, `query-options`,
// `verify-stand-in`, `comment-swallow`), so every rule id is unchanged.

export { SLOT_LOOKUP_ANY_MESSAGE, slotLookupPlugin } from './slot-lookup.mjs';
export { QUERY_OPTIONS_ANY_MESSAGE, queryOptionsPlugin } from './query-options.mjs';
export { VERIFY_STAND_IN_MESSAGE, verifyStandInPlugin } from './verify-stand-in.mjs';
export {
  COMMENT_SWALLOW_FILES,
  COMMENT_SWALLOW_MESSAGE,
  COMMENT_SWALLOW_PATTERNS,
  commentSwallowPlugin,
  looksLikeSwallowedCode,
} from './comment-swallow.mjs';
