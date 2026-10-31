---
'@objectstack/skills': patch
---

docs(skills): objectstack-data teaches the code-defined datasource credential route (`OS_DATASOURCE_<NAME>_PASSWORD`, behind the host switch)

Clause-②: no
Metadata-protocol: none

- **Before.** `rules/datasources.md` taught `credentialsRef` and `connector` as the only credential channels. A datasource defined in code has no `sys_secret:` handle to point at (the Setup form refuses a code-origin datasource, and nothing else mints one), so an agent following the rule wrote a reference the connect could never resolve.
- **Now.** The credential section says a code-declared datasource reads its password at connect from `OS_DATASOURCE_<NAME>_PASSWORD` (the name upper-cased) while the host switch `OS_DATASOURCE_ENV_CREDENTIALS` is `on`; that `os serve`, `os start` and `os dev` default it on, a library composition leaves it off, and the switch takes `on` or `off` only; that a declared `credentialsRef` or `connector` still wins and never falls back to the variable; and the operator's caution that an installed package may declare a datasource of any free name and so read that variable.
- The file stays under its token ceiling: the new text is paid for by deleting restatements in the same file (the field-reference pointer the references index already carries, the `writable` and `columnMap` restatements of their own sections, the `datasource` field default the SKILL.md field table carries, and two detail clauses). No ceiling moves, no frontmatter, schema or behaviour changes.
