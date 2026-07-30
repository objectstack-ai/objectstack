---
---

fix(tooling): drop the retired `/storage` mount from the wildcard fall-through gate (#4116). #4122 added the guard declaring `packages/adapters/hono/src/index.ts:all ${prefix}/storage/*` in its `MOUNTS` ratchet; #4112 had already retired that mount, so the declaration pointed at nothing and the ESLint job failed on `main` — every open PR inheriting a red check it did not cause. Removing the entry is what the guard's own message asks for; nothing is un-ratcheted, because the mount it described no longer exists. Tooling only; releases nothing.
