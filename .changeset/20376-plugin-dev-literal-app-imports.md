---
"@objectstack/plugin-dev": patch
---

`DevPlugin` now loads `@objectstack/setup` and `@objectstack/account` through literal `import('…')` specifiers, like every other package it loads, instead of one variable specifier shared by a loop (#20376).

Clause-②: no

- **What was wrong.** The setup / account app-package loop imported `spec[0]`. A variable specifier cannot be resolved ahead of time. Under vitest, every `DevPlugin.init()` in a test therefore made two round trips to the main test process, even with both packages mocked. Under CPU load those round trips were the load-dependent term that timed out this package's own suites against the 5000 ms budget.
- **What changes.** Each loop entry carries its own literal loader. The `try` / `catch` and the absent-package report around each load are unchanged: a missing package is still logged as, for example, `✘ @objectstack/setup not installed — skipping its app`, and a present one that fails is still reported as present-but-failed.
- **Unchanged.** Nothing an author or operator configures or sees changes. Both packages were already declared dependencies of `@objectstack/plugin-dev`, and the built output keeps `await import("…")` in both the ESM and the CJS build.
