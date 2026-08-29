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
 * Is `port` inside the range this transport will connect on?
 *
 * ⚠️ This is the enforcement `smtp.ts` already had, moved and NOT narrowed.
 * The accept set is unchanged in both directions, deliberately: a refactor
 * that quietly rejected a value which worked yesterday would be a behaviour
 * change wearing a cleanup's clothes. In particular a **non-integer** inside
 * the range (`587.5`) is accepted here exactly as it was before, and is
 * refused later by `net.connect` under an internal name — filed separately
 * rather than repaired here, because that is an accept-set defect and this
 * card is about the duplication.
 */
export function isValidSmtpPort(port: number): boolean {
  return Number.isFinite(port) && port >= SMTP_PORT_MIN && port <= SMTP_PORT_MAX;
}

/**
 * The refusal for a port outside the range, naming the value the caller
 * actually supplied and the range from the constants above.
 *
 * `raw` is the caller's ORIGINAL value, not the coerced number: an operator
 * who configured `"abc"` needs to see `abc`, not `NaN`.
 */
export function formatInvalidSmtpPortNotice(raw: unknown): string {
  return `SmtpTransport: invalid port '${String(raw)}' (expected ${SMTP_PORT_RANGE_TEXT})`;
}
