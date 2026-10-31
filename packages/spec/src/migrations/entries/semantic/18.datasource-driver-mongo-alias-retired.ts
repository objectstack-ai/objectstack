// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #23543 F1 — the value retirement's one D3 entry. The D2 half is
// `datasource-driver-mongo-to-mongodb` (a step-17 conversion), which rewrites
// every `driver: 'mongo'` the chain can reach and is now retired from the load
// path; this entry carries what the chain cannot reach — the spellings that
// live outside metadata sources.
export const entry: SemanticMigration = {
  id: 'datasource-driver-mongo-alias-retired',
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
    + '`datasource-driver-mongo-to-mongodb` makes the mechanical edit wherever the chain reaches: '
    + "`os migrate meta` lists every `datasources[].driver: 'mongo'` in your metadata sources, and stored "
    + 'datasource rows keep loading because every rehydration seam replays it. What the chain cannot '
    + 'reach is everything outside metadata sources: an environment variable or deployment manifest '
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
  conversionIds: ['datasource-driver-mongo-to-mongodb'],
};
