---
"@objectstack/cli": patch
---

Correct a false verb in `os migrate meta`'s own source comments: the `--from`
arm **lists** the mechanical edits an author's source needs; it rewrites no file
(#10831).

The `pendingDataMigrations` docblock in
`packages/cli/src/commands/migrate/meta.ts` opened with "this command rewrites an
author's source" — 74 lines above the command header that says the opposite
("The command does not silently rewrite TS config source (that AST rewrite is
unsafe and lossy)"). Both `writeFileSync` calls in the file are guarded by
`if (flags.out)`, so the only file the `--from` arm ever writes is the `--out`
JSON snapshot. The in-place codemod is a separate, unbuilt piece of work.

The contrast the docblock was drawing — metadata migration's subject is the
author's *source*, the two data migrations' subject is a deployment's *rows* —
is correct and is preserved; only the verb on the first half changed. The
`--stored` arm genuinely does rewrite `sys_metadata` rows and its wording is
untouched.

No runtime behaviour changes: comment-only.
