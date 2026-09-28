---
"@objectstack/plugin-dev": patch
---

`DevPlugin` now loads `@objectstack/setup` and `@objectstack/account` through literal `import('…')` specifiers, like every other declared dependency it loads, instead of one variable specifier shared by a loop (#20376).

Clause-②: no

- **What was wrong.** The setup / account app-package loop imported `spec[0]`. A variable specifier cannot be resolved when the file is transformed. Under vitest, every `DevPlugin.init()` in a test therefore made two round trips to the main test process, even with both packages mocked, inside every clocked test window that boots `DevPlugin`. The main process is shared by the whole run, so on a busy CI shard those round trips wait on other files' work, against this package's 5000 ms test budget.
- **What changes.** Each loop entry carries its own literal loader. The `try` / `catch` and the absent-package report around each load are unchanged: a missing package is still logged as, for example, `✘ @objectstack/setup not installed — skipping its app`, and a present one that fails is still reported as present-but-failed.
- **Unchanged.** Nothing an author or operator configures or sees changes. Both packages were already declared dependencies of `@objectstack/plugin-dev`, and both the ESM and the CJS build keep a native `import("…")` for each.
