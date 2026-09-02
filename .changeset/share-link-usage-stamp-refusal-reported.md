---
"@objectstack/plugin-sharing": patch
---

fix(plugin-sharing): a refused `use_count` / `last_used_at` stamp in `resolveToken` is reported as a durability degradation, once, instead of being swallowed (#12981, batch 9)

`ShareLinkService.resolveToken` stamps `use_count` and `last_used_at` on
`sys_share_link` after every successful resolution. The stamp's `catch` was
empty ("usage telemetry is a nice-to-have"), so a storage refusal — a
read-only database, a missing table, a broken system-context write path —
left the link resolving normally while both counters silently froze.

Those counters are a persistence CLAIM, not telemetry: `sys_share_link`
declares `use_count` as "Incremented by resolveToken on every successful
resolution" and `last_used_at` as "Stamped by resolveToken; used by the
dashboard to highlight active links", and the shipped `active_links` grid
lists both. After a swallowed refusal an administrator read a count the
system's own declaration defines, wrong, with no signal anywhere — the
AGENTS.md "Degradation log levels" shape (persisted state and runtime state
disagree while nothing looks broken).

**What changed.** The refusal is now reported through the service's existing
`logger` option — the published `{ info?, warn, error? }` shape — at `error`,
falling back to the guaranteed `warn` channel when the host sink declares no
`error`. The line names the consequence (both counters are not being
persisted; links keep resolving; the `active_links` grid under-counts), the
fix (resolve the storage refusal named as the cause; refused stamps are not
replayed), and the cause. It is emitted **once per service instance**, at the
first refusal, never per request — `resolveToken` runs on every public
share-link request, and a line per refused stamp would be the flood the rule
forbids.

**What did NOT change**, and is pinned: the resolution itself (the holder is
still served, `redactFields` is unchanged, `resolveToken` never throws for a
refused stamp); the success path (`use_count` still increments and
`last_used_at` is still stamped on every successful resolution); the public
HTTP projection; and `ShareLinkServiceOptions` — no member is added or
widened, so hosts compile exactly as before.
