---
"@objectstack/spec": minor
"@objectstack/objectql": minor
"@objectstack/plugin-auth": patch
---

fix(objectql)!: `beforeUpdate` receives the record the engine intends to persist, and the caller's submission travels on `ctx.submitted` (#16344)

<!-- adr-0087: not-required (no-migration-prescription) an enforcement-ORDER change plus one ADDITIVE optional key on a runtime context schema. No authorable key, spelling or stored shape moves, so a stored `sys_metadata` row needs no conversion and an upgrader has nothing to hand-edit. What changes is which image a `beforeUpdate` handler is shown; the remedy for a handler that depended on seeing a refused value is to read `ctx.submitted`, which is a code edit in the handler, not a metadata migration. Nothing is retired: `HookContext.submitted` is new and optional. -->

**BREAKING** — what a `beforeUpdate` handler reads on `ctx.input.data` changes. A statically `readonly` field the caller supplied a value for is no longer there.

## The defect

On update, a value sent for a field declared `readonly: true` was correctly **not persisted** — and was still handed to the object's `beforeUpdate` hook. A hook deriving columns from the incoming record therefore derived them from a value the row would never contain, and **those derived writes persisted**, because they are the hook's own.

Measured on a real app (17.2.0, sqlite, dev runtime) and reproduced in `packages/objectql/src/engine-readonly-hook-input.test.ts`. One `PATCH { actual_value: 380, target_value: 1, weight: 1 }` against a `readonly` `target_value`:

```
read back: target_value 400   weight 10        ← the strip worked
           score 1.2  calc_trace "实际 380 / 目标 1 … 权重 1%"
```

The row's own audit trail cites values the row does not hold. No error, no warning, 200, and `droppedFields` correctly reporting the strip the whole time — every channel said the write was fine, because by every channel's own lights it was. The only way for an application to be safe was for every hook to re-read its read-only columns and ignore the incoming record, which defeats declaring them read-only at all.

## What changed

**`ctx.input.data` on `beforeUpdate` is now the record the engine intends to persist.** Caller-supplied values for statically `readonly` fields are taken out of the hooks' view before the before phase is dispatched, and handed back at the engine's post-hook confluence — so the payload every engine-owned consumer below reads is byte-for-byte what it read before. `onFieldsDropped` reports the same fields with the same `readonly` reason, the read-only WARN says the same sentence, and `strictReadonlyWrites` refuses exactly the same writes.

**The caller's submission travels on a new `HookContext` member, `ctx.submitted`** (`@objectstack/spec`, `HookContextSchema`) — the payload as sent, snapshotted at engine entry before any middleware or hook stamp, frozen, and documented as *diagnostics only, never the persist image*. It is bound on the update verb, both phases, and every per-row dispatch of one caller write.

Two things deliberately did **not** move:

- **The enforcement pass is still after the hooks.** It is the only point that can tell a hook's stamp from a caller's forgery (`hookWrittenKeys`), so a `beforeUpdate` that stamps a read-only column still lands — including when the caller echoed the same key back, which is the whole subject of #5591 / #14088.
- **`beforeInsert` is untouched.** The create side's strip position is settled post-hook by ruling C (#14147, "one semantics, one enforcement point"), and `readonlyWhen`-locked fields stay hook-writable per #9107.

`@objectstack/plugin-auth`'s ADR-0092 identity write guard is migrated onto the new member in the same change, which is why nothing degrades: its 403 and its security warn still name the non-whitelisted field the caller sent. Without that migration the identical request answers `None of the submitted fields (—) are editable` — as strong a refusal, saying nothing about what was refused. Both readings are pinned side by side in `identity-write-guard.test.ts`.

Ruled 2026-09-08 (maintainer, verbatim 「批 #87 同意」, director seat, decision batch #87). The refused primary was the same strip move **without** the new member: the ADR-0092 diagnostic degrades and every third-party `beforeUpdate` guard reading `ctx.input.data` degrades with it, silently. The refused alternative on the other side was documenting that hooks must read read-only columns from `ctx.previous` — which outsources the invariant to every application, the exact shape triage had already rejected.

## Who is affected

A `beforeUpdate` handler that **reads a statically `readonly` field out of `ctx.input.data`**, on a non-`isSystem` write. Three shapes, and the fix is one line each:

- **deriving a value from it** — this is the defect; the handler now derives from `ctx.previous`, or from `ctx.input.data` with the payload's absence meaning "unchanged", which is what it always meant for a field the caller never sent.
- **reporting on what the caller sent** (a guard naming the offending key) — read `ctx.submitted`.
- **a self-assignment** (`data.x = data.x`) on such a field — this used to promote the caller's forged value to hook-owned and commit it; it now writes `undefined`, because the key the hook reads is gone. That laundering route closing is intended, and it is re-pinned rather than removed.

⚠️ **The sharpest edge is a sandboxed `body` hook, and it is a refusal rather than a quiet change.** A body that reaches *through* such a key — `ctx.input.locked_meta.who = 'hook'` — now dereferences `undefined` and throws, and a `body`'s default `onError` is `abort`, so the caller's **whole write is rejected** where it used to succeed. What that body used to do was persist a value derived from the caller's forgery, so refusing is the correct direction; but the message the author sees is a raw `TypeError` from their own dereference and names nothing actionable. Measured end to end through a real QuickJS sandbox and pinned in `packages/runtime/src/sandbox/hook-input-writeback-readonly-provenance.integration.test.ts`.

A body hook cannot read `ctx.submitted`: it is deliberately not marshalled onto the sandbox face, for the reason `dispatch.scope` is not — that face is assembled key by key, and a key added there is a second published contract with its own compatibility story. A body deriving a column from a read-only field reads **`ctx.previous`**, the stored row, which is the correct source either way.

An `isSystem` caller sees no change at all: the strip has never applied to one, and neither does the hide.
