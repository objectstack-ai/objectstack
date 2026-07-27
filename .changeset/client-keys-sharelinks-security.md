---
"@objectstack/client": minor
"@objectstack/runtime": patch
---

feat(client): `keys`, `shareLinks`, and `security` surfaces (#3563 PR-3)

Three more domains the route audit found with zero SDK expression:

- `client.keys.create({ name?, expiresAt? })` — mints a `sys_api_key`
  (`POST /api/v1/keys`). The raw secret comes back exactly once; `user_id`
  is pinned server-side. There was previously no SDK path to create an API
  key at all.
- `client.shareLinks.create / list / revoke` — authenticated management of
  record share links. Listing is server-constrained to the caller's own
  links; the public token-consumption routes stay browser-only by design.
- `client.security.suggestedBindings.list / confirm / dismiss` — the
  ADR-0090 admin surface for package audience-binding suggestions.

The route ledger flips all seven rows to `sdk` and the gap ratchet drops
24 → 17.
