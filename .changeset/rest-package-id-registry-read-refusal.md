---
'@objectstack/rest': patch
---

Stop answering a terminal `404 RESOURCE_NOT_FOUND` for a REGISTRY read that
could not happen on `GET /api/v1/packages/:id`

The detail door tries the durable `sys_packages` read first and falls back to
the in-memory registry via `protocol.getMetaItems({ type: 'package' })`. That
fallback sat in a bare `catch {} // Protocol unavailable`, so when the read
threw, control fell straight through to the line below and the door answered
**`404 RESOURCE_NOT_FOUND` — `Package "<id>" was not found.`**

This is the worse half of the family, not a smaller one. The list door's
version of the same swallow (#11130) answered a `200` whose `total`
under-counted; this one answers a terminal negative fact. `404` /
`RESOURCE_NOT_FOUND` is not "the answer may be incomplete", it is *"this package
does not exist"*, and callers act on it: an installer decides the package is not
installed and offers to install it, a console hides the entry, a script branches
to the create path. The producer's own words for the same condition are the
opposite — *"whether this item exists is unknown"*.

It was also #5532's defect resurfacing one layer up.
`ObjectStackProtocolImplementation.getMetaItems` was taught **not** to report an
unreadable `sys_metadata` as "that item does not exist"; this consumer-side
catch then re-applied precisely that relabelling to the protocol's answer. So
the producer already declares the refusal — every non-benign overlay read
failure leaves as `SERVICE_UNAVAILABLE` / 503 with an ADR-0112 status+code on
the error — and the repair is the same one #11063 made for this door's durable
half and #11130 made for the list door's registry half: delete the catch and let
`sendThrownError` carry the producer's own status and code.

Standing family ruling — #10965 · #10677 · #10789 · #11063 · #11130: **a read
that could not happen must not be reported as a read that found nothing.**

Unchanged, and pinned in both directions because the defect was that a failed
read and an absent resource were indistinguishable: a genuine miss (both sources
read fine, neither holds the id) still answers `404 RESOURCE_NOT_FOUND`; a
composition with no protocol service is an absence rather than a failed read and
still reaches that same 404; a registry hit still answers `200` with
`source: 'registry'`; and a durable hit still answers `200` without consulting
the registry at all. No wire field is added — the response shape is a contract
decision this change does not carry.
