// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * [#10629] Expected `refused a read on` noise: WITHHELD from the shared log,
 *          and ASSERTED instead — the shape PR #10630 landed, factored out
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ## The defect this closes
 *
 * A `@objectstack/runtime` fixture that provisions some objects and not others
 * makes the runtime probe the ones it did not provision. Several of those
 * probes are **fail-soft by construction** — they exist to answer "is this
 * installed?" and treat a missing table as "no":
 *
 *   * `resolveUserAuthzGrants` (`core/src/security/resolve-authz-context.ts`)
 *     `tryFind`s six `sys_*` tables per grant resolution — the resolver is
 *     fail-closed and must always resolve;
 *   * `ObjectQL.probeInstallOrganizations` (`objectql/src/engine.ts`) reads
 *     `sys_organization` and catches `isMissingTableError` **only**, which its
 *     own doc comment names as "the one benign cause";
 *   * `SeedLoaderService.resolveSoleOrganizationId`
 *     (`metadata-protocol/src/seed-loader.ts`) and
 *     `LifecycleService`'s governance snapshot read the same table best-effort;
 *   * `runBuildProbes` (`metadata-protocol/src/build-probes.ts`) reads the
 *     object a published view is bound to, and turns a failure into a
 *     `view_read_failed` publish issue rather than an exception;
 *   * the boot metadata load reads `sys_metadata` before anything created it.
 *
 * Each of those swallows the fault — but on the way out the driver and the
 * engine have each already logged it:
 *
 *   1. `[sql-driver] DATABASE_ERROR — the backend refused a read on '<table>'
 *      … no such table: <table>`, from `SqlDriver.backendStatementFault`
 *      through the driver's own `logger.warn`;
 *   2. `ERROR Find operation failed {"object":"<table>",…}` one frame up
 *      (`objectql/src/engine.ts`), carrying the same fault as a stack.
 *
 * Turbo interleaves package logs without attribution, so in the shared shard
 * log those are indistinguishable from a real failure. Not a hypothetical:
 * lines of exactly this shape were lifted VERBATIM into a p1 flake signature
 * (#10293) and sent a whole dispatch cycle at the wrong mechanism.
 * Expected-failure noise from a green test is a diagnosis tax on every future
 * red shard.
 *
 * ## ⛔ What this is NOT is a mute
 *
 * Silencing alone would make a fixture BLIND: if the probed read ever stopped
 * happening (the runtime dropped it) or started SUCCEEDING (someone
 * provisioned the table), the log would go quiet and NOTHING would notice — a
 * live pin quietly demoted to a decoration. So each sink here does two things
 * instead of one:
 *
 *   * it withholds ONLY the expected fault — the line must name one of the
 *     caller's declared tables AND carry that same table's `no such table`
 *     reason. Any other table, any other reason, any other level and any other
 *     logger method is forwarded untouched to the sink that would have
 *     received it;
 *   * it COUNTS what it withheld, per table and per channel, and the caller
 *     asserts those counts. A capture nobody asserts is a mute.
 *
 * ⚠️ [#11569] "Forwarded untouched" is NOT the same as "loud", and the two
 * channels differ on exactly that point. Measured, not inferred (pinned by
 * `expected-read-refusal-noise.channel-asymmetry.test.ts`):
 *
 *   * `captureDriver`'s pass-through calls `console.warn` / `console.error`
 *     DIRECTLY, so an unrecognised driver refusal reaches a reader whatever
 *     the kernel's log level is;
 *   * `captureEngine`'s pass-through calls the ENGINE'S OWN logger — the one
 *     the kernel built from its `logger` config and handed over by reference
 *     — so it inherits that logger's level. `ObjectLogger.write` returns
 *     early unless `error` is enabled, which it is not whenever the
 *     configured level ranks ABOVE `error` (`fatal`, `silent`).
 *
 * ⇒ So the engine channel's loudness is the CALLER'S, not this module's, and
 * it is not uniform across this capture's consumers: the ones that boot
 * `new ObjectKernel({ logger: { level: 'silent' } })` see an unrecognised
 * ENGINE frame nowhere at all, while the ones that leave the kernel at its
 * default (`info`) still see it. ⛔ Do not read the silent-fixture case as the
 * rule for all of them, and do not read a quiet engine channel in one fixture
 * as evidence about another.
 *
 * ⇒ Read the guarantee per channel: the DRIVER channel is pinned in both
 * directions (withheld-when-expected, loud-when-not); the ENGINE channel is
 * pinned in one (withheld-when-expected, counted, asserted) and is only as
 * loud as the fixture's own kernel logger in the other. The driver half of the
 * same fault stays loud, which is where this class of fault can still be
 * picked up.
 *
 * ⛔ The engine gate is deliberately the narrowest of the two: a frame is
 * withheld only when it sits directly above a driver refusal this capture
 * already recognised ({@link ExpectedReadRefusalCapture.pending}). A
 * `DATABASE_ERROR` on one of the same tables arising from any OTHER cause is
 * not recognised by the driver sink, so its frame is not withheld here either
 * — this capture never swallows it. Its DRIVER half reaches the log intact,
 * on the direct console sink above. Its ENGINE half is handed back to the
 * engine's own logger, so whether a reader sees it is that logger's decision
 * and not this module's — under `logger: { level: 'silent' }` it is dropped
 * (see the asymmetry note above, and {@link captureExpectedReadRefusals}'s
 * `captureEngine`).
 *
 * ⛔ Nothing here reads or relaxes a fixture's own assertions. This is the LOG
 * side-effect only — and "the log" means `console` on the driver channel and
 * the engine's own logger on the engine channel, which is the whole of the
 * asymmetry above.
 *
 * ## Why a shared module rather than a copy per fixture
 *
 * PR #10630 established this shape on two files and wrote it inline in each.
 * The enumerated remainder is sixteen more, across four distinct probe sites,
 * and sixteen copies of one predicate is sixteen places for it to drift —
 * including drifting *looser*, which is the direction that turns a pin back
 * into a mute without anything going red. The mechanism below is #10630's
 * verbatim: the same two sinks, the same "named table AND named reason"
 * predicate, the same pending-refusal gate on the engine frame, the same
 * count-and-assert discipline. Only the duplication is gone.
 *
 * ⛔ Test-only. Nothing in `src/index.ts` imports it, so it is not bundled
 * (tsup's single entry is `src/index.ts`); it carries no `vitest` import
 * either, so the assertions stay visible in the fixture that owns them.
 */

/** One channel's tally, keyed by the table the withheld line named. */
export type WithheldByTable = ReadonlyMap<string, number>;

/**
 * The driver logger shape this capture installs. It mirrors the default's
 * `{ warn, error }` so `SqlDriver.logDurabilityFailure` still finds an `error`
 * channel to prefer — a sink with only `warn` would silently re-level every
 * durability-degradation message this fixture is not talking about.
 */
interface DriverLoggerSink {
  warn: (msg: string, meta?: unknown) => void;
  error: (msg: string, meta?: unknown) => void;
}

export interface ExpectedReadRefusalCapture {
  /** Per-table count of driver refusal envelopes withheld. */
  readonly refusals: WithheldByTable;
  /** Per-table count of engine `Find operation failed` frames withheld. */
  readonly engineFrames: WithheldByTable;
  /** Total refusal envelopes withheld, across every declared table. */
  totalRefusals(): number;
  /** Total engine frames withheld, across every declared table. */
  totalEngineFrames(): number;
  /** The declared tables that were seen at least once on the driver channel. */
  tablesSeen(): string[];
  /**
   * The expected channels that never fired, one sentence each — the assertion
   * surface. `expect(capture.silentChannels()).toEqual([])` is one call that
   * still makes a silent channel NAME ITSELF in the diff, which is what
   * #10630's "one assertion per channel" bought at sixteen times the bulk.
   *
   * ⛔ Repairing a failure here means re-deriving the declared table list or
   * finding out why the probe stopped — NEVER relaxing this: a runtime read
   * that stopped happening is a finding, and a table that started resolving
   * means the fixture now provisions it.
   *
   * @param required the subset that must have fired. Defaults to every
   *   declared table. Narrow it for a table read on only SOME of a file's
   *   paths — requiring that one would turn a single-test `-t` run red without
   *   meaning anything, while still withholding it when it does fire.
   */
  silentChannels(required?: readonly string[]): string[];
  /**
   * Install the driver sink. ⛔ Call it BEFORE the driver runs any statement —
   * `logger` is a protected field with a `console` default, and this is the
   * idiom its own doc comment names ("Tests inject a spy") and that ~20 sibling
   * driver suites already use.
   */
  captureDriver(driver: unknown): void;
  /**
   * Wrap the engine's `error` channel through a Proxy, so every OTHER logger
   * method resolves to the engine's own. ⛔ Call it before the expected reads
   * happen; the engine's logger is a private field with no setter, which is
   * the same access `engine-readonly-when-parent.test.ts` established.
   *
   * ⚠️ [#11569] Its PASS-THROUGH is quieter than
   * {@link ExpectedReadRefusalCapture.captureDriver}'s: an unrecognised frame
   * goes to the engine's own logger and is dropped under a kernel configured
   * above `error`. The implementation carries the full note.
   */
  captureEngine(engine: unknown): void;
}

/**
 * Build a capture for the tables a fixture deliberately does not provision.
 *
 * @param tables the object/table names whose `no such table` read failures are
 *   EXPECTED here. Derive them by measurement rather than from the prober's
 *   source, so a read the fixture stops provoking shows up as a changed set
 *   rather than silently.
 */
export function captureExpectedReadRefusals(
  tables: readonly string[],
): ExpectedReadRefusalCapture {
  const refusals = new Map<string, number>();
  const engineFrames = new Map<string, number>();
  /** Recognised driver refusals not yet consumed by their engine frame. */
  const pending = new Map<string, number>();

  const bump = (into: Map<string, number>, table: string): void => {
    into.set(table, (into.get(table) ?? 0) + 1);
  };

  /**
   * The refusal envelope AND the dialect reason must name the SAME table.
   * Matching the envelope alone would withhold a refusal whose cause is a
   * permission denial, a dropped connection or a syntax fault — every one of
   * which is a real signal on a table this fixture merely also happens to miss.
   */
  const expectedRefusal = (line: string): string | undefined =>
    tables.find(
      (t) => line.includes(`refused a read on '${t}'`) && line.includes(`no such table: ${t}`),
    );

  const sum = (m: Map<string, number>): number => {
    let n = 0;
    for (const v of m.values()) n += v;
    return n;
  };

  return {
    refusals,
    engineFrames,
    totalRefusals: () => sum(refusals),
    totalEngineFrames: () => sum(engineFrames),
    tablesSeen: () => [...refusals.keys()].sort(),

    silentChannels(required: readonly string[] = tables): string[] {
      const out: string[] = [];
      for (const t of required) {
        if ((refusals.get(t) ?? 0) === 0) {
          out.push(`the driver's read refusal for '${t}' was never emitted`);
        }
        if ((engineFrames.get(t) ?? 0) === 0) {
          out.push(`the engine's 'Find operation failed' frame for '${t}' was never emitted`);
        }
      }
      return out;
    },

    captureDriver(driver: unknown): void {
      const sink: DriverLoggerSink = {
        warn: (msg: string, meta?: unknown): void => {
          const table = expectedRefusal(String(msg));
          if (table !== undefined) {
            bump(refusals, table);
            bump(pending, table);
            return;
          }
          console.warn(msg, meta ?? '');
        },
        error: (msg: string, meta?: unknown): void => {
          console.error(msg, meta ?? '');
        },
      };
      (driver as { logger: unknown }).logger = sink;
    },

    /**
     * ⚠️ [#11569] Where a NON-matching frame actually goes, and why it is not
     * the same place `captureDriver`'s goes.
     *
     * The fall-through below is `target.error(msg, err, meta)` — `target` is
     * the ENGINE'S OWN logger, i.e. the `ObjectLogger` the kernel built from
     * its `logger` config and handed to the engine by reference
     * (`core/src/kernel.ts` → `hostContext.logger`). So the pass-through
     * inherits that logger's level: `ObjectLogger.write` returns early unless
     * `error` is enabled, and it is not whenever the configured level ranks
     * above `error` — `fatal` or `silent`. Fixtures that boot with
     * `logger: { level: 'silent' }` therefore see an unrecognised engine frame
     * NOWHERE. `captureDriver`'s sink, by contrast, calls `console` directly
     * and is loud regardless. Both directions are pinned in
     * `expected-read-refusal-noise.channel-asymmetry.test.ts`.
     *
     * ⛔ Deliberately NOT "repaired" by pointing this branch at `console`:
     * that makes every consuming fixture — including two in another lane's
     * packages — newly loud on a channel they expect to be quiet, to recover a
     * diagnosis no test has yet been shown to have lost. Ruled a DOCUMENTED
     * limit rather than a defect (#11569); a loud-channel mechanism gets its
     * own card if an unrecognised engine frame ever actually costs one.
     *
     * ⛔ What this does NOT weaken: a RECOGNISED frame is still withheld here,
     * still counted per table, and still asserted through
     * {@link ExpectedReadRefusalCapture.silentChannels} — that half is a pin,
     * and the driver channel carrying the same fault stays loud in both
     * directions.
     */
    captureEngine(engine: unknown): void {
      const base = (engine as { logger: Record<string, any> }).logger;
      (engine as { logger: unknown }).logger = new Proxy(base, {
        get: (target: Record<string, any>, key: string) =>
          key === 'error'
            ? (msg: string, err?: unknown, meta?: unknown) => {
                const object = (meta as { object?: string } | undefined)?.object;
                const outstanding = object !== undefined ? (pending.get(object) ?? 0) : 0;
                const detail = String((err as { message?: string } | undefined)?.message ?? '');
                if (
                  msg === 'Find operation failed' &&
                  object !== undefined &&
                  outstanding > 0 &&
                  detail.includes(`refused to run this query for object '${object}'`)
                ) {
                  pending.set(object, outstanding - 1);
                  bump(engineFrames, object);
                  return;
                }
                target.error(msg, err, meta);
              }
            : target[key],
      });
    },
  };
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * [#10983] A SECOND, independent predicate: cross-field `{ $field }` refusal
 *          engine noise (#7929) — the sibling {@link captureExpectedReadRefusals}
 *          cannot recognise, because it has no table to key on
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ## Why this cannot reuse the table-keyed predicate above
 *
 * `captureExpectedReadRefusals` withholds an engine frame only when it sits
 * directly above a driver refusal ITS OWN `captureDriver` sink already
 * recognised ({@link pending} in that closure) — the engine frame alone never
 * carries enough identity to withhold safely, so the driver channel supplies
 * it via the caller's declared TABLE plus that table's `no such table` reason.
 *
 * A cross-field `{ $field }` refusal (#7929, `uncompilableFieldReferenceError`
 * in `driver-sql/src/sql-driver.ts`) never goes through that path at all: it is
 * a validation refusal raised while COMPILING the filter, not a backend
 * statement fault, so it never reaches `SqlDriver.backendStatementFault` and
 * there is no driver-channel line — and therefore no `pending` entry — for an
 * engine frame to sit above. There is no table involved either: the refusal is
 * about which FIELDS a filter compared, not which table was queried.
 *
 * ## What replaces the table: the engine frame's own message, measured
 *
 * Unlike the generic "no such table" case, THIS engine frame's `error.message`
 * already carries the refusal's own identity — so the message itself is the
 * correlation, and no driver-channel line is needed to supply it. Measured
 * directly off a real run of `cross-field-refusal-operand-withhold.test.ts`
 * (`--reporter=default`, the reporter this feature bypasses regardless — see
 * the file's own header): its 6 ERROR frames carry not one message shape but
 * TWO, both produced by `uncompilableFieldReferenceError` —
 *
 *   * the WITHHELD generic wording (4 of the 6): `"A cross-field comparison
 *     ({ \"$field\": … }) in this filter cannot be compiled here. …"`;
 *   * the [#8220] author-DISCLOSED wording (2 of the 6, from the one case in
 *     that file where the predicate is positively marked `'author'` and the
 *     driver restores the full diagnostic): `"Operator \"$gt\" on field
 *     \"amount\" compares against another field ({ \"$field\":
 *     \"secret_policy_column\" }), which cannot be compiled here: …"`.
 *
 * A predicate keyed on the withheld wording alone would silently miss the
 * disclosed half — 4 of 6 withheld and 2 loud is not "expected-noise
 * withholding", it is a partial mute with a passing assertion sitting on top
 * of it. Both strings share exactly two substrings and no third candidate
 * does: **`cannot be compiled here`** (verified by source grep to appear
 * NOWHERE else in `driver-sql/src/sql-driver.ts` — it is
 * `uncompilableFieldReferenceError`'s own wording and no other builder's) and
 * **`$field`** (present on every `{ $field }`-shaped refusal, cross-field
 * comparison or not). Requiring BOTH — mirroring the sibling predicate's
 * "table AND reason" pairing above — is what keeps a sibling `{ $field }`
 * family (`bareFieldReferenceError`'s "bare field reference … with no
 * operator", which contains `$field` but never "cannot be compiled here")
 * OUTSIDE the match: same operand syntax, different refusal, stays loud.
 *
 * ## ⛔ Still not a mute: the counting dimension moves, the discipline does not
 *
 * There is no driver-channel table to count against, so what is counted
 * changes from "per table, across two correlated channels" to "per OBJECT,
 * on the one channel that exists" — the engine frame's own `object` meta,
 * scoped to the caller's declared list exactly as the table list scopes the
 * sibling predicate. What does NOT change: a frame is withheld only on an
 * exact identity match (declared object AND both message markers), the
 * withholding is COUNTED per object, and the caller MUST assert those counts
 * ({@link ExpectedCrossFieldRefusalCapture.silentChannels}) — a capture
 * nobody asserts is a mute, whichever dimension it counts by.
 *
 * ⛔ Test-only, same reason as above: not exported from `src/index.ts`.
 */

export interface ExpectedCrossFieldRefusalCapture {
  /** Per-object count of engine `Find operation failed` frames withheld. */
  readonly frames: WithheldByTable;
  /** Total engine frames withheld, across every declared object. */
  totalFrames(): number;
  /** The declared objects that were seen at least once. */
  objectsSeen(): string[];
  /**
   * The declared objects whose expected cross-field frame never fired — the
   * assertion surface, mirroring
   * {@link ExpectedReadRefusalCapture.silentChannels}. ⛔ Repairing a failure
   * here means finding out why the refusal stopped firing (or reproducing on
   * a new message shape this predicate has not been taught) — NEVER loosening
   * the match in {@link captureExpectedCrossFieldRefusalNoise} to make it pass.
   *
   * @param required the subset that must have fired. Defaults to every
   *   declared object.
   */
  silentChannels(required?: readonly string[]): string[];
  /**
   * Install the engine sink. Same access pattern and same call-before-reads
   * discipline as {@link ExpectedReadRefusalCapture.captureEngine} — the
   * engine's logger is a private field with no setter.
   */
  captureEngine(engine: unknown): void;
}

/**
 * Build a capture for the cross-field `{ $field }` refusal family (#7929) on
 * a fixture's declared objects.
 *
 * @param objects the object names whose cross-field `{ $field }` refusals are
 *   EXPECTED here. Derive them by measurement (as the file header does)
 *   rather than assumption, so an object this predicate was not told about
 *   stays loud rather than silently swallowed.
 */
export function captureExpectedCrossFieldRefusalNoise(
  objects: readonly string[],
): ExpectedCrossFieldRefusalCapture {
  const frames = new Map<string, number>();

  const bump = (object: string): void => {
    frames.set(object, (frames.get(object) ?? 0) + 1);
  };

  const sum = (): number => {
    let n = 0;
    for (const v of frames.values()) n += v;
    return n;
  };

  /**
   * Both markers must be present — see the docblock above for why each one
   * alone is either not unique enough (`$field` alone also matches
   * `bareFieldReferenceError`) or, on its own, unverified against a message
   * shape this predicate has never seen.
   */
  const isExpectedCrossFieldRefusal = (detail: string): boolean =>
    detail.includes('cannot be compiled here') && detail.includes('$field');

  return {
    frames,
    totalFrames: () => sum(),
    objectsSeen: () => [...frames.keys()].sort(),

    silentChannels(required: readonly string[] = objects): string[] {
      const out: string[] = [];
      for (const o of required) {
        if ((frames.get(o) ?? 0) === 0) {
          out.push(
            `the engine's 'Find operation failed' frame for the cross-field refusal on '${o}' was never emitted`,
          );
        }
      }
      return out;
    },

    captureEngine(engine: unknown): void {
      const base = (engine as { logger: Record<string, any> }).logger;
      (engine as { logger: unknown }).logger = new Proxy(base, {
        get: (target: Record<string, any>, key: string) =>
          key === 'error'
            ? (msg: string, err?: unknown, meta?: unknown) => {
                const object = (meta as { object?: string } | undefined)?.object;
                const detail = String((err as { message?: string } | undefined)?.message ?? '');
                if (
                  msg === 'Find operation failed' &&
                  object !== undefined &&
                  objects.includes(object) &&
                  isExpectedCrossFieldRefusal(detail)
                ) {
                  bump(object);
                  return;
                }
                target.error(msg, err, meta);
              }
            : target[key],
      });
    },
  };
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * [#11571] ⛔ There is deliberately NO third, console-level predicate — the
 *          kernel's ERROR frames never pass through `console` under Node
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ## The case that asked for one
 *
 * Three memory-driver fixtures in `@objectstack/trigger-record-change`
 * (`bulk-write-per-row-context`, `formula-context`, `multilookup-context`)
 * boot a kernel with no datasource, so every boot-time fail-soft read refuses.
 * Measured on this branch by floating each fixture to `level: 'info'`, their
 * ENTIRE ERROR surface is one invariant trio, repeated once per boot:
 *
 *   | fixture                      | ERROR frames  | distinct messages |
 *   |------------------------------|---------------|-------------------|
 *   | `bulk-write-per-row-context` | 15 (5 boots)  | 3                 |
 *   | `formula-context`            |  3 (1 boot)   | 3                 |
 *   | `multilookup-context`        |  3 (1 boot)   | 3                 |
 *
 *   1. `sys_metadata could NOT be read at boot …` (`objectql/src/plugin.ts`);
 *   2. `[wait] suspended wait-timer re-arm ABORTED …`
 *      (`service-automation/src/builtin/wait-node.ts`);
 *   3. `[Automation] sys_automation_run could not be read at startup …`
 *      (`service-automation/src/plugin.ts`).
 *
 * Neither predicate above can reach them: with no SqlDriver there is no
 * `refused a read on '<table>'` line — so no `pending` entry for the engine
 * gate to sit above — and no `Find operation failed` frame at all. Those three
 * fixtures therefore KEEP the blanket `logger: { level: 'silent' }` that the
 * two SqlDriver-backed fixtures were able to drop.
 *
 * ## Why the obvious third mechanism does not exist
 *
 * The proposal was a console-level capture: patch `console.error`/`console.warn`
 * for the file and float the kernel to `level: 'error'` so INFO/WARN stay
 * suppressed. **Measured: it captures ZERO of the 21 frames.**
 * `ObjectLogger.write` (`core/src/logger.ts`) prefers the process streams and
 * reaches console only as a fallback:
 *
 *     if (stream) {              // process.stderr for error/fatal
 *         stream.write(line + '\n');
 *     } else if (typeof console !== 'undefined') {
 *         … console.error …     // browsers / bundler shims ONLY
 *     }
 *
 * Under vitest's `environment: 'node'`, `process.stderr` always exists, so the
 * `console` arm is unreachable there. A probe booting this exact plugin stack
 * at `level: 'error'` with all four sinks counted scored `console.error: 0,
 * console.warn: 0, process.stderr.write: 3, process.stdout.write: 0`.
 *
 * ⇒ The only variant that DOES intercept them patches `process.stderr.write`,
 * and it is refused here as disproportionate rather than as unworkable. Both
 * predicates above patch an OBJECT seam (`driver.logger`, `engine.logger`)
 * whose blast radius is one instance the fixture itself owns; a stream patch
 * is process-global and sits in the path of everything the worker writes —
 * the reporter's own diagnostics included — for as long as it is installed.
 * Twenty-one invariant per-boot frames that carry no per-test signal do not
 * buy a third capture mechanism of that reach. #11569 — this module's engine
 * pass-through lands in the engine's own logger, and is therefore dropped
 * under exactly the `level: 'silent'` fixtures this section is about — was
 * ruled a DOCUMENTED limit of the two mechanisms above rather than a repair to
 * make (see the file header), so it is one more reason not to stack a third
 * on top of them, and not a repair this section is waiting on.
 *
 * ⛔ Nor is the repair a predicate pointed at `kernel.logger`: the kernel takes
 * a logger CONFIG, builds its own and hands it to the plugin loader and the
 * service context BY REFERENCE (`core/src/kernel.ts`), so a post-construction
 * swap propagates only partially. That yields a capture which misses frames
 * while asserting it does not — the exact inversion this module exists to
 * prevent, and strictly worse than the honest silence of a blanket mute.
 */
