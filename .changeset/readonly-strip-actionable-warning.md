---
'@objectstack/objectql': patch
---

fix(objectql): the static-`readonly` write strip now logs its consequence and its remedy

Writing a `readonly: true` column from server-side code — a cron job or background
task reaching the engine through `ctx.getService('data')` — dropped the value and
reported success. The only trace was:

```
WARN Field 'work_duration' is read-only — ignoring incoming change (#2948)
```

which says what the engine did, not what it cost the caller or how to fix it. The
downstream symptom is a field that persists fine through every REST path and never
persists from cron (os-project-titanwind-ehr#750), which reads as "cron is broken"
rather than "the value was stripped". The strip now names the object, states that
the update was **committed without the field**, and carries both remedies: trusted
server code declares itself with `{ context: { isSystem: true } }`, and any caller
can detect drops programmatically with `options.onFieldsDropped` (the machine-readable
strip signal that has existed since #3407 — one event per strip pass, with `fields`
and `reason`).

The level stays `warn`, deliberately: this seam cannot distinguish a hostile REST
body forging `created_by` from trusted server code, because `ExecutionContext`
carries no origin marker and `isSystem` — the only trust bit — is precisely the
exemption. `error` would make the error log client-triggerable; `debug` would restore
the silent drop.

Behaviour is unchanged: what is stripped, what survives, and what `onFieldsDropped`
reports are all identical. Documented in the [security protocol
page](/docs/protocol/objectql/security) — strip condition, the caller-supplied-keys
scope, why a `beforeUpdate` hook's backfill is exempt (the key snapshot is taken at
engine entry, before hooks run), and the `isSystem` convention for plugin writes —
and pinned in `engine-readonly-strip-signal.test.ts`.
