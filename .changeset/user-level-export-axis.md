---
"@objectstack/spec": minor
"@objectstack/plugin-hono-server": minor
---

feat: user-level export permission axis (#3544, #3391 follow-up)

`export` is a user-gated operation, not just "anyone who can list". A permission
set can now deny export on an object while keeping read — matching Salesforce
"Export Reports" / Dynamics "Export to Excel" / NetSuite "Export Lists" / SAP
S_GUI 61.

- **spec** `ObjectPermissionSchema` gains an optional `allowExport` bit. It is
  deliberately OPTIONAL with **no default** so it is a backward-compatible
  opt-out: unset → inherits read (today's "can-list ⇒ can-export"), `false` →
  export denied while read is kept, `true` → granted.
- **plugin-hono-server** `annotateEffectiveApiOperations` derives
  `userExportAllowed = allowExport !== false` from the resolved per-object
  permission and threads it into `resolveEffectiveApiMethods` — so `export`
  derives from `list ∧ userExportAllowed`. When the axis removes `export` from
  an otherwise-open object, the object is now annotated (the effective set minus
  `export`) so the client hides the Export button; an unrestricted object with
  export still allowed stays unannotated (client default-allow).

Wires the `userExportAllowed` slot reserved in #3391 P1 — zero contract change
to the derivation table or the frontend (it already consumes the effective
`apiOperations`). Backward-compatible: existing permission sets (no
`allowExport`) keep today's behavior everywhere.
