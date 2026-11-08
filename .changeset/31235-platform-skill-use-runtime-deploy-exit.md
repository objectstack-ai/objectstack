---
'@objectstack/skills': patch
---

docs(skills): the platform skill says how `os deploy` exits 1 on a self-hosted runtime target

Clause-②: no
Metadata-protocol: none

`objectstack-platform`'s operations reference scopes its `os deploy` exit-1 paragraph to ObjectOS Cloud and adds one for a target `os environments use-runtime` remembered: it asks for no cloud login, and it exits 1 on a failed build, a dry run the runtime refuses, cannot serve or ignores (an older runtime installed anyway), an install refusal (rerun with the `--confirm-access-upgrade` or `--confirm-upgrade` token it printed), or a package the running kernel did not load (live after a restart). The `os deploy` row's use-runtime tail moves into that paragraph, and a pitfalls row that only pointed to the data skill's permission-set assignment is cut. The CLI behaviour already shipped; this release only teaches it.
