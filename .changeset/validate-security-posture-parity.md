---
"@objectstack/cli": patch
---

`os validate` now runs the ADR-0090 D7 security posture check, restoring its documented contract of being the artifact-free run of the same gates as `os compile`/`os build`. Previously a stack could pass `validate` and then fail the build — e.g. a custom object with no explicit `sharingModel` (OWD), which the posture linter rejects at compile. Error findings gate validation; advisory findings print as warnings (and join the `--json` warnings array).
