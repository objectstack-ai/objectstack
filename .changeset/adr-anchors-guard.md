---
---

Tooling-only: `pnpm check:adr-anchors` — code an accepted ADR governs must keep naming it (#3723 follow-up). Adds `scripts/check-adr-anchors.mjs` + `scripts/adr-anchors.json` (8 seeded anchors, all in the blast radius of the incident), a `Lint & Type Check` step, and Prime Directive #13 in `AGENTS.md` ("an accepted ADR binds until a superseding ADR says otherwise"). Releases nothing — no package changes.

The incident this closes: three accepted ADRs said `sys_member.role` must never carry RBAC authority, and a patch-level changeset made app-declared names storable there anyway; a follow-up then made it automatic in every host. The mechanism was not carelessness — the file being edited never named the ADRs that governed it, so the author could not have known. The check is a presence check (does the governed file still reference its ADR ids?), deliberately dumb; the value is that the failure carries the **invariant**, not just an id to paste back, and it fires on exactly the diff that warrants a second look — someone rewriting a governed block and dropping the rationale with it.
