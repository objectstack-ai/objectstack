---
"@objectstack/spec": minor
---

feat(spec): register the invitation role cap's three refusal codes under `@objectstack/plugin-auth`

Clause-②: yes (widening)

The error-code ledger (`ERROR_CODE_LEDGER`, and so `ErrorCode`) gains three `@objectstack/plugin-auth` codes, one per refusal the invitation role cap can return. Today the cap answers all three as a bare `403 FORBIDDEN`, so a client such as the Invite User dialog cannot tell them apart:

- `INVITE_ROLE_ABOVE_ISSUER` — the requested role grades above the issuer's own; an invitation never confers authority above its issuer.
- `INVITE_ISSUER_MEMBER_ONLY` — an issuer below admin grade may invite only as a plain `member`; the requested role may carry capability of its own.
- `INVITE_ISSUER_UNVERIFIED` — fail-closed: the issuer's organization membership could not be established, so the invitation may confer nothing beyond `member`.

Registration only: `@objectstack/plugin-auth` still throws `FORBIDDEN` until #23945 stamps these codes on its refusals. No existing code changes, and no standard-catalog member is shadowed (none needs a synonym waiver).
