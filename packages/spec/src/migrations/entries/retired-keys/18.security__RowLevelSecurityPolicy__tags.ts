// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #20321 (ADR-0049 enforce-or-remove; graded RETIRE by the maintainer's
// criterion for declared-but-unenforced families — does a mainstream platform
// have the capability?). `RowLevelSecurityPolicy.tags` promised categorization
// and reporting for governance and compliance, and nothing ever read it: the
// RLS compiler never consults it, objectui's permission preview renders only
// the policy count and its policy editor neither seeds nor reads the key, and
// cloud has no reader. No mainstream platform tags a row-level policy. The
// policy shape is `strictObject`, but the def is reachable from the
// `permission` metadata root, so the route is the `retiredKey()` tombstone
// (the `rls.priority` posture one key over): the key stays in the walked shape
// as `[RETIRED]`, and authoring it is a tsc error and a parse error carrying
// the prescription. D2: `permission-rls-tags-removed`; D3:
// `permission-rls-tags-retired`.
export const entry = 'security/RowLevelSecurityPolicy:tags';
