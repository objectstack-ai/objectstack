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
 *     logger method is forwarded to the real console untouched;
 *   * it COUNTS what it withheld, per table and per channel, and the caller
 *     asserts those counts. A capture nobody asserts is a mute.
 *
 * ⛔ The engine gate is deliberately the narrowest of the two: a frame is
 * withheld only when it sits directly above a driver refusal this capture
 * already recognised ({@link ExpectedReadRefusalCapture.pending}). A
 * `DATABASE_ERROR` on one of the same tables arising from any OTHER cause is
 * not recognised by the driver sink, so its frame is not withheld here either
 * — it reaches the log with both halves intact.
 *
 * ⛔ Nothing here reads or relaxes a fixture's own assertions. This is the
 * console side-effect only.
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
