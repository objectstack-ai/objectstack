---
"@objectstack/spec": minor
---

Ten wall-clock instants now declare their unit through the shared `EpochMs` schema (`@objectstack/spec/shared`) instead of a bare `z.number()`. No key is renamed and no key is added or removed.

`EpochMs` is `z.number().int()` with the describe "Unix timestamp in milliseconds (epoch)". Adopting it moves each key's published JSON Schema from `{"type":"number"}` to `{"type":"integer"}` and puts the millisecond unit on the contract itself, where a reader of the reference page, the JSON Schema or the TypeScript surface all see the same answer. Before this, the unit lived in a JSDoc block (invisible in every published artifact), in prose that named only the epoch and not the unit, or nowhere at all — the ×1000 ambiguity a `timestamp: number` key carries by default.

The keys, by schema:

- `Data.DocumentVersion.createdAt`, `Data.Document.access.expiresAt`
- `System.SupplierSecurityAssessment.assessedAt`, `.validUntil`, `.remediationItems[].deadline`
- `Identity.Account.expiresAt`
- `Kernel.PluginLoadingEvent.timestamp`, `Kernel.PluginLoadingState.startedAt`, `.completedAt`
- the shared connector OAuth2 auth shape's `tokenExpiry`

**What an author must change: nothing, unless they were writing a fractional millisecond.** Seven of the ten previously accepted any `number` and now accept integers only; `Date.now()` — the value every one of these keys is documented to carry — is already an integer. The three `Kernel.PluginLoading*` keys already declared `.int().min(0)`; they keep that floor (`EpochMs.min(0)`), so their accepted set is byte-for-byte what it was and only their description is new.

`timestamp`, `tokenExpiry`, `deadline` and `validUntil` deliberately keep their names. `EpochMs`'s own docblock recommends spelling an instant `*At`, but a rename of a published key is a retirement with its own ADR-0087 entry and is not part of this change.
