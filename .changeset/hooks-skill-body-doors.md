---
'@objectstack/skills': patch
---

The data-hooks reference names the two body doors, `ctx.email.send` (`email.send`) and `ctx.activity.append` (`activity.append`), in its sandbox `ctx` table and capability list. A hook body cannot send mail; mail on a record change goes through an action, a job or a flow.
