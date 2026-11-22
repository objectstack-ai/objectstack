// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #35901 (epic #35896) — an object extension says where the fields, groups and
// child lists it brings go (`place`), applied once by the registry merge; and
// a child list another package brings is no longer hidden by the parent's
// declared `relatedLists` (Sales ruling 7073014077 on #35901, flipping the
// hiding #35897 shipped under ruling 7072511859). Semantic only, with no D2
// conversion: where each extension's items should go is not recorded
// anywhere, and the visibility flip needs no rewrite.
export const entry: SemanticMigration = {
  id: 'object-extension-place-and-cross-package-lists',
  surface:
    'objectExtensions[].place (data.ObjectExtensionSchema.place), new; and objects[].relatedLists '
    + '(data.ObjectSchema.relatedLists) when DECLARED and non-empty on an object another package adds a '
    + 'child list to',
  replacement:
    'an extension package that wants its fields, groups or child lists at a set position writes '
    + "place: [{ field, group, after | before }, { group: { key, label, ... }, after | before }, "
    + "{ list, after | before, label?, columns? }] on its objectExtensions entry. A parent that wants another "
    + "package's child list at a set position names it in its own relatedLists (its position wins); there is "
    + 'no way for the parent to hide it, short of relatedList: false on that package\'s FK',
  reason:
    'The maintainer asked that an extension package declare where the fields, groups and child lists it '
    + 'brings go (「排在谁后面」) and that what it brings appear there by itself; with no place written '
    + 'nothing moves (「没写就照旧」). Placement arranges what the extended object declares (ruled 「父对象声明了才生效」): '
    + 'a list placement applies when the parent declares relatedLists, a group or field placement when it '
    + "declares fieldGroups; on a parent that declares neither, the automatic arrangement stays, the entry's "
    + 'label / columns and a field\'s after / before are not applied, and the boot log names each such '
    + 'placement (os validate too when the parent is in the same stack). An anchor the parent does not have '
    + 'puts the item at the end; several packages at one anchor order by priority, then package name. An '
    + 'extension places only its own items. SHIPPED BEHAVIOUR CHANGE: under #35897 a declared non-empty '
    + 'relatedLists hid a side list no entry named, a child list another package adds included, until the '
    + "parent named it. Now such a list (child and parent belong to different packages) is not hidden: placed, "
    + 'it sits where its package puts it; unplaced, it shows at the end of the tabs (「装了就自动排在末尾」), '
    + 'before a trailing approvals / activity-stream run. A child of the parent\'s own package, or one no '
    + 'package owns, is still hidden until named. A STORED object row is not rewritten: its record page '
    + 'changes at the next read. In-repo census before the change: no example, platform object, dogfood '
    + 'fixture or HotCRM object declared relatedLists, and no objectExtensions entry wrote place; deployed '
    + 'metadata was NOT measured. ADR-0146 D10 / ADR-0085',
  acceptanceCriteria:
    'On the record page of an object that declares relatedLists, a child list another installed package '
    + 'brings shows: at the position its extension\'s place names, or at the end of the tabs when it names '
    + 'none; on an object that declares fieldGroups, a field an extension places shows in the named group '
    + 'right after (before) the named member; an object that declares neither, and an extension that writes '
    + 'no place, shows the same as before.',
};
