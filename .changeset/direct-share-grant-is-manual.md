---
'@objectstack/plugin-sharing': patch
---

fix(plugin-sharing)!: a share granted directly by a non-system caller is always a manual share

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export changes shape. The moved answer is a refusal of two input fields on one service method and the door that calls it: no stored row changes, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for a client that sends a non-manual `source` or a `sourceId` on the direct-grant door. `SharingService.grant` called by a non-system caller, and so `POST /api/v1/data/:object/:id/shares`, now refuses an input whose `source` is present and is not `'manual'`, and an input that carries any `sourceId`, with `VALIDATION_FAILED` (400), and writes nothing. The refusal comes before any other check reads anything. Only the platform's own sharing-rule, team and system paths, which run under a system context, write a share of another source.

**Who moves:** a client that sent a non-manual `source` (`'rule'`, `'team'`, `'inherited'` or any other string) or a `sourceId` on the direct-grant door. FROM 201 with the row written TO 400 `VALIDATION_FAILED`, nothing written. The fix is one line: drop `source` and `sourceId` from the request (or send `source: 'manual'` with no `sourceId`); a share that should follow a rule is declared as a sharing rule.

**Not moved.** A grant with no `source`, or with `source: 'manual'` and no `sourceId`, answers as before. The system path (the sharing-rule evaluator and other platform callers under a system context) writes its shares as before, and the revoke door answers as before.
