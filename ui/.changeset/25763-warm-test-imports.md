---
---

Test-only change: the test files that `check:test-source-alias` named now load, at module scope, the `@objectstack/*` / `@object-ui/*` specifiers they otherwise first load inside a test body, a `vi.mock` factory or after `vi.resetModules()`, so the cold transform is paid during collection instead of inside a clocked window (objectstack#25763). No published behaviour changes.
