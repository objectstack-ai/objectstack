---
'@objectstack/scenarios': patch
---

fix(scenarios): door mode mints its token when the authorize endpoint answers 200 `{ redirect, url }`

Clause-②: no
Metadata-protocol: none

`run-scenarios --modes door` could not get its OAuth token on a current app: `GET /api/v1/auth/oauth2/authorize` answers a fetch from Node (which sends `sec-fetch-mode: cors`) with a 200 and `{ "redirect": true, "url": "…" }` instead of a 302, and the runner read only a `Location` header, so every door round stopped at "authorization". The runner now follows either answer: a 302 `Location`, or a 200 `{ redirect: true, url }`, then consents and trades the code as before. Any other answer is still recorded as the refusal of the authorization step.
