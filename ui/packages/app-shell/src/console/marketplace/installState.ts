// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * What this environment holds of each package, by manifest id: the one
 * install state the catalog page draws on both of its kinds of card, the
 * catalog card and the "Your organization" card (objectstack#33831).
 *
 * Two listings answer "what is installed here", and both are read:
 *   - this runtime's install-local ledger (`listLocalInstalls`): a
 *     self-hosted / single-environment runtime's own installs;
 *   - the control plane's env listing (`listInstalledPackages`): on a
 *     cloud-managed environment, installs by ANY path. It also lists a
 *     soft-uninstalled row (`disabled`, objectstack#28521), which is not
 *     installed.
 * Reading only one of them draws a package the other installed as not
 * installed.
 */

import type { LocalInstallEntry } from './marketplaceApi.js';
import { isNewerVersion } from './versionPrecedence.js';

export interface InstallIndex {
  /** Each installed package's entry — loaded, or refused at startup (`notLoaded`). */
  readonly installed: ReadonlyMap<string, LocalInstallEntry>;
  /** Packages the control plane lists as uninstalled and nothing installs. */
  readonly disabled: ReadonlySet<string>;
}

/**
 * Index the two listings by manifest id. Where both name a package, the
 * install-local entry wins: it is the one that can carry `notLoaded`, and the
 * package page draws it ahead of the control plane's version too.
 */
export function indexInstalls(
  local: readonly LocalInstallEntry[],
  cloud: readonly LocalInstallEntry[],
): InstallIndex {
  const installed = new Map<string, LocalInstallEntry>();
  const disabled = new Set<string>();
  for (const e of cloud) {
    if (e.disabled) disabled.add(e.manifestId);
    else installed.set(e.manifestId, e);
  }
  for (const e of local) installed.set(e.manifestId, e);
  for (const id of installed.keys()) disabled.delete(id);
  return { installed, disabled };
}

/**
 * The version an install can update to: `latest` when it has HIGHER SemVer
 * precedence than the installed version (objectui#10899), else `null`. The
 * package page's "Update available" rule, for any card that draws it.
 */
export function updateTarget(
  installedVersion: string | null | undefined,
  latest: string | null | undefined,
): string | null {
  if (!installedVersion || !latest) return null;
  return isNewerVersion(latest, installedVersion) ? latest : null;
}
