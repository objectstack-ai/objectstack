// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #23543 F1 — the value retirement's one D3 entry. The D2 half is
// `datasource-driver-mongo-to-mongodb` (protocol 17), now retired from the load
// path. It carries no `conversionIds`: since #25767 protocol 17 is
// MIGRATION_SUPPORT_FLOOR, so no step of the chain replays that conversion,
// and `os migrate meta` lists this entry as the hand edit it is — for the
// spellings inside metadata sources and the ones outside them alike.
export const entry: SemanticMigration = {
  id: 'datasource-driver-mongo-alias-retired',
  // No backticks and no pipes in `surface` — build-upgrade-guide.ts renders it
  // inside a code span AND a table cell.
  surface:
    "datasource.driver authored as 'mongo' (DriverType, data/datasource.zod.ts), and the same spelling "
    + 'as a boot driver selection (OS_DATABASE_DRIVER, the standalone stack databaseDriver option)',
  replacement:
    "`driver: 'mongodb'` — the MongoDB driver's canonical id since 17, and `OS_DATABASE_DRIVER=mongodb` "
    + 'for a boot selection',
  reason:
    "A maintainer ruling retired `mongo` as a value at 18. Through 17 it was a second accepted spelling of "
    + "`mongodb`: the loader rewrote an authored `datasource.driver: 'mongo'` with a notice, and both boot "
    + 'hosts accepted it as a driver selection. At 18 the authoring parse refuses it by name with the '
    + 'prescription naming `mongodb`, and it is no longer a selection spelling, so a boot that sets '
    + '`OS_DATABASE_DRIVER=mongo` is refused with the list of supported drivers. The D2 conversion '
    + '`datasource-driver-mongo-to-mongodb` belongs to protocol 17, the migration floor, so '
    + "`os migrate meta` applies no edit for it and prints each `datasources[].driver: 'mongo'` in your "
    + 'metadata sources among the refusals left after the chain; change the value by hand. Stored '
    + 'datasource rows keep loading because every rehydration seam replays it. Outside metadata sources '
    + 'the same hand edit is owed: an environment variable or deployment manifest '
    + 'setting `OS_DATABASE_DRIVER=mongo`, a program that passes `databaseDriver: \'mongo\'` to the '
    + 'standalone stack, and a script or integration that creates or updates a datasource through the '
    + 'metadata or datasource REST API with `driver: \'mongo\'`. Each of those is refused at 18 and needs '
    + 'the same one-word change by hand. Nothing about the connection changes: `mongo` and `mongodb` '
    + 'always built the same driver against the same config contract.',
  acceptanceCriteria:
    "`os validate` reports no refusal at a `datasources[].driver` path; no deployment environment, "
    + "manifest or launch script sets `OS_DATABASE_DRIVER=mongo`, and the process boots on MongoDB with "
    + "`OS_DATABASE_DRIVER=mongodb` (or with the driver chosen by a `mongodb://` URL scheme and no "
    + 'override); every script or integration that writes a datasource sends `driver: \'mongodb\'` and '
    + 'gets a success answer from the API.',
};
