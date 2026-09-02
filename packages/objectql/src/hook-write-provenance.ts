// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #14088 — WHO WROTE THIS KEY, recorded rather than inferred.
//
// ## The question, and why every value-shaped answer to it is wrong
//
// The static `readonly` strip (`stripReadonlyFields`) and its `readonlyWhen`
// sibling both run AFTER the before-phase hooks, so at the moment they look at
// a key, "the caller sent this key" and "this key still holds what the caller
// sent" are different facts. #5591 / #6339 moved the judgement from the first
// to the second, on the argument that a key SET made the contract
// (`runtimeOwnedStripWarning`: "hook-written keys are NOT caller-supplied")
// true only BY ACCIDENT.
//
// The same sentence is true of value equality, and #14088 is it failing the
// second time. `Object.is(payload[name], supplied[name])` cannot separate
//
//   - the hook deliberately wrote the value the caller happened to send, from
//   - the hook never touched the key at all,
//
// and the two demand opposite verdicts. The measured downstream row: a
// `readonly` `completed_at` cleared by a `beforeUpdate` hook on the transition
// OUT of `done`, against a caller that round-tripped the whole record and so
// also sent `completed_at: null`. `Object.is(null, null)` is `true`, the key is
// deleted with the caller's null, and the row commits `status = in_progress`
// carrying its OLD completion timestamp. No error. Nothing downstream can tell
// that row from a genuinely completed one.
//
// ⛔ A `null` special case is not the fix, and this module exists so nobody
// reaches for one: the identical collision is available on `0`, `''`, `false`,
// a shared object reference, and on any value a form round-trip echoes back.
// The distinction the strip needs is PROVENANCE — which keys the hook chain
// actually ASSIGNED — and provenance cannot be recovered from the values
// afterwards. It has to be RECORDED WHILE THE WRITES HAPPEN.
//
// ## The forgery boundary — the one thing here that must never be got wrong
//
// A hook-owned key is a key the strip STOPS DEFENDING, so a record that a
// caller could influence would be a privilege escalation, not a fix. This
// recorder cannot be reached by caller data, and the reason is structural
// rather than careful:
//
//   * it records nothing about the object's CONTENTS — only the fact that an
//     assignment executed against it;
//   * it is armed AFTER the caller's payload has arrived and been snapshotted,
//     and SEALED before the engine's own normalisation passes touch the payload
//     (`encryptSecretFields`, `normalizeMultiValueFields`, the strips
//     themselves). Between those two points the only code that runs is
//     before-phase hook code — server code, by definition;
//   * a caller cannot execute an assignment. Echoing a key back, echoing a
//     value back, sending `null`, sending a `Proxy`, sending a getter — none of
//     them is a `set` on this object, so none of them adds a key to the record.
//
// The record therefore only ever converts a "strip" verdict into a "keep" one,
// for keys a hook demonstrably assigned. Every other verdict is left to the
// two-part test that was already there — which stays, unchanged, as the answer
// for every key this recorder has nothing to say about.
//
// ## KNOWN LIMIT: a hook that REPLACES the payload object
//
// `ctx.input.data.x = 1` is recorded. `ctx.input.data = { …ctx.input.data, x: 1 }`
// is not: the replacement is a fresh object whose keys are indistinguishable
// from the caller's, because most of them ARE the caller's, spread across. So
// {@link HookWriteRecording.seal} returns NO record at all for that call and
// the strip falls back to the pre-#14088 value comparison.
//
// That fallback direction is deliberate and is the only safe one: the fallback
// OVER-strips (the pre-existing defect) where the alternative — treating a
// replacement's keys as hook-owned — would launder a caller's forged
// `created_by` into a platform write on any object with such a hook. Fail-safe
// here means "keep the old bug", and keeping the old bug is strictly better
// than opening the lock. Same shape, and the same argument, as the SHALLOW
// snapshot limit already documented on `stripReadonlyFields`: a hook that means
// to own a read-only column should ASSIGN to it.

/**
 * A live recording of the keys a hook chain assigns on one write payload.
 *
 * Produced by {@link recordHookPayloadWrites}, handed to the before-phase as
 * `hookContext.input.data`, and closed by {@link HookWriteRecording.seal}
 * before anything else in the engine touches the payload.
 */
export interface HookWriteRecording {
  /**
   * The object to hand the hook phase INSTEAD of the raw payload.
   *
   * It is a transparent write-through view of the raw payload — reads, spreads,
   * `Object.keys`, `JSON.stringify` and in-place mutation all behave exactly as
   * they do on the payload itself, and every write lands on the SAME underlying
   * object, so a hook that mutates in place is mutating the engine's payload
   * exactly as it always has.
   */
  readonly payload: Record<string, unknown>;
  /**
   * Close the recording and hand back the payload the rest of the write must
   * use.
   *
   * `current` is whatever the hook phase left in `hookContext.input.data`.
   * Pass it in rather than assuming: a hook is allowed to REPLACE the payload,
   * and that case is exactly the one with no attributable record (see the
   * KNOWN LIMIT above).
   *
   * Sealing is what keeps the record honest about its own boundary: the engine
   * writes to this payload too (secret encryption, multi-value normalisation,
   * the strips' own shallow copies), and a recorder still armed for those would
   * report ENGINE writes as HOOK writes — which, on a caller-forged secret
   * field, is the privilege escalation this module is built to make
   * impossible. The returned set is a snapshot; later writes through a stashed
   * reference cannot grow it.
   */
  seal(current: unknown): SealedHookWrites;
}

/** What {@link HookWriteRecording.seal} hands back. */
export interface SealedHookWrites {
  /**
   * The payload the rest of the write must use — the RAW object when the
   * recording survived (never the recording view, which must not reach a
   * driver), else `current` untouched.
   */
  data: Record<string, unknown> | undefined;
  /**
   * The keys a hook assigned, or `undefined` when this call has no attributable
   * record (a hook replaced the payload object). `undefined` is not "no hook
   * wrote anything" — it is "this call cannot say", and every consumer must
   * treat it as the pre-#14088 fallback rather than as an empty set.
   */
  hookWrittenKeys?: ReadonlySet<string>;
}

/**
 * Arm a recording of hook writes over `target`.
 *
 * ⚠️ Arm AFTER the caller's entry snapshot and SEAL before any engine-owned
 * mutation of the payload — see the forgery-boundary note at the top of this
 * file. Both ends are load-bearing; neither is a style choice.
 */
export function recordHookPayloadWrites(target: Record<string, unknown>): HookWriteRecording {
  const written = new Set<string>();
  let sealed = false;

  const record = (key: string | symbol): void => {
    // Symbols are not field names (a field is `^[a-z_][a-z0-9_]*$`), so a
    // symbol write can never be about a column the strip judges. Ignored rather
    // than stringified, so nothing a hook stashes under a symbol can ever
    // collide with a real key's provenance.
    if (sealed || typeof key !== 'string') return;
    written.add(key);
  };

  const payload = new Proxy(target, {
    set(t, key, value) {
      // Three-argument `Reflect.set`: the receiver defaults to the TARGET, not
      // to the proxy. Passing the proxy through as the receiver re-enters this
      // trap for any accessor property and recurses until the stack goes.
      const ok = Reflect.set(t, key, value);
      if (ok) record(key);
      return ok;
    },
    defineProperty(t, key, descriptor) {
      // `Object.defineProperty(ctx.input.data, k, …)` is a hook write too, and
      // it does NOT route through the `set` trap. Rare in hook code; recorded
      // because a provenance channel with a second, unwatched write verb is a
      // provenance channel that answers wrongly on exactly the writes someone
      // took care over.
      const ok = Reflect.defineProperty(t, key, descriptor);
      if (ok) record(key);
      return ok;
    },
    deleteProperty(t, key) {
      const ok = Reflect.deleteProperty(t, key);
      // A deleted key holds no value for the strip to keep, and re-adding it
      // records it again. Dropping it here keeps the set meaning "a hook
      // assigned the value standing on this key" rather than "a hook once
      // touched this name".
      if (ok && typeof key === 'string') written.delete(key);
      return ok;
    },
  });

  return {
    payload,
    seal(current: unknown): SealedHookWrites {
      sealed = true;
      if (current !== payload) {
        // Replaced wholesale — no attributable record. KNOWN LIMIT above.
        return { data: current as Record<string, unknown> | undefined };
      }
      return { data: target, hookWrittenKeys: new Set(written) };
    },
  };
}
