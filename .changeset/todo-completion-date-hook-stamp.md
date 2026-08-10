---
"@objectstack/example-todo": patch
---

fix(example-todo): a normal user can mark a task complete again — `completed_date` is stamped by the hook instead of demanded from the caller (#7036)

`examples/app-todo` shipped two declarations on `todo_task` that could not both hold on
the update path, so the app's headline action was unsatisfiable by construction.

**Before.** `completed_date` is `Field.datetime({ readonly: true })`, and `readonly` is a
two-part contract: never editable in forms, **and** a non-system caller's write to it is
stripped from the payload on the update path. The same object then declares a validation
rule, `completed_date_required`, refusing any record whose `status` is `completed` while
`completed_date` is blank. The strip runs first, so a payload carrying both keys lost
`completed_date` and was then rejected for missing it. Measured against the real object on
a real kernel:

```
update status+completed_date (user ctx):  REJECTED -> Completed date is required when status is Completed
update status only           (user ctx):  REJECTED -> Completed date is required when status is Completed
update status+completed_date (isSystem):  OK
insert already-completed:                 OK
```

Both escapes are non-user paths — an elevated write bypasses the strip, and a create may
legitimately seed a read-only column. Every ordinary user update was refused, which made
the app's own `completeTask` and `massCompleteTasks` handlers fail every time they ran.

**After.** The column is server-owned, so the server writes it. `task.hook.ts` gains a
`beforeUpdate` leg that stamps `completed_date` on the transition into `completed` and
clears it on the transition back out; `completeTask` and `massCompleteTasks` now send
`status` alone. A one-key user-context update completes the task and persists the stamp.

This works because the readonly strip is deliberately narrow rather than because it is
bypassed: it runs *after* the before-hooks and deletes a key only when the caller supplied
it **and** it still holds the caller's own value (`stripReadonlyFields`, the
`suppliedValues` snapshot plus the `Object.is` identity check). A value a hook wrote is a
platform value and survives — including when the caller echoed the same key back, which is
what a whole-record form PUT does. The stamp is therefore written unconditionally: leaving
a caller-supplied value in place would leave the caller's own value on the key, and the
strip would delete it.

`completed_date_required` stays, and is now the assertion that the stamp actually
happened — if the hook is ever unregistered or its transition guard breaks, the write is
refused loudly instead of committing a completed task with no completion date.

**Two related repairs the fix required.**

- The hook was never registered. `task_logic` was not in `defineStack({ hooks })`, and
  `collectBundleHooks` reads that array and nothing else, so the whole file was dead
  metadata: it type-checked, it read as wired, and it never ran. Both sibling example apps
  already declare `hooks: allHooks`; `app-todo` now does too.
- Both existing legs read the record off `ctx.input` rather than `ctx.input.data`.
  `HookContext.input` is an envelope — `{ data, options }` on insert, `{ id, data, options }`
  on update — so `ctx.input.priority = 'normal'` set a key no write path reads. The insert
  defaults and the after-update branches had never had any effect; they do now. The
  after-update logging also moved from `console` to the kernel logger reached through
  `ctx.ql`, so it honours the configured log level.

Reopening a completed task clears `completed_date`, documented in the object and hook
metadata: the field means "when this task was completed", so a task that is not completed
must not carry a stale one. An edit that carries no `status` is not treated as a reopen.
