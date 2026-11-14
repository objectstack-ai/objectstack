---
'@objectstack/skills': patch
---

docs(skills): a hook that enforces a business rule declares `refusals` and refuses by code, not with a free-text throw answered `HOOK_ABORTED`

Clause-②: no
Metadata-protocol: none

`objectstack-data/references/data-hooks.md` § Declared refusals now opens with the rule: a hook that enforces a business rule declares a `refusals` catalogue, one code per rule, and its body throws the code; a throw with no code is answered with the platform's `HOOK_ABORTED`, which is for failures nobody planned. The section's example is now a cross-object state guard (only an in-stock asset can be checked out, `ASSET_NOT_IN_STOCK` at 409). It also says which hook form can declare `refusals` today: only a sandboxed `js` `body`; a `handler` hook, an inline TS one included, is refused at save. It says how the refusal reaches the wire: the status's `code` (default 400), with the hook's code as `declaredCode`. Best Practices and the Error Handling intro point to it. Common Patterns' delete guard (`crm_protect_strategic_accounts`) declares `STRATEGIC_ACCOUNT` and `OPEN_OPPORTUNITIES` and throws them instead of two free-text errors; the second message no longer carries the count, since a catalogue message takes no parameters. `objectstack-data/rules/validation.md` § External / Custom Validation now teaches the same thing: its tax-ID hook declares `TAX_ID_BLOCKED` and throws it instead of `new Error('Tax ID is blocked')`. Both files pay for the new lines by deleting restatements in the same file. No schema, accept set or behaviour changes.
