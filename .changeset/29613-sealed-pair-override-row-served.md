---
'@objectstack/metadata-protocol': patch
'@objectstack/plugin-hono-server': patch
---

fix(metadata-protocol): a `.custom` pair's published override of a page, app, dataset, doc or book is served from its stored row by every read, and no longer sits in the registry under the base's envelope

Clause-②: no
Metadata-protocol: none

Pages, apps, datasets, docs and books take no environment overlay, so every read declined their stored rows as overlays of a package's item. That included the override a base's `<base>.custom` pair publishes under ADR-0146. The override was served only from a copy the registry kept under the item's bare name, wearing the base's envelope. On a server with a metadata service (every real boot), the by-name read answered the base's shipped item instead, while the lists answered the override.

The reads now serve the pair's declared override from its row, as they already did for dashboards and reports. Every other stored row of such a name is still not served. The registry no longer keeps the copy under the base's envelope. What moves, for each of the five types, all toward ADR-0146 D8:

- `GET /meta/TYPE/NAME` with no package, the base or the pair: the override on every server (item 2). Before, it served the base's shipped item whenever a metadata service was present.
- The layered read naming the base, `effective`: the override (item 2). Before, the base's shipped item.
- The per-package layer naming the pair: the override (item 3). Before, empty. So the pair's export (`GET /packages/PAIR/export`) now carries the override with its `overrides` block, as it does for a dashboard.
- The per-package layer naming the base: the base's own item only (item 3). Before, it also listed the override, or listed only the override when a metadata service was present.
- `GET /me/apps` (`@objectstack/plugin-hono-server`): it now lists the protocol's served apps (what `GET /meta/app` serves) when the protocol service is present, so the pair's override of an app is listed. With no protocol service it reads the registry as before.
- A registry read that names the item directly answers the base's own item.

Reads that already served the override still do: the effective list (no package, the base). Nothing to migrate: a restart re-hydrates the registry under the new rule.
