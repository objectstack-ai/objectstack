---
"@objectstack/cli": patch
---

fix(cli): `environments/*.ts` command sources no longer spell `os projects` in live `--help` output (#10967)

`static override examples` is printed verbatim as part of oclif's `--help`, and all five
commands under `packages/cli/src/commands/environments/` (`bind`, `create`, `list`, `show`,
`switch`) still spelled the pre-v5.0-rename `os projects <cmd>` there — a user copy-pasting
straight from `os environments bind --help` hit `Error: Command projects:bind not found.`
(exit 2), the same dead command #10927 fixed in `packages/cli/README.md`, this time sourced
from the CLI binary itself.

`examples` arrays and JSDoc headers now say `os environments <cmd>`. The exported default
class on each file is renamed to match its real, file-path-derived command id
(`ProjectsBind` → `EnvironmentsBind`, etc.) — oclif's pattern-strategy loader derives a
command's id purely from its file path, never from the class name, so this rename changes
no runtime resolution; verified by building the CLI and running `--help` on all five
commands, plus one real invocation, after the rename. `environments.test.ts`'s imports and
`describe` title are updated to match, and gain a pin: every `examples` entry on these five
commands is checked against the CLI's actual file-tree-derived command-id set, so a future
topic rename that misses an `examples` string fails a test instead of shipping.
