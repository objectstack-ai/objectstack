---
'@objectstack/skills': patch
---

docs(skills): objectstack-data eval case 3 answers the code-defined datasource credential route and pins it

Clause-②: no
Metadata-protocol: none

- **Before.** `evals/hooks-security-seeds-datasources.json` case 3 (a read-only `legacy_customer` object over the `customers` table of a Postgres reporting database) answered "a `defineDatasource` entry (`credentialsRef`, never inline credentials)". `rules/datasources.md` now teaches that a datasource defined in code reads its password at connect from `OS_DATASOURCE_<NAME>_PASSWORD` behind the host switch `OS_DATASOURCE_ENV_CREDENTIALS`, and that nothing mints a `sys_secret:` handle for one; the eval's `must_contain` pinned neither route, so the eval stayed green while its model answer taught a handle the connect could never resolve.
- **Now.** The model answer names the environment route the rule teaches (`OS_DATASOURCE_REPORTING_PASSWORD` for a datasource named `reporting`, the switch and the hosts that default it on), `schemaMode: 'external'`, the object's `datasource` / `external.remoteName` / `columnMap` binding and the closed write gate (`allowWrites`, `writable`). `must_contain` keeps `defineDatasource`, `datasource`, `remoteName`, `columnMap` and `schemaMode` and adds `OS_DATASOURCE_ENV_CREDENTIALS` and `_PASSWORD`, so an answer that teaches only the old route goes red.
- Eval fixtures are measured but not ratcheted; no SKILL.md, rules, references, schema, key or behaviour changes.
