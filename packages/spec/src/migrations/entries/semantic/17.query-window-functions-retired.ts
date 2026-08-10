// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'query-window-functions-retired',
  surface: 'data.query.windowFunctions',
  replacement:
    '`aggregations` + `groupBy` for request-level analytics; '
    + '`SqlDriver.findWithWindowFunctions(object, query)` for embedders on a SQL datasource',
  reason:
    'The `windowFunctions` array was declared-but-inert on the query path: `find()` never '
    + 'applied a window function, so every OVER clause a caller declared was silently '
    + 'dropped. The capability only ever ran behind `SqlDriver.findWithWindowFunctions()`, '
    + 'a driver-level door that is not on the `IDataDriver` contract and whose flat input '
    + 'shape (`{ function, alias, partitionBy?, orderBy? }`) the spec vocabulary never '
    + 'matched — `WindowFunctionNodeSchema` declared `field`/`over`/`frame` members the door '
    + 'never read, so that cluster is removed with the key rather than left as a false '
    + 'affordance. A REQUEST surface, never stored; no source to rewrite. '
    + 'ADR-0049 / ADR-0078, #4286.',
  acceptanceCriteria:
    'No caller sends `windowFunctions` in a query; request-level analytics use '
    + '`aggregations` + `groupBy`, and embedders needing OVER-clause SQL call the SQL '
    + "driver's `findWithWindowFunctions` door directly. A query that still carries the key "
    + 'fails to parse with the removal prescription naming that door.',
};
