// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';
import { FilterConditionSchema } from '../data/filter.zod';
import { AggregationFunction } from '../data/query.zod';

/**
 * The `source` block of the Ask data tools — how an answer computed over
 * object records was computed.
 *
 * Five tools answer it as a top-level `source` key of their result JSON, on
 * every successful call ({@link OBJECT_QUERY_SOURCE_TOOL_NAMES});
 * `visualize_data` carries it beside `chart`. An error result carries none, so
 * a reader treats the block as optional per tool call. The tool composes it
 * from the query it actually ran — the model never types it — and a chat
 * answer renders "how this was computed" from it.
 *
 * It is the object-query sibling of `query_dataset`'s `provenance`
 * (`DatasetProvenanceSchema`, ADR-0149 D3): the dataset tool names a governed
 * dataset and its measures, while these tools name the object, the `where`
 * and the aggregation they ran. ADR-0149 D3 rule 4 asks the object-query
 * answer to state its source; this block is what it states it from.
 *
 * Only the shape is spec. The producer is the cloud AI service's
 * `resultSourceBlock()`; a reader is the console chat's answer-source block.
 * `scope` is one of two values, both required to be stated: the producer
 * judges it per call from `ISecurityService.getReadFilter(object, ctx)`
 * under the read's own context (`visible_to_you` when a row restriction
 * applied, the organization wall included; `all_records` only when that call
 * resolved to `undefined`; `visible_to_you` whenever the producer obtains no
 * answer), and the reader states an access line for `visible_to_you` only.
 *
 * Every optional key is LEFT OUT when it does not apply, never sent as
 * `null`: a `null` is refused. The object is a plain object, so a key a newer
 * producer adds is stripped, not refused, and an older reader still parses
 * the block.
 */
export const ObjectQuerySourceSchema = lazySchema(() => z.object({
  object: z.string().describe('The machine name of the object the figures were read from'),
  label: z.string().optional().describe(
    'The object\'s plural label, or its label when it declares no plural. Translated only when the request '
    + 'is in Chinese and a `zh*` translation pack names the object; otherwise the authored label, not the '
    + 'caller\'s UI locale. Absent when the producer sets none: a reader falls back to `object`',
  ),
  filter: FilterConditionSchema.optional().describe(
    'The caller\'s `where`, in the `$` query dialect, exactly as the engine accepted it: machine names only, '
    + 'no field labels, date placeholders such as `{today}` as written. Absent when no condition applied',
  ),
  scope: z.enum(['visible_to_you', 'all_records']).describe(
    'The row scope the figures cover, judged by the producer per call from '
    + '`ISecurityService.getReadFilter(object, ctx)` for this caller and `object`, under the same context the '
    + 'read ran under. `visible_to_you`: a row restriction applied, so the figures cover only the records the '
    + 'caller may read. The organization wall is a row restriction: under the `isolated` and `group` tenancy '
    + 'postures `getReadFilter` answers an `organization_id` predicate on every object that carries the column, '
    + 'for every caller but a platform admin whose object\'s posture lets them cross the wall, so an organization '
    + 'owner there reads `visible_to_you`. `all_records`: stated only when that call RESOLVED to `undefined`, so '
    + 'no row restriction applied; for a caller no row rule or sharing narrows, that is the `single` posture, an '
    + 'object outside tenancy, a platform admin crossing the wall, or a system context. An absent security '
    + 'service, an absent `getReadFilter`, a call that throws or rejects, or a call made under any other context '
    + 'than the read\'s own states `visible_to_you`. A restriction applied is the fact stated, not a count of rows '
    + 'excluded. The value speaks for `object` only, not for the objects behind `related` lookup paths. Always '
    + 'present, one of these two values',
  ),
  groupBy: z.array(z.string()).optional().describe('The field names the figures were grouped by, in order'),
  aggregations: z.array(z.object({
    function: AggregationFunction.describe('The aggregation function'),
    field: z.string().optional().describe('The field aggregated; absent for a bare `count`'),
  })).optional().describe('The aggregations computed, in order'),
  orderBy: z.array(z.object({
    field: z.string().describe('The field the records were ordered by'),
    order: z.enum(['asc', 'desc']).optional().describe('The direction; absent when the query named none'),
  })).optional().describe('The ordering applied, in order of precedence'),
  limit: z.number().int().positive().optional().describe(
    'The row or group cut applied (a top-N read or a group cut). Present only together with `orderBy`',
  ),
  related: z.array(z.string()).optional().describe(
    'The lookup paths read in the same call, dotted from the object (for example '
    + '`client.relationship_manager`)',
  ),
  latestPer: z.object({
    groupBy: z.string().describe('The field the latest row is taken per'),
    orderField: z.string().describe('The field that decides which row is latest'),
  }).optional().describe('Present when the answer keeps only the latest row per group'),
  records: z.number().int().nonnegative().optional().describe(
    'How many records the figures cover — a count, never a list: the match total for a page read, the summed '
    + 'group counts for an aggregate or a chart, 1 for `get_record`. Absent when unknown, never guessed',
  ),
  line: z.string().min(1).describe(
    'The finished one-line citation, in the request language. The producer keeps it to at most 280 '
    + 'characters; a reader does not refuse a longer one',
  ),
}));

/**
 * The five Ask data tools whose successful result carries the
 * {@link ObjectQuerySourceSchema} block as its top-level `source` key.
 */
export const OBJECT_QUERY_SOURCE_TOOL_NAMES = [
  'query_records',
  'query_data',
  'get_record',
  'aggregate_data',
  'visualize_data',
] as const;

export type ObjectQuerySource = z.input<typeof ObjectQuerySourceSchema>;
