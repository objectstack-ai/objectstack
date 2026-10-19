---
'@objectstack/cli': patch
---

fix(cli): `os doctor` tells a tool missing from PATH apart from a tool on PATH that failed when it ran

Clause-②: no

- **What was wrong.** `os doctor` runs `pnpm -v`, `tsc -v` and `git --version`, and reported every failure as "Not found". A `pnpm` that is installed but cannot start was reported `✗ pnpm  Not found` with `Install pnpm: npm install -g pnpm@10.28.1`. One example is a Corepack-managed `pnpm` that cannot download the version it resolves: offline, behind a proxy, or with the registry answering 429. Reinstalling pnpm does not fix that.
- **What changed.** When a probe fails, doctor checks whether the tool is on the PATH the probe ran with. This is the same lookup the shell does: `/bin/sh` walks `PATH`; on Windows, `cmd.exe` tries each `PATHEXT` extension in the current directory and then in each `PATH` entry. If the tool is not there, the row is unchanged. If it is there, the row's message is the tool's own first error line, such as Corepack's `Error: Server answered with HTTP 429 when performing the request to …`. The fix then matches the cause. For a Corepack download failure, it says to check the network or proxy, or to pin pnpm with a `"packageManager"` field in `package.json`. For any other failure, it says to run the command and read its error.
- **Unchanged.** Each row keeps its status: `pnpm` is `error`, `TypeScript` and `Git` are `warning`. So doctor's exit code does not move. A tool that answers is reported as before. No package export or flag changes, and the report keeps its layout.
