---
'@objectstack/spec': minor
---

`ERROR_CODE_LEDGER['@objectstack/service-automation']` now lists `MAPPING_NOT_FOUND` and `UNSUPPORTED_TRANSFORM`, the two registered codes the connector sync executor (`pullConnectorSource`) stamps onto `ConnectorPullError.code` (#21106).

Clause-②: yes

Provenance, not identity. The per-package face of `ERROR_CODE_LEDGER` changes in this release in two steps, and neither changes the `ErrorCode` union, the wire or any HTTP answer:

- The bulk-import runner, the mapping pipeline and the data-error classification moved out of `@objectstack/rest` (#20919), and each code's row moved to the package that now stamps it. `@objectstack/core` gains `AMBIGUOUS_MATCH`, `BLANK_MATCH_KEY`, `NO_MATCH`, `SUMMARY_RECOMPUTE_FAILED` and `UNSUPPORTED_TRANSFORM`. A new `@objectstack/types` key lists `CONCURRENT_UPDATE`, `ERR_DATASOURCE_UNAVAILABLE` and `UNIQUE_VIOLATION`. `@objectstack/rest` no longer lists those seven, because it stamps none of them now; it keeps `UNSUPPORTED_TRANSFORM`, which it still stamps.
- `@objectstack/service-automation` gains the two rows above. Both codes were already registered, under `@objectstack/rest` (and `UNSUPPORTED_TRANSFORM` under `@objectstack/core` as well).

So a consumer reading `ERROR_CODE_LEDGER['@objectstack/rest']` sees seven fewer entries, and one reading the `@objectstack/core`, `@objectstack/types` or `@objectstack/service-automation` key sees the new ones. Nothing to migrate: every code keeps its wire value and its status.
