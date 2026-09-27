---
'@objectstack/spec': minor
---

feat(spec): a package-id segment may open with a digit, and the refusal states the rule the pattern enforces (#19870)

Clause-②: yes (widening) — the accept set of `ManifestSchema.id` and `PackageSchema.manifestId` (one shared constant, `MANIFEST_ID_PATTERN`) grows by the ids that carry a digit-led segment. Nothing previously admitted is refused, no key is added, removed or renamed, and no export moves.

**The rule, as the pattern now enforces it:** two or more lowercase dot-separated segments of letters, digits and inner hyphens. A segment may open with a letter or a digit — never with a hyphen — and underscores are not admitted. `com.163.crm`, `com.example.2app` and `local.2024-app` are package ids now; `com.example.-app`, `com.example.my_app` and `Com.Example.App` stay refused.

**Why the leading-letter clause went.** The package id is a registry key (`manifest_id`), a runtime package-map key and a grant-source key — never a table name, a JS identifier, a filesystem path or a hostname — and a DNS label may itself open with a digit. The clause had no downstream reason, so the refusal sentence could not state one: an author who followed the sentence could write `com.example.2app`, satisfy every clause it listed, and still be refused.

**The refusal sentence** is now `… Expected reverse-domain notation ('com.steedos.crm', 'org.apache.superset') — lowercase dot-separated segments of letters, digits and inner hyphens; a segment may not open with a hyphen; underscores are not admitted.` It was `… — lowercase dot-separated segments; hyphens allowed inside a segment, underscores are not.` The doors that surface it verbatim (`POST /api/v1/packages`, the protocol install and duplicate primitives, `POST /api/v1/marketplace/install-local`, `os package publish`) follow it with no change of their own. A digit-led bare word now gets the prefixed repair (`2fa` → `Did you mean 'com.example.2fa'?`), where it used to get none.

**What moves with it.** `os package publish` derives `local.<slug>` from `manifest.name` or the artifact filename when no id is declared; a slug is lowercase letters, digits and inner hyphens, so a derived id now always parses — a manifest named `2024 App` publishes as `local.2024-app` instead of being refused. A declared `manifest.id` is still used or refused, never replaced by a derived one.

**What does not move.** `manifest.namespace` — the physical object-name prefix (`crm` → `crm_account`) — keeps its own leading-letter rule, for the SQL-identifier reason. A namespace derived from a package id still strips a leading digit run from its last segment (`com.163.crm` → `crm`; `com.example.123` derives none, and the author declares `namespace`).

**If you relied on the refusal:** nothing you stored changes. A consumer that assumed a package id opens each segment with a letter should stop assuming it; parse it through `PackageSchema.shape.manifestId` or `ManifestSchema.shape.id` rather than a copy of the pattern.
