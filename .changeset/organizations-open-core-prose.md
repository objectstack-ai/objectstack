---
'@objectstack/cli': patch
'@objectstack/plugin-dev': patch
---

Operator-facing text no longer tells an open-source install that multi-organization
operation requires a subscription.

ADR-0132 moved the `org-scoping` registrar into open core — `@objectstack/organizations`
is Apache-2.0, carries no licence check, and declares both walled postures (`group` and
`isolated`) as its own constant. The messages an operator actually reads had not followed:

- `os serve`'s install remedy for a walled posture ended "this runtime is closed-source and
  is NOT on the public npm registry ... Without one this bullet is not followable" — it now
  says the runtime is Apache-2.0 and on the public registry, and notes that a commercial
  deployment resolves the same package name to its own private, licence-gated build.
- The `isolated` posture hint rendered by `os serve` and `os doctor` no longer calls the
  runtime "enterprise".
- `os verify`'s `--org-scoped` flag description drops the same word.
- The dev stack's degraded-tenancy warning and its stage-2 mount refusal no longer describe
  the package as the enterprise runtime.

Text only — no control flow, no identifiers, no behaviour change.
