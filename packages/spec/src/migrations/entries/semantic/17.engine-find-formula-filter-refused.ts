// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'engine-find-formula-filter-refused',
  surface:
    'a `where` / filter naming a `formula` field — at BOTH doors: the REST ingress '
    + '(`assertFilterFieldsExist`, covering everything that reaches `findData`) and the '
    + 'engine seam itself (`engine.find` / `findOne` / `count` / `aggregate` / `update` / '
    + '`delete`), which saved reports, flows and dashboard widgets reach directly',
  replacement:
    'denormalise the value onto the object (a stored field, written when the source '
    + 'changes) and filter that — deliberately the same remedy, in the same words, the '
    + 'SORT axis prescribes (#6924 / #6994 / #7095) and the SEARCH axis has prescribed '
    + 'since #6674; `summary` and `autonumber` fields need NO action, because both get '
    + 'real maintained columns and filter correctly',
  reason:
    '`formula` is the one field type no driver materialises a column for, and FILTER was '
    + 'the last of the three query axes still fail-open on it: SORT refuses it (#6994 at '
    + 'the ingress, #7095 at the engine) and SEARCH refuses it by name (#6674), while a '
    + '`where` on a `formula` field cleared every gate precisely BECAUSE the object '
    + 'declares the field, reached a driver with no column behind it, and answered 200 '
    + 'with zero rows. Measured on a real `ObjectQL` with `is_open` a `formula` over the '
    + "stored `status` column: `where {is_open: true}` and `where {is_open: false}` each "
    + "returned 0 rows with NO error, while the controls `where {status: 'open'}` returned "
    + '4 rows and `where {subtask_total: 5}` (a `summary`, which HAS a column) returned 1 '
    + 'row.\n\n'
    + 'BOTH directions are wrong and the `false` one is the dangerous one: the same '
    + 'predicate against a STORED boolean returns every matching row, so a filter meaning '
    + '"not yet done" silently became "no records at all" — a row SET changed under a 200, '
    + 'which no amount of inspecting the response can reveal, and the formula READS '
    + 'correctly in that very same response, so the field is visibly populated and '
    + 'simultaneously unfilterable. That is strictly worse than the sort axis it mirrors: '
    + 'a refused sort returns the same rows in a different order, a refused filter changes '
    + 'which rows exist.\n\n'
    + 'Both doors now refuse it with `400 INVALID_FIELD` (#8296 / PR #8369), naming the '
    + 'offending key path and carrying the remedy sentence — the ingress gate '
    + '(`assertFilterFieldsExist`, `@objectstack/metadata-protocol`) for everything '
    + 'reaching `findData`, and `assertFilterIsMaterializable` '
    + "(`@objectstack/objectql`, `filter-comparand-shape.ts`) at the engine's own filter "
    + 'seam, which every caller-supplied `where` passes through whichever verb it arrived '
    + 'by. Both judge the field by the SAME `@objectstack/spec/data` predicate the SEARCH '
    + 'axis uses (`isVirtualSearchField` / `SEARCH_VIRTUAL_TYPES`, which holds `formula` '
    + 'and nothing else), so gate and drivers cannot disagree about which types have a '
    + 'column: a gate widened to the spec\'s `COMPUTED_VALUE_TYPES` (the WRITE contract) '
    + 'would refuse two working types. DOTTED filter paths are deliberately not judged on '
    + 'this axis at either door.\n\n'
    + 'This is a CODE-path API, not stored metadata, so — like '
    + '`engine-find-formula-order-by-refused` and `engine-dotted-projection-refused` at '
    + 'this step — there is no `sys_metadata` row for the D2 chain to rewrite and this '
    + 'ledger entry is the notification channel. No mechanical rewrite exists in either '
    + 'direction: the platform cannot invent the stored column the remedy prescribes, and '
    + 'it must not filter post-hoc instead — `driver.find` has already applied `limit` / '
    + '`offset`, so a predicate applied after the formulas are evaluated would filter an '
    + 'ARBITRARY PAGE, which looks correct on small result sets and is wrong the moment '
    + 'pagination is involved.\n\n'
    + 'AUTHOR-REACHABLE SURFACES are why this is not merely a code-side note. A saved '
    + "report's `query.filter` (`sys_saved_report`) is forwarded VERBATIM into "
    + '`engine.find` by `plugin-reports` (`report-service.ts`, `where: q.filter`), '
    + 'bypassing the ingress gate entirely; flow node `config.filter` and dashboard widget '
    + 'filters are author-written the same way. A report or flow authored to filter on a '
    + 'formula field used to run and quietly return the wrong row set; it now fails '
    + 'loudly, with the remedy in the message.\n\n'
    + 'Registered on the inherited ruling of #7095 ("register it anyway"), re-affirmed for '
    + 'this axis at triage on 2026-08-13 (#8370): the shape is identical to the sort axis '
    + 'and the consequence here is larger. #8296, #8370, #7095, #6994, #6924, #6674, '
    + 'ADR-0112.',
  acceptanceCriteria:
    'No filter names a `formula` field on any surface — grep your saved report definitions '
    + "(`sys_saved_report.query.filter`), flow node `config.filter`, dashboard widget "
    + 'filters and view filters for a filtered field whose object declares it as a '
    + '`formula`, and denormalise each onto a stored column written when the source '
    + 'changes. A `summary` / `autonumber` field needs no action: both have real '
    + 'maintained columns and filter correctly. Reads complete with no `INVALID_FIELD` '
    + 'naming a virtual `formula` field in a filter, at either door.',
};
