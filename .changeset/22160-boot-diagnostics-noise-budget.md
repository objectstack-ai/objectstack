---
"@objectstack/cli": patch
---

*Boot diagnostics* puts the one record you have to act on first, with its fix, counts it apart from the informational ones, and no longer prints stack traces at the default log level.

Clause-②: no

- **The record that needs you comes first, with its fix.** A script action declared with no handler (a button wired to nothing) prints first in *Boot diagnostics*, highlighted, naming each action, with its fix on the next line. A blank project with one such action shows:

  ```text
  ⚠ Boot diagnostics — 1 needs your attention · 2 informational:
    ⚠ [action-governance] declared script actions with NO handler — a button wired to nothing (ADR-0078): support_desk_ticket:resolve_ticket
      fix: add a `body`, or register a handler under the declared `target`
  ```

  Every other record prints once, dim, as before, and the header counts it as informational. When nothing needs your attention the header reads `ℹ Boot diagnostics — 4 informational:`. This record class is the only one highlighted so far.
- **No stack traces at the default level.** A record that carries an error's stack trace prints with its message and without the trace. The block's last line says how many traces were withheld. At `--log-level debug` the boot streams live, and the same record prints there with its stack.
- ⛔ Nothing you author changes, and no warning's log level changes. The package that logs a warning sets its level.
