// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #21504 — the D3 record of the `ai:chat_window` retirement (ADR-0049
// enforce-or-remove; triage ruling 5963897014: retire, refused BY NAME through
// `RETIRED_PAGE_COMPONENT_TYPES`, the `user:profile` precedent of #14159). There
// is no D2 half: the element's four keys left with its props def, so there is no
// key a walker could strip and leave a valid node behind, and deleting an
// authored page node is a layout decision a mechanical conversion must not make
// (the `element-filter-removed` docblock's rule). What the chain owes the
// upgrader is the delegation itself, in writing — the `element:filter` /
// `element:form` node entry's shape, for a node the parse now refuses by name.
//
// The replacement is not new prose: it is the node-level refusal message in
// `RETIRED_PAGE_COMPONENT_TYPES` (ui/page.zod.ts), so the door that refuses and
// the chain that prescribes carry one instruction.
export const entry: SemanticMigration = {
  id: 'ui-ai-chat-window-retired',
  surface:
    'page.component.ai:chat_window — the component node, with every key its props bag '
    + 'declared (`mode`, `agentId`, `context`, `aria`), in regions, named slots and nested '
    + 'containers alike',
  replacement:
    'Delete the component node and put nothing in its place: AI chat is not a page element, '
    + 'and the floating chat overlay the console mounts on every page is the supported entry '
    + 'point. To choose which platform agent the overlay answers with — what `agentId` reached '
    + 'for — set the app\'s `defaultAgent` (a platform agent: `ask`, or `build` on an authoring '
    + 'surface). `mode`, `context` and `aria` have no counterpart on the page: none of them was '
    + 'ever read, and the overlay is not configured per page',
  reason:
    'No renderer for `ai:chat_window` ever shipped in objectui, framework or cloud, and none is '
    + 'wanted: the console leaves it unregistered on purpose so that a page naming it fails '
    + 'loudly, and Studio\'s page palette excludes it. So the element and its four keys were a '
    + 'capability claim nothing kept — a page that placed one validated clean and drew "Unknown '
    + 'component type" in front of an end user. Zero producers were measured in objectstack, '
    + 'cloud and hotcrm (one comment naming it as dropped). The name is now refused at '
    + '`PageComponentSchema.type`, its `ComponentPropsMap` row refuses every props bag with the '
    + 'same prescription, and the enum no longer lists it; `ai:suggestion` is unchanged. No '
    + 'conversion is registered, because the only edit is deleting the node, and which region '
    + 'closes up, holds something else, or keeps its slot is the author\'s judgment about a '
    + 'page they composed — this entry is that delegation',
  acceptanceCriteria:
    'No `ai:chat_window` component remains in any page — regions, named slots and nested '
    + 'containers alike. `os validate` is clean: a remaining node is reported at its own `type` '
    + 'path with `params.retiredComponentType` naming `ai:chat_window`, so each one is named '
    + 'individually rather than as one page-level failure. An app whose removed node named an '
    + '`agentId` now names that platform agent in its `defaultAgent` instead, or leaves it unset '
    + 'for the default `ask`. Replaying the 17 → 18 chain over the edited source then reports the '
    + 'migrated stack schema-valid — `schemaValid: true` in `--json`',
};
