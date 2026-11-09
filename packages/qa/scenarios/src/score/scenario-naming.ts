// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The literal-prefix rule of a gallery app: an item whose name stays global
 * in the environment carries the app's namespace, so two gallery apps
 * installed in one environment cannot collide on it.
 *
 * Which names stay global is ADR-0150's, not this file's. Its D1 table keeps
 * bucket 1 on the global literal prefix:
 *
 *   `object` (ADR-0129 D2, the table name) · `field` · `object_extension` ·
 *   `view` (object-derived) · `capability` (`NS.SHORT`, ruling 6683456244) ·
 *   `doc` (ADR-0046 doc lint) · an api's `path` (globally unique)
 *
 * and D7 keeps a `position` as one slot per name in the environment, so a
 * bare position still collides at install. Every other type (buckets 2-4:
 * flows, actions, jobs, tools, skills, agents, apps, pages, dashboards,
 * permission sets, an api item's `name`, …) is identified by (package, name)
 * and is named plainly: ADR-0150 D9 narrows this check to bucket 1 and
 * positions. {@link LITERAL_PREFIX_TYPES} restates that table until the
 * platform exports the bucket of each type; `test/score/entry.test.ts` reads
 * the ADR's two rows, and fails when they change or when the types this check
 * judges stop being exactly the ones they name.
 *
 * Of the manifest collections (`PLURAL_TO_SINGULAR`, the one table of them,
 * read through `resolveStackCollection` so a multi-package artifact is judged
 * too), four hold such a type: views, docs and positions, named
 * `<namespace>_<short>`, and capabilities, named `<namespace>.<short>`
 * ({@link literalPrefix}). Objects are not judged here: `defineStack` already
 * refuses an object without its namespace prefix, and the card's `expect`
 * names them namespace-relative. Fields and object extensions are not
 * collections of the manifest, and an api's `path` is not its name.
 *
 * Only a bare name produces a check, and it always fails: one Build finding
 * per item, named by its type and name, so a candidate with one fails the
 * Build half. A clean build adds no check, so the rule never pads a score.
 *
 * Deterministic: no model call, no network (the cost ruling on cloud#3600).
 */

import { resolveStackCollection } from '@objectstack/core';
import { PLURAL_TO_SINGULAR } from '@objectstack/spec/meta-spelling';

import type { CheckResult } from './scenario-score.js';

/**
 * The metadata types whose name keeps the global literal prefix: ADR-0150 D1's
 * bucket 1 and the position (D7), restated from the ADR's table.
 */
const LITERAL_PREFIX_TYPES: readonly string[] = Object.freeze(['object', 'field', 'object_extension', 'view', 'capability', 'doc', 'position']);

/** The manifest collections this check walks (plural key → type): those of {@link LITERAL_PREFIX_TYPES}, objects excepted. */
const PREFIX_JUDGED_COLLECTIONS: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(Object.entries(PLURAL_TO_SINGULAR).filter(([key, type]) => key !== 'objects' && LITERAL_PREFIX_TYPES.includes(type))),
);

/** What a `type` item's name starts with in an app of `namespace`: `<namespace>.` for a capability (`NS.SHORT`), else `<namespace>_`. */
function literalPrefix(type: string, namespace: string): string {
  return type === 'capability' ? `${namespace}.` : `${namespace}_`;
}

/** One failing check per item of `artifact` that keeps the literal prefix (views, docs, capabilities, positions) and is named without it. */
export function gradeItemNames(artifact: unknown, namespace: string): CheckResult[] {
  const out: CheckResult[] = [];
  for (const [key, type] of Object.entries(PREFIX_JUDGED_COLLECTIONS)) {
    const prefix = literalPrefix(type, namespace);
    for (const item of resolveStackCollection(artifact, key)) {
      const name = typeof item === 'object' && item !== null ? (item as { name?: unknown }).name : undefined;
      if (typeof name !== 'string' || name.startsWith(prefix)) continue;
      out.push({ check: `bare-name:${type}:${name}`, pass: false, detail: `a gallery app names each ${type} \`${prefix}<short>\`; this ${type} is \`${name}\`` });
    }
  }
  return out;
}
