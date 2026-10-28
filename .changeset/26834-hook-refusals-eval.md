---
'@objectstack/skills': patch
---

docs(skills): an objectstack-data eval asks for a hook's `refusals` catalogue instead of a sentence thrown from the body

Clause-②: no
Metadata-protocol: none

- **Before.** `references/data-hooks.md` teaches a hook's declared `refusals` catalogue (the body throws `{ code }`, the message is translated under `hooks.HOOK.refusals.CODE.message`), but no eval in `evals/hooks-security-seeds-datasources.json` exercised it: an agent asked for a refusal in a multi-language app could still write an English sentence into `throw new Error(...)`, which reaches zh-CN users untranslated, and nothing scored that wrong.
- **Now.** Eval 7 asks for an `order` save refused over the account's credit limit in an app serving English and Chinese users, and expects `refusals: { CREDIT_LIMIT: { message } }` on the hook, a `language: 'js'` body that throws `{ code: 'CREDIT_LIMIT' }`, and the zh-CN sentence under the bundle's `hooks: { HOOK: { refusals: { CREDIT_LIMIT: { message } } } }`; it refuses a sentence on the throw (`new Error('`) and a `handler:` (a catalogue without a `js` body is refused at save). Five sentences in evals 1–5 that restated their own `must_not_contain` assertions are gone; every fact and assertion stays.
- No schema, key or behaviour changes.
