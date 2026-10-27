---
'@objectstack/skills': patch
---

docs(skills): the objectstack-platform skill teaches the `demoStaff` `manager` key — another entry's email, written as `manager_id` by the development boot (#26764)

Clause-②: no
Metadata-protocol: none

The Demo accounts section of `objectstack-platform/SKILL.md` now names a line manager in its `demoStaff` example and says how the key behaves: `manager` is another entry's `email`; `os dev` writes `sys_user.manager_id` itself once every demo account exists and keeps a manager someone set by hand, so no seed hook writes it; a display name, an address no entry has, the entry itself or a loop is refused at load. One eval case in `evals/config-plugins-ops.json` expects the key and forbids a seed writing `manager_id`. Four restatements elsewhere in the skill were cut to pay for the addition; each rule keeps its other home in the file.
