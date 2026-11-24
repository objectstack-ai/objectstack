---
'@objectstack/cli': patch
---

feat(cli): `os validate`, `os verify` and `os serve` name a declared enterprise or cloud capability that no provider enforces

Clause-②: yes (widening)
Metadata-protocol: none

A stack that declares `requires: ['hierarchy-security']` and runs without the enterprise provider wired into `plugins[]` gets owner-only hierarchy scopes (`own_and_reports`, `unit`, `unit_and_below`), and before this nothing said so past `os validate`'s install hint.

- `os verify` now runs the capability-provider check `os validate` runs and reports every finding as an advisory: a `capabilities` array on the `--json` report (`token`, `message`, and `validate`: `error` when `os validate` refuses the stack over it, `warning` when it reports it), and one line each on the text face. It never changes `os verify`'s exit status, for any token.
- `os validate` and `os build` (and through the first, `os verify`) add a wiring check: an `enterprise`-edition token whose package resolves but which no `plugins[]` entry provides is a warning. Which tokens are `enterprise` is read from the capability registry's edition tags.
- `os validate --strict` (and `os validate --json --strict`), which already fails on any warning, now exits 1 for a stack whose `enterprise` capability package resolves but is not wired into `plugins[]`, or resolves but fails to load, while without `--strict`, and in `os build` (which has no flag that fails on warnings), the exit status is unchanged.
- The `enterprise` message names what happens without a provider (for `hierarchy-security`: the hierarchy scopes behave as owner-only) and its remedy reads "Install the package and add its plugin to `plugins[]`, or remove the token from `requires`".
- `os serve` prints the same sentence once at start-up for a declared enterprise or cloud token that nothing mounts. The boot itself is unchanged.
