---
---

docs(automation): add a "Hooks vs flows" decision section to `hooks.mdx` — flow as the default application surface, hook as the system backstop — with a task→layer table and the two structural reasons (a flow's writes are lint-checked metadata while a hook body's write set is statically opaque, per the accepted gap in `hook-body.zod.ts`; a flow reviews as data). Reverse link from `flows.mdx` Related. The framing settled in the #4271 discussion; documentation only, releases nothing.
