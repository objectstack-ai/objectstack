---
"@objectstack/cli": patch
---

docs(cli): drop the `os studio` row from the README command table — the CLI ships no such command (#11180)

`packages/cli/README.md`'s **Development** command table listed
`` | `os studio [config]` | Launch Studio UI with development server | ``. The CLI has no
`studio` command and has not had one: the oclif command set is pattern-derived from
`packages/cli/src/commands/**`, and loading the built CLI's own `Config` enumerates 60
registered ids with **zero** matching `studio` (control: `dev`, `serve`, `login`, `logout`,
`register`, `whoami` are all present in the same enumeration, so the check is not vacuous).
Running it confirms the same from the outside — `os studio --help` exits 2 with
`Error: Command studio not found.`

The row is deleted rather than rewritten. Studio is not reached by a CLI command at all —
it is served by the console at `/_console/studio` after `os dev` or `os serve`, both of
which the same table already lists — so a replacement row would reintroduce the category
error that made this one wrong: a Commands table is a list of commands, and a browser route
is not one.
