// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Studio landing's new-package deep link: `/studio?new=package` opens the
 * landing (`BuilderLanding`) with its create-package dialog already open.
 *
 * Its own module rather than an export of `BuilderLanding.tsx`: Home and the
 * `/ai` route's no-assistant screen link here from the console's eager
 * closure, while `BuilderLanding` is fetched with the lazy Studio chunk
 * (`apps/console/src/components/studioBuilder.ts`), and a static import of it
 * from either would pull it back into every page load.
 *
 * `new` is a page-scoped param of the landing's own contract, so it is not
 * listed in `urlParams.ts`; it collides with none of the names reserved there.
 */

/** The landing's query param that names what to create on arrival. */
export const STUDIO_NEW_PARAM = 'new';

/** The {@link STUDIO_NEW_PARAM} value that opens the create-package dialog. */
export const STUDIO_NEW_PACKAGE_VALUE = 'package';

/** Studio's new-package flow: the landing, with the create-package dialog open. */
export const STUDIO_NEW_PACKAGE_PATH = `/studio?${STUDIO_NEW_PARAM}=${STUDIO_NEW_PACKAGE_VALUE}`;
