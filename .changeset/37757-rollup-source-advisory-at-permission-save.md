---
'@objectstack/lint': patch
---

fix(lint): saving a permission set through Studio, REST `/meta` or the MCP authoring door now warns when the set reads a roll-up over child data it cannot read

Clause-②: no
Metadata-protocol: none

`validateRollupSourceVisibility` (`security-rollup-source-unreadable`, `security-rollup-source-row-scoped`) ran only in `os validate`, `os build` and `os lint`. It now also runs at the runtime authoring door on `permission` writes, at advisory tier, so an author who never runs the CLI (an AI agent saving drafts through `save_metadata_draft`, a Studio admin) is told when a set reads a summary column such as `project.task_count` while it cannot read the `task` rows, or the child field, the column aggregates.

What changes for a caller:

- A `permission` save or publish that grants such a pair **still succeeds** and returns the finding in `advisories[]` (the draft verdict's `advisories` for a draft save), with the same `message` and `hint` `os lint` prints. `path` is the name-keyed `permissions.<set>.fields["<object>.<field>"]`.
- **Never a refusal.** The rule stays advisory; nothing that saved before is refused.
- A set's finding is charged only to a write of that set, never to a write of another set or of the objects. A child object the save cannot see (another package outside the written package's closure) is left unjudged, as the rule already left it in the CLI.
- **`object` writes are unchanged.** An advisory object rule stays off that door until its finding volume is decided separately.
- **The CLI commands are unchanged**: same rule, same positional `permissions[i]…` path.
