---
"@objectstack/metadata-protocol": minor
"@objectstack/lint": minor
"@objectstack/cli": patch
---

Author-time rules now gate the RUNTIME metadata write path, not just the CLI (#4463)

The 26 author-time rules `os validate` / `os build` / `os lint` share (#4409) ran on
those three commands and nowhere else. Every runtime metadata write — Studio's
designer, REST `/meta` item CRUD, an MCP/AI agent authoring a flow — reaches
`saveMetaItem`, which did a per-type Zod `safeParse` and stopped. For a tenant that
was not the weakest of four doors, it was the **only** door: a `sys_metadata`
overlay row is not in the CLI's config file, so there was no command they could run
instead. An approval flow whose `expression` approver is broken CEL
(`record.owner ==`) is Zod-valid, so it saved, registered, and failed at the node's
entry the first time it fired — the exact body `os lint` had rejected since #4409.

**One shared core, one runtime gate.**

- The rule registry moved from `packages/cli` into `@objectstack/lint`
  (`AUTHORING_RULES`), and the CLI now calls it there. Five rule modules moved with
  it (`lintFlowPatterns`, `lintLivenessProperties`, `lintAutonumberFormats`,
  `lintViewRefs`, `data-model-rules`), unchanged. There is one table; a second one
  cannot be introduced without failing `authoring-rule-wiring.test.ts`.
- New kernel-safe subpath export **`@objectstack/lint/runtime`** — the entry the
  metadata write path imports. Running the gate loads neither `typescript` nor
  `sucrase`, pinned by a new `runtime-lazy-deps.test.ts` alongside the existing
  `lazy-deps.test.ts`, which is unchanged.
- Each registry entry now declares `surfaces` (`cli` / `runtime-publish`) plus
  either the metadata `runtimeTypes` it judges or a written `surfaceReason`. The
  ratchet fails an entry that answers neither.

**Behaviour**

- A `state: 'active'` `saveMetaItem` — and the draft→active promotion in
  `publishMetaItem` — of a **flow** runs the flow / approval / expression /
  reference rule families. A gating finding is refused with **422
  `INVALID_METADATA`**, in the same structured envelope the Zod failure already
  used, with `rule` / `path` / `where` / `message` / `hint` per issue.
- **Draft saves are never gated** — a draft is allowed to be half-finished and
  cannot execute.
- Only the write is judged: the rules run twice (context with and without the
  submitted item) and only findings the item *added* can refuse it, so a
  pre-existing violation in a stored row never blocks an unrelated save. Stored
  rows keep being read.
- Escape hatch **`OS_ALLOW_UNLINTED_METADATA_WRITES=1`** turns the refusal into a
  loud log for a migration window. Unset it once the metadata is fixed — the
  runtime executes what it published.

Only `flow` writes are gated in this pass; every other metadata type carries a
recorded reason in the registry.
