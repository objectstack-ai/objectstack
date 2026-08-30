// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ONE SMTP port bound this package has: the range `SmtpTransport` accepts,
 * the predicate that applies it, and the sentence it refuses in (#12993).
 *
 * ## Why this is a module and not three literals
 *
 * The bound was hand-written three times, across two packages:
 *
 * 1. the enforcement in `smtp.ts` — `port < 1 || port > 65535`;
 * 2. the **message text on the very next line**, which re-spelled the same
 *    range as a literal: `(expected 1-65535)`;
 * 3. `min: 1, max: 65535` on the `smtp_port` field of the mail manifest in
 *    `@objectstack/service-settings`, which that service really does enforce
 *    (`declaredBounds` / `validatePatch`), so it is a second door and not
 *    decoration.
 *
 * Sites 1 and 2 were ADJACENT LINES — the cheapest possible drift. Changing
 * the check without changing the sentence produces a refusal that misstates
 * its own rule, and nothing fails.
 *
 * ⭐ So the sentence is **generated**, not remembered:
 * {@link formatInvalidSmtpPortNotice} renders the range from
 * {@link SMTP_PORT_MIN} / {@link SMTP_PORT_MAX}, and site 2 stops existing as
 * an independent spelling. A test that merely compared two literals would
 * leave two literals — it would check the drift instead of deleting it.
 *
 * ## Why site 3 is a pinned MIRROR rather than an import
 *
 * MEASURED on this checkout, and it is the reason the obvious repair is the
 * wrong one: `@objectstack/service-settings` does **not** depend on this
 * package in any form, and this package already depends on it the other way —
 * as a **devDependency, test-only, no runtime edge**. Having the manifest
 * import this constant would add a runtime edge from a *service* to a
 * *plugin*, invert the layering, close a cycle in the workspace graph, and
 * drag `nodemailer` into the settings service's install closure — a worse
 * outcome than the drift it removes.
 *
 * The repo has already answered this exact question for this exact pair of
 * packages and this exact manifest: `mail-manifest-providers.contract.test.ts`
 * holds the provider dropdown equal to `EMAIL_TRANSPORT_PROVIDERS` with a
 * cross-package assertion over that same devDependency, "rather than two
 * mirrored literal lists". `smtp-port-contract.test.ts` extends that mechanism
 * to this bound, so the manifest's numbers cannot drift from these without a
 * red test — and no new dependency edge exists in either direction.
 *
 * ## ⛔ This is NOT the CLI's port range, and must never be merged with it
 *
 * `packages/cli/src/utils/port-contract.ts` owns the range a real `listen()`
 * accepts and floors at **0**, because 0 is a REQUEST — "let the OS choose" —
 * and binds a kernel-assigned port. This range floors at **1**: a destination
 * you connect *to* cannot be 0. The two are deliberately separate declarations
 * of two different contracts that happen to share a ceiling, and collapsing
 * them onto one constant would silently make `0` a legal SMTP port.
 * `smtp-port-contract.test.ts` fails if this floor moves or if this package
 * reaches for the CLI's module.
 */

/**
 * The lowest port an SMTP server can be reached on.
 *
 * ⛔ **1, not 0** — see this module's header. Port 0 is meaningful only to a
 * *listener*; there is no host answering on port 0 to connect to.
 */
export const SMTP_PORT_MIN = 1;

/**
 * The highest port number that exists — the 16-bit ceiling, shared with every
 * other port contract in the repo because TCP says so, not because they were
 * copied from one another.
 */
export const SMTP_PORT_MAX = 65535;

/**
 * The range exactly as a refusal should state it. Derived, never re-typed:
 * this is the construct that replaced the hand-written `(expected 1-65535)`.
 */
export const SMTP_PORT_RANGE_TEXT = `${SMTP_PORT_MIN}-${SMTP_PORT_MAX}`;

/**
 * Is `port` a port this transport can actually connect on?
 *
 * Three conditions, and `Number.isInteger` carries the first two of them:
 * finite (it refuses `NaN` and both infinities), whole, and inside the range.
 *
 * ## ⭐ Why integrality is part of the contract (#13189)
 *
 * This predicate arrived from `smtp.ts` as `Number.isFinite` and no more, and
 * #12993 kept it that way on purpose — narrowing an accept set inside a
 * refactor whose whole claim is behaviour preservation would have been a
 * behaviour change wearing a cleanup's clothes. It is narrowed here, in a card
 * that is about nothing else, for a reason that is measured rather than
 * stylistic:
 *
 * A fractional port **cannot ever connect**. MEASURED on Node 22:
 * `net.connect({ port: 587.5 })` throws `ERR_SOCKET_BAD_PORT`, and by the time
 * nodemailer has re-coded it the operator is shown a bare `RangeError`
 * (`code: 'ECONNECTION'`) reading `Port should be >= 0 and < 65536. Received
 * type number (587.5).` — at SEND time, naming a TCP rule and not the
 * Settings field they typed in. So admitting `587.5` here bought nothing: it
 * deferred a certain refusal by three layers and stripped the transport's name
 * off it on the way.
 *
 * ⭐ And the refusal this door already emitted **stated the integer rule
 * without enforcing it**: `587.5` is inside `1-65535` on any reading of
 * `(expected 1-65535)`. The sentence and the check disagreed. Exactly one of
 * them had to move, and the one that can never be satisfied is the value.
 *
 * ## ⚠️ This is NOT the CLI contract diverging — it is the two converging
 *
 * `packages/cli/src/utils/port-contract.ts` is often read as the precedent
 * *against* this, because its module header is emphatic that a door may not
 * narrow what boots. Read to the end of it: `parseRequestedPort` is
 * `if (!Number.isInteger(parsed)) return null;` and `strictPortReading` is
 * `Number.isInteger` behind `/^[+-]?\d+$/`. That module's width is about
 * **string spellings** — `3e3`, `0x0BB8`, `3000.0`, `3000abc`, `+3000`,
 * `08080` — every one of which `parseInt` reduces to an INTEGER before it is
 * ever range-checked. It governs how an operator may *spell* a port, never
 * whether a fractional one is admitted. On integrality the CLI has been strict
 * all along, in code. `smtp-port-contract.test.ts` holds that reading.
 */
export function isValidSmtpPort(port: number): boolean {
  return Number.isInteger(port) && port >= SMTP_PORT_MIN && port <= SMTP_PORT_MAX;
}

/**
 * The refusal for a port this transport will not connect on, naming the value
 * the caller actually supplied and the rule from the constants above.
 *
 * `raw` is the caller's ORIGINAL value, not the coerced number: an operator
 * who configured `"abc"` needs to see `abc`, not `NaN`.
 *
 * ⭐ **"an integer" is load-bearing, not decoration (#13189).** This sentence
 * used to read `(expected 1-65535)` while the guard admitted `587.5` — which
 * IS in 1-65535 — so the door stated a rule it did not enforce. Now that the
 * guard tests integrality, the sentence has to say so or the lie has merely
 * moved from the check to the message. The range itself stays GENERATED from
 * {@link SMTP_PORT_MIN} / {@link SMTP_PORT_MAX}: the word is prose about the
 * predicate, and ⛔ re-spelling either bound here would rebuild the exact
 * duplication #12993 deleted.
 */
export function formatInvalidSmtpPortNotice(raw: unknown): string {
  return `SmtpTransport: invalid port '${String(raw)}' (expected an integer ${SMTP_PORT_RANGE_TEXT})`;
}
