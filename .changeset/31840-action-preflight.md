---
'@objectstack/spec': minor
---

feat(spec): an action declares `preflight`, one same-origin `GET` its param dialog shows before submit, with answer-to-param seeding

Clause-②: yes (widening)
Metadata-protocol: added
Skills-docs: follow-up owed — skills/objectstack-ui/rules/actions.md (documents the action keys; no `preflight` line yet)

- **`ActionSchema.preflight`** — `{ read: { url, method? }, path?, fields?, seed? }`. The param dialog sends one `GET` to `read.url`, shows the answer (or the sub-tree `path` selects, through `fields` in `resultDialog.fields`' own row and format set) above the params, and writes each `seed` entry's value into the named param, which the user does not type. The key is `planned` in the liveness ledger: it parses and is judged at parse today, and no param dialog reads it until the console half lands.
- **One same-origin rule.** `read.url` is held to the rule a page element's `api` data source reads under: it opens with a single `/`, and a scheme, `//host`, a backslash read as a slash, a space or control character, and a relative path are refused at parse with the class named. The rule moved into one module both schemas import; the page element's accept set, its messages and its published `pattern` are unchanged.
- **Refused at parse, each at its own path:** a `method` other than `GET`; a credential key (`headers`, `auth`, `authorization`, `token`, `credentials`, `apiKey`), `body`, `params` or any unknown key; a hole outside `${param.NAME}`, `${ctx.recordId}` and `${ctx.record.FIELD}` (`${result.*}` included), an unterminated `${`, or a `${param.NAME}` naming no declared param; `preflight` on an action with no non-empty `params`, or beside `execution: 'aggregate'`; a `seed.param` naming no declared param, a param seeded twice, a seeded param that also declares `defaultValue`, `defaultFromRow` or `carryOver`, and a seeded param a hole reads.

Nothing an author wrote before changes meaning: the key is new, and every value that parsed before parses to the same thing.
