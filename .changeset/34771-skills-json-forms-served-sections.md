---
'@objectstack/skills': patch
---

docs(skills): the sections served to MCP clients show their examples as JSON, and a check pins their headings

Clause-②: no
Metadata-protocol: none

A client that builds through MCP writes JSON, and the sections of `objectstack-data`, `objectstack-ui` and `objectstack-automation` that the hosted MCP door serves showed their examples in TypeScript. Those sections now give each example as JSON, with one line on how a TypeScript project wraps the same literal:

- `objectstack-data`: the object in Object Definition, the `state_machine` rule in State Machine Validation, and the `summary` field and the permission set in Roll-up Summaries. Field Type Selection names the `{ dialect: 'cel', source }` envelope beside the TypeScript tag.
- `objectstack-ui`: the write-button action in Actions.
- `objectstack-automation`: the `notify` node (its key notes are a list under the block), the `script` and `update_record` pair in Valid-but-silently-wrong, the whole approval flow in Approvals (Flow Nodes), and the start node and window filter of the time-relative trigger, beside its TypeScript flow.

The other served sections are prose and tables and read the same to both kinds of client; three of them drop a TypeScript-only phrase.

Every JSON block in a served section is parsed and validated against the spec schema for its kind in CI, and a renamed, removed or duplicated heading of a served section now fails there.
