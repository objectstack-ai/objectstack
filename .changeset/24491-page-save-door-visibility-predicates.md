---
'@objectstack/lint': minor
---

fix(lint)!: the page save door refuses a page component `visibleWhen` that `os build` refuses (#24491)

Clause-②: no (narrowing)

A page component's `visibleWhen` was judged by `os validate`, `os build` and `os lint`, and not by the metadata save door. A page saved through Studio, REST `/meta` or an MCP/AI author answered `200` and was stored when a component predicate called a function nothing registers (such as `totallyBogusFn(1)`), read a bare field (`status == 'open'`), did not parse, or overran the CEL parse budget. At render such a predicate faults, the visibility fallback is `true`, and the component renders for everyone.

The visibility-predicate family (`validateVisibilityPredicates`, `validatePredicatePathRefs`) now runs on a `page` write as well as on a `view` write, on the principle of ruling B on #23388: a page with a finding is fixed, then saved. The door's verdict is the build's finding: the same rule id (`visibility-predicate-unknown-function`, `visibility-bare-identifier`, `visibility-predicate-syntax`, `visibility-predicate-over-budget`), location (`pages[N].regions[N].components[N]`, and the slot or nested path the build names), message and hint. `visibility-root-mislayered` (a `data.`-rooted predicate on a page) rides the save response as an advisory, as it is a warning at the build. `validatePredicatePathRefs` judges schema-bound form views only, so it adds no finding on a page.

**BREAKING — what moves for consumers.** This is an accept-set narrowing on the metadata save door, shipped as `minor` under the launch-window convention for accept-set narrowings (`.changeset/pre.json` is open in `next` pre mode).

- FROM: a page write in publish mode answered `200` for a component `visibleWhen` the build refuses. This covers `PUT /api/v1/meta/page/:name` (and `saveMetaItem` in publish mode), the promotion of a draft (`POST /api/v1/meta/page/:name/publish`, `publishMetaItem`), and a package draft publish (`publishPackageDrafts`).
- TO: it answers `422 INVALID_METADATA`, with the build's issue located at that component.
- Fix: correct the predicate the issue names, as `os build` already requires, and save again. Call a function `introspectScope` lists, read through a bound root (`record.FIELD`, `current_user.FIELD`, `page.VAR`), and fix the syntax the verdict quotes. Saving the page as a draft (`mode: 'draft'`) is still allowed, because drafts are never gated; publishing that draft is judged.

**The next save of a stored page whose component `visibleWhen` the build refuses is refused with the fix; stored pages keep serving until then.** The door judges writes only: a stored page row is not re-judged at boot, loads and is served as before.

**Unchanged.**

- Stored rows are not migrated, and they are not refused on read.
- A `view` write is judged as before.
- `OS_ALLOW_UNLINTED_METADATA_WRITES=1` still turns a refusal into a logged write.
- Measured before crossing: the 36 pages this repository ships (the examples, `platform-objects`, `plugin-approvals`, `cloud-connection`, `mcp` and `qa/downstream-contract`) carry 8 component `visibleWhen` predicates. Neither rule finds anything in them, at the build or at the door, before this change or after it; deployed rows were not measured.
- No public export or signature moves. The two registry entries gain `page` in `runtimeTypes`, and the gate itself is unchanged: `page` already mapped to `pages`.

<!-- adr-0087: not-required (no-migration-prescription) a refusal at the page save door of a page component visibleWhen that the published validator already refuses at `os build`: no authorable key, spelling, export or stored shape moves, and no stored row is read, rewritten or converted. A stored page whose component predicate the validator refuses keeps loading until it is next saved, and the repair is the author's edit of the predicate, which no ledger entry can derive. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers this door (not already-registered); and the change is a door verdict, not a declaration or an export (not runtime-interface-only, type-surface-only or runtime-export-retired). -->
