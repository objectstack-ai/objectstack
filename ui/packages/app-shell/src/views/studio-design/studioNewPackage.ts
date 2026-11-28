// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The retired Studio new-package deep link, `/studio?new=package`.
 *
 * It opened the Studio home with its create-package dialog open. The home was
 * removed (objectstack#36908, epic #36890 decision 9), and a package is
 * created from Setup → Packages, which then lands in Studio on it
 * (`SETUP_NEW_PACKAGE_PATH`, objectstack#36834). The console's own doors link
 * there; a bookmark of the old address is forwarded there by Studio's entry
 * (`StudioEntryRedirect`), so it still opens New Package.
 *
 * `new` is a page-scoped param, so it is not listed in `urlParams.ts`; it
 * collides with none of the names reserved there.
 */

/** The retired deep link's query param, which named what to create on arrival. */
export const STUDIO_NEW_PARAM = 'new';

/** The {@link STUDIO_NEW_PARAM} value that asked for a new package. */
export const STUDIO_NEW_PACKAGE_VALUE = 'package';
