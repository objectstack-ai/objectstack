---
"@objectstack/cli": patch
---

fix(cli): `register`/`whoami`/`logout` examples no longer spell `os auth <cmd>` in live `--help` output (#11221)

`static override examples` is printed verbatim as part of oclif's `--help`. `register.ts`,
`whoami.ts` and `logout.ts` live at the **root** of `packages/cli/src/commands/`, so oclif's
pattern-strategy loader registers them as `register` / `whoami` / `logout` — but their
`examples` spelled an `os auth <cmd>` shape that has never resolved. A user copy-pasting
straight out of `--help` hit `Error: Command auth:whoami not found.` (exit 2), the same dead
command #10927 fixed in `packages/cli/README.md` and #10967 fixed for the `environments`
topic, this time on the root auth-family commands.

Measured against the built CLI (`packages/cli/bin/run.js`) before the fix: `os auth whoami`,
`os auth register` and `os auth logout` each exited 2 with `Error: Command auth:<cmd> not
found.`, while the bare `os whoami` / `os register` / `os logout` each exited 0 and printed
help — so the examples named the one spelling that could not work. All seven `examples`
entries now say the bare, registered spelling.

The exported default class on each file is renamed to match its real, file-path-derived
command id (`AuthRegister` → `Register`, `AuthWhoami` → `Whoami`, `AuthLogout` → `Logout`).
oclif derives a command's id purely from its file path, never from the class name, so this
changes no runtime resolution — confirmed by rebuilding the CLI and re-running `--help` on
all three. The rename also brings them onto this package's measured convention: every other
root-level command class is exactly the PascalCase of its filename. `login.ts` keeps
`AuthLogin` — its `examples` were already correct (`$ os login`), so it is outside this
card's file surface; that lone remaining class-name holdout is reported, not swept.

`environments.test.ts`'s `#10967` pin carried a deliberately self-retiring `EXCLUDED` entry
for each of these three files, asserting the defect was *still present* so the exemption
could not outlive its cause. This fix removed the last unresolved entry, that assertion went
red exactly as designed, and the three entries are retired — the map is now empty and all
three files are scanned by the main assertion like every other command source.
