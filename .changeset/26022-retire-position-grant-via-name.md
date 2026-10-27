---
'@objectstack/spec': patch
'@object-ui/app-shell': patch
---

**BREAKING** — `PositionGrantVia` (`@objectstack/spec/contracts`) loses its `'name'` member, and the Setup position list drops its "(by name)" badge (#26022).

Clause-②: no (narrowing)
Metadata-protocol: none
Ruling-ref: #13419 ruling B (`5472608110`); 「甲」 as amended (`6303865025`); triage unlock on #26022 (`6424661273`)

**Why.** The security plugin no longer grants a position's holders the permission set that only shares the position's name: a position grants the sets its definition names in `permissionSets`, and nothing else (#24757). Since then nothing serves `via: 'name'` on `describePositionGrants` or on `GET /api/v1/meta/position?include=grants`. The spec still published the member and the console still drew a badge for it, so both described a grant the runtime no longer makes. #13419 ruling B retires the channel in 18.x with no retirement stage.

What changes:

- `@objectstack/spec`: `PositionGrantVia` is `'definition'`. Every entry of `PositionGrantSummary.permissionSets` carries `via: 'definition'`, as the security plugin already serves it.
- `@object-ui/app-shell`, Setup → Positions: the granted-sets column shows each set's name alone. The "(by name)" / 「（同名）」 badge and its hint are gone, with the i18n keys `engine.position.grants.byName` and `engine.position.grants.byNameHint` (en and zh).
- `@object-ui/app-shell`, Setup → Users on a managed environment: the 「未授权」 marker judges a held position only by the sets its definition lists. It no longer counts a permission set that shares the position's name, and it no longer reads the permission-set catalogue to do so. A holder of such a position is now marked when nothing else grants them a set beyond the baseline, which is what the server enforces. Before this change, such a holder was left unmarked.

For TypeScript consumers: code that compares a `PositionGrantVia` value with `'name'` no longer compiles (TS2367). Delete that branch, because no server serves the value. To have a position grant the set that shares its name, name the set in the position's `permissionSets`. No stored row or authored metadata carries the type, so nothing is converted.

The ADR-0087 D3 semantic entry `position-grant-via-name-retired` records the retirement. `PositionGrantVia` types a served description, not a stack collection or a metadata type, so there is no source for a D2 conversion to rewrite.

<!-- adr-0087: registered position-grant-via-name-retired -->
