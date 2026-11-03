// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Datasource names the admin route family can never serve by name (#29164).
 *
 * `registerDatasourceAdminRoutes` mounts the by-name doors at
 * `/datasources/:name` and, beside them, literal single-segment routes under
 * the same root. Where a literal shares a METHOD with a `/:name` route it is
 * registered first and captures the path: `GET /datasources/drivers` answers
 * the driver catalog, so a datasource named `drivers` could be created and
 * listed while its detail read — the load of its edit form — was never
 * reached. Each such literal is therefore a reserved datasource name, refused
 * at create the same way the host-owned `default` is.
 *
 * A literal that shares no method with a `/:name` route captures no name, and
 * is not reserved: `POST /datasources/test` (the unsaved-draft probe) sits
 * beside no `POST /datasources/:name`, so a datasource named `test` is read,
 * patched, removed and probed (`POST /datasources/test/test`) through its own
 * doors.
 *
 * ONE list for every half, and it is the spec's
 * (`ROUTE_SHADOWED_DATASOURCE_NAMES` in `@objectstack/spec/data`), so the
 * metadata surface refuses the same names: `DatasourceSchema.name` rejects
 * each one at `defineStack`, `os validate`, `os build` and the metadata save
 * door. Here, the registrar mounts each shadowing literal from a segment typed
 * as a member of that list, and `DatasourceAdminService` refuses each name in
 * it at create. The drift pin
 * (`__tests__/datasource-route-reserved-names.test.ts`) enumerates what the
 * registrar actually mounts and fails both ways: a literal sibling of a
 * same-method `/:name` route that is not listed, and a listed name that no
 * longer shadows anything.
 */

import { ROUTE_SHADOWED_DATASOURCE_NAMES as SPEC_ROUTE_SHADOWED_DATASOURCE_NAMES } from '@objectstack/spec/data';

/**
 * The driver-catalog literal: `GET /datasources/drivers`, mounted beside
 * `GET /datasources/:name`. Typed as a member of the spec's reserved list, so
 * a catalog segment the spec does not reserve does not compile.
 */
export const DRIVER_CATALOG_SEGMENT: (typeof SPEC_ROUTE_SHADOWED_DATASOURCE_NAMES)[number] = 'drivers';

/**
 * Every literal segment the admin registrar mounts beside a same-method
 * `/datasources/:name` route — a datasource of one of these names could never
 * be reached through that by-name door. The spec's list itself (the same
 * frozen array), widened to `string` for the door's membership test.
 */
export const ROUTE_SHADOWED_DATASOURCE_NAMES: readonly string[] = SPEC_ROUTE_SHADOWED_DATASOURCE_NAMES;
