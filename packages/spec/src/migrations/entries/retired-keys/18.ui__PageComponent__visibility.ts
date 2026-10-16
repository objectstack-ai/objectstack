// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #23543 F4 — ADR-0089 D2, by the maintainer's ruling F4 A on #23543 (record
// 6182001882), retired together with the view form's `visibleOn`. `visibility`
// was the page component's deprecated spelling of `visibleWhen`, folded onto
// it at parse through 17; it is a `retiredKey()` tombstone naming `visibleWhen`
// now. (An AI agent's `visibility`, retired earlier, is a different surface.)
// Stored rows keep loading through the retired D2 conversion
// `page-component-visibility-to-visibleWhen` (protocol 15); D3:
// `ui-visibility-alias-keys-retired`.
export const entry = 'ui/PageComponent:visibility';
