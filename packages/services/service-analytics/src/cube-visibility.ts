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
 * through an ad-hoc cube named after the object. What `false` withholds is the
 * cube's own semantic definition: its name, its measures (raw SQL included) and
 * its dimensions.
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
 * ## Why the refusal is `CUBE_NOT_FOUND` / 404
 *
 * To an API consumer a hidden cube is exactly as absent as one nobody declared:
 * discovery omits both, so the query doors answer both with the same declared
 * envelope instead of a second code that would only tell a caller which names
 * exist. The message differs, because the person reading it is usually the
 * author who wrote the flag, and it says how to expose the cube. It is never an
 * empty result: a query that silently returned no rows would read as "no data"
 * on a dashboard.
 */
export function isCubePublic(cube: Cube): boolean {
  return cube.public !== false;
}

/** The `CUBE_NOT_FOUND` / 404 refusal every query door answers a hidden cube with. */
export function cubeNotPublicError(name: string): Error & { code: string; status: number; cube: string } {
  const err = new Error(
    `Cube '${name}' is not available through the analytics API: it declares \`public: false\`, which hides it ` +
      `from /analytics/meta and refuses every query against it. Remove \`public: false\` from the cube ` +
      `definition (cubes are visible by default) to query it, or query a cube that is not hidden.`,
  ) as Error & { code: string; status: number; cube: string };
  err.code = 'CUBE_NOT_FOUND';
  err.status = 404;
  err.cube = name;
  return err;
}
