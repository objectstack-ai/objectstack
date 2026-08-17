---
"@objectstack/objectql": minor
---

fix(objectql): a TRUE `readonlyWhen` no longer strips hook-derived values — the conditional strip judges only API-boundary callers (#9107)

`stripReadonlyWhenFields` runs AFTER the before-phase hooks and was keyed on
`name in data` over the POST-hook payload, so a value a `beforeUpdate` hook
computed was judged exactly like a key the caller forged. Unlike the static
`readonly` strip immediately beside it, it carried no `isSystem` exemption
either — so a field locked by a TRUE predicate had **no server-side write path
at all**: a hook derived it and the strip deleted it; a cron or plugin wrote it
with `{ context: { isSystem: true } }` and the strip deleted that too.

Net effect before this change: the derived-field pattern (hook-computed column)
and a conditional form lock could not coexist on one field. An author wanting
"visible on the form but locked" **and** "recomputed by a hook" had no
spec-compliant spelling, and the failure was silent behind an HTTP 200.

Measured downstream (steedos-labs/os-project-titanwind-ehr#1446):
`equipment.next_maintenance_date` is hook-derived (last maintenance date + cycle
days) and declared with an always-true `readonlyWhen` to render
visible-but-locked. After a maintenance sign-off the recompute never landed, and
a scheduler keyed on that date regenerated the same maintenance plan on every
scan — a user-visible duplicate-plans loop, diagnosed only by reading the
engine's strip order in the dist bundle.

The conditional strip now carries the exact key discipline #5591 gave the static
one, on **both** branches (by-id and multi-row) off one engine-entry snapshot: a
key is judged only while it is still an own property of the caller's payload as
it arrived at engine entry AND still holds that caller's value by `Object.is`. A
key a hook added, or overwrote, is a server value and survives.

**The API-boundary lock is unchanged, and a caller cannot launder a write
through the hook phase.** To reach the exempt side of either test a value must
differ from what arrived at engine entry — which only server code can arrange. A
client that echoes the locked key back is stripped exactly as before; if a hook
overwrites that key, what persists is the **hook's** value, never the client's.
`isSystem` is still deliberately NOT an exemption for `readonlyWhen`: a state
lock that any system-context write could bypass would not be a state lock (the
frozen paid-invoice-lines case depends on it).

What moves for callers:

- A `beforeUpdate` hook may now write a field locked by a TRUE `readonlyWhen`.
  This is the sanctioned channel for a conditionally-locked derived field.
- `onFieldsDropped` no longer reports such a key under `readonly_when` — it is
  written, not dropped, so reporting it would make the observability seam lie.
- `strictReadonlyWrites` no longer refuses a write whose only `readonlyWhen`
  "drop" was a hook's own value; a caller-supplied locked field is still refused.
- The `ERR_READONLY_FIELD_REJECTED` refusal message's `readonlyWhen` remedy
  clause now reads "every **API-boundary** caller, isSystem included" and names
  the hook path. The error `code` is unchanged; a pin on the exact message text
  moves with it.

If an app relied on the strip discarding a hook's own write to a locked field,
that write now lands — remove the hook assignment, or narrow the predicate.
