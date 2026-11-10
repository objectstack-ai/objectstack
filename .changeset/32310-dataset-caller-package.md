---
'@objectstack/metadata-protocol': patch
'@objectstack/rest': patch
'@objectstack/runtime': patch
'@objectstack/client': patch
---

feat(metadata-protocol, rest, runtime, client)!: the dataset query doors (single and batch) and `/meta/dataset` take the reader's package (`?callerPackage=`) and resolve the name by ADR-0150 D3

Clause-②: yes (narrowing) — `POST /api/v1/analytics/dataset/query?callerPackage=PACKAGE_ID` and `POST /api/v1/analytics/dataset/query/batch?callerPackage=PACKAGE_ID` accepted the parameter and ignored it (`200`, the bare read's dataset); each now resolves the name from that package and answers `409 RESOURCE_CONFLICT` when the name is ambiguous in the package's closure or held only outside it (on the batch, as that query's entry), and `400 VALIDATION_ERROR` beside `?package=`, when blank, `all`, not a string or repeated (on the batch, for the whole request). First-party senders of `?callerPackage=` before this change: 0 on either door, repo-wide with `ui/` included. The widening half: `GET /api/v1/meta/dataset/:name?callerPackage=` (both transports), which refused the name with `400` as a parameter it does not read, now resolves by the same rule, and `@objectstack/client`'s `analytics.queryDataset(payload, { callerPackage })`, `analytics.queryDatasetBatch(queries, { callerPackage })` and `meta.getItem(type, name, { callerPackage })` send it.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) no key of any schema, stored row or registered node type is added, removed or re-shaped: what moves is which saved dataset a by-name read answers when the request names the reader's package, and nothing at rest records that answer, so there is nothing for `objectstack migrate meta` to rewrite -->

Skills-docs: none — `skills/**` teaches neither the dataset query door nor `?callerPackage=`; its one `?package=` passage is about reading an installed package's overrides, which this change does not touch. `content/docs/data-modeling/analytics.mdx` gains the paragraph that teaches the new parameter beside `?package=`.

**The caller arm.** `?package=ID` names the package that HOLDS the dataset: it is an exact qualifier, and it refuses a name that package does not hold. `?callerPackage=ID` names the package that READS it, and the server resolves the name for that reader the way a package's own metadata resolves a bare dataset name (ADR-0150 D3): the reader's own dataset first, then the one holder among the packages the reader declares in `dependencies` (transitively) plus `sys`, then a refusal. Two holders in the closure answer `409 RESOURCE_CONFLICT` naming both (`ambiguous-in-closure`); a holder outside the closure, or a dataset only the environment authored, answers `409 RESOURCE_CONFLICT` naming it (`outside-closure`). The resolved holder is then read exactly as `?package=HOLDER` reads it, so admission, the dataset parse and every answer after resolution are the qualified read's. A reader that is not an installed package gets the answer `?package=` gives for that id (`409` naming the holders, `404` when nothing holds the name) and never falls back to the bare read; `all`, which `?package=` reads as naming no package, is refused. The parameter is read only from the query string, never from a header or the session.

The arm is refused, `400 VALIDATION_ERROR` naming both parameters, when it is sent with `?package=`, on the qualified path `/meta/dataset/NAMESPACE/:name`, on any `/meta` type other than `dataset` (also beside `?layers=` and `?member=`), with a blank, `all` or non-string value, or more than once. A well-formed arm beside an inline `dataset` body on the query doors is not read, as `?package=` is not; a malformed one is refused, inline body or not.

On the batch door the arm is read once, from the batch URL, for every query: a malformed arm refuses the whole batch before any query runs, and each query's name resolves from the package on its own, so a name that cannot be resolved is that query's `409` or `404` entry and never fails the others.

**BREAKING** accept-set narrowing at `POST /api/v1/analytics/dataset/query` and `POST /api/v1/analytics/dataset/query/batch` (`@objectstack/rest`):

- **Before.** `?callerPackage=` was not read on either door: each answered `200` with the dataset the bare `datasetName` resolves to, whatever the value (on the batch, for every query).
- **Now.**
  1. The name resolves from that package. A name ambiguous in, or held only outside, the package's closure is `409 RESOURCE_CONFLICT` (on the batch, that query's entry). A name the package itself holds, or the one holder in its closure holds, is answered as `?package=HOLDER` answers it.
  2. `?callerPackage=` beside `?package=`, blank, `all`, repeated, or not a string (`?callerPackage[x]=`) is `400 VALIDATION_ERROR`, and nothing runs (on the batch, the whole request).
  3. A package id that is not installed gets the `?package=` answer for that id: `409` naming the holders, `404` when nothing holds the name.
  4. A deployment whose composed metadata protocol has a by-name read (`getMetaItem`) but no caller resolution (`resolveCallerPackageAddress`), or whose engine registry lacks the package-scoped reads the exact qualifier judges with, answers a `datasetName` sent with the arm `503 SERVICE_UNAVAILABLE` (on the batch, that query's entry), and runs nothing, where it answered `200` with the bare read. `@objectstack/metadata-protocol`'s protocol on an ObjectQL engine has both.
- **Who moves.** Nothing first-party sent the parameter to either door. A script that sent it and relied on the bare read gets the reader's resolution.

**The remedy.** Drop `?callerPackage=` for the bare read, send `?package=HOLDER` to read one holder's dataset, or add the holder to the reading package's `dependencies`.
