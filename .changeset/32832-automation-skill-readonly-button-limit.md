---
'@objectstack/skills': patch
---

docs(skills): objectstack-automation's readonly-field callout states the limit a flow started from a button has

Clause-②: no
Metadata-protocol: none

The callout "Writing a `readonly` field? Set `runAs: 'system'`" in `skills/objectstack-automation/SKILL.md` § Failure routing & `runAs` gains one sentence, in the words of `os explain flow-update-readonly-field`. A button or action does not let a user start an `autolaunched`, `record_change` or `schedule` flow declared `runAs: 'system'`: it answers 403 `PERMISSION_DENIED`. For a flow a user starts from a button, the elevated routes are a `screen` or `api` flow declared `runAs: 'system'`, or a user-run flow whose `subflow` node calls the elevated flow. Before this, an agent following the callout alone declared the button's `autolaunched` flow `runAs: 'system'` and the button answered 403.

Paid for inside the file's token ceiling, which does not move (6854 -> 6852 of 6861), by seven cuts from the same file, each keeping its other home:

1. The callout "Elevate the write, not the flow" loses "A `screen` flow stays `runAs: 'user'`; a step that must write a `readonly` field moves into a dedicated `runAs: 'system'` flow called from a `subflow` node": the new sentence directly above it names that route ("a user-run flow whose `subflow` node calls the elevated flow"). The callout keeps its rule and its reason: "Prefer the `subflow` route — raising a whole `screen` flow silently elevates every other write in it".
2. The `notify` section heading's "— the most-used node type": a tagline that states no rule.
3. The start-node example's comment "gates whether the flow launches on the event": Valid-but-silently-wrong #4 ("`condition: …` parses, matches no row: the flow stages clean and never fires").
4. The `get_record` row's "(that name has no executor and throws)": the same cell's "there is no `query_record` node".
5. Valid-but-silently-wrong #3's "Keep data effects on the flow graph (visible, governed, build-checkable)": the clause before it ("a later declarative node persists it") and the paragraph's opening ("it does NOT read/write the database").
6. The `schedule` row's "see *Time-relative triggers*": the pointer under Trigger Configuration ("references/examples-flows.md § Time-relative triggers").
7. The `screen` row's "(wizards, forms)": the skill description ("interactive screen flow / wizard") and the `screen` node row ("Display a UI form to the user").

No rule's teaching changes.
