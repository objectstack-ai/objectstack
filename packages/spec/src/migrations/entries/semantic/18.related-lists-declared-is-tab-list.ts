// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #35897 (epic #35896) — an object's declared `relatedLists` changes meaning
// from "order only" to "the record page's tab list": the lists it names show,
// in its order, and a side list it leaves out shows no tab. The three built-in
// tabs (attachments, approvals, activity stream) are placed by object name.
// Semantic only, with no D2 conversion: which unlisted lists the author still
// wants is not recorded anywhere.
export const entry: SemanticMigration = {
  id: 'related-lists-declared-is-tab-list',
  surface:
    'objects[].relatedLists (data.ObjectSchema.relatedLists) when DECLARED and non-empty — an object '
    + 'that lists some of its inbound relationships and leaves others out',
  replacement:
    'list every related list the record page should show, in the order it should show them; add '
    + "'sys_attachment' to keep the attachments tab of an object with enable.files, and optionally "
    + "'sys_approval_request' and 'sys_activity' to place the approvals and activity-stream tabs. An object "
    + 'that should keep every list declares no relatedLists at all',
  reason:
    'The maintainer ruled that the record page\'s tabs are declared on the parent object in '
    + 'one place: removing an entry removes its tab (「删除tab就是不现实」, meaning not shown), with relatedLists as that '
    + 'list (「其实除了 overview，我们直接用 relatedLists 是不是就可以」) and the three built-in tabs named by '
    + 'their objects (「三个内置项，是不是可以直接用对应的对象名」). Until now a declared relatedLists only '
    + 'ordered: listed lists came first and every unlisted one still followed, and the attachments, '
    + 'approvals and stream tabs always closed the strip in a fixed order. Now, on a declared non-empty '
    + 'relatedLists, a side list no entry names shows no tab; the attachments tab shows only when '
    + "'sys_attachment' is listed (and the object enables files, as before); the approvals tab, when "
    + 'unlisted, follows the listed tabs and still shows whenever the record has requests; the stream '
    + 'tab, when unlisted, still closes the strip. Body tables a field group places stay at their group; '
    + 'the tab such a master_detail table also keeps on an undeclared page shows only when an entry names it, '
    + 'and relatedList: false on the FK still hides a list. An undeclared or empty relatedLists draws '
    + 'exactly what it drew before. A STORED object row is not rewritten: its record page changes at '
    + 'the next read. In-repo census before the change: no example, platform object, dogfood fixture '
    + 'or HotCRM object declared relatedLists; deployed metadata was NOT measured. ADR-0035 / ADR-0085 / '
    + 'ADR-0087',
  acceptanceCriteria:
    'On the record page of each object that declares relatedLists, the tabs after the overview are the '
    + 'listed related lists and built-in tabs in the listed order, then (if unlisted) approvals when the '
    + 'record has requests and the activity stream last; an object that declares no relatedLists shows '
    + 'the same tabs as before.',
};
