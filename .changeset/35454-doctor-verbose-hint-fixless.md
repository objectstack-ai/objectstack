---
'@objectstack/cli': patch
---

fix(cli): `os doctor` no longer advises `--verbose` when no warning has a fix for it to show

Clause-②: no
Metadata-protocol: none

When `os doctor` finished with warnings it closed with "Run with --verbose to see fix suggestions." whenever any warning fired. Several warnings have no fix suggestion in either mode (a missing `*.test.ts` beside a `*.zod.ts`, `@deprecated` usages, circular dependencies, unused objects, orphan views), so for those the re-run printed nothing new. The line is now printed only when at least one warning that fired carries a fix that `--verbose` would reveal. The warnings themselves, and exit codes, are unchanged.
