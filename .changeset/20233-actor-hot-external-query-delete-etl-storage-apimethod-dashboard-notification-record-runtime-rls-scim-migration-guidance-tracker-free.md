---
'@objectstack/spec': patch
---

fix(spec): `os migrate meta` guidance for the `actor-*`, `hot-*`, `external-*`, `query-*`, `delete-*`, `etl-*`, `storage-*`, `apimethod-*`, `dashboard-*`, `notification-*`, `record-*`, `runtime-*`, `rls-*` and `scim-*` migration entries states each lesson in words instead of citing tracker numbers

Clause-②: no

The ADR-0087 semantic entries of the `actor-*` family (the retired `ctx.user.roles` alias),
the `hot-*` family (the inert `'disk'` / `'distributed'` state strategies and the file-watch
placeholder), the `external-*` family (the retired external-lookup and message-queue
schemas), the `query-*` family (the retired `QueryAST` request members and aggregation
functions), the `delete-*` family (the retired by-id repoint in a `beforeDelete` hook), the
`etl-*` family (the retired ETL pipeline layer), the `storage-*` family (the retired
single-argument `IStorageService.list`), the `apimethod-*` family (the `apiMethods` enum
shrunk to six primitives), the `dashboard-*` family (the `compareTo` offset, the page-only
modal target, the chart-config structure refusal, the single-measure metric tile and the
funnel-only `stageOrder`), the `notification-*` family (the retired inbox cursor), the
`record-*` family (the object-form detail sections and the converged chatter position), the
`runtime-*` family (the retired `HttpServer` wrapper), the `rls-*` family (the refused array
comparand, cross-class field comparison and stored-list ordering in row-level predicates)
and the `scim-*` family (the retired `sys_scim_provider` object) are printed by
`os migrate meta` as the header, `why:` and `verify:` lines of a manual change. Their text
sent the reader to issue-tracker, pull-request and decision-batch numbers — some of which no
longer resolve, and some in another repository — for what a ruling, measurement or fix had
decided; it now says what was decided, in the sentence being read. ADR ids are kept. One
entry of another family is corrected in the same way: `rest-api-endpoint-handler-status-retired`
now names the API skill, whose factual sweep corrected the `handlerStatus` sentence, instead
of the automation skill.

Text only: no entry id, `from` / `to`, conversion or matching logic changes, and the chain
rewrites exactly what it rewrote before. No `surface` changes. The generated migration
registry, `spec-changes.json` and the protocol upgrade guide carry the same text.
