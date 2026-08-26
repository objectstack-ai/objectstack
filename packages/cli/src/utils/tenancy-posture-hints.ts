// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The one-line posture descriptions `os serve` and `os doctor` BOTH put in front
 * of an operator, declared ONCE (#12492).
 *
 * ── What this closes ──────────────────────────────────────────────────────
 *
 * `serve.ts` and `doctor.ts` each carried their own `TENANCY_POSTURE_FIX_HINTS`
 * table, and the two tables were byte-identical (modulo the expression that
 * spells the package name) under no cross-check of any kind. `isolated` at
 * least carried a package literal the spec-owned roster could be pinned against
 * (#12464 / PR #12496); `single` and `group` touch no roster, so there was
 * nothing anywhere that could ever have noticed those two drift apart — reword
 * one command's copy and every gate stays green while the two commands describe
 * the same posture differently to the same operator.
 *
 * ⭐ The two UNCOVERED entries were the worse half, which is why all three moved
 * here together. Single-sourcing only `isolated` would have closed the half that
 * was already covered and left the other two exactly as silent as before.
 *
 * ── Why this is CLI-INTERNAL and not `packages/spec` ─────────────────────
 *
 * `packages/spec` owns the posture VOCABULARY (`TENANCY_POSTURES`,
 * `TenancyPosture`) and these hints are keyed by it. The prose is not part of
 * that contract: it is operator advice, in the imperative voice of a terminal,
 * read by exactly two CLI commands and by nothing else. That was measured
 * rather than assumed before this module was placed here — no reader outside
 * `packages/cli` consumes any of the three strings (the near hits are a comment
 * in `plugin-auth` that happens to phrase `group` similarly, and ADR-0105's own
 * different sentence about a shared database).
 *
 * Publishing it from `packages/spec` instead would widen public surface to buy
 * nothing: it would export operator prose to every consumer of the protocol
 * contract, and the drift this closes is entirely internal to two files that
 * sit three directories apart. A posture declared in the spec but not described
 * here is still listed by both commands — bare, without prose — rather than
 * silently dropped, so the vocabulary stays the authority and this table stays
 * an optional gloss on it. The advice can go terse; it can never go stale.
 *
 * ── What is shared here, and what deliberately is not ────────────────────
 *
 * Only the TABLE. Each command keeps its own bullet assembly, because the two
 * renderings genuinely differ and always did: doctor emits
 * `        • OS_TENANCY_POSTURE=<p> — <hint>` inside a health-check `fix`, serve
 * emits `      • set OS_TENANCY_POSTURE=<p> — <hint>` inside a FATAL refusal, at
 * different indents. Hoisting those too would force one of the two messages to
 * change shape, and this change is a refactor with byte-identical output.
 *
 * ⛔ Do not add rendering, chalk, or posture POLICY here. What loads the
 * multi-org runtime, and what each failure stage means, stay where they are.
 */

/**
 * The `plugins[]`-wired multi-org runtime both commands NAME in their posture
 * advice, spelled once (#11614 → #12464 → #12492).
 *
 * ⚠️ This is now the SECOND declaration of the literal, down from three, and the
 * remaining duplicate is load-bearing: the other is the KEY of the spec-owned
 * `PLATFORM_PLUGIN_WIRED_RUNTIMES` roster, and the roster cannot supply the
 * name. It is keyed BY package name and its row type `PlatformPluginWiredRuntime`
 * carries no `package` field — deliberately, so the name "cannot be `null` and
 * cannot drift from a duplicate field" — and its own header records that it is
 * "not a resolution registry". Both organization rows are `edition: 'enterprise'`,
 * so nothing machine-readable selects this one. The roster VALIDATES a name you
 * already hold; it does not hand you one. That is why the pins over this value
 * read it as a roster KEY CHECK, the only first-class read the roster offers.
 *
 * `Serve.ORGANIZATIONS_RUNTIME_PKG` is no longer a third declaration — it reads
 * this one. It stays a static because `serve`'s boot path and two sibling pins
 * (`serve-capability-vocabulary.test.ts`, `serve-cluster-host-resolution.test.ts`)
 * address it there, and because a command's own resolution seam is a reasonable
 * thing for that command to expose. `doctor.ts` no longer declares it at all:
 * the const #12464 added carried its deletion condition in its own docblock,
 * naming this card, and that condition is met here. Doctor reads this module
 * rather than `serve.ts` — the coupling that const's docblock ⛔ ruled out was a
 * diagnostic command depending on a `serve` command's export, not on a neutral
 * utility both commands sit above.
 */
export const ORGANIZATIONS_RUNTIME_PKG = '@objectstack/organizations';

/**
 * One-line descriptions of the accepted postures, keyed by the vocabulary
 * `@objectstack/spec/security` owns.
 *
 * A posture declared there but not described here is still listed by both
 * commands (bare, without prose) rather than silently dropped — both call sites
 * read this table with an optional-hint guard, and that is contract, not
 * defensiveness.
 *
 * ⚠️ Reword an entry here and BOTH commands change together. That is the point,
 * and it is what the rendered pins in `serve-organizations-message-spelling.test.ts`
 * and `doctor-organizations-message-spelling.test.ts` measure: those two files
 * hold hard-coded expectations of this prose, so a reword here reddens a pin on
 * each command from one edit. If only one ever reddened, the table would be
 * shared in name only.
 */
export const TENANCY_POSTURE_FIX_HINTS: Readonly<Record<string, string>> = {
  single: 'one organization, no organization wall — the default',
  group: 'organization wall enforced by the open engine, one shared database',
  isolated:
    `organization wall + the enterprise ${ORGANIZATIONS_RUNTIME_PKG} runtime `
    + "(the legacy spelling 'multi' is accepted and normalizes to this)",
};
