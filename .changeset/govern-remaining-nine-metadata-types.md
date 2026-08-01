---
'@objectstack/spec': minor
'@objectstack/cli': patch
---

Liveness coverage is complete: the nine remaining registered metadata types are
governed (#4488) — `app`, `book`, `doc`, `email_template`, `job`, `mapping`,
`seed`, `translation`, `validation` — and `PENDING_GOVERNANCE` is empty. Every
type in the metadata-type registry now has a ledger with per-property verdicts,
evidence, and a `verifiedAt` stamp.

Spec:

- Nine new ledgers under `packages/spec/liveness/` (≈150 verdicts). Highlights:
  the ENTIRE `email_template` authoring surface is dead (nothing materializes
  metadata items into the `sys_email_template` rows `sendTemplate` reads — an
  admin editing the password-reset mail in Studio changes nothing; #4509);
  `app.areas[].visible` / `areas[].requiredPermissions` are fail-open dead
  gates (item-level siblings ARE enforced); `translation.validationMessages`
  is read by nothing while #3778's own migration table steers authors into it;
  `job`/`validation` have runtime-authoring doors disconnected from their
  execution points (#4509). `doc` and `seed` are fully live.
- `check-liveness.mts`: the walker now sees through `z.preprocess` pipes
  (takes the OUT side when the IN side is a transform) — `translation`'s
  registered schema was unwalkable before this.
- `liveness/README.md`: the per-type count table's method is now decided and
  recorded (it mirrors `check-liveness.mts --json` `byStatus`, the number CI
  enforces); all rows regenerated from one run, and the two-generations-stale
  `webhook` row rewritten to the post-#3489/#3494 state.

CLI:

- `lint-liveness-properties` registers the six newly governed types that carry
  `authorWarn` entries (`apps`, `books`, `jobs`, `emailTemplates`, `mappings`,
  `translations`), so authors hear about the misleading keys at compile time.
