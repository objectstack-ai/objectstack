---
'@objectstack/skills': patch
---

docs(skills): the platform skill names the installation-wide uniques stop on a self-hosted `os deploy`

Clause-②: no
Metadata-protocol: none

`objectstack-platform`'s operations reference: a `use-runtime` target's install refusal now also covers the installation-wide `unique` constraints stop, with its two ways on: rerun with `--confirm-global-uniques` when those constraints are meant platform-wide, else set them `unique: 'organization'`. `os deploy` already accepts the flag; this release only teaches it. Two logger and metrics restatements whose home is `references/plugin-development.md` are cut.
