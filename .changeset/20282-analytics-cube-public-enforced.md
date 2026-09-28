---
'@objectstack/spec': minor
'@objectstack/service-analytics': minor
---

An analytics cube's `public` now takes effect, and it defaults to visible: `CubeSchema.public` defaults to `true` (it was `false`), and the analytics service hides a cube that declares `public: false` from discovery and refuses every query against it (#20282).

Clause-②: yes (narrowing)

**BREAKING**: this narrows what the analytics API answers. A query or SQL dry run against a cube declared `public: false` (`POST /api/v1/analytics/query`, `POST /api/v1/analytics/sql`) was answered before this change and is now refused with `404 CUBE_NOT_FOUND`, and `GET /api/v1/analytics/meta` no longer lists that cube. The same happens to every cube in an artifact built by `os compile` before this release, which carries a materialized `public: false` from the old default. The remedy: delete `public: false` from any cube that is meant to be queried (cubes are visible by default), and recompile pre-release artifacts. It ships as `minor` under the launch-window convention; the widening half is the default moving to visible.

Until this change nothing read `public`. `GET /api/v1/analytics/meta` listed a `public: false` cube and every query door answered it, so the flag withheld nothing. Its declared default, `false`, could not simply be switched on: enforcing it as declared would have hidden every cube that omits the key. The default is now the Cube.dev default (visible), and an explicit `false` is enforced:

- `GET /api/v1/analytics/meta` omits a cube declared `public: false`, and `?cube=` naming one answers `[]`, the same as a name no cube has.
- `POST /api/v1/analytics/query` and `POST /api/v1/analytics/sql` refuse it with `404 CUBE_NOT_FOUND` — the same refusal, byte for byte, that an unknown cube name gets, so a caller cannot use it to learn that a hidden cube exists. The one shared message names both possibilities, so it still tells an author how to expose a hidden cube. The refusal comes before any SQL is built, and it is never an empty result.

`public` is visibility on the analytics API, not row security. An object's records stay governed by its permissions and row-level security on every door, whether or not a cube over it is hidden. What `public: false` does is exactly the two points above: the cube is left out of `/analytics/meta`, and queries and SQL generation against it are refused. The cube's definition stays readable on the metadata door, like any other authored schema.

What to expect after upgrading:

- **A cube that omits `public`** stays visible and queryable. It was visible before too, because nothing read the key. A client that parses cube metadata through the published JSON Schema now materializes `public: true` where it materialized `false`.
- **A cube that writes `public: false`** is now hidden and refused. If you wrote it only because it was the old default, delete the line (cubes are visible by default). A dashboard or report that queries such a cube starts answering `404 CUBE_NOT_FOUND` until you do.
- **A compiled artifact built before this release** carries a materialized `public: false` on every cube, because `os compile` writes the parsed stack with its defaults applied. Recompile it with this release before serving cubes from it.
- **Cubes the platform mints itself** stay visible: the cube inferred for an ad-hoc query on an object (the KPI path), a compiled dataset's cube (`POST /api/v1/analytics/dataset/query`), and `CubeRegistry.inferFromObject`. Each wrote a literal `false`, the old default, and now writes `true`.

The showcase example's `showcase_delivery` cube, which is the app's demonstration of `/api/v1/analytics/*`, drops its `public: false`.
