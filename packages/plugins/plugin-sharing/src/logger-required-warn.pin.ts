// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #10692 — compile-time pins for the REQUIRED `warn` channel on this package's
 * logger sinks, and for their members being real signatures rather than bare
 * `Function`.
 *
 * WHY A PIN AT ALL. A test that passes a full logger cannot tell a required
 * member from an optional one — every runtime suite in this package stays
 * green if some `warn:` quietly regresses to `warn?:` or to `Function`. The
 * contract IS the compile-time refusal of a `{ info, error }`-only host
 * logger (#9754: an optional `error` beside an optional `warn` is a contract
 * that permits silence; the maintainer ruled on 2026-08-25 that these
 * publicly exported types refuse it loudly instead of baselining it). So the
 * pin is the refusal itself: each `@ts-expect-error` below is red exactly
 * when the refusal stops happening.
 *
 * WHY A `.pin.ts` AND NOT A `*.test.ts`: this package's `tsconfig.json`
 * excludes `**\/*.test.ts` (measured TEST_DEBT), so a pin written in a test
 * file is read by NO tsc program the `typecheck` script runs — a phantom
 * check that stays green however the contract is broken. This file IS in the
 * program, is imported by nothing, and is never bundled (tsup entry is
 * `src/index.ts`), exactly like `exec-context-annotation.pin.ts`.
 *
 * ⚠️ SHAPE DISCIPLINE for this file: it deliberately declares NO interface,
 * no type-literal alias and no inline type literal carrying channel-named
 * members. `check:optional-error-sink`'s census reads exactly those three
 * node kinds, and a pin file must observe the population, never join it. The
 * sinks are named below through indexed-access and `Parameters<>` types only.
 *
 * The four pinned sinks:
 *   - `SharingServiceOptions['logger']`     (public, tightened by PR #11856)
 *   - `ShareLinkServiceOptions['logger']`   (public, tightened by PR #11856)
 *   - `SharingRuleServiceOptions['logger']` (public, tightened by PR #11856)
 *   - `sweepOrphanedRowsByRecordExistence`'s `logger` parameter
 *     (`record-orphan-cleanup.ts`'s module-local `MinimalLogger`, tightened
 *     by #10692 — the consumer that was blocked behind the three producers)
 */

import type { SharingServiceOptions } from './sharing-service.js';
import type { ShareLinkServiceOptions } from './share-link-service.js';
import type { SharingRuleServiceOptions } from './sharing-rule-service.js';
import type { sweepOrphanedRowsByRecordExistence } from './record-orphan-cleanup.js';

type SharingSink = NonNullable<SharingServiceOptions['logger']>;
type ShareLinkSink = NonNullable<ShareLinkServiceOptions['logger']>;
type RuleSink = NonNullable<SharingRuleServiceOptions['logger']>;
type SweepSink = NonNullable<Parameters<typeof sweepOrphanedRowsByRecordExistence>[3]>;

/**
 * Never called — every line below is a type-level assertion evaluated by
 * `tsc --noEmit`. `noop` and `anyCallable` exist only to give the literals
 * members to carry.
 */
export function __pinLoggerWarnIsRequiredAndReal(
  noop: (msg: any, ...rest: any[]) => void,
  anyCallable: Function,
): void {
  // ── NEGATIVE: a `{ info, error }`-only host logger must NOT compile. ─────
  // This is the break the changeset declares, pinned as a refusal. The three
  // producers declare `error?`, so the ONLY error each literal can produce is
  // the missing required `warn` (TS2741) — nothing else can satisfy the
  // directive. The sweep's sink declares no `error` member at all, so its
  // refusal literal spells only `info` (an `error` key would trip the
  // excess-property check instead and let a `warn?` regression hide).
  // @ts-expect-error 'warn' is required on SharingServiceOptions['logger'] (#9754/#10692)
  const sharingRefusesSilence: SharingSink = { info: noop, error: noop };
  // @ts-expect-error 'warn' is required on ShareLinkServiceOptions['logger'] (#9754/#10692)
  const shareLinkRefusesSilence: ShareLinkSink = { info: noop, error: noop };
  // @ts-expect-error 'warn' is required on SharingRuleServiceOptions['logger'] (#9754/#10692)
  const ruleRefusesSilence: RuleSink = { info: noop, error: noop };
  // @ts-expect-error 'warn' is required on the orphan sweep's logger (#10692)
  const sweepRefusesWarnless: SweepSink = { info: noop };

  // ── POSITIVE control: a bare `{ warn }` stub still compiles everywhere. ──
  // Keeps the negatives honest (the aliases resolve, the literals are not red
  // for some unrelated reason) and pins the documented promise that a minimal
  // test stub stays a legal host logger.
  const sharingAcceptsWarnOnly: SharingSink = { warn: noop };
  const shareLinkAcceptsWarnOnly: ShareLinkSink = { warn: noop };
  const ruleAcceptsWarnOnly: RuleSink = { warn: noop };
  const sweepAcceptsWarnOnly: SweepSink = { warn: noop };

  // ── NEGATIVE: bare `Function` no longer satisfies the members. ───────────
  // `Function` is assignable to a concrete signature in neither direction, so
  // this line is red exactly while the member carries a REAL signature — and
  // goes green (failing the directive) if anyone loosens it back to
  // `warn?: Function` or `warn: any` (#11069 taught the sink census to read
  // bare `Function`; the members must not regress to it).
  // @ts-expect-error a value of type Function does not satisfy SharingSink's real-signature 'warn'
  const sharingRefusesBareFunction: SharingSink = { warn: anyCallable };
  // @ts-expect-error a value of type Function does not satisfy SweepSink's real-signature 'warn'
  const sweepRefusesBareFunction: SweepSink = { warn: anyCallable };

  void sharingRefusesSilence;
  void shareLinkRefusesSilence;
  void ruleRefusesSilence;
  void sweepRefusesWarnless;
  void sharingAcceptsWarnOnly;
  void shareLinkAcceptsWarnOnly;
  void ruleAcceptsWarnOnly;
  void sweepAcceptsWarnOnly;
  void sharingRefusesBareFunction;
  void sweepRefusesBareFunction;
}
