// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';
import { GetMetaItemResponseSchema } from './protocol.zod';

/**
 * App metadata bundle — `GET /api/v1/meta/app/{appId}/bundle`.
 *
 * One request that answers the metadata a console asks for while it works
 * inside one app: the app with its navigation, every object that navigation
 * reaches and the objects that point at those through a relationship, and the
 * views, pages and dashboards they draw. A console loads it once per session and
 * revalidates it with `If-None-Match` after that.
 *
 * Every member is the answer of the item read it replaces, asked as the same
 * caller: the app is `GET /meta/app/{appId}`, and each entry of `objects`,
 * `views`, `pages` and `dashboards` is `GET /meta/{type}/{name}` for that
 * entry's own `type` and `name`, envelope included. Audience gates, list-view
 * and dashboard permissions, the field-visibility mask, the translation to the
 * request's locale and the per-caller `sortability` therefore apply exactly as
 * they apply to those reads. An item whose read refuses the caller is ABSENT:
 * the bundle carries no entry, no name and no placeholder for it. An app the
 * caller cannot read refuses the whole request with the app read's own answer,
 * so the bundle never discloses an app the caller could not open.
 *
 * Which items the bundle holds is derived on the server, from the app the
 * caller is served (navigation already pruned to that caller):
 *
 * - `objects` — every object an `object` navigation entry names (top-level
 *   `navigation`, each area's `navigation`, and `children` at any depth), in
 *   navigation order; then every object with a `lookup` or `master_detail`
 *   field whose `reference` is one of those, in registry order. One hop: an
 *   object related only to a related object is not included.
 * - `views` — every view a navigation entry names by `viewName`, and every view
 *   bound to an object in `objects`.
 * - `pages` — every page a `page` navigation entry names, and every page bound
 *   to an object in `objects` by its `object`.
 * - `dashboards` — every dashboard a `dashboard` navigation entry names.
 *
 * A name appears once per list, at its first position. Items outside the
 * bundle stay on their own `GET /meta/{type}/{name}` read.
 *
 * The response carries a weak `ETag` that identifies the body served to
 * THIS caller, under `Cache-Control: private, no-cache` (the item reads' own
 * cache posture), and `Vary: Accept-Language`; a request whose `If-None-Match`
 * names it is answered `304` with no body. Two callers are answered one
 * validator only when they are served the same body. When any member's field
 * visibility could not be determined, the bundle is served under
 * `Cache-Control: private, no-store` with no `ETag`, as that item's read is.
 */

/** The answer of `GET /meta/app/{appId}/bundle` — bare, as the `/meta` item reads answer. */
export const AppMetadataBundleResponseSchema = lazySchema(() => z.object({
  app: GetMetaItemResponseSchema.describe(
    'The app, as `GET /meta/app/{appId}` answers it to this caller (its navigation pruned to what the caller may open).',
  ),
  objects: z.array(GetMetaItemResponseSchema).describe(
    'The objects the app\'s navigation reaches, then the objects whose relationship fields reference them, each as '
    + '`GET /meta/object/{name}` answers it. An object the caller may not read is absent.',
  ),
  views: z.array(GetMetaItemResponseSchema).describe(
    'The views the navigation names and the views bound to the bundled objects, each as `GET /meta/view/{name}` '
    + 'answers it. A view the caller may not read is absent.',
  ),
  pages: z.array(GetMetaItemResponseSchema).describe(
    'The pages the navigation names and the pages bound to the bundled objects, each as `GET /meta/page/{name}` '
    + 'answers it. A page the caller may not read is absent.',
  ),
  dashboards: z.array(GetMetaItemResponseSchema).describe(
    'The dashboards the navigation names, each as `GET /meta/dashboard/{name}` answers it. A dashboard the caller '
    + 'may not read is absent.',
  ),
}).strict());
export type AppMetadataBundleResponse = z.input<typeof AppMetadataBundleResponseSchema>;
export type AppMetadataBundleResponseParsed = z.infer<typeof AppMetadataBundleResponseSchema>;
