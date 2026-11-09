// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * What a marketplace package adds to this runtime, read BEFORE the install
 * (objectstack#30325), so the confirm in front of Install can say it.
 *
 * The source is the package body the install door itself installs: the
 * catalog's `GET /packages/:id/versions/latest/manifest`, the read the package
 * page already makes for the package's install modes. Nothing here is a second
 * opinion of the door's: each count follows the door's own reading of that
 * body, and the install's answer (its `seeded` report, objectstack#30323) stays
 * what says what was loaded.
 *
 * - Package bodies: a compiled artifact nests its manifest under `manifest:`
 *   beside the collections, a flattened bundle carries both at the top, and a
 *   multi-package artifact carries each package's body in a `packages[]`
 *   entry (ADR-0130 D4). The door registers every one of them.
 * - Objects: each body's `objects`, a list or a map keyed by name.
 * - Permission sets: each body's `permissions` LIST. The same key at the
 *   manifest stage is the capability grant (ADR-0025), an object, which is not
 *   a set and is not counted.
 * - Sample records: the body's top-level `data[]` entries that name an object
 *   and carry `records`, summed: the datasets the install's seed step loads.
 *   A dataset scoped to some environments (`env`) or locales (`locale`) may
 *   not load here, so then the count is an upper bound (`sampleRecordsAtMost`).
 * - Suggested grants: each permission set declaring `isDefault: true`, which
 *   the install turns into a suggestion to grant it to the Everyone position
 *   (ADR-0090 D5). Nothing is granted until an administrator accepts it.
 */

/** What the confirm says a package adds. */
export interface InstallPreview {
  objects: number;
  permissionSets: number;
  sampleRecords: number;
  /** A counted dataset is scoped by environment or locale: `sampleRecords` is at most what loads. */
  sampleRecordsAtMost: boolean;
  /** Permission-set names the install will suggest granting to Everyone. */
  suggestedGrants: string[];
}

const ALL_ENVS = ['prod', 'dev', 'test'];

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** One package body, flat: a nested `manifest:` lifted beside the collections, the collections winning. */
function flatten(body: Record<string, any>): Record<string, any> {
  if (!isRecord(body.manifest)) return body;
  const { manifest, ...sections } = body;
  return { ...manifest, ...sections };
}

function objectCount(objects: unknown): number {
  if (Array.isArray(objects)) return objects.filter(isRecord).length;
  if (isRecord(objects)) return Object.values(objects).filter(isRecord).length;
  return 0;
}

function permissionSetsOf(permissions: unknown): Record<string, any>[] {
  return Array.isArray(permissions)
    ? permissions.filter((p): p is Record<string, any> => isRecord(p) && typeof p.name === 'string' && p.name.length > 0)
    : [];
}

function scoped(dataset: Record<string, any>): boolean {
  if (Array.isArray(dataset.locale) && dataset.locale.length > 0) return true;
  if (Array.isArray(dataset.env)) return !ALL_ENVS.every((e) => dataset.env.includes(e));
  return false;
}

/**
 * The preview of the served manifest value (`data.manifest` of the catalog's
 * manifest answer). `null` when it is not a package body, so the confirm says
 * it could not read what the package adds rather than saying it adds nothing.
 */
export function installPreviewOf(served: unknown): InstallPreview | null {
  if (!isRecord(served)) return null;
  const top = flatten(served);
  const bodies: Record<string, any>[] = [top];
  if (Array.isArray(top.packages)) {
    for (const entry of top.packages) {
      if (isRecord(entry) && isRecord(entry.manifest)) bodies.push(flatten(entry.manifest));
    }
  }

  let objects = 0;
  let permissionSets = 0;
  const suggestedGrants: string[] = [];
  for (const body of bodies) {
    objects += objectCount(body.objects);
    const sets = permissionSetsOf(body.permissions);
    permissionSets += sets.length;
    for (const set of sets) {
      if (set.isDefault === true && !suggestedGrants.includes(set.name)) suggestedGrants.push(set.name);
    }
  }

  const datasets = Array.isArray(top.data)
    ? top.data.filter((d: unknown): d is Record<string, any> => isRecord(d) && !!d.object && Array.isArray(d.records))
    : [];
  const sampleRecords = datasets.reduce((sum: number, d: Record<string, any>) => sum + d.records.length, 0);
  const sampleRecordsAtMost = datasets.some((d: Record<string, any>) => d.records.length > 0 && scoped(d));

  return { objects, permissionSets, sampleRecords, sampleRecordsAtMost, suggestedGrants };
}
