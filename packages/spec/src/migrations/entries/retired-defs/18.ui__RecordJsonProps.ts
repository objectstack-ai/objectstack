// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #24162 — `ui/RecordJsonProps` (`field`, `label`, `requiredPermissions`) leaves
// with the `record:json` page element it described (ADR-0049
// enforce-or-remove), one prerelease after #23745 declared it: it was published
// in 18.0.0-next.3 only. The element was declared spec first for the approval
// request page's raw JSON panel, which the maintainer dropped, so no renderer
// was built and no page placed it, and none of the three keys was ever read.
// Its only carrier, the `ComponentPropsMap['record:json']` row, is kept as a
// whole-bag refusal (`retiredComponentProps`) that answers with the element's
// retirement prescription, and the node itself is refused by name at
// `PageComponentSchema.type`. Upgraders get the D3 semantic entry
// `ui-record-json-retired`.
export const entry = 'ui/RecordJsonProps';
