// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #35889 (epic #35590, superseding #35597's default) — a `master_detail` FK
// that declares no `relatedList` is a TAB of the parent's record page by
// default, like a `lookup`, not a body table in the overview. It is a body
// table only where a field group of the parent names it
// (`fieldGroups[].relatedList`): then the record page draws it at the group,
// the parent's entry form inlines it, and the record page's edit state saves
// its rows with the record (#35599). `relatedList: 'primary'` is unchanged.
// Maintainer ruling B on #35889 (「明细表应该改成指看分组的定义了」): the FK's
// `inlineEdit` no longer inlines a child in the parent's form by itself either;
// only the group does, and `inlineEdit` picks the form factor of a placed one.
// What a field group may name is unchanged (`isGroupPlaceableRelationship`
// accepts exactly what #35597 accepted), so no write that was accepted is
// refused. Semantic only, with no D2 conversion: whether an author wants the
// table back in the overview is theirs to say, by a group. The printed guidance
// below names no tracker id (the os migrate meta guidance pin); the previous
// default it names is #35597's, and the approval lock is #35599's ruling A.
export const entry: SemanticMigration = {
  id: 'master-detail-related-list-tab-by-default',
  surface:
    'objects[].fields.<fk> (data.FieldSchema.relatedList) left absent on a master_detail field, and '
    + 'objects[].fields.<fk>.inlineEdit on a lookup or master_detail field, where the parent declares no '
    + 'fieldGroups[].relatedList naming that child (by its object name or object.field); and a lookup or '
    + 'master_detail FK declaring relatedList \'primary\' that such a parent field group DOES name, which '
    + 'the parent\'s create and edit forms now inline (inlineEdit or not; its record page is unchanged)',
  replacement:
    'Nothing to replace for the new default: the child list is a tab of the parent\'s record page, with its '
    + 'count, as every other related list is. To keep it a table in the record\'s overview, at a chosen place '
    + 'among the field sections, add a field group to the PARENT object whose `relatedList` names it — '
    + '`{ key: \'lines\', label: \'Lines\', relatedList: \'<child>\' }` (or `\'<child>.<fk>\'` when the child '
    + 'points at the parent more than once) — in the `fieldGroups` order where the table should sit; such a '
    + 'group holds no fields. The table is then also inlined in the parent\'s create and edit forms, and the '
    + 'record page\'s Edit saves the record and its rows together. The same group is what keeps a child that '
    + 'sets `inlineEdit` inlined in the parent\'s form derived from its relationships: `inlineEdit` alone no '
    + 'longer does, and now only picks the form factor (`\'grid\'`, `\'form\'`, or `true` / absent for the '
    + 'shape-picked default) of a child a group places. A group may name only a list it can place, so for an '
    + '`inlineEdit` child that is not a plain master_detail the FK changes too: on a lookup FK, or a FK declaring '
    + '`relatedList: true`, write `relatedList: \'primary\'` and add the group (a master_detail FK may instead '
    + 'drop `relatedList: true`); a FK declaring `relatedList: false` hides the list, and a group naming it is '
    + 'refused (`related-list-group-not-body`). A form view that declares its own subforms still inlines what it '
    + 'declares. To keep a table in the overview with no group, write `relatedList: \'primary\'` on the '
    + 'child\'s FK instead (that does not inline it in the form).',
  reason:
    'The maintainer ruled that a master-detail child should not be put into the overview by its relationship '
    + 'type alone: 「主从子表我认为不应该自动申明放在概览中，除非我通过 fieldGroup 强制指定」, while keeping '
    + 'what was built: 「大部分场景不需要，但是我们已经开发好的功能也没必要作废」. Before this change every '
    + 'master_detail FK with no relatedList was a body table. Now body-ness comes from `relatedList: \'primary\'` '
    + 'on the FK, or from a parent field group that places the list. Nothing is refused that was accepted: a '
    + 'field group may still name a plain master_detail child, and that is now what makes it a body table. '
    + 'There is no D2 conversion, since adding a group to every parent would put back the default the '
    + 'maintainer removed. A STORED object row is not rewritten and loads unchanged; its record page draws '
    + 'the child as a tab. The child\'s rows, their approval lock and the parent\'s summary '
    + 'fields are unchanged. In-repo census before the change: no example, platform object or HotCRM object '
    + 'declared a field group relatedList. Moving to a tab: the showcase task (project), field zoo '
    + '(f_master_detail), project membership (team, project), invoice line and expense line children, the CRM '
    + 'opportunity line item, and every plain master_detail child in HotCRM (for example sales order lines, '
    + 'project budget lines, and the contacts, contracts, quotes, orders, invoices and payments of an '
    + 'account). The inline-edited ones (showcase invoice and expense lines, CRM opportunity line item) get a '
    + 'field group on their parent in this change, so their forms and record pages keep the table; HotCRM\'s '
    + 'project budget lines need the same group in HotCRM. HotCRM\'s quote and opportunity line items declare '
    + 'relatedList \'primary\' and stay in the overview. Deployed metadata was NOT '
    + 'measured. ADR-0035 as amended, ADR-0085 / ADR-0087',
  acceptanceCriteria:
    'On the record page of a parent with a master_detail child and no field group naming it, the overview '
    + 'draws no table for the child and the tab row carries the child\'s tab with its count; the create and '
    + 'edit forms do not inline it. After adding a field group that names the '
    + 'child, second in fieldGroups: the overview draws the child\'s table in the second group\'s place, the '
    + 'tab is still there (on a parent that declares no relatedLists; a declared relatedLists decides the tabs, '
    + 'so there the tab shows only if an entry names the child), the create and edit forms inline the table '
    + 'at the same place (a tab of its own in a tabbed form), and the record page\'s Edit saves the '
    + 'record fields and the rows in one save. A child whose FK sets inlineEdit and that no group names is not '
    + 'inlined in the parent\'s forms. A child whose FK declares relatedList \'primary\' is drawn on the '
    + 'record page as before: a body table with no tab of its own, whether or not a group positions it. Where '
    + 'a parent field group names such a child, the parent\'s create and edit forms inline it (inlineEdit or '
    + 'not); where none does, they do not, inlineEdit or not. `os validate` reports no new issue.',
};
