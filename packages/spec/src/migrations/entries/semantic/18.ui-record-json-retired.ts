// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #24162 — the D3 record of the `record:json` retirement (ADR-0049
// enforce-or-remove; the maintainer dropped face 4 of the objectui#12438
// ruling C, the approval request page's raw JSON panel `record:json` was
// declared for in #23745, and the element shipped in the 18.0.0-next.3
// prerelease only). Refused BY NAME through `RETIRED_PAGE_COMPONENT_TYPES`,
// the `ai:chat_window` shape. There is no D2 half: the element's three keys
// left with its props def, so there is no key a walker could strip and leave a
// valid node behind, and deleting an authored page node is a layout decision a
// mechanical conversion must not make (the `element-filter-removed` docblock's
// rule). What the chain owes the upgrader is the delegation itself, in writing.
//
// The replacement is not new prose: it is the node-level refusal message in
// `RETIRED_PAGE_COMPONENT_TYPES` (ui/page.zod.ts), so the door that refuses and
// the chain that prescribes carry one instruction. No replacement panel is
// named, by ruling.
export const entry: SemanticMigration = {
  id: 'ui-record-json-retired',
  surface:
    'page.component.record:json — the component node, with every key its props bag '
    + 'declared (`field`, `label`, `requiredPermissions`), in regions, named slots and nested '
    + 'containers alike',
  replacement:
    'Delete the component node and put nothing in its place: a record drawn as raw JSON is not '
    + 'a page element, and no replacement panel exists by ruling. `field`, `label` and '
    + '`requiredPermissions` have no counterpart: none of them was ever read',
  reason:
    '`record:json` was declared in the 18.0.0-next.3 prerelease for one face only, the approval '
    + 'request page\'s raw JSON panel, and the maintainer dropped that face: the person deciding '
    + 'an approval has no business need to read the request as JSON. So no renderer was built, '
    + 'no page placed it, and its one planned producer was closed unmerged — zero consumers were '
    + 'measured in objectstack and objectui. A declared element nothing draws is a capability '
    + 'claim nothing keeps, so the name is now refused at `PageComponentSchema.type`, its '
    + '`ComponentPropsMap` row refuses every props bag with the same prescription, and the enum '
    + 'no longer lists it. No conversion is registered, because the only edit is deleting the '
    + 'node, and which region closes up or holds something else is the author\'s judgment about '
    + 'a page they composed — this entry is that delegation',
  acceptanceCriteria:
    'No `record:json` component remains in any page — regions, named slots and nested containers '
    + 'alike. `os validate` is clean: a remaining node is reported at its own `type` path with '
    + '`params.retiredComponentType` naming `record:json`, so each one is named individually '
    + 'rather than as one page-level failure. Replaying the 17 → 18 chain over the edited source '
    + 'then reports the migrated stack schema-valid — `schemaValid: true` in `--json`',
};
