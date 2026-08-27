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
 * What moved is the TABLE — and, since #12579, the package name the `isolated`
 * sentence interpolates moved with it. It is declared once, at the const below,
 * and `serve.ts`'s `Serve.ORGANIZATIONS_RUNTIME_PKG` is assigned from it. Read
 * that const's docblock before touching either end.
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
 * advice — and, since #12579, the one place that package is spelled at all
 * inside `packages/cli` (#11614 → #12464 → #12492 → #12579).
 *
 * ⚠️ Since #12579 this is the ONLY declaration of the spelling inside
 * `packages/cli`. `serve.ts` no longer holds a second literal: its
 * `Serve.ORGANIZATIONS_RUNTIME_PKG` is assigned from this const, keeping the
 * NAME the roster pins address while the spelling lives here. ⛔ That is not a
 * reason to move this declaration somewhere more central — it sits in a module
 * NEITHER command owns for the reason the ⛔ below states.
 *
 * It was a duplicate until then, and the reason it HAD to be one is dead rather
 * than forgotten: the host-anchoring sweep in
 * `serve-cluster-host-resolution.test.ts` resolved the organizations load site
 * through that static to a LITERAL IN THAT FILE, so rewriting the static as a
 * re-export of this const stopped the specifier resolving and dropped that load
 * OUT of the sweep instead of failing inside it (#11614's silent-vacuity mode;
 * #12492 tried it and the sweep's named vacuity guard refused it, by name).
 * ⭐ That reason died at `1ca763b60` (#12533, PR #12582): the sweep now follows
 * an import alias into a sibling module of the same package, and it pins that
 * hop against THIS FILE by name. The full reading lives on
 * `Serve.ORGANIZATIONS_RUNTIME_PKG`; ⛔ do not restate it here — it is one
 * reason, and #12579 exists because it had four copies.
 *
 * ⭐ So: one declaration, and the pins that used to hold two copies equal are
 * now pins over this one —
 *
 *   · it is a key of the spec-owned `PLATFORM_PLUGIN_WIRED_RUNTIMES`
 *     (`doctor-organizations-message-spelling.test.ts`, leg (ii)).
 *   · the same value read as `Serve.ORGANIZATIONS_RUNTIME_PKG` is pinned as a
 *     key of that roster again (`test/serve-capability-vocabulary.test.ts`), and
 *     is what every operator-facing `os serve` message renders
 *     (`serve-organizations-message-spelling.test.ts`).
 *   · the equality assertion that kept the duplication CHECKED — site 8 of that
 *     file — retired WITH its subject, in the same diff.
 *
 * ⛔ Ending the duplication was a maintainer-facing call rather than a refactor,
 * because PR #12532 shipped it deliberately with the reasoning at both ends. It
 * was ruled on 2026-08-27 (#12579, Option A: single-source the spelling here,
 * the static keeps its NAME) and taken in one diff.
 *
 * ⛔ Do NOT close the gap by importing `Serve.ORGANIZATIONS_RUNTIME_PKG` here
 * instead: this module is read by `os doctor`, and a diagnostic command taking a
 * dependency on a `serve` command's export in order to spell a package name is
 * a worse coupling than the duplication it removes (#12464's ruling, unchanged).
 *
 * ── Why neither copy can read the name from the spec roster ──────────────
 *
 * Because the roster cannot supply it. `PLATFORM_PLUGIN_WIRED_RUNTIMES` is keyed
 * BY package name and its row type `PlatformPluginWiredRuntime` carries no
 * `package` field — deliberately, so the name "cannot be `null` and cannot drift
 * from a duplicate field" — and its own header records that it is "not a
 * resolution registry". Both organization rows are `edition: 'enterprise'`, so
 * nothing machine-readable selects this one. The roster VALIDATES a name you
 * already hold; it does not hand you one. That is why every pin over this value
 * reads it as a roster KEY CHECK, the only first-class read the roster offers.
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
