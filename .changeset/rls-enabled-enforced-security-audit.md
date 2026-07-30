---
"@objectstack/plugin-security": patch
"@objectstack/spec": patch
---

fix(security)!: a disabled RLS policy no longer grants — found by re-verifying the ledger's security subset (#3896 follow-up)

**The fix.** `RowLevelSecurityPolicySchema.enabled` promises, verbatim: *"Disabled
policies are not evaluated."* Nothing read it — not the collection site, not the
projection round-trip, not the compiler. Because applicable policies OR-combine
(any match allows access), a policy an admin switched off **kept contributing its
grant**: disabling a too-permissive policy silently changed nothing. That is the
#3896 shape — a documented security control whose real behaviour is wider than
its contract — one layer up, on RLS instead of sharing rules.

`getApplicablePolicies` now excludes `enabled === false` before any matching, at
the single choke point both the find path and the analytics path flow through —
the same place, and the same ADR-0049 enforce-or-remove resolution, as the
formerly-unenforced `positions` domain. Exact `=== false` on purpose: the schema
defaults `enabled` to true and projection rows may omit the key, so absent stays
active. Four tests pin both directions. Access-narrowing only: no policy grants
MORE after this change, and nothing in-repo authors `enabled: false`.

**The audit that found it.** All 44 entries of the liveness ledger's security
subset (`permission` 33, `position` 4, `object` sharing/access 7) were
call-graph-closed by hand and stamped `verifiedAt: 2026-07-30` — the subset's
first-ever re-verification (previously 4 dated entries repo-wide, and the last
sweep that cited preview renderers went 10-for-13 wrong). Beyond `enabled`:

- `rowLevelSecurity.priority` → **dead + authorWarn**. Not merely unimplemented:
  policies OR-combine (the schema's own describe says most-permissive-wins), so
  the promised "conflict resolution" semantics cannot exist. A REMOVE candidate
  per the #3715/#3950 precedent while the v17 breaking window is open.
- `rowLevelSecurity.label` / `description` / `tags` → dead (benign display —
  no consumer in either repo; deliberately not authorWarn'd).
- `tabPermissions` was UNDERSTATED: the note said only `'hidden'` is read, but
  hono's rank merge reads all four visibility values across resolved sets, and
  the `me-apps-and-everyone-baseline` dogfood test exercises it. Evidence
  upgraded; noted as a proof-binding candidate.
- `allowExport` re-verified TRUE against the suspicion that it was
  projection-only: the export route carries its own caller-level 403 gate
  (`enforceExportPermission`), fail-closed when the security service cannot
  answer, separate from the object-level 405.
- `allowTransfer/Restore/Purge` notes re-confirmed accurate (M2 operations still
  unshipped; the RBAC gates are pre-mapped fail-closed).
- `object.ownership` evidence had rotted (line drift) — refreshed; six other
  object-level security entries re-cited and stamped.

No other runtime behaviour changes.
