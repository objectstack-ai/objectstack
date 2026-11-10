---
'create-objectstack': patch
---

docs(create-objectstack): the blank starter's README and `src/apps/main.app.ts` stop telling the author to generate a second app, which `objectstack generate app` refuses in an app package that already has one (ADR-0019 D3)

Clause-②: no
Metadata-protocol: none

The starter ships one app, `src/apps/main.app.ts`, and a package whose manifest type is `app` holds at most one. Its README and the app file's comment now say what `os init`'s starter app already says: to put another object in the Console, add a navigation entry for it to that app (a `group` entry with children nests them) rather than a second app, and give it a list view with `objectstack generate view OBJECT`. Before, both suggested `objectstack generate app NAME --object OBJECT`, which exits 1 on the starter and writes nothing.
