---
'@objectstack/rest': patch
---

fix(rest): `GET /meta/diagnostics` refuses an unknown query parameter name instead of ignoring it and answering the full sweep (#27633)

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) The narrowed face is a REQUEST to one read door: a query parameter name the route never read (`?typ=view`, `?packageId=`) is now refused instead of silently ignored. No stored metadata, package source or object definition holds a diagnostics request, no schema key or export changes, and the remedy is the caller's own query string, so there is nothing for `objectstack migrate meta` to rewrite. -->

`/meta/diagnostics` is the door an author, an agent or CI reads to learn whether metadata is healthy. #27514 made it refuse an unknown VALUE of `type`, `severity` or `package`; an unknown parameter NAME was still dropped, so `?typ=view` answered `200` with every type swept and the caller believed the answer was narrowed to `view`.

- The route now declares its closed query-parameter set, `type`, `severity` and `package` (the three it reads and the three both SDKs send), through the shared closed-set decision the converted routes use.
- Any other name answers `400 INVALID_REQUEST` in the route's nested `{ error: { code, message } }` envelope. The message names the unknown parameter and lists the supported ones.
- Recognition runs before the repeated-parameter refusal, so a request with both faults is told about the unknown name first.

**BREAKING** for a caller that sends `GET /meta/diagnostics` a parameter outside `type`, `severity` and `package`: it was ignored and now answers `400 INVALID_REQUEST`. The remedy is to drop the parameter, or to use the supported spelling (`package`, not `packageId`).
