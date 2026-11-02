---
'@objectstack/spec': patch
'@objectstack/metadata-protocol': patch
'@objectstack/metadata': patch
---

fix(spec): a connector read serves only the keys `retryConfig` and each `actions` element declare, and a save of the served form keeps the rest

Clause-②: no
Metadata-protocol: none

The built-in `connector` read-path redactor now serves, inside `retryConfig` and inside each element of `actions`, only the keys those shapes declare. Every metadata read exit that serves a stored connector applies it. Each withheld position is named in `redactedKeys` (an `actions` element by its index), and the stored row is never changed.

A save of the served form keeps every withheld nested value: the save door carries each one forward from the stored row. An `actions` element is followed by its `key`, so a reordered list keeps each element's value on that element; for every carried-forward position, an array element with no `id` is now identified by its `key`. A `retryConfig` or an `actions` element the author removes is removed.

`MetadataManager.getPublished` now hands the type's redactor the authored document alone and serves the metadata layer's own bookkeeping beside the answer unchanged (`packageId`, `state`, and the publish keys).

What a save accepts is unchanged.
