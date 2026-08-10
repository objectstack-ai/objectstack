---
"@objectstack/spec": minor
"@objectstack/objectql": minor
"@objectstack/service-automation": patch
---

feat(spec,objectql): `DroppedFieldsEvent.reason` names the dispatch-ruled id strip (#6437)

The write path's strip-observability seam declared a narrower vocabulary than
the strips it reports on. `DroppedFieldsEvent.reason` was a closed enum over the
two READ-ONLY strips (`readonly` #2948 / `readonly_when` #3042), so the
primary-key strip added by #6262 / PR #6433 (multi branch) and #6435 (by-id
branch) — a `data.id` the update dispatch has ALREADY RULED is not a primary
key, removed from the SET payload before it can overwrite the targeted rows'
identity — was invisible to `onFieldsDropped` and to `strictReadonlyWrites`.
Both PRs were right to refuse the alternative: force-fitting `readonly` would
make `reason` lie, which is worse than silence. This adds the value instead.

**New reason: `primary_key`.** It names the FIELD's role, not the offending
value's shape, so it stays true if the strip ever widens to the same-value
truthy-scalar no-op the engine deliberately leaves alone today —
`not_a_primary_key` would describe the value and become false that day. The
house rule it follows is #5503's, applied in the other direction: a new arm is
warranted exactly when no existing arm is truthful. #5503 reported the
implicitly-readonly runtime-owned strip as plain `readonly` because that *was*
true of it; `readonly` is not true of an `id` (a truthy scalar `id` writes
fine), so this one gets its own value.

**⚠️ Behaviour change, deliberate and measured: `strictReadonlyWrites` gains a
new refusal.** The option's contract says it covers "every drop
`onFieldsDropped` reports" — coverage DERIVED from the reported set, never an
enumeration frozen at #5126, and confirmed by reading `reportDroppedFields` on
`main`, whose `strictDrops.push` applies no reason-class filter. So reporting a
new reason necessarily refuses it. A caller that passes
`strictReadonlyWrites: true` **and** puts a ruled-non-key value in `data.id` now
gets `ERR_READONLY_FIELD_REJECTED` where it previously got a success whose `id`
had been silently dropped. That is the option's whole promise ("don't
half-apply my payload") reaching one more strip class, and it is the outcome the
flag's own doc now states. Nothing else moves: default-mode callers still get a
successful write plus an event, the strip itself is unchanged, and
`strictReadonlyWrites` is in-process only (`WriteObservabilityOptions`), so no
REST/wire caller can reach either behaviour.

**The refusal error no longer describes every rejection as read-only.**
`ReadonlyFieldRejectedError` composed one sentence ("… are read-only and would
have been stripped", remedied by `{ context: { isSystem: true } }`) that is
false for a `primary_key` drop — `isSystem` does not exempt that strip. The
message is now built from the `drops` breakdown the error already carried, so it
names each reason against its own fields and offers the right remedy. The
**read-only-only message is byte-identical** to #5126's / #5503's text (pinned
directly), the error `code` is unchanged, and adding a reason deliberately does
not add an error code: callers catch one code and read `drops`.

Consumers that branch on `reason` were swept. `service-automation`'s flow-step
warning map is a `Record<DroppedFieldsEvent['reason'], string>`, so tsc demanded
the new wording — the loud shape, kept that way on purpose. The protocol
responses that carry `droppedFields` (`api/batch.zod.ts`, `api/protocol.zod.ts`
×3, plus the cross-object batch extension) all derive from
`DroppedFieldsEventSchema` and widen transitively; REST's
`X-ObjectStack-Dropped-Fields` header is generic over the reason and needed no
change. One consumer does NOT widen safely and is filed rather than fixed here:
objectui's `writeWarningToast` picks its wording with a binary ternary whose
`else` arm would announce a stripped `id` as "Read-only" (objectui#3935).
