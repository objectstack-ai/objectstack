---
'@objectstack/skills': patch
---

Clause-②: no
Metadata-protocol: none

The platform skill's operations reference now says what the official image does on `main`: it refuses to start unless `OS_DATABASE_URL`, `OS_AUTH_SECRET` and `OS_SECRET_KEY` are set at runtime (an explicit `file:` URL on a mounted volume passes), and a Common ops pitfalls row tells an upgrade to keep the values an old container generated (`auth-secret`, `dev-crypto-key`, `data/objectstack.db` under `/home/node/.objectstack`) rather than set fresh ones, which would leave every saved credential unreadable.
