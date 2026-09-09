---
"@objectstack/cli": patch
---

`os package publish` now decides what a manifest id is by parsing it through `PackageSchema.manifestId` — the schema for the very column it publishes into — instead of testing it against a hand-copied look-alike.

The command carried its own rule (`MANIFEST_ID_RE`, a case-insensitive "starts alphanumeric, then any of a-z 0-9 dot underscore hyphen, up to 255 chars"), which is looser than the declared contract on every axis. The local preflight therefore **admitted what the control plane refuses**: a single segment (`crm`), an underscore (`com.acme.repair_desk`), upper case (`COM.ACME.CRM`), a digit-first segment (`9foo.bar`), an empty segment (`com..acme`) and a trailing dot (`com.acme.`). The preflight passed, the request went out, and the server answered `400`. Its error text, when it did fire, named a contract (`a-z0-9._-`) that does not exist — so a user who followed the message walked into a second refusal.

- **One rule, both paths.** `MANIFEST_ID_RE` is deleted. The explicit `--manifest-id` / `objectstack.manifest.json` path and the derive path (`deriveManifestId`, which adopts `artifact.manifest.id`) now ask the same imported schema. They previously disagreed with each other as well as with the declaration: the derive path additionally required a dot, so a bare `crm` was blocked there and accepted on the explicit path. That extra condition is gone because the schema subsumes it — its pattern requires at least two segments.
- **The refusal text is quoted from the schema**, from its own `invalid_format` issue plus its `.describe()`, so it can no longer drift from the rule it describes.
- **A derived id the schema rejects is refused, not rewritten.** `slugify` has no letter-first rule, so an app named `2024 App` derives `local.2024-app` — digit-first, and rejected. That is now refused before any network call, with a message naming where the id came from and how to set one (`--manifest-id`, `manifestId` in `objectstack.manifest.json`, or `manifest.id`). It is deliberately not normalised into some other id: `manifestId` is immutable once published, and minting a different permanent global identifier than the inputs imply is worse than saying what is wrong.

Publishing is unaffected for every id the control plane accepts — a legal reverse-domain id passes both paths with unchanged bytes. What changes is that the ids the server was going to reject are now refused locally, with the real rule in the message.
