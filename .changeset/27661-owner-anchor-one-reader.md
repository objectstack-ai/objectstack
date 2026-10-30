---
'@objectstack/spec': patch
'@objectstack/plugin-sharing': patch
'@objectstack/lint': patch
---

fix(spec): one reader decides whether an external object's owner is provable, and record sharing and lint both read it

Clause-②: yes
Metadata-protocol: none

An external object (ADR-0015) gets the platform's `owner_id` injected but no storage for it. Record sharing narrows such an object's member reads and bulk writes to no row by ownership unless the author declares where the owner comes from: a declared `owner_id` field, or an `external.columnMap` entry that maps a remote column onto `owner_id`. That question was answered in three places. The spec's provenance helper did not know the `columnMap` arm, while plugin-sharing and lint each read `columnMap` with their own copy.

- **`isOwnerAnchorUnprovable(def)`** (`@objectstack/spec/data`) is now the one answer: `true` when `resolveInjectedColumnProvenance(def, 'owner_id')` is `injected-unprovisioned` and no `external.columnMap` value is `owner_id`. Plugin-sharing's `hasPhantomOwnerAnchor` and lint's `hasUnprovableOwnerAnchor` return it.
- **`externalColumnMapTargets(def, field)`** reads whether `external.columnMap` maps a remote column onto `field`. Lint's `security-external-owner-unmapped` uses it for its "mapped but not declared" wording.
- **Public surface.** `@objectstack/spec/data` gains the two exports above; no existing export changes its answer.
- **`resolveInjectedColumnProvenance` is unchanged.** A `columnMap` entry does not change who wrote the `owner_id` field, and the lint write rule depends on that: on a plugin driver the map is not applied, so only a declared field lets a member write.

Read scopes, write scopes, share-grant refusals and lint findings are unchanged for registered objects. On hand-built documents, two readings move: an object with no `owner_id` key that would be injected one now reads as unprovable, which every sharing caller already guards by checking for the field first; and an object whose tier withholds `owner_id` but which declares a field identical to the platform's now reads as the author's, the spec's existing rule. Both still match no remote row the author did not vouch for.
