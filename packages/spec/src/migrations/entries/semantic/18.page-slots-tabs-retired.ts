// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #27053 — page `slots.tabs` retired (ADR-0085; the record-page v3
// definition-surface ruling of 2026-10-28). It absorbs the protocol-18 entry
// `page-slots-details-beside-tabs-refused` (#22568): with no `tabs` slot there
// is no pair to refuse, and that entry's prescription (move the details body
// INTO the `tabs` items) pointed at the key this one retires.
//
// No backticks and no pipes in `surface` — build-upgrade-guide.ts renders it
// inside a code span and a table cell.
export const entry: SemanticMigration = {
  id: 'page-slots-tabs-retired',
  surface:
    'page.slots.tabs — the slot that replaced the record page tab strip, a single component or an '
    + 'array, whatever the page kind; and the slot map spellings related and relatedLists',
  replacement:
    'Nothing on the slot map: the record page composes its tabs, and its columns at wider widths, from '
    + 'the object\'s roles and relationship flags (ADR-0085). To change which related lists appear or '
    + 'their order, set `relatedList` / `relatedList: \'primary\'` on the child\'s reference field; to '
    + 'replace the Details body, author `slots.details`. A page that needs its own strip — a curated '
    + 'tab set, a tab the object does not produce — is a `kind: \'full\'` page whose regions carry the '
    + 'header, the highlights, the `page:tabs` strip and the discussion, drawn as authored.',
  reason:
    'An authored `tabs` slot replaced the whole synthesized strip, so the related lists, approvals, '
    + 'attachments and history the platform composes from the object were dropped unless the author '
    + 're-added each one, and it opted the page out of the record page\'s column tiers, so the page '
    + 'stayed tabbed at every width. The maintainer\'s keep / narrow / retire ruling on the record-page '
    + 'definition surfaces kept the object roles, the relationship flags, six slotted slots and '
    + '`kind: \'full\'`, and retired this slot. The D2 conversion `page-slots-tabs-removed` STRIPS the '
    + 'slot mechanically, so a stored page renders the synthesized strip again; but a strip that was '
    + 'curated (a custom first tab, a tab of controls, related lists the relationship flags do not '
    + 'produce) is lost by the strip, and whether such a page should become `kind: \'full\'` instead is '
    + 'a judgement no walker can make. Measured reach before the narrowing: four pages in this '
    + 'repository authored the slot (the platform\'s organization, user and approval-request record '
    + 'pages and one example page), each moved to `kind: \'full\'` with its strip unchanged; hotcrm\'s '
    + 'one slotted page authors `header` and `discussion` only. This entry also absorbs '
    + '`page-slots-details-beside-tabs-refused`: with no `tabs` slot the `details` + `tabs` pair cannot '
    + 'be authored, and its refusal left with it. ADR-0087.',
  acceptanceCriteria:
    'Grep every page in `defineStack` pages sources, exported stacks and every page row in '
    + '`sys_metadata` for a `slots` map carrying a `tabs`, `related` or `relatedLists` key. For each, '
    + 'either delete the key (the D2 conversion does this for `tabs`) and, where a related list must '
    + 'appear, be promoted or be hidden, set `relatedList` on the child\'s reference field; or, where the '
    + 'strip was curated, rewrite the page as `kind: \'full\'` with `regions` carrying the header, the '
    + 'highlights, the same `page:tabs` strip and the discussion. Then `objectstack validate` reports '
    + 'nothing at `pages.N.slots.tabs`, saving each formerly affected page through the metadata API '
    + 'succeeds, and each record page shows either the synthesized strip (and the columns at wider '
    + 'widths) or, for a `kind: \'full\'` page, the same tabs it showed before.',
  conversionIds: ['page-slots-tabs-removed'],
};
