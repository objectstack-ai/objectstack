---
'@objectstack/cli': patch
---

fix(cli): `os dev --no-watch` turns watch mode off, and `os dev` fails when its PACKAGE argument selects no workspace package

Clause-②: no

`os dev` watches `objectstack.config.ts` and `src/` by default, and it already
had a branch for running without that watcher. No argument reached it:

- `os dev --no-watch` was refused as a nonexistent flag (exit 2).
- `os dev --watch=false` is not a form the CLI reads for a boolean flag. It
  parsed as `--watch` plus the PACKAGE argument `false`, so the command switched
  to monorepo mode, ran `pnpm --filter false dev`, printed "No projects found",
  and exited 0 with nothing started.

What changes:

- `os dev --no-watch` boots the environment with the watch-and-rebuild loop off.
  Plain `os dev` keeps it on, as before.
- In monorepo mode, a PACKAGE argument that selects no workspace package now
  exits 1, and the failure line names the value. The command passes
  `--fail-if-no-match` to pnpm, so pnpm decides whether the filter matched, for
  every filter form it accepts. `os dev --watch=false` is one such run: it now
  fails instead of reporting success. Write `--no-watch` instead.
- `os dev --no-watch` in monorepo mode (a PACKAGE argument, or a workspace root
  with no `objectstack.config.ts`) exits 1 and names the flag. In that mode each
  package's own `dev` script decides whether it watches, so the CLI cannot turn
  watching off. Run it in the project directory, or pass `--artifact`.

Monorepo mode now needs pnpm 8.13.1 or later, the release that added
`--fail-if-no-match`.
