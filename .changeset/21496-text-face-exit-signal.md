---
'@objectstack/cli': patch
---

fix(cli): `os package install`, `os package publish` and `os plugin sign` print one error line per refusal (#21496)

Clause-②: no

`os package install ./does-not-exist.json` printed `✗ Cannot read artifact: ENOENT …` and then a second line, `✗ EEXIT: 1`. The exit status, 1, was right. The extra line came from the command's own `catch`: the `this.exit(1)` inside its `try` throws oclif's exit signal, and the `catch` reported the signal as an error.

The same `catch` sat in two more commands:

- **`os package publish`.** Every refusal it makes printed the extra `✗ EEXIT: 1` line. Examples are an unreadable artifact, an invalid manifest id, no cloud login, a failed package registration and a failed version publish. An `--icon-file` whose image type it cannot infer printed three error lines: the refusal, then `✗ Cannot read --icon-file '…': EEXIT: 1`, then `✗ EEXIT: 1`.
- **`os plugin sign`.** A signature that failed its self-verification printed `✗ Self-verification error: EEXIT: 1` under the refusal.

Each refusal is now one error line, and every exit status is unchanged. A script that filtered out the `EEXIT` line can drop that filter.
