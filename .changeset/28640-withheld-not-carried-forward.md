---
'@objectstack/spec': patch
'@objectstack/metadata-protocol': patch
---

feat(spec): a save of a connector's served form drops the leftover inline value under an undeclared `auth` key, and the save answer names each key it dropped

Clause-②: yes (widening)
Metadata-protocol: none

A connector row stored before the instance-auth shapes went strict can still hold a value under an `auth` key its kind does not declare, typically an inline secret such as `auth.token`. The read already withheld it. A save of the served form, however, re-grafted it from the stored row, so the cleartext stayed at rest through every edit, although no door accepts the key and nothing at runtime reads it. Now:

- **The redactor can mark a withheld position as not carried forward.** `MetadataRedactionResult` (`@objectstack/spec/kernel`) gains an optional `notCarriedForwardKeys`: the positions among `redactedKeys` that a save drops instead of re-grafting. It is a subset, so `redactedKeys` still names every withheld position and a reader that knows only `redactedKeys` withholds exactly what it did before. Absent means none: the `datasource` built-in, the schema-derived redactors and every registered redactor keep carrying every withheld position forward, with nothing to change.
- **The connector redactor marks its undeclared `auth` keys.** Each one is named in both lists. A cleared value there (`null`, `''`, an empty map) is now withheld too, because the strict shape refuses the key whatever it holds, so serving it made a plain read then save fail with `unrecognized_keys`. Every other withheld connector position (the four header and environment maps, `authentication`, a credential URL, an undeclared top-level, `retryConfig` or `actions` key, a non-object `auth`) is carried forward exactly as before.
- **The save drops it and says so.** The `/meta` save (`saveMetaItem`, draft saves included) never re-grafts a not-carried-forward position, so the stored row loses it, and the answer's `advisories` carries one `warning` per dropped position: rule `withheld-key-dropped`, `where` naming the item, and `path` where the value sat at rest (`connectors[0].auth.token`). The notice never carries the value. The key is still omitted when there is nothing to report, so a save that drops nothing answers the same bytes as before. A value the incoming body itself holds at that position is the author's word and is not a drop.

If a connector still needs a credential that sat under such a key, store the secret outside the metadata and name it with `auth.credentialRef`.
