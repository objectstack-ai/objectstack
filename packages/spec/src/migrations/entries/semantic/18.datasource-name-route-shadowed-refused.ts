// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #29308. An accept-set narrowing of `DatasourceSchema.name` with no
// conversion: a datasource named after a literal the datasource admin API
// mounts beside its by-name read (`drivers`, the driver catalog) is refused.
// The new name, and every object `datasource` / `datasourceMapping` rule that
// routes to it, only the author can pick. Same class as
// stack-datasource-host-reserved-name-refused.
export const entry: SemanticMigration = {
  id: 'datasource-name-route-shadowed-refused',
  surface: 'a datasource whose `name` is one of `ROUTE_SHADOWED_DATASOURCE_NAMES` (today `drivers`), '
    + 'e.g. defineDatasource({ name: \'drivers\', driver: \'postgres\', config: { … } }), in '
    + '`defineDatasource`, a stack\'s `datasources`, `os validate`, `os build` and the metadata save door '
    + '(`PUT /api/v1/meta/datasource/drivers`)',
  replacement: 'The same datasource under another snake_case name (e.g. `driver_registry`), with every '
    + 'object that names it (`datasource`, or a `datasourceMapping` rule) pointed at the new name. ⛔ NOT '
    + 'mechanically convertible: the new name is the author\'s call.',
  reason:
    'The datasource admin API mounts the driver catalog at `GET /api/v1/datasources/drivers`, ahead of '
    + 'the by-name read `GET /api/v1/datasources/:name`, so a datasource named `drivers` was stored and '
    + 'listed while its detail read (the load of its Setup edit form) always answered the catalog. The '
    + 'admin create door already refused the name; `DatasourceSchema.name` accepted it, so the same '
    + 'unreachable datasource was still minted from code and through the metadata save door. The schema '
    + 'now refuses every name in `ROUTE_SHADOWED_DATASOURCE_NAMES`, the one list the admin routes mount '
    + 'from, with an `invalid_format` issue at `name` naming the name and the route; the published JSON '
    + 'Schema carries the refusal as a second `pattern`. Measured producers: none in this repository.',
  acceptanceCriteria:
    'No datasource is named `drivers`; `defineStack`, `os validate` and `os build` report no issue at '
    + '`name` (or `datasources.N.name`) reading "Datasource name \'drivers\' is reserved", and the '
    + 'metadata save door answers 200 for the renamed datasource. A stored `sys_metadata` datasource row '
    + 'named `drivers` still loads, with `_diagnostics` reading `valid: false` and carrying this refusal, '
    + 'and its next metadata save is refused; nothing rewrites it. Through the admin door that row stays '
    + 'listed and removable, and a `label`/`active`-only edit still saves.',
};
