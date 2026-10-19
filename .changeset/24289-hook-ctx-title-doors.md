---
'@objectstack/skills': patch
---

docs(skills): `objectstack-data` says which hook doors provide `ctx.title` — a `body` has it, a deprecated `handler` gets it at runtime without `HookContext` declaring it, and `ql.registerHook` and a bare `ObjectQL` `bindHooks` do not provide it (#24289)

Clause-②: no

`skills/objectstack-data/references/data-hooks.md` listed `ctx.title(field?)` in the sandbox `ctx` table with no qualifier, so it read as a member of every hook context. It is not: a sandboxed `body` has it (the recommended form); an inline or named `handler`, which is deprecated, is handed it at runtime when the runtime binds the stack's hooks, but `HookContext` does not declare it, so a handler annotated with that type fails to compile; a hook registered with `ql.registerHook(...)`, or bound through `ObjectQL.bindHooks` with no runtime, gets no `ctx.title` at all. The row now says so. Text only; nothing an author writes changes, and no hook context changes.
