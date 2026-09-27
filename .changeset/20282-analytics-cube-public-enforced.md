---
'@objectstack/spec': minor
'@objectstack/service-analytics': minor
---

An analytics cube's `public` now takes effect, and it defaults to visible: `CubeSchema.public` defaults to `true` (it was `false`), and the analytics service hides a cube that declares `public: false` from discovery and refuses every query against it (#20282).

Clause-②: yes

Until this change nothing read `public`. `GET /api/v1/analytics/meta` listed a `public: false` cube and every query door answered it, so the flag withheld nothing. Its declared default, `false`, could not simply be switched on: enforcing it as declared would have hidden every cube that omits the key. The default is now the Cube.dev default (visible), and an explicit `false` is enforced:

- `GET /api/v1/analytics/meta` omits a cube declared `public: false`, and `?cube=` naming one answers `[]`, the same as a name no cube has.
- `POST /api/v1/analytics/query` and `POST /api/v1/analytics/sql` refuse it with `404 CUBE_NOT_FOUND`, and the message says how to expose it. The refusal comes before any SQL is built, and it is never an empty result.

`public` is visibility, not row security. An object's records stay governed by its permissions and row-level security on every door, whether or not a cube over it is hidden. What `public: false` withholds is the cube's own definition: its name, its measures (raw SQL included) and its dimensions.

What to expect after upgrading:

- **A cube that omits `public`** stays visible and queryable. It was visible before too, because nothing read the key. A client that parses cube metadata through the published JSON Schema now materializes `public: true` where it materialized `false`.
- **A cube that writes `public: false`** is now hidden and refused. If you wrote it only because it was the old default, delete the line (cubes are visible by default). A dashboard or report that queries such a cube starts answering `404 CUBE_NOT_FOUND` until you do.
- **A compiled artifact built before this release** carries a materialized `public: false` on every cube, because `os compile` writes the parsed stack with its defaults applied. Recompile it with this release before serving cubes from it.
- **Cubes the platform mints itself** stay visible: the cube inferred for an ad-hoc query on an object (the KPI path), a compiled dataset's cube (`POST /api/v1/analytics/dataset/query`), and `CubeRegistry.inferFromObject`. Each wrote a literal `false`, the old default, and now writes `true`.

The showcase example's `showcase_delivery` cube, which is the app's demonstration of `/api/v1/analytics/*`, drops its `public: false`.
