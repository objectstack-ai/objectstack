# ADR-0156: A compiled metadata answer is cached only when every source it reads counts its own changes, and a bound covers what this process cannot see

**Status**: Accepted (2026-11-16) — maintainer ruling on [#34206](https://github.com/objectstack-ai/objectstack/issues/34206), comment 6920925378, verbatim 「B 只缓存所有人共用的部分」: build an environment metadata change signal and a cache of the compiled results that do not depend on the caller; the per-caller gate, field mask, translation and ETag stay computed on every request. The ruling ordered this record first, as its own pull request, landing on the maintainer's approval (Tier H, Prime Directive #14). **This record declares; it implements nothing.** The cache it governs is the third change on the card and is built after this record lands.
- **Date**: 2026-11-16
- **Card**: [#34206](https://github.com/objectstack-ai/objectstack/issues/34206) (the app bundle recompiles on every request, a 304 included). Blocks cloud#4563 acceptance 1, which is judged on its staging reading.
- **Builds on**: [ADR-0127](./0127-authorization-cache-invalidation-contract-and-ttl-bound.md) (no cached answer without an observed write seam AND a time bound; D2 the seam is never a call-site list; D6 a metadata leg may ship enabled and `0` is a real path; D9 pins assert `cached ≡ uncached` plus zero reads). This record is ADR-0127's rule applied to the metadata leg it anticipated, for answers that read more than one source.
- **Rewrites**: the conditional position in `packages/metadata-protocol/src/meta-overlay-cache.ts`, section "Why only the row set is cached, and never the merged answer". That text stays true of that module; what it no longer is, is a ban on caching a merged answer anywhere.
- **Supersedes**: nothing.

---

## Context

### What a bundle request costs, and why a 304 costs the same

`GET /api/v1/meta/app/{id}/bundle` compiles the app's navigation, objects, views, pages and dashboards from scratch on every request. Its `ETag` is a hash of the freshly compiled body, so a revalidation that answers 304 has already paid for the compile; it saves the bytes, not the work. The card measured a Setup bundle at 276–313 ms of `meta` per call on HotCRM 6.4.0 (45% of a Setup page's server CPU) and `meta=911` on the first call after the metadata row cache lapses; the earlier report (6919782135) measured 198–238 ms on showcase, about 55% of it item reads.

The Console asks for a bundle once per app entry or page reload, so a customer's two requests for the same bundle are usually tens of seconds to hours apart. The row cache's bound is 30 s and does not slide (`expiresAt: now + ttlMs`), so the path a customer usually meets is the expired one, not the warm repeat.

### Why no compiled answer is cached today

`meta-overlay-cache.ts` caches the raw `sys_metadata` row set and nothing downstream of it. Its stated reason is conditional, and it was a measurement: the merged answer reads four mutable sources and the write epoch observes one of them.

| source | change counter today |
|:--|:--|
| `sys_metadata` rows | yes: the overlay cache generation, bumped at the engine middleware seam after every write to the table |
| SchemaRegistry objects | yes: `objectRevision`, bumped at every site that drops the merged-object cache |
| SchemaRegistry items (apps, views, pages, dashboards), nav contributions, package enablement | no |
| MetadataService loader items | no |
| artifact protection (`lookupArtifactItem`) | no |

The app bundle reads further sources with no counter either: translation bundles, the flow-registration and action-activation readers, and the kernel service table. A cache keyed on what exists today would serve answers whose inputs it cannot see change. That is the whole of the old position, and it is still correct for any cache that cannot see its sources.

### What the old position did not say

It never said a merged answer is uncacheable in principle. The accepted design of #11633 (leg D) listed "cache the merged post-hydration result" as one of its two ways out of the hydration trap, and the module took a third. What was missing is a counter at each source, and that is buildable.

## Decision

### D1 — The rule

**A compiled metadata answer, a value derived from more than one metadata source, may be cached only when (a) every source it reads exposes a change counter that moves on every change to it, and (b) a time bound covers the changes this process cannot observe. Both, always.**

(a) is ADR-0127's observed seam, one per source. (b) is its TTL: another node's write, a write that bypasses the engine, a deployment that edits a file under a running process. Neither alone is a design, for ADR-0127's reasons.

### D2 — Each source owns its counter at its own mutation point

A counter is incremented by the code that performs the mutation, in the same function, as `objectRevision` is in the registry today. ⛔ It is never a list of call sites that remember to invalidate a cache (ADR-0127 D2). A new mutation path that forgets to bump is a defect in that source, findable by reading that source alone; a cache-side invalidation list makes the same omission invisible.

A source that exposes no counter makes the cache **decline**: the answer is computed uncached, exactly as the overlay row cache declines when the engine exposes no middleware seam. ⛔ The cache never substitutes a guess (a timer alone, a counter of a different source) for a source's own counter.

The counters are in-process. ⛔ None of them goes on the wire, and none of them is a cross-node metadata version: `content/docs/kernel/cluster.mdx` §6.1 retired that once, and it returns only through its own enforce route.

### D3 — Only the caller-independent part is cached

What is cached is a result that every caller of the environment would receive before any per-caller step: item reads, candidate lists and the parts of the compile that read only metadata. **The per-caller gate, the field mask, translation into the caller's locale and the `ETag` are computed on every request**, over the cached part.

⛔ No whole answer is cached per caller, whether keyed on a user, a permission fingerprint or a resolved execution context. That option was put to the maintainer and not ruled; it needs a new ruling, with staging readings, before anyone builds it. A cached part that turns out to read the caller (an `ExecutionContext` member, a security-service answer) is outside this record and is not cached.

### D4 — The registry hydration of `getMetaItems` stays outside the cached path

`getMetaItems` registers overlay rows back into the SchemaRegistry (`hydrateOverlayIntoRegistry`). A cache hit must leave the registry populated exactly as a miss does. The cache sits downstream of that registration or replays nothing that performs it; either way a hit registers what a miss registers, and a pin proves it (D7).

### D5 — On expiry, confirm cheaply; do not recompile

When an entry's time bound passes, the cache first confirms that nothing it depends on moved: every in-process counter at its stamped value, and one read that observes the out-of-process writers the bound exists for (the stored rows). If nothing moved, the entry is kept for another bound. Only a moved counter or a moved store reading recompiles.

The confirmation must observe every out-of-process change D1 (b) names for the sources the entry read. ⛔ An entry that read a source the confirmation cannot observe (a loader reading files a deployment can edit under a running process, with no watcher telling this process) is recompiled at its bound and never renewed; or that source makes the cache decline. A renewal is a claim that nothing moved, and it may be made only about what was looked at.

The confirmation must be strictly cheaper than the compile it avoids; if it is not, the cache has no reason to exist. This clause is what makes the cache serve the customer's usual path (a reload after the bound) and not only a warm repeat.

### D6 — The knob is deployment config, and `0` is a real path

One `OS_*` environment knob per cache (`OS_METADATA_COMPILE_CACHE_TTL_MS` unless the implementing change finds a reason to name it otherwise, registered in `content/docs/deployment/environment-variables.mdx`). At `0` the cache is off and the request issues the same reads, in the same order, as before the cache existed (ADR-0127 D6). The metadata leg may ship enabled (ADR-0127 D6); its default is chosen and stated by the implementing change.

### D7 — Pins

Per ADR-0127 D9, the implementing change carries, at least:

- for every source, one pin that a change to that source retires the entry, and one control showing that a change elsewhere does not;
- `cached ≡ uncached` over the existing fixtures, and zero source reads on the second call;
- the registry populated after a hit (D4);
- a source with its counter hidden makes the cache decline (D2);
- at `0`, the uncached read sequence (D6);
- on expiry with nothing moved, no recompile; with the store moved, a recompile (D5);
- an entry that read a source the confirmation cannot observe is recompiled at its bound, not renewed (D5).

A revocation-shaped pin asserts the end of the chain: the changed metadata is in the next answer, not merely that an entry was cleared.

### D8 — What happens to the overlay cache's own text

`meta-overlay-cache.ts` keeps caching only the row set, and its warning against moving its own cache below the merge stands: that cache has one counter and must not serve sources it cannot see. Its section heading is rewritten to say that the row-set-only shape is this module's, and a paragraph added after the section's unchanged closing sentence says that a cache of a merged answer elsewhere is governed by this record and never moves this cache below the merge.

## Consequences

- The card's acceptance is rewritten by the same ruling: the "`meta` under 20 ms" line is withdrawn (it presupposed a per-caller cache), and each change under the card reports before and after `meta` for an immediate repeat, a 304, and a reload more than one minute after the previous call.
- Each source named in the Context table that lacks a counter gains one at its own mutation point, or the cache declines while that source is read. The implementing change says which sources it covers and which make it decline.
- The first change under the card, a memo of the cascade-delete closure on `objectRevision` ([#34437](https://github.com/objectstack-ai/objectstack/pull/34437), merged as `d18d54bd`), already obeys this record: one source, its own counter, a copy per caller.
- The rule costs work at every source and buys a cache whose staleness has a named owner per source. A per-caller cache stays unbuilt until a new ruling.

## Alternatives considered

**A per-caller whole-bundle cache** (option A on the decision card). It is the only route to the withdrawn 20 ms target. It adds a permanent contract that the caller fingerprint covers every security answer, and its failure mode is serving another scope's navigation and field definitions with no error. Not ruled; needs staging readings and a new ruling.

**Stop after the cascade-delete memo** (option D). Leaves every bundle request, the expired path included, recompiling the whole app.

**A time bound alone.** Rejected by ADR-0127 D1: publish visibility becomes a timer, and a 30 s bound helps no real reload.

**A cache-side invalidation list.** Rejected by D2 and ADR-0127 D2: the omission it invites is silent.
