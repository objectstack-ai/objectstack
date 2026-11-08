// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The lifecycle-verb → row-level-security operation mapping. Its one
 * definition lives in `@objectstack/core` (`security/lifecycle-verb-rls-operation.ts`)
 * since #30237, so plugin-sharing's write gate reads it too; this module
 * re-exports it for plugin-security's own readers.
 */
export { LIFECYCLE_VERB_RLS_OPERATION, rlsOperationForVerb } from '@objectstack/core';
