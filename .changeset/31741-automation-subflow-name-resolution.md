---
'@objectstack/skills': patch
---

docs(skills): objectstack-automation says how a `subflow` / `map` child flow name resolves, and when it is refused

Clause-②: no
Metadata-protocol: none

The `subflow` and `map` rows of `skills/objectstack-automation/SKILL.md` now teach the engine's bare-name rule for `config.flowName` (ADR-0150 D3): a package's flow reaches its own package's flow, else the one holder in its declared `dependencies` closure plus `sys` packages; a package-less flow reaches the environment's flow, else the one package holder. Anything else passes `os validate` and fails the node at run time with the resolver's sentence naming every candidate and no error code: `outside-closure` (only an undeclared package or an environment-authored flow holds the name), `ambiguous-in-closure` / `ambiguous-in-environment` (two packages hold it; only a clash older than install's one-holder refusal, and such a name is never armed). A `map` fails at its first item. The automation evals gain a case that declares the dependency on the child flow's package.

Paid for by nine restatements cut from the same file, each keeping its other home:

1. The `screen` row's "never hand-roll a button label or step counter into `fields`": the same cell's "Next / Submit and Step N of M are not authored".
2. The `script` example's "function returns values → outputVariable → update_record persists" comment: the prose sentence above it.
3. The "CEL values or literals" comment on `script` `inputs`: Valid-but-silently-wrong #1, which lists `script` `inputs.*` as a value slot.
4. "Do not remove `readonly` instead": objectstack-data's `readonly` bullet ("not by removing `readonly`").
5. The `loop` row's sample envelope: #1's `{ dialect: 'cel', source: '…' }`.
6. "never a reason to write code" in Integrations: the same paragraph's "Never a plugin" and "the app still writing none".
7. References' "Read the source for exact field shapes; never rely on memory": `references/_index.md` ("Read them directly from `node_modules`").
8. "hooks get `ctx.api`": the hook `runAs` paragraph ("that hook's `ctx.api` data operations").
9. When to Use's "(auto-launched, screen, scheduled)" and "record-change": the Flow Types table and the frontmatter description.

The remaining 41 tokens move the file's ceiling 6527 -> 6568 under the standing ruling 「A:先削重复,余额按实测提高」 (ruling record 6513306068, letter B), pinned at the measurement.
