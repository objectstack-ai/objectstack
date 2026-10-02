---
'@objectstack/metadata-protocol': minor
'@objectstack/objectql': minor
'@objectstack/mcp': minor
'@objectstack/plugin-audit': minor
'@objectstack/service-analytics': minor
'@objectstack/cli': minor
---

fix(metadata-protocol)!: a metadata body's stored content hash is served and compared only in keyed form, never copied, and never evaluated (#21207)

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) the stored content hash of a metadata body stays the canonical hash at rest and no metadata body, authorable key, spelling or export moves; what changes is the form a door serves the hash in (a keyed digest: the crypto provider's, or a process-scoped ephemeral key's when none is registered), the form an inbound version token is compared in, and which query shapes the doors accept over the two hash columns, so `objectstack migrate meta` has nothing to rewrite. The operator-run rewrite this release asks for is of audit, activity and decision-audit copies, not of metadata. The other categories are closed on facts: every package here publishes (not `unpublished`); no ADR-0087 id covers a served version token or a refused query shape (not `registered` / `already-registered`); and the change is runtime behaviour, not a declaration (not `runtime-interface-only` / `type-surface-only`). -->

**BREAKING**: this narrows what the metadata doors serve and accept for the stored content hash of a metadata body — a hash over the whole stored body, withheld credential material included. Served beside the projected body it let a reader confirm a guess at that material offline; filtered on, it confirmed one online. It ships as `minor` under the launch-window convention for accept-set narrowings.

**Three things change for callers and operators.**

1. **A held version token gets one `409 METADATA_CONFLICT`.** Every door that hands out a metadata version token — the save, publish, package-publish and rollback receipts and the history read — now hands out a keyed digest of the stored hash instead of the hash itself, and the save and reset doors compare a token they are sent in that same form. The key is the crypto provider's; a host that registers none keys under a process-scoped ephemeral key instead, so a token is always issued and never empty. A token a client held from before the upgrade is refused once; take the token from the next read or receipt and retry. On a host with no provider the same happens after a restart, and on any host when a provider is first registered. An empty, withheld, raw or stale token is refused with the same `409`; it is never read as "no pin".
2. **Filter, sort and group on the two stored content-hash columns, and on the version history's change note, now answer `400 INVALID_FIELD`** — on the generic data door, the MCP stdio reader and the analytics door, before the engine runs. The change note is included because a draft promotion that stated no message of its own recorded the draft's stored hash in it; the publish door now always states a hash-free message, and a note written before this release is served with the quoted hash in keyed form. A data-door search over the two stored-metadata tables no longer scans those columns or the stored body column, and an explicit search-field list naming one answers the same `400`. Every other column of the two tables is served, filtered, sorted and grouped as before, and every other object is unchanged.
3. **Operators run `os migrate audit-metadata-bodies` once after upgrading, dry run first.** The audit ledger, the activity feed and the metadata decision-audit trail no longer copy the stored hash. The extended command drops it from the copies already written and withholds it in the decision-audit notes and their copies: a dry run by default, `--apply` to rewrite, idempotent. The version history stays the lineage.

**What else changes.** The data door serves the two hash columns of the stored-metadata tables in keyed form, under the same key as the version tokens. The MCP stdio reader serves them keyed under the crypto provider's key, and omits them on a host with no provider. A `409` conflict refusal carries keyed values or none. The ObjectQL engine gains a read accessor for the registered provider's keyed digest; it is additive. A member's read of these tables is refused as before.
