---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol)!: the Data API refuses a malformed or negative page window with a 400 naming the parameter as written, instead of a 500 or a silently ignored window

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition or stored shape is added, removed, renamed or re-shaped, and no exported declaration is removed or narrowed, so there is nothing for `objectstack migrate meta` to rewrite. What changes is the answer the list-query normalizer gives a request whose page window is not a non-negative integer. The remedy is in the request (send a count, or leave the parameter out), never a rewrite of a package source or a stored row. -->

**BREAKING** accept-set narrowing on the list doors (`GET /api/v1/data/:object`, `POST /api/v1/data/:object/query`, and the runtime dispatcher's data list). It changes what a Data API caller can send, not what a metadata author can write, so it ships as `patch` with this banner.

- **Before.** The list-query normalizer coerced the window with a bare `Number(...)`. A negative offset (`?$skip=-1`, `{"offset": -5}`) reached the SQL driver, which threw, and the caller got `500 INTERNAL_ERROR`. A limit that was not a number or was negative (`?$top=abc`, `?$top=-1`, `{"limit": -1}`), and an offset that was not a number (`?$skip=abc`), were dropped, so the caller got every row under a `200`. A blank `?$top=` became `0` and answered an empty page. A fractional window (`{"offset": 1.5}`, `{"limit": 1.5}`) was rounded by the driver.
- **Now.** `limit` / `offset` and their spellings `$top`, `top`, `$skip`, `skip` must be non-negative integers. Anything else is refused before any read with `400 INVALID_REQUEST`, and the message names the parameter the caller wrote: `Query parameter '$skip' must be a non-negative integer; got "-1".` A blank value is refused too (`?$top=`, `?$skip=`), not read as absent: an absent window means every row, so reading a blank one that way would be the silent widening this closes.
- **Unchanged.** A well-formed window pages exactly as before (`?$top=5&$skip=2`, `{"limit": 5, "offset": 2}`), and `0` stays valid on both (`$top=0` asks for the total alone). A non-number in a `POST` body (`{"limit": "ten"}`) is still the body schema's `400 VALIDATION_FAILED`.

**The remedy.** Send the window as a whole count of zero or more, or leave the parameter out.
