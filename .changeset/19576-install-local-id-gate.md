---
'@objectstack/cloud-connection': minor
---

fix(cloud-connection): `POST /api/v1/marketplace/install-local` parses the package id it installs through the manifest declaration (#19576)

Clause-②: no

**BREAKING for callers of the install-local door** — a manifest whose `id` is
not reverse-domain notation is now refused `PLUGIN_MANIFEST_INVALID` (`400` for
an inline manifest, `502` for a cloud-fetched snapshot) before anything is
registered or written. It used to install and answer `200`.

The accept set only shrinks back to what the published declaration has always
said. `MANIFEST_ID_PATTERN` (`@objectstack/spec/kernel`) is the one declaration
of a package id, and the other two package-install doors — `POST
/api/v1/packages` and the protocol install primitive — already refuse the ids it
refuses. This door is a separate path: it never calls the protocol primitive,
so neither gate covered it. It derived the id as `manifest.id ?? manifest.name`
and parsed nothing, so `late-app`, `com.example.my_erp`, a number, or a manifest
carrying only a `name` installed cleanly and became the key for the on-disk
ledger entry and for every `:manifestId` route.

The door now asks the declaration **by reference** — `ManifestSchema.shape.id`
— at the one point where the inline branch (after a compiled bundle is
flattened) and the cloud branch have converged, ahead of the `409
MANIFEST_CONFLICT` collision check, the posture gate, the hot-register and the
ledger write. The sentence the caller reads is the declaration's own
(`manifestIdRefusal`), surfaced rather than reworded. Posting `id: 'late-app'`
now answers, in `error.message`:

```text
Invalid package id 'late-app' on `manifest.id`. Expected reverse-domain notation
('com.steedos.crm', 'org.apache.superset') — lowercase dot-separated segments;
hyphens allowed inside a segment, underscores are not. Did you mean
'com.example.late-app'?
```

**`manifest.name` is no longer read as an id.** `ManifestSchema` declares `id`;
`name` is a display label with no pattern. A manifest with no `id` is refused
with the same sentence, naming `manifest.id`. The inline branch's earlier
message for that case — which said the manifest needed an `"id"` or a `"name"`
— is gone with the fallback it described.

**What is not affected.** A conforming id installs exactly as before, on both
branches and for both the flat and the compiled-bundle shape. Ledger entries
already on disk are not re-judged: an entry an older build installed under an
id the declaration refuses still rehydrates at boot and can still be removed
with `DELETE /api/v1/marketplace/install-local/:manifestId`; only a fresh
install under that id is refused. Boot-time and in-process registration
(`manifest.register`, `AppPlugin`) never passes through this door.

**If you are refused.** Give the manifest an `id` in reverse-domain notation —
lowercase dot-separated segments, hyphens allowed inside a segment, underscores
not. The refusal names the key, echoes what was sent and, where a mechanical
repair exists, offers one it has already checked against the rule. Artifacts
built by `os build` from `defineStack()` already carry a conforming id, because
the same declaration refuses anything else at build time.

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable is removed, renamed or reshaped: no spec key, no export, no stored row. `objectstack migrate meta` has nothing to reach, because there is no old spelling that maps to a new one — a caller supplies an id the declaration already required, and an id's repair changes the package's identity, so no mechanical mapping could be prescribed even in principle. Existing ledger entries are left exactly as they are. The refusal itself carries the remedy. -->
