---
"@objectstack/cli": patch
---

fix(cli): `os login --json` refuses in a non-interactive shell instead of writing `Email: ` to stdout and exiting 13 (#6728)

`os login --json` had a path below the device flow that wrote a **prompt** to
the payload stream. With no TTY and one or both of `--email`/`--password`
missing — what a CI runner produces when a secret fails to interpolate — the
command fell through to `readline`, whose prompt goes to the `output` stream
the interface was built on: `process.stdout`, unconditionally, `--json` or not.

Measured on the released behaviour:

```console
$ os login --json --url https://api.example.com < /dev/null
exit=13
$ cat -A out.txt
Email:
```

The entire stdout of a run under a declared machine-readable flag was the
string `Email: `, with no trailing newline: not a JSON document, not NDJSON, no
payload at all. Supplying `--password` alone produced the same; supplying
`--email` alone produced `Password: `. stderr carried only Node's
`Warning: Detected unsettled top-level await`.

Two defects, fixed together.

**`--json` is non-interactive by definition, so it refuses.** A `--json` run
that would otherwise have to ask now emits one record through the same NDJSON
emitter as every other `--json` write in the command, and exits `1`:

```console
$ os login --json --url https://api.example.com < /dev/null
{"success":false,"error":"email and password are required in a non-interactive shell"}
```

The refusal is keyed on the flag, not on `isTTY`: reaching it under `--json`
means the only way forward was a prompt, and what stdin happens to be attached
to does not un-declare the run. The `--email`-only and `--password`-only
combinations are covered, since a half-interpolated secret is the usual shape
of the mistake.

**End of input now produces an exit code the CLI defines.** Exit 13 was not a
decision this CLI made — it is Node's unsettled-top-level-await teardown:
`readline`'s `question()` promise is *abandoned* rather than rejected when
stdin is at EOF, nothing throws, and the `await execute(...)` in `bin/run.js`
never settles. `CliExitCode` admits `0` and `1` only, and a CI step judging
success by exit status depends on that. Every prompt is now bound to an abort
that fires on the interface's `close`, so an abandoned question rejects and the
failure reaches the exit code.

Without `--json`, `os login` still prompts on a pipe exactly as before; what
changed for that path is the ending — an EOF at either prompt now reports
`stdin reached end of input before the credentials were entered. Pass --email
and --password to log in non-interactively.` and exits `1`.

If you relied on `os login --json` prompting, pass `--email` and `--password`,
or drop `--json` to keep the interactive prompts.
