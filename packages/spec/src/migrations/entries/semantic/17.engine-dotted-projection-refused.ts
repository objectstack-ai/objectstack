// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'engine-dotted-projection-refused',
  surface:
    'engine.find(object, { fields }) and engine.findOne(object, { fields }) carrying a '
    + 'dotted entry (`account.name`) — the direct engine path, not the REST ingress',
  replacement:
    "read the related record with `expand` (`{ expand: { account: { object: '<target>', "
    + "fields: ['name'] } } }`), keeping the reference column itself in `fields` — the "
    + 'relation is carried by that column and projecting it away leaves expansion nothing '
    + 'to resolve, the same silent no-op a nested projection omitting the related `id` '
    + 'produced before the engine began keeping that join key itself; or denormalise the '
    + 'value onto the queried object (a stored field, written when the source changes) '
    + 'and name that — the same remedy the REST ingress prescribes when it refuses a '
    + 'dotted projection, and the sort axis when it refuses a dotted sort',
  reason:
    "The REST ingress closed the PROJECTION axis' dotted leg first, refusing a dotted "
    + 'entry instead of widening the response to every field '
    + '(`assertProjectionFieldsExist`, `400 INVALID_FIELD`), which covers everything '
    + 'reaching `findData`. A caller reaching `engine.find()` / `engine.findOne()` '
    + 'DIRECTLY passed through none of it, and that caller set was measured, not assumed: '
    + "a flow `get_record` node's authored `fields: ['name', 'account.name']` "
    + 'parses (`GetRecordConfigSchema` restricts nothing), travels verbatim into '
    + "`data.find(...)`, cleared the engine's head-only projection filter on its head "
    + 'segment (`account` IS a field), and reached the driver as a projection column — '
    + 'where SQL renders `"account"."name"` against a table that was never joined, the '
    + "DB answers `no such column`, and the driver's unknown-column recovery ladder — "
    + 'there so an unknown column never reads as "no rows" — retries '
    + "`select('*')`. The caller asked to narrow and silently received EVERY field, "
    + 'byte-identical to no projection at all, pointing away from both FLS and data '
    + 'minimisation.\n\n'
    + 'Ruled by the maintainer on 2026-08-12: a dotted entry the engine cannot resolve is '
    + "refused loudly at the engine's own head-only projection filter, covering every "
    + 'caller that reaches the engine. The check it replaces was justified by a comment '
    + 'claiming the engine resolves relationship paths "via populate"; a measurement found '
    + 'that NO populate step exists — once the spec and docs stopped prescribing a dotted '
    + '`fields` path, that comment was the last place in the repo asserting dotted-path '
    + 'resolution does — so what was removed is not a '
    + 'working feature but a path to widening, kept alive by a false premise. The '
    + 'unknown-PLAIN-column tolerance is explicitly KEPT by the same ruling (an unknown '
    + 'plain name still drops silently; an all-unknown projection still falls back to '
    + '`*`), a registry-less host gets no verdict (the driver-side recovery ladder remains '
    + 'its documented backstop, and a driver-side carve-out is measured-need only), and '
    + 'a dotted `fields` inside a nested `expand` degrades to an observable warning '
    + "rather than a refusal — `expandRelatedRecords`' pre-existing graceful-degradation "
    + '`catch` swallows every expand failure, the same posture the formula-sort refusal '
    + '(`engine-find-formula-order-by-refused`) records for the same catch.\n\n'
    + 'This is a CODE-path API, not stored metadata, so — like '
    + '`engine-find-formula-order-by-refused` at this step — there is no `sys_metadata` '
    + 'row for the D2 chain to rewrite and the ledger entry is the notification channel. '
    + 'No mechanical rewrite exists: the platform cannot decide between `expand` and '
    + 'denormalisation for the caller, and it must not resolve the path itself — no '
    + 'driver ever did, and inventing a join here is a feature decision, not a '
    + 'migration — the line analytics already takes for a relation-traversing dotted '
    + 'measure, refused with a 400 naming the caller\'s spelling rather than computed '
    + 'against the wrong column. ADR-0112.',
  acceptanceCriteria:
    'No `engine.find` / `engine.findOne` call site passes a dotted `fields` entry, no '
    + "flow `get_record` config authors one, and no saved report's "
    + '`query.fields` names one — grep flow definitions and report definitions for a '
    + '`fields` entry containing a `.`, and rewrite each to `expand` (keeping the '
    + 'reference column projected) or to a denormalised stored column. Reads complete '
    + 'with no `INVALID_FIELD` whose message says "follows the relationship" or "a '
    + 'dotted path", and no "Failed to expand relationship field" warning whose error '
    + 'text does.',
};
