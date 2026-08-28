// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'strategy-context-aggregation-method-narrowed',
  surface: 'StrategyContext.executeAggregate aggregations[].method '
    + '(contracts/analytics-service.ts, exported from @objectstack/spec/contracts) '
    + '- the parameter type, declared as bare string',
  replacement: 'AggregationFunction (count | sum | avg | min | max | count_distinct, '
    + 'data/query.zod.ts) - the same closed vocabulary IDataEngine.aggregate already '
    + 'declares for the identical slot (AggregationNodeSchema.function; the analytics '
    + 'bridge renames method to function and forwards). A caller filling method from a '
    + 'string-typed value narrows the value to the enum - typing it '
    + 'AggregationFunction, or parsing with the spec\'s own AggregationFunction zod '
    + 'enum where the value enters from data. Values outside the six were never '
    + 'served: the bridge has parsed-and-refused them at runtime since #11833, and '
    + 'that refusal stays as defence in depth',
  reason:
    '#12776, maintainer ruling 2026-08-28 (option A, census-first). Two spec-declared '
    + 'surfaces described the same value and disagreed about its type: '
    + 'IDataEngine.aggregate\'s aggregations[].function is the closed six-value '
    + 'AggregationFunction enum while StrategyContext.executeAggregate declared the '
    + 'same slot aggregations[].method: string, so nothing on the analytics side of '
    + 'that seam was compile-checked against the engine\'s vocabulary - an author, '
    + 'very often an AI (ADR-0033), writing an analytics strategy got no compile-time '
    + 'help and could carry any method name all the way to the bridge\'s runtime '
    + 'refusal. One slot now has one declaration. Bookkeeping: this is a TYPE '
    + 'narrowing on a runtime TS interface member - no authorable metadata key, no '
    + 'wire shape and no walked-shape def changed, so nothing lands in '
    + 'RETIRED_KEYS_BY_MAJOR / RETIRED_DEFS_BY_MAJOR and the surface ratchets are '
    + 'expected byte-identical. It is a SEMANTIC entry rather than a D2 conversion '
    + 'because there is no authored document or sys_metadata row for the chain to '
    + 'rewrite: the only consumers are TypeScript call sites, and the compile error '
    + 'is the channel that reaches them. In-repo census at the ruling (hard '
    + 'precondition, measured before the narrowing landed): every implementor and '
    + 'every call site filling method is legal under the enum - '
    + 'ObjectQLStrategy.resolveMeasureAggregation emits only the six post-#12209 '
    + 'refusal, the two literal producers write count, and every test fixture is '
    + 'implementor-side and stays assignable by contravariance.',
  acceptanceCriteria:
    'External implementors of StrategyContext stay source-compatible: a handler '
    + 'accepting method: string accepts a superset and remains assignable to the '
    + 'narrowed member. External callers filling method with a string-typed or '
    + 'out-of-vocabulary value fail tsc at the executeAggregate call site on upgrade; '
    + 'the fix is narrowing the value\'s type to AggregationFunction (parsing with '
    + 'the spec enum where it enters from data), never widening a local mirror of '
    + 'the contract. Runtime behaviour is unchanged: the bridge\'s #11833 '
    + 'parse-and-refuse accepts and rejects exactly the same sets before and after, '
    + 'and no stored metadata or document needs editing.',
};
