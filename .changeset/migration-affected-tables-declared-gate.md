---
"@objectstack/metadata": patch
---

fix(metadata): stop `migrateProjectIdToEnvironmentId` renaming into a column no declaration knows about (#13205)

`AFFECTED_TABLES` was a hand-written list, and it outlived the declarations it
described. The branch/project-removal amendment (M1) took `environment_id` out
of `sys_metadata_history`'s declaration in `@objectstack/metadata-core`; the
migration kept naming that table. Its only guard asks whether `project_id` is
present **physically** (`_columnExists`) — which says nothing about the target
column being **declared** — so against any database whose physical
`sys_metadata_history` still carried the pre-v5 column, the migration renamed it
to `environment_id`: a fresh orphan column that no declaration, no `syncSchema`
and no reader knows about.

The list is now **derived from the declarations** rather than restated beside
them. A candidate table is migrated only if its current declaration carries the
target column, so the two cannot drift apart again — the derivation and the
declaration are the same fact. `@objectstack/metadata-core` was already a
dependency of this package, so this adds no dependency edge.

A candidate that does not declare the target column is now **reported** as
`status: 'skipped_not_declared'` (an additive member of the result union)
instead of silently vanishing from the result array: an operator reading the
results can tell "considered and deliberately skipped" from "forgotten again",
which is the state this defect started in.

The sibling `migrateEnvIdToProjectId` is deliberately left alone: its target
(`project_id`) is an intermediate column that no current declaration carries by
design, so the "target must be declared" rule is sound only for the terminal
migration in the chain.

No behaviour changes for `sys_metadata`, whose declaration does carry
`environment_id`: it is renamed exactly as before.
