---
'@objectstack/spec': minor
'@objectstack/runtime': minor
---

feat(spec,runtime): every served package row carries `disableable`, the disable door's own verdict, beside `writable`

Clause-②: yes (widening)
Metadata-protocol: added

- **New key.** `SERVED_ROW_VERDICTS` in `@objectstack/spec/api-assembled` declares `disableable: boolean` on both stage branches of `InstalledPackageAtEitherStageSchema`, so `GET /api/v1/packages` and `GET /api/v1/packages/:id` serve it on every row. It answers "may an org disable this package here?": `true` for a writable base and for a module of an installed app (a `type: 'module'` package that directly depends on an installed `type: 'app'` package, outside a `system` / `cloud` scope), `false` for every other read-only package.
- **One predicate.** The runtime computes the served value with the same predicate `PATCH /api/v1/packages/:id/disable` asks before it switches a package off, so the row and the door cannot disagree. The caller's own permission and a catalog wall are still asked at the door; the verdict is about the package only.
- **`writable` is unchanged.** A module of an installed app is `disableable: true` and `writable: false`: it may be switched off, never authored into. A client offers Disable / Enable from `disableable`, and authoring from `writable`.
- **Who sees it.** A customer admin on the Packages page: once the Console reads this key, it can offer Disable on a suite module the server already accepts.
