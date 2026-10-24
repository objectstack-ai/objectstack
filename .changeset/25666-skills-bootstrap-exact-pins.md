---
'@objectstack/skills': patch
---

docs(skills): the objectstack-platform bootstrap example pins every `@objectstack/*` dependency to one exact version

Clause-②: no

The 〈Complete Working Example〉 `package.json` in `objectstack-platform/references/bootstrap.md` gave `^17.0.0` for its five `@objectstack/*` packages, a major behind and a caret range the v18 docs advise against. It now gives `18.1.0` for each, and one sentence says `create-objectstack` writes every `@objectstack/*` dependency as its own version, exactly, so all of them stay on one version.
