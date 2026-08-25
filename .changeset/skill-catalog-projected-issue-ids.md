---
"@objectstack/spec": patch
---

docs(spec): strip the internal issue-id references that were projected into the published skill catalog

The 2026-08-23 ruling stripped internal `#NNNN` citations from the published
skill corpus, but 14 of them were not authored in `skills/**` at all — they were
projected there from `.describe()` / TSDoc text in `packages/spec/src/**` by
`gen:skill-refs` and `gen:react-blocks`, so a hand-edit of the corpus could not
reach them and a regeneration would have put them straight back.

Six source sites are rewritten to say the same thing without the citation, and
the artifacts are regenerated: the module summaries of `data/driver/common`,
`data/driver/config-registry`, `data/driver/turso`, `shared/retry-policy` and
`system/translation`, plus the `ListView.objectName` / `ListView.viewType`
deprecation notes and the `<Block>` summary in `ui/react-blocks`. The teaching in
each is kept, per the standing ruling of 2026-08-12, verbatim and untranslated:
「处理 issue 时犯的错应该总结成经验,保留 issue id没有意义」.

Customer-facing text changes in three places from the one source edit: the
published catalog (`skills/*/references/_index.md`,
`skills/objectstack-ui/references/react-blocks.md` and its sibling
`contracts/react-blocks.contract.json`), and the docs site
(`content/docs/references/data/driver-common.mdx`, `driver-turso.mdx`). No
schema shape, no `.describe()` used for validation, and no accept/reject
behaviour changes — the edits are comment and documentation text only.

The doc-authoring gate's path exemption for the generated artifacts is removed
in the same change: it existed only because those files still carried projected
ids, and an exemption over a surface that no longer needs one is where the next
regeneration would smuggle one back in.
