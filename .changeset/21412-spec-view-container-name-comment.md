---
'@objectstack/spec': patch
---

The comment above `ViewSchema`'s `guidance:` states who writes a view container's `name`, and the rule every door applies to it

Clause-②: no

`src/ui/view.zod.ts` ships as source, and the comment also ships in the `ui` JavaScript output. It used to say that `saveMetaItem` sends a container's `name`, that artifact-shipped containers do, and that the validation sweep injects it. It now says the metadata door's own stamp (`normalizeViewMetadata`) is the only platform writer of the key. Artifact-shipped containers carry none, and the sweep passes its name as the request name. It also states the rule: when an authored `name` is set, it must equal the key the door files the container under, or the door refuses it. ⛔ No schema, parse, export or accept-set change.
