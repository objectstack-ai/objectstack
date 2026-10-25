// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `useHomePath()` — the target every "Home" affordance in the console chrome
 * points at: the top-bar logo, the sidebar's Home row, the mobile sidebar's
 * Home row, and the app switcher's Home entry.
 *
 * Before objectui#7256 each of those named `/home` literally, so on a
 * deployment that DECLARES a landing (`app.isDefault`) the chrome disagreed
 * with `/`: signing in landed you on the declared home, and then the logo took
 * you to a second, different home. On cloud's control plane the second one is
 * the environment launcher, whose cards act on an environment the control plane
 * does not have and whose "Your apps" tiles are the control plane's own
 * internal management apps.
 *
 * The policy itself is `resolveDeclaredHomePath` — see `utils/homePath.ts` for
 * why the declaration, and not a hostname or a product name, is the signal.
 *
 * While the app list is still loading, `useMetadata().apps` is empty and this
 * answers `/home`. That is deliberate: this is a LINK target, not a redirect,
 * so an in-flight answer costs nothing (the href settles before a boot-time
 * click is plausible) — unlike `/` , where an unresolved list must not be
 * fossilized into history (`isAppListConclusive`, objectui#4233).
 *
 * @module
 */

import { useMetadata } from '../providers/MetadataProvider.js';
import {
  HOME_LAUNCHER_PATH,
  resolveDeclaredHomePath,
  type DeclaredHomeApp,
} from '../utils/homePath.js';

/** The path the console chrome's Home affordances navigate to. */
export function useHomePath(): string {
  const { apps } = useMetadata();
  return resolveDeclaredHomePath(apps as DeclaredHomeApp[] | undefined) ?? HOME_LAUNCHER_PATH;
}
