// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #24230 — the D3 record of the `marketplace:installed-list` retirement
// (ADR-0049 enforce-or-remove), executing ruling B on #23892 (record
// 6216295104, item 2: the separate Installed Apps view retires once the
// filtered view serves its actions). objectui#12733 deleted the type's one
// renderer; its one page, `marketplace_installed`, had already left
// `@objectstack/cloud-connection` at #23933. Refused BY NAME through
// `RETIRED_PAGE_COMPONENT_TYPES`, the `ai:chat_window` shape. There is no D2
// half: the type never had a key, so there is nothing a walker could strip and
// leave a valid node behind, and deleting an authored page node is a layout
// decision a mechanical conversion must not make (the `element-filter-removed`
// docblock's rule). What the chain owes the upgrader is the delegation itself.
//
// It narrows `ui-cloud-connection-widgets-unknown-keys-refused`, which closed
// this type's props bag to `{}` in the same major: that entry now speaks for
// `cloud-connection:panel` alone, and this one for the retired name.
export const entry: SemanticMigration = {
  id: 'ui-marketplace-installed-list-retired',
  surface:
    'page.component.marketplace:installed-list — the component node (the widget never took a '
    + 'prop), in regions, named slots and nested containers alike',
  replacement:
    'Delete the component node. The Installed Apps list is Setup → Packages filtered to '
    + 'Source = marketplace: the console\'s `developer:packages` component opened with '
    + '`params: { source: \'marketplace\' }`. A page that needs to send users there links to it '
    + 'with a navigation item of type `component`, `componentRef: \'developer:packages\'` and '
    + '`params: { source: \'marketplace\' }`, which is what the cloud-connection plugin\'s own '
    + '"Installed Apps" entry does',
  reason:
    '`marketplace:installed-list` was the console widget that drew the separate Installed Apps '
    + 'view: the list of locally installed marketplace packages, with their uninstall action. '
    + 'Once Setup → Packages carried those packages and their actions behind a Source = '
    + 'marketplace filter, the separate view was retired: its one renderer was deleted from the '
    + 'console, and its one page left the cloud-connection plugin, whose navigation entry now '
    + 'opens the filtered Packages view. A declared element nothing draws validated clean and then '
    + 'showed "Unknown component type" in front of a user, so the name is now refused at '
    + '`PageComponentSchema.type` and its `ComponentPropsMap` row refuses every props bag with '
    + 'the same prescription. The type was never a `PageComponentType` member, so there is no '
    + 'enum value to remove. No conversion is registered, because the only edit is deleting the '
    + 'node, and which region closes up or links to the Packages view instead is the author\'s '
    + 'judgment about a page they composed — this entry is that delegation',
  acceptanceCriteria:
    'No `marketplace:installed-list` component remains in any page — regions, named slots and '
    + 'nested containers alike. `os validate` is clean: a remaining node is reported at its own '
    + '`type` path with `params.retiredComponentType` naming `marketplace:installed-list`, so each '
    + 'one is named individually rather than as one page-level failure. Replaying the 17 → 18 '
    + 'chain over the edited source then reports the migrated stack schema-valid — '
    + '`schemaValid: true` in `--json`',
};
