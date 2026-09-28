// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { Cube } from '@objectstack/spec/data';

/**
 * The reader of `analytics_cube.public` — the one place the analytics API asks
 * whether a registered cube is exposed.
 *
 * ## What the key means (the Cube.dev semantics the schema follows)
 *
 * A cube declared `public: false` is hidden from the analytics API: discovery
 * (`getMeta`, `GET /analytics/meta`) omits it, and every door that runs a query
 * against a named cube refuses it — `query()` (`POST /analytics/query`, and the
 * dataset door, which reaches `query()` through `DatasetExecutor`) and
 * `generateSql()` (`POST /analytics/sql`). Anything else is visible; the schema
 * default is `true`.
 *
 * It is VISIBILITY, not row security. An object's records stay governed by the
 * object's permissions and row-level security on every door (`assertReadAdmitted`
 * and the read scope in `analytics-service.ts`), whether or not some cube over
 * that object is hidden — a caller who may read the object may still aggregate it
 * through an ad-hoc cube named after the object. What `false` does, and all it
 * does: the cube is left out of `/analytics/meta`, and queries and SQL
 * generation against it are refused. It does NOT hide the cube's definition
 * from the metadata door — authored cubes are also `analytics_cube` metadata
 * items, readable there like any other authored schema (the Cube.dev split:
 * `public` governs the query API, not the schema files).
 *
 * ## Why `=== false` and not a truthiness test
 *
 * The registry holds the INPUT shape (`Cube` is `z.input<typeof CubeSchema>`):
 * `CubeRegistry.register` never parses, and the internal producers
 * (`inferCubeFromQuery`, `compileDataset`, `CubeRegistry.inferFromObject`) build
 * typed literals. So an absent key reaches this function as `undefined`, and the
 * reading of an absent key is the schema's default — visible. Only the explicit
 * value the author wrote hides; `analytics.test.ts` in `@objectstack/spec` pins
 * that default, so the two cannot drift apart silently.
 *
 * ## Why the refusal is the unknown-cube refusal, byte for byte
 *
 * To an API consumer a hidden cube is exactly as absent as one nobody declared:
 * discovery omits both, so the query doors answer both with ONE refusal —
 * {@link cubeNotFoundError}, the same `CUBE_NOT_FOUND` / 404 envelope and the
 * same message — which `analytics-service.ts` throws from both paths
 * (`assertCubePublic` for a hidden cube, `assertInferableCube` for a name that
 * is neither a cube nor an object). A caller who guesses a name therefore
 * cannot tell a hidden cube from a missing one by status, code or text; the
 * message names both possibilities, so the author who wrote the flag still
 * reads how to expose the cube. `cube-public-visibility.test.ts` pins the
 * identity. It is never an empty result: a query that silently returned no rows
 * would read as "no data" on a dashboard.
 */
export function isCubePublic(cube: Cube): boolean {
  return cube.public !== false;
}

/**
 * The ONE `CUBE_NOT_FOUND` / 404 refusal for a name the analytics API does not
 * expose — thrown for a hidden cube and for a name that is neither a registered
 * cube nor a registered object, so the two are indistinguishable to a caller.
 *
 * ⛔ Keep the phrase "is not a registered object" in the message:
 * `isMissingSourceError` (`analytics-service.ts`) reads it, and the dataset
 * door's envelope check is what stops that read from turning this 404 into an
 * empty grid (`dataset-degradation-envelope.test.ts`).
 */
export function cubeNotFoundError(name: string): Error & { code: string; status: number; cube: string } {
  const err = new Error(
    `Cube '${name}' not found: the analytics API exposes no cube under that name, and it is not a ` +
      `registered object either (a cube can only be auto-inferred from a registered object). A cube ` +
      `declared \`public: false\` is hidden from the analytics API and answers exactly like a missing one. ` +
      `Define a Cube in your stack, check the object name, or remove \`public: false\` from the cube to ` +
      `expose it.`,
  ) as Error & { code: string; status: number; cube: string };
  err.code = 'CUBE_NOT_FOUND';
  err.status = 404;
  err.cube = name;
  return err;
}
