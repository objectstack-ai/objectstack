// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os validate`'s half of the override write gate (ADR-0146 D2, ruling A on
 * #28390; card #28410).
 *
 * ## One judge, not a second rule
 *
 * The verdict is `@objectstack/metadata-protocol`'s `judgeOverrideWrite`, the
 * SAME function the publish doors (`saveMetaItem`, `publishMetaItem`,
 * `publishPackageDrafts`) and the marketplace managed install ask. ⛔ Not an
 * `@objectstack/lint` rule and not a re-spelling of it here: a twin agrees
 * with the doors only until one of the two is edited. What this module owns
 * is the WALK — which items an artifact carries, under which package, and
 * which packages of the artifact's closure ship the same name — and nothing
 * about the verdict.
 *
 * ## The walk
 *
 * Each package of the artifact (`packages[]`, ADR-0130 D4), or the stack
 * itself when it carries none, is judged against its dependency closure:
 * the manifest's `dependencies`, followed transitively through the packages
 * this same artifact carries.
 *
 *   - A same-named item is found only where both packages are in this
 *     artifact: a base the artifact does not carry is not visible here, and
 *     the publish door judges that write against the installed base.
 *   - A DECLARED item (`overrides: { package, basedOn }`) is judged whole —
 *     the pair predicate, the closure, the type — wherever its base lives.
 *     When the base is in the closure but not in this artifact, whether it
 *     ships the name is the one fact this door cannot read, so it is assumed
 *     and the publish door answers it.
 *
 * Items are named the way the registry names them (`overrideWriteItemsOf`,
 * the walk the marketplace install door asks too): an `action` by
 * `<objectName>:<name>`, a `views:` container by the views it expands into.
 */

import { judgeOverrideWrite, overrideWriteItemsOf, type OverrideWriteItem } from '@objectstack/metadata-protocol';
import { OverrideDeclarationSchema } from '@objectstack/spec/kernel';

import { artifactPackages } from './artifact-packages.js';

/** One refusal, located. `message` is the publish door's, verbatim. */
export interface OverrideDeclarationRefusalRow {
  /** Where the item sits in the parsed stack, e.g. `packages[1].manifest.views[0]`. */
  path: string;
  /** The code the publish door refuses the same write with. */
  code: 'NOT_OVERRIDABLE';
  /** Which of the gate's refusals this is (`judgeOverrideWrite`'s `rule`). */
  rule: string;
  /** The package the item is written into. */
  packageId: string;
  message: string;
}

interface WalkedPackage {
  id: string;
  dependencies: string[];
  items: OverrideWriteItem[];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

const dependencyIds = (manifest: Record<string, unknown> | undefined): string[] => {
  const declared = manifest?.dependencies;
  if (Array.isArray(declared)) return declared.filter((d): d is string => typeof d === 'string');
  return isRecord(declared) ? Object.keys(declared) : [];
};

/** The artifact's packages: `packages[]`, or the stack itself as one package. */
function packagesOf(parsed: Record<string, unknown>): WalkedPackage[] {
  const entries = artifactPackages(parsed);
  if (entries.length > 0) {
    return entries.map(({ index, id, body }) => ({
      id,
      dependencies: dependencyIds(body),
      items: overrideWriteItemsOf(body, `packages[${index}].manifest.`),
    }));
  }
  const manifest = isRecord(parsed.manifest) ? parsed.manifest : undefined;
  const id = typeof manifest?.id === 'string' && manifest.id !== '' ? manifest.id : undefined;
  if (id === undefined) return [];
  return [{ id, dependencies: dependencyIds(manifest), items: overrideWriteItemsOf(parsed, '') }];
}

/** `id`'s dependency closure, followed through the packages this artifact carries. */
function closureOf(id: string, byId: ReadonlyMap<string, WalkedPackage>): string[] {
  const seen = new Set<string>();
  const queue = [...(byId.get(id)?.dependencies ?? [])];
  while (queue.length > 0) {
    const next = queue.shift()!;
    if (next === id || seen.has(next)) continue;
    seen.add(next);
    queue.push(...(byId.get(next)?.dependencies ?? []));
  }
  return [...seen];
}

/**
 * Every item of the parsed stack the publish door would refuse under the
 * override write gate — an undeclared same name inside the closure, or an
 * `overrides` declaration the gate does not admit.
 */
export function findOverrideDeclarationRefusals(parsed: Record<string, unknown>): OverrideDeclarationRefusalRow[] {
  const packages = packagesOf(parsed);
  const byId = new Map(packages.map((p) => [p.id, p]));
  const shipped = new Map(packages.map((p) => [p.id, new Set(p.items.map((i) => `${i.type}\u0000${i.identity}`))]));
  const rows: OverrideDeclarationRefusalRow[] = [];
  for (const pkg of packages) {
    const dependencies = closureOf(pkg.id, byId);
    for (const walked of pkg.items) {
      const key = `${walked.type}\u0000${walked.identity}`;
      const shippers = dependencies.filter((d) => shipped.get(d)?.has(key));
      // A malformed `overrides` is no declaration (the schema step reports
      // it), so it names no base here either, as the gate reads it.
      const declared = isRecord(walked.item) ? OverrideDeclarationSchema.safeParse(walked.item.overrides) : undefined;
      const base = declared?.success ? declared.data.package : undefined;
      // A declared base the closure names but this artifact does not carry:
      // whether it ships the name is read at the publish door.
      if (base !== undefined && dependencies.includes(base) && !byId.has(base) && !shippers.includes(base)) {
        shippers.push(base);
      }
      const verdict = judgeOverrideWrite(
        { type: walked.type, name: walked.name, packageId: pkg.id, item: walked.item },
        { dependencies, shippers },
      );
      if (verdict.verdict !== 'refuse') continue;
      rows.push({ path: walked.path, code: 'NOT_OVERRIDABLE', rule: verdict.rule, packageId: pkg.id, message: verdict.message });
    }
  }
  return rows;
}
