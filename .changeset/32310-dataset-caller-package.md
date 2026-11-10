---
'@objectstack/metadata-protocol': minor
'@objectstack/rest': minor
'@objectstack/runtime': minor
'@objectstack/client': minor
---

feat(metadata-protocol, rest, runtime, client)!: the dataset query door and `/meta/dataset` take the reader's package (`?callerPackage=`) and resolve the name by ADR-0150 D3

Clause-②: yes (narrowing) — `POST /api/v1/analytics/dataset/query?callerPackage=PACKAGE_ID` was accepted and ignored (`200`, the bare read's dataset); it now resolves the name from that package and answers `409 RESOURCE_CONFLICT` when the name is ambiguous in the package's closure or held only outside it, and `400 VALIDATION_ERROR` beside `?package=`, when blank or when repeated. First-party senders of `?callerPackage=` before this change: 0, repo-wide with `ui/` included. The widening half: `GET /api/v1/meta/dataset/:name?callerPackage=` (both transports), which refused the name with `400` as a parameter it does not read, now resolves by the same rule, and `@objectstack/client`'s `analytics.queryDataset(payload, { callerPackage })` and `meta.getItem(type, name, { callerPackage })` send it.
Metadata-protocol: added

<!-- adr-0087: not-required (no-migration-prescription) no key of any schema, stored row or registered node type is added, removed or re-shaped: what moves is which saved dataset a by-name read answers when the request names the reader's package, and nothing at rest records that answer, so there is nothing for `objectstack migrate meta` to rewrite -->

Skills-docs: none — `skills/**` teaches neither the dataset query door nor `?callerPackage=`; its one `?package=` passage is about reading an installed package's overrides, which this change does not touch. `content/docs/data-modeling/analytics.mdx` gains the paragraph that teaches the new parameter beside `?package=`.

**The caller arm.** `?package=ID` names the package that HOLDS the dataset: it is an exact qualifier, and it refuses a name that package does not hold. `?callerPackage=ID` names the package that READS it, and the server resolves the name for that reader the way a package's own metadata resolves a bare dataset name (ADR-0150 D3): the reader's own dataset first, then the one holder among the packages the reader declares in `dependencies` (transitively) plus `sys`, then a refusal. Two holders in the closure answer `409 RESOURCE_CONFLICT` naming both (`ambiguous-in-closure`); a holder outside the closure, or a dataset only the environment authored, answers `409 RESOURCE_CONFLICT` naming it (`outside-closure`). The resolved holder is then read exactly as `?package=HOLDER` reads it, so admission, the dataset parse and every answer after resolution are the qualified read's. A reader that is not an installed package gets the answer `?package=` gives for that id (`409` naming the holders, `404` when nothing holds the name) and never falls back to the bare read. The parameter is read only from the query string, never from a header or the session.

The arm is refused, `400 VALIDATION_ERROR` naming both parameters, when it is sent with `?package=`, on the qualified path `/meta/dataset/NAMESPACE/:name`, on any `/meta` type other than `dataset`, with a blank value, or more than once. An inline `dataset` body on the query door ignores it, as it ignores `?package=`.

**BREAKING** accept-set narrowing at `POST /api/v1/analytics/dataset/query` (`@objectstack/rest`):

- **Before.** `?callerPackage=` was not read: the door answered `200` with the dataset the bare `datasetName` resolves to, whatever the value.
- **Now.** The door resolves the name from that package, and answers `409 RESOURCE_CONFLICT` for a name ambiguous in, or held only outside, the package's closure; `400 VALIDATION_ERROR` with `?package=`, a blank value or a repeat; and the `?package=` answer for a package that is not installed. A name the package itself holds, or the one holder in its closure holds, is answered as `?package=HOLDER` answers it.
- **Who moves.** Nothing first-party sent the parameter. A script that sent it and relied on the bare read gets the reader's resolution.

**The remedy.** Drop `?callerPackage=` for the bare read, send `?package=HOLDER` to read one holder's dataset, or add the holder to the reading package's `dependencies`.
