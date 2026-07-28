---
"@objectstack/spec": minor
"@objectstack/cli": patch
---

feat(spec,cli): warn the author when a deprecated action alias is discarded (#3743)

#3742 made `target` beat the deprecated `execute` alias everywhere and had the
`ActionSchema` transform **drop** the alias from its output, so "two different
scripts for one button" became unrepresentable. What it left behind: an author
who declares both slots with different values still loses one of the two
handlers they wrote, **silently**. Per Prime Directive #12 that belongs at
authoring time, so it is now reported there.

**New rule — `action-target-execute-conflict` (advisory).** An action declaring
both `target` and `execute` with different values gets a warning naming both
handlers, stating that `target` wins, and giving the one-line fix (delete
`execute`). Identical values in both slots are harmless duplication and stay
quiet. It never fails the build: the resulting stack is well-defined — the cost
is a handler that never runs, not a broken artifact.

The rule must run **pre-parse**, because the parse is what consumes the alias:
once `ObjectStackDefinitionSchema` has run there is no `execute` key left to
report. It therefore lives in `@objectstack/spec`
(`lintDeprecatedAliases`, exported from the package root) and is wired into
both layers that perform the discard:

- **`defineStack`** — the dominant authoring path, and the one that consumes the
  alias earliest: it parses inside your own config module, so by the time
  `os build` loads that module the alias is already gone. It now warns on the
  console before parsing (once per distinct conflict per process).
- **`os build` / `os validate`** — a new pre-parse pass covering stacks that
  skip strict `defineStack`: a plain object default-export,
  `defineStack(…, { strict: false })`, and inline function handlers (`target` is
  `z.string()`, so those cannot pass strict `defineStack` and are lowered by the
  CLI instead). Both commands lint the same input, so they agree by construction
  (#3782).

Each layer reports only its own discards, so one authored conflict produces
exactly one warning however the stack is compiled.

**Behaviour fix in the same contract.** #3742 fixed compile-time precedence by
probing for a *callable* `target` first, which left one combination still
resolving the alias's way: a **string** `target` beside a **function** `execute`
bound the alias and then overwrote the canonical ref the author wrote. `target`
now wins in every combination of string/function across the two slots, matching
the `ActionSchema` transform — so the new warning states one precedence rule
that is true everywhere. If you relied on an inline `execute` function winning
over a string `target`, move it into `target`; the warning names the action.

Authoring is otherwise unchanged: `execute` alone is still accepted, still
lowered into `target`, and still documented.
