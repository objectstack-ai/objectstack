---
'@objectstack/skills': patch
---

docs(skills): the hooks skill says when `ctx.api.transaction` joins an outer unit, that its transaction is one datasource, and teaches hook `texts` with `ctx.text`

Clause-②: no
Metadata-protocol: none

objectstack-data's `references/data-hooks.md`:

- The `api.transaction` capability row no longer says only "commit on return, rollback on throw". It now says the callback runs in one transaction on one datasource, and that a write in it to an object on another datasource is refused before it runs (`400 ERR_CROSS_DATASOURCE_TRANSACTION_WRITE`). Inside a unit that is already open (the one the hook's write runs in, or a caller's) it joins that unit: its return is no commit and its throw no rollback, so a throw the body catches keeps the callback's writes, and the outer unit commits or rolls back all of it.
- A new "Declared texts (`texts`)" block beside "Declared refusals" teaches a hook's `texts` and `ctx.text(key, params?)`: the sentence is written in the organization's language, translated first and then filled, a missing translation never fails the hook, an unreadable Localization setting rejects, and only declared keys are answered. The sandbox `ctx` table gains a `ctx.text` row that points to it. The translation key is left to objectstack-i18n.
- Seven restatements in the same file were removed to pay for the new text.

`evals/hooks-security-seeds-datasources.json` gains two cases, one on the joined transaction and the one-datasource rule, one on `texts` with `ctx.text`.
