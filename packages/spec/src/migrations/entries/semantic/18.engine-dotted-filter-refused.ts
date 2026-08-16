// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'engine-dotted-filter-refused',
  surface:
    'a `where` / filter whose KEY is a dotted path with a relation, virtual-`formula` or '
    + 'plain-scalar head (`{"project_id.name": …}`, `{"is_open.x": …}`, `{"title.x": …}`) — at '
    + 'BOTH doors: the REST ingress (`assertFilterFieldsExist`, covering everything that reaches '
    + '`findData`) and the engine seam itself (`engine.find` / `findOne` / `count` / `aggregate` '
    + '/ `update` / `delete`), which saved reports, flows and dashboard widgets reach directly',
  replacement:
    'denormalise the value onto the queried object (a stored field, written when the source '
    + 'changes) and filter that — the same remedy, in the same words, the SORT axis has '
    + 'prescribed for the dotted spelling since #4256/#6924. To read a related column, `$expand` '
    + 'is unchanged; to CONDITION on one, the stored denormalised field is the supported shape. '
    + 'A dotted path into a structured/JSON field (`{"address.city": …}`) is NOT refused and '
    + 'keeps its current per-driver behaviour',
  reason:
    'FILTER was the last of the four query axes with no verdict for a dotted name: SORT refuses '
    + 'it (#4256), PROJECTION refuses it at both doors (#7589), and the FILTER gates judged a '
    + 'key on its HEAD SEGMENT only — so `where {"project_id.name": "Apollo"}` cleared the '
    + '#7534 unknown check because `project_id` is a real field, reached a driver that cannot '
    + 'serve the path, and answered 200 with zero rows. The #8296 virtual verdict deliberately '
    + 'skipped dotted keys, so the axis answered one unserviceable intent two ways by spelling: '
    + '`{is_open: true}` was refused while `{"is_open.x": true}` rode through.\n\n'
    + 'Measured across all THREE drivers before ruling (#8371): relation-head, formula-head, '
    + 'system-column-head and plain-scalar-head dotted filters return ZERO rows on '
    + '`driver-memory`, `driver-sql` AND `driver-mongodb`, each under an ordinary 200 '
    + 'indistinguishable from an empty table. There is no working capability for this refusal '
    + 'to remove: an ObjectStack lookup stores the related record\'s SCALAR id (SQL: a string '
    + 'column plus FK; Mongo: a single-key index on a scalar), while Mongo\'s dotted paths '
    + 'traverse EMBEDDED DOCUMENTS — so the spelling is well-formed Mongo that matches nothing. '
    + 'On driver-sql, knex reads the dot as a table qualifier and emits a column no dialect can '
    + 'resolve; `find()` falls into the #3821 recovery ladder and returns `[]` silently (the '
    + 'find/count divergence that fell out of that measurement is #8790, its own card).\n\n'
    + 'Both doors now refuse the three measured-dead head classes with `400 INVALID_FIELD`, '
    + 'naming the whole offending key exactly as the caller wrote it and carrying the remedy '
    + 'sentence — no new mechanism, no new error class, per the #8371 maintainer ruling. Both '
    + 'judge the head by the SAME `@objectstack/spec/data` classification '
    + '(`classifyDottedFilterHead`), the one-source move #8296 made with `isVirtualSearchField`, '
    + 'so the doors cannot drift into answering one spelling two ways. Precedence mirrors the '
    + 'sort axis, verdict for verdict: `unknown` > `dotted` > unmaterializable.\n\n'
    + 'DELIBERATELY UNJUDGED, per the same ruling: a dotted path whose head is a '
    + 'structured/JSON field (`address.city`) — the one spelling the drivers genuinely disagree '
    + 'on (live on memory and mongodb, 2 rows in the measurement; silently empty on sql). '
    + 'Refusing it for symmetry would delete a working capability on two of three backends; '
    + 'declaring JSON-path filtering a capability (`supports`) waits for a real consumer. '
    + 'Array-valued heads (`multiple: true`, tag types) and file heads are unjudged for the '
    + 'same measured reason. The nested-relation OBJECT form `{ owner: { region: "NA" } }` is '
    + 'untouched: the refusal targets the dotted-STRING spelling alone.\n\n'
    + 'This is a CODE-path API, not stored metadata, so — like '
    + '`engine-find-formula-filter-refused` and `engine-dotted-projection-refused` one step '
    + 'down — there is no `sys_metadata` row for the D2 chain to rewrite and this ledger entry '
    + 'is the notification channel. No mechanical rewrite exists: the platform cannot invent '
    + 'the stored column the remedy prescribes, and it must not join or post-filter instead — '
    + 'the drivers have already applied `limit`/`offset`, so any post-hoc predicate would '
    + 'filter an arbitrary page.\n\n'
    + 'AUTHOR-REACHABLE SURFACES: a saved report\'s `query.filter` (`sys_saved_report`) is '
    + 'forwarded VERBATIM into `engine.find` by `plugin-reports`, bypassing the ingress; flow '
    + 'node `config.filter` and dashboard widget filters are author-written the same way. A '
    + 'dotted filter path is exactly what an AI author writes by analogy with `$expand`, '
    + 'projection spellings and SQL joins — and it used to answer an empty list '
    + 'indistinguishable from "no matching records", often with the related value reading '
    + 'correctly in the very same response. It now fails loudly, with the remedy in the '
    + 'message. Registered on the same inherited ruling as its siblings (#7095 "register it '
    + 'anyway", re-affirmed 2026-08-13): #8371, #8296, #7589, #7534, #4256, ADR-0112.',
  acceptanceCriteria:
    'No filter key is a dotted path whose head is a relation (`lookup` / `master_detail` / '
    + '`user` / `tree`), a `formula`, or a plain scalar — grep your saved report definitions '
    + '(`sys_saved_report.query.filter`), flow node `config.filter`, dashboard widget filters '
    + 'and view filters for keys containing a dot, and for each either denormalise the related '
    + 'value onto a stored field of the queried object, or (for a relation id test) filter the '
    + 'head field itself (`{"project_id": <id>}`). A dotted path into a structured/JSON field '
    + '(`{"address.city": …}`) needs NO action — it is deliberately not judged. Reads complete '
    + 'with no `INVALID_FIELD` naming a dotted filter key, at either door.',
};
