---
'@objectstack/lint': patch
---

`ai-skill-tool-unresolved` is a whole-stack verdict by design: `os validate` / `os lint` / `os build` report it, and the runtime publish gate never does (#19527)

A skill's `tools[]` entries resolve against three sources: `stack.tools`, the
platform tool registry, and the `action_<name>` tools materialised from
AI-exposed actions. The runtime publish gate judges one written item against a
per-write snapshot that carries neither `stack.tools` nor `stack.actions`, and
no snapshot can carry a tool that a runtime plugin registers outside the
registry. At that door the rule could only ever produce a false
`ai-skill-tool-unresolved`: a skill naming a real stack-level action would be
told the tool does not exist. The ruling on #19527 (letter B) places this
check at the whole-stack rule, following ADR-0109 Decision §3, and keeps the
per-write snapshot as it is.

`skill` was already outside the runtime gate. The earlier comments called that
a temporary hold-out, pending a wider snapshot. They now describe it as the
design, so no later change should add `actions` / `tools` to the snapshot in
order to move this check onto the door. New tests pin both halves:

- a `skill` write through the runtime gate gets no tool-reference finding. This
  holds for a stack-level action tool, a plugin-registered tool, and a tool
  that exists nowhere. No other write type can put a skill into a door
  snapshot;
- `validate`, `build` and `lint` still report a tool that exists nowhere, at
  warning severity, and do not report the stack-level action that resolves.

⛔ No behaviour changes. Before and after this change, the runtime gate runs no
rule for a `skill` write, and the whole-stack commands report the same
findings. No authorable key, accept set or export changes.

**This ships, so it carries a changeset rather than `skip-changeset`.**
`@objectstack/lint` publishes `dist`, and its build keeps source comments. A
rebuilt artifact shows the reworded block in `dist/index.js`,
`dist/index.cjs`, `dist/runtime.js` and `dist/runtime.cjs`, and the old
wording (「held out on a measurement」) in none of them. So the published JS
bytes change, but behaviour and the declaration surface do not.
