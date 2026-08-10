---
'@objectstack/service-automation': patch
---

Align the `notify` node's Studio form-descriptor strings with the schema's actual acceptance behaviour (docs-only; no acceptance or `configSchema` key/type/required change):

- `sourceObject` / `sourceId` no longer say "Requires sourceId." / "Requires sourceObject.". Both are optional and the executor drops a half-specified click-through target at execute time (so the inbox never renders a dead link) — the descriptions now state that tolerance instead of a phantom requirement, mirroring the `NotifyConfigSchema.sourceObject`/`sourceId` `.describe()` wording fixed in #7085 (PR #7111). (#7112)
