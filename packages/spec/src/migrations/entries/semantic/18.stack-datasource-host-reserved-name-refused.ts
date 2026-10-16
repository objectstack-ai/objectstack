// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'stack-datasource-host-reserved-name-refused',
  surface: 'an entry of a stack\'s `datasources` collection named `default` (the array form '
    + '`datasources: [{ name: \'default\', … }]`, or the map form `datasources: { default: { … } }`), '
    + 'in `defineStack`, `os validate` and publish',
  replacement: 'for the project\'s own primary database, no entry: set `OS_DATABASE_URL` and the host '
    + 'connects it as `default`. For a datasource of the stack\'s own, the same entry under another '
    + 'snake_case name (e.g. `app_primary`), with the objects that use it routed to it explicitly '
    + '(the object\'s `datasource`, or a `datasourceMapping` rule). ⛔ NOT mechanically convertible: '
    + 'whether the entry was meant as the host\'s database or as one of the stack\'s own is the '
    + 'author\'s call.',
  reason:
    '`default` is the host\'s primary datasource: the runtime declares and connects it itself, and '
    + 'the app plugin refuses a stack that declares it in every boot posture, with `OS_DATABASE_URL`, '
    + 'with `--dev` and on the standalone path. The authoring doors accepted the same stack, so its '
    + 'author first met the refusal after the boot\'s earlier plugins had started. The stack\'s '
    + '`datasources` collection now refuses the entry with the runtime\'s sentence and remedy. '
    + '`DatasourceSchema` itself is unchanged: it also documents the host\'s own `default` row, which '
    + 'keeps parsing. No config that boots today is newly refused. Measured producers: none in this '
    + 'repository; the one instance found was an agent-written measurement fixture.',
  acceptanceCriteria:
    'No stack\'s `datasources` collection carries an entry named `default`; `defineStack` and '
    + '`os validate` report no issue at `datasources.N.name`, and the deployment reaches its primary '
    + 'database through `OS_DATABASE_URL` (or a driver plugin) and any datasource of its own under '
    + 'its own name.',
};
