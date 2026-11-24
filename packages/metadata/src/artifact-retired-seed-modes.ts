// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { RETIRED_SEED_MODE_VALUES, SeedMode } from '@objectstack/spec/data';

/**
 * [#34613] A compiled artifact built before the seed modes `insert` and
 * `replace` were retired can still carry a dataset declaring one. The artifact
 * door strict-parses the whole definition, and `SeedSchema.mode` refuses both
 * values, so without this the boot would abort over one seed dataset: no
 * object, view or flow of the artifact would register either. Ruling
 * 6942780880 asks for the opposite: that dataset is refused, loudly, and the
 * rest of the environment loads.
 *
 * So the door parses the definition WITHOUT such datasets and hands them back
 * afterwards, unparsed, to the collection they came from. Seeds are never
 * registered as metadata items (they are applied by the seed loader off the
 * bundle), so the only reader of the handed-back dataset is a seed load, and
 * every seed load refuses it alone with `SeedMode`'s prescription
 * (`SeedLoaderService.loadStored`, and `loadDataset` beneath it).
 *
 * Only a RETIRED value is withheld. A mode that was never a seed mode, or any
 * other malformed dataset, is still the parse's refusal, as before.
 */

/** Where a seed collection sits in an artifact definition, as a key path. */
type SeedCollectionPath = ReadonlyArray<string | number>;

export interface WithheldSeedDataset {
  /** The path of the `data` collection the dataset was taken from. */
  readonly path: SeedCollectionPath;
  readonly dataset: unknown;
  readonly object: string;
  readonly mode: string;
  /** `SeedMode`'s own refusal of the mode: the prescription, never restated. */
  readonly prescription: string;
}

const RETIRED = new Set(RETIRED_SEED_MODE_VALUES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Every container that can hold a seed `data` collection, by path. */
function seedCollectionPaths(definition: Record<string, unknown>): SeedCollectionPath[] {
  const paths: SeedCollectionPath[] = [[], ['manifest']];
  const packages = definition.packages;
  if (Array.isArray(packages)) {
    packages.forEach((_body, index) => {
      paths.push(['packages', index], ['packages', index, 'manifest']);
    });
  }
  return paths;
}

function at(root: unknown, path: SeedCollectionPath): unknown {
  let node: unknown = root;
  for (const key of path) {
    if (Array.isArray(node) && typeof key === 'number') node = node[key];
    else if (isRecord(node) && typeof key === 'string') node = node[key];
    else return undefined;
  }
  return node;
}

/**
 * The definition with every retired-mode seed dataset taken out of its `data`
 * collection (the input is not mutated: each container on the way is copied),
 * and the datasets taken out. With none, the definition is returned as is.
 */
export function withholdRetiredSeedModes(definition: unknown): {
  definition: unknown;
  withheld: WithheldSeedDataset[];
} {
  if (!isRecord(definition)) return { definition, withheld: [] };
  const withheld: WithheldSeedDataset[] = [];
  let copy: Record<string, unknown> | undefined;

  for (const path of seedCollectionPaths(definition)) {
    const container = at(copy ?? definition, path);
    if (!isRecord(container) || !Array.isArray(container.data)) continue;
    const kept: unknown[] = [];
    const taken: WithheldSeedDataset[] = [];
    for (const dataset of container.data) {
      const mode = isRecord(dataset) ? dataset.mode : undefined;
      if (typeof mode === 'string' && RETIRED.has(mode)) {
        const verdict = SeedMode.safeParse(mode);
        taken.push({
          path,
          dataset,
          object: String((dataset as Record<string, unknown>).object ?? '(unnamed)'),
          mode,
          prescription: verdict.success ? '' : verdict.error.issues[0]?.message ?? '',
        });
      } else {
        kept.push(dataset);
      }
    }
    if (taken.length === 0) continue;
    withheld.push(...taken);
    // Copy the containers along the path, then replace the collection.
    copy ??= { ...definition };
    let parent: Record<string, unknown> | unknown[] = copy;
    for (const key of path) {
      const child: unknown = (parent as Record<string | number, unknown>)[key as never];
      const cloned: Record<string, unknown> | unknown[] = Array.isArray(child) ? [...child] : { ...(child as Record<string, unknown>) };
      (parent as Record<string | number, unknown>)[key as never] = cloned;
      parent = cloned;
    }
    (parent as Record<string, unknown>).data = kept;
  }
  return { definition: copy ?? definition, withheld };
}

/**
 * Hand the withheld datasets back to the collection each came from in the
 * PARSED definition, after its own datasets, so a seed load that reads the
 * parsed definition (the dev hot reload reads the top-level `data`) still meets
 * them and refuses them. Mutates `parsed`, which the caller owns.
 */
export function restoreWithheldSeedDatasets(parsed: unknown, withheld: readonly WithheldSeedDataset[]): void {
  for (const entry of withheld) {
    const container = at(parsed, entry.path);
    if (!isRecord(container)) continue;
    container.data = [...(Array.isArray(container.data) ? container.data : []), entry.dataset];
  }
}
