// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import {
  ExternalSchemaMismatchError,
  type SchemaDiffEntry,
} from '@objectstack/spec/shared';

/**
 * Structural subset of `SchemaValidationReport` — the shape both the sweep and
 * its scoped twin answer with.
 */
interface SchemaValidationReportLike {
  ok: boolean;
  results: Array<{ ok: boolean; datasource: string; object: string; diffs: SchemaDiffEntry[] }>;
}

/**
 * Structural subset of `IExternalDatasourceService` used here, to avoid a hard
 * dependency on the service package from runtime.
 */
interface ExternalDatasourceServiceLike {
  /**
   * The whole-farm sweep. Used by the BOOT gate ({@link
   * ExternalValidationPlugin.runValidation}), whose subject genuinely is every
   * federated object in the environment — see `announceAllClear` for the one
   * claim that scope entitles it to make.
   */
  validateAll(): Promise<SchemaValidationReportLike>;
  /**
   * [#10961] The scoped twin: validate the federated objects bound to ONE
   * datasource, driving live introspection against THAT datasource only.
   *
   * OPTIONAL, and probed rather than assumed, because it is deliberately not on
   * `IExternalDatasourceService` — #10537's triage authorized the service-side
   * composition, not a contract-surface expansion, and #10961's triage carried
   * that ruling forward unchanged. What is asserted here rather than
   * contract-checked is the method's NAME; nothing about the shape it returns,
   * which is the report type both spellings already share.
   *
   * See {@link ExternalValidationPlugin.runDriftCheck} for what its absence
   * does — and, more importantly, for what it deliberately does not do.
   */
  validateDatasource?(datasource: string): Promise<SchemaValidationReportLike>;
}

interface MetadataServiceLike {
  get?: (type: string, name: string) => Promise<unknown>;
  list?: (type: string) => Promise<unknown[]>;
  /**
   * [#6504] The plural ADR-0110 D3 verdict — "could this listing be trusted as
   * complete?". Optional exactly as on `IMetadataService`: a service predating
   * it cannot report the distinction, and a service without it reports nothing
   * degraded, which is precisely what it could express.
   */
  listDiagnosed?: (
    type: string,
  ) => Promise<{ items: unknown[]; degraded: boolean; errors: string[] }>;
}

/**
 * [#6504] Report the boot gate's all-clear — WITHOUT claiming universality over
 * a set that may have been read short.
 *
 * ## The consumer's classification: mis-describing
 *
 * `validateAll()` sweeps `listObjects()` and filters it down to the federated
 * objects. That listing goes silently short while a metadata loader is down
 * (ADR-0110 D3), and this gate then makes two statements over the survivors:
 * the sentence *all federated objects match their remote schema*, and the
 * number `objects: N`. Both are positive claims about the ENVIRONMENT taken
 * from a set nobody established was complete — the card's exact shape, one
 * layer up from a `totalCount`. The federated objects held by an unreadable
 * loader were never validated, and ADR-0015 §5.2's `onMismatch: 'fail'` gate
 * therefore could not have fired for them: an outage silently narrows the gate
 * and then announces a clean sweep.
 *
 * ## What changes, and what deliberately does not
 *
 * Only the CLAIM. The gate still validates and still refuses on every mismatch
 * it found — a degraded read is a reason to withhold a completeness statement,
 * never a reason to withhold the work, and never (see below) a reason to invent
 * a failure.
 *
 * ⛔ It does **not** turn a degraded metadata read into a boot abort. That
 * would convert a transient dependency outage into a refusal to start, which is
 * a new functional failure mode bought with a diagnosis fix — the opposite of
 * what #6504 is. The operator gets a `warn` naming the outage and the fact that
 * the sweep was narrower than the environment, at the level AGENTS.md's
 * degradation table asks for: the condition is visible and self-heals on the
 * next boot after the loader does.
 *
 * The verdict is asked of the metadata service DIRECTLY rather than threaded
 * through `SchemaValidationReport`, for two reasons. The plain one: that report
 * is declared in `packages/spec`, whose surface this card does not own. The
 * better one: the question is about the object listing, and the metadata
 * service is where the answer lives — routing it through a second contract
 * would add a member every implementer must remember to fill in, to relay a
 * fact the authority can already be asked for.
 *
 * A verdict probe that THROWS must not turn a successful validation sweep into
 * a failure, so it is reported as "could not be determined" — never flattened
 * into a completeness claim this code did not earn.
 */
async function announceAllClear(
  ctx: PluginContext,
  metadata: MetadataServiceLike | undefined,
  validated: number,
): Promise<void> {
  if (typeof metadata?.listDiagnosed !== 'function') {
    ctx.logger?.info?.('[external-validation] all federated objects match their remote schema', {
      objects: validated,
    });
    return;
  }

  let degraded = false;
  let errors: string[] = [];
  try {
    const diagnosed = await metadata.listDiagnosed('object');
    degraded = diagnosed?.degraded === true;
    errors = Array.isArray(diagnosed?.errors) ? diagnosed.errors : [];
  } catch (err) {
    ctx.logger?.warn?.(
      '[external-validation] validated every federated object it could see, but whether that set was '
        + 'COMPLETE could not be determined — the metadata service\'s diagnosed read failed. Treat this '
        + 'boot as unverified for federated objects held by loaders that may have been unreachable.',
      { validated, err },
    );
    return;
  }

  if (!degraded) {
    ctx.logger?.info?.('[external-validation] all federated objects match their remote schema', {
      objects: validated,
    });
    return;
  }

  ctx.logger?.warn?.(
    '[external-validation] schema validation swept an INCOMPLETE object set — the metadata service '
      + 'could not be fully read, so federated objects held by the unreachable loader(s) were never '
      + 'validated and the onMismatch gate could not have fired for them. Every object that WAS read '
      + `matches its remote schema (${validated} validated); this is not an all-clear for the `
      + 'environment. Fix: check the loaders behind the metadata service (datasource connection, '
      + 'credentials, table), then restart to re-run the gate.',
    { validated, errors },
  );
}

interface DatasourceDef {
  name?: string;
  schemaMode?: string;
  external?: {
    validation?: {
      onMismatch?: 'fail' | 'warn' | 'ignore';
      /**
       * [#13037] The BOOT gate's per-datasource opt-out — read by
       * {@link bootCheckEnabled}, and by nothing else on purpose. The scope
       * boundary the maintainer pinned when ruling this key ENFORCED (rather
       * than retired) is stated at that function.
       */
      checkOnBoot?: boolean;
      checkIntervalMs?: number;
    };
  };
}

/**
 * Payload of the `external.schema.drift` event emitted on the kernel bus by the
 * background drift checker (ADR-0015 §5.2). Consumed by `audit` / `notification`
 * services. One event per drifted federated object.
 */
export interface ExternalSchemaDriftEvent {
  datasource: string;
  object: string;
  diffs: SchemaDiffEntry[];
}

/**
 * Boot-validation plugin — Gate 2 of ADR-0015 §5.2.
 *
 * On `kernel:ready`, validates every federated object against its remote table
 * (via the `external-datasource` service) and applies the datasource's
 * `external.validation.onMismatch` policy:
 *   - `fail`   → throws `ExternalSchemaMismatchError` (aborts boot) — default,
 *   - `warn`   → logs the diff and continues,
 *   - `ignore` → does nothing.
 *
 * [#13037] A datasource that sets `external.validation.checkOnBoot: false` is
 * skipped by this sweep entirely — no policy is applied to its rows, so no
 * mismatch on it can abort boot. Its BACKGROUND drift checking is a separate
 * policy and is unaffected; see {@link bootCheckEnabled} for the scope the
 * maintainer pinned.
 *
 * `onMismatch` governs MEASURED mismatches only. A row whose diffs are
 * `kind: 'unreachable'` (the remote could not be read, so validation was
 * indeterminate — see the kind's docblock in `@objectstack/spec/shared`) never
 * feeds that policy: it is logged loudly and boot continues, under every
 * `onMismatch` value (maintainer ruling 2026-08-23, #11166).
 *
 * No-op when the `external-datasource` service is not registered (federation
 * unused).
 */
export class ExternalValidationPlugin implements Plugin {
  name = 'com.objectstack.external-validation';
  type = 'standard';
  version = '1.0.0';

  /** Active background drift-check timers, keyed by datasource name. */
  private driftTimers = new Map<string, ReturnType<typeof setInterval>>();

  init = (_ctx: PluginContext): void => {
    // Nothing to register; validation runs on kernel:ready (see start()).
  };

  start = (ctx: PluginContext): void => {
    // Subscribe to kernel-ready so validation runs after every plugin (drivers,
    // services, manifests) has been registered.
    ctx.hook('kernel:ready', async () => {
      await this.runValidation(ctx);
      // Boot validation done; arm any background drift checks (ADR-0015 §5.2).
      await this.scheduleDriftChecks(ctx);
    });
  };

  /**
   * Tear down background drift-check timers (idempotent) — the kernel's ONLY
   * teardown hook.
   *
   * [#10772] This body used to be spelled `stop()`. `Plugin`
   * (`@objectstack/core`'s `types.ts`) declares `init()`, `start?(ctx)` and
   * `destroy?()` and no `stop()`, and `ObjectKernel.performShutdown()` /
   * `LiteKernel.destroy()` walk the plugins in reverse calling
   * `plugin.destroy()`. Nothing in the tree ever called `stop()` on a plugin,
   * and this class's own only caller was `scheduleDriftChecks()` re-arming
   * itself — so every armed `setInterval` below was STILL ARMED after
   * `await kernel.shutdown()` had RESOLVED. That is #9371's mechanism
   * verbatim, and this plugin is one of only two `Plugin` implementations in
   * the tree that own `setInterval` at all (`ReportsServicePlugin` is the
   * other, repaired under #10371).
   *
   * The timers are `unref`'d, so a long-lived host process still exits and
   * nothing complains in production — the bill lands in a vitest worker, which
   * is alive throughout teardown.
   *
   * Stays SYNCHRONOUS on purpose: `stop()` was `(): void`, and widening a
   * public alias to `Promise<void>` would change what an embedder's
   * non-awaiting call site does.
   */
  destroy = (): void => {
    for (const timer of this.driftTimers.values()) clearInterval(timer);
    this.driftTimers.clear();
  };

  /**
   * Retained alias for {@link destroy}. Kept because it is public API of an
   * exported class: an embedder may have learned to call it directly precisely
   * BECAUSE the kernel never did, and deleting it would break them. Still an
   * arrow property returning `void`, so both a detached
   * `const { stop } = plugin` call and a non-awaiting call site keep working
   * unchanged.
   */
  stop = (): void => {
    this.destroy();
  };

  /** Exposed for testing; invoked from the kernel:ready handler. */
  async runValidation(ctx: PluginContext): Promise<void> {
    const svc = safeGet<ExternalDatasourceServiceLike>(ctx, 'external-datasource');
    if (!svc?.validateAll) {
      ctx.logger?.debug?.('[external-validation] service not registered; skipping');
      return;
    }

    const metadata = safeGet<MetadataServiceLike>(ctx, 'metadata');
    // [#13037] One definition read per datasource per sweep, shared by the
    // `checkOnBoot` gate below and the `onMismatch` resolution after it.
    const loadDef = createDatasourceDefLoader(metadata);
    let report: Awaited<ReturnType<ExternalDatasourceServiceLike['validateAll']>>;
    try {
      report = await svc.validateAll();
    } catch (err) {
      ctx.logger?.warn?.('[external-validation] validateAll failed', { err });
      return;
    }

    // [#13037] Honour each datasource's `external.validation.checkOnBoot`
    // BEFORE any verdict is drawn from its rows. The sweep is whole-farm and
    // the key is per-datasource, so the opt-out can only be applied here, row
    // by row — a datasource that set `false` is dropped, and every other
    // datasource in the same boot is judged exactly as it was before.
    // ⭐ Boot step only: `scheduleDriftChecks()` below is untouched by this.
    const gated: SchemaValidationReportLike['results'] = [];
    const skipped = new Set<string>();
    for (const r of report.results) {
      if (await bootCheckEnabled(loadDef, r.datasource)) gated.push(r);
      else skipped.add(r.datasource);
    }
    if (skipped.size > 0) {
      ctx.logger?.info?.(
        '[external-validation] boot schema validation SKIPPED for datasource(s) that set '
          + '`external.validation.checkOnBoot: false` — their federated objects were NOT gated at '
          + 'boot, and no mismatch on them can abort startup. Any verdict logged below covers the '
          + 'REMAINING datasources only. Background drift checking is a separate policy '
          + '(`external.validation.checkIntervalMs`) and is unaffected.',
        {
          datasources: [...skipped].sort(),
          objectsSkipped: report.results.length - gated.length,
        },
      );
    }

    const failures = gated.filter((r) => !r.ok);
    if (failures.length === 0) {
      // [#6504] The all-clear is a UNIVERSAL claim, and this gate has no way to
      // make one when the object set it swept was itself known-partial. See
      // `announceAllClear`.
      await announceAllClear(ctx, metadata, gated.length);
      return;
    }

    for (const r of failures) {
      // [#11166] An `unreachable` row is NOT a schema mismatch — the remote
      // (or the object's own definition) could not be read, so validation was
      // indeterminate and there is no measured fact to gate on. Maintainer
      // ruling 2026-08-23: no `onMismatch: 'fail'` abort for unreachable —
      // loud logging instead. The log is deliberately OUTSIDE the `onMismatch`
      // resolution: that policy governs how a measured mismatch is handled,
      // and an outage is a different condition — even an `ignore` datasource's
      // operator is told their boot ran unverified. `warn`, not `error`, per
      // AGENTS.md's degradation table: this is a functional degradation (a
      // check did not run, and says so) — nothing claims to have persisted.
      const unreachable = r.diffs.filter((d) => d.kind === 'unreachable');
      const schemaDiffs = r.diffs.filter((d) => d.kind !== 'unreachable');
      if (unreachable.length > 0) {
        ctx.logger?.warn?.(
          '[external-validation] federated object could not be validated — the remote (or the '
            + 'object definition) could not be read, so its schema is UNVERIFIED for this boot: no '
            + 'mismatch abort applies because no mismatch was measured, and boot continues. The '
            + 'remote table may be perfectly intact; do not "repair" a schema nobody has seen. Fix: '
            + 'check the datasource connection/credentials, then re-run validation (restart, '
            + '`os datasource validate`, or the background drift check).',
          {
            datasource: r.datasource,
            object: r.object,
            errors: unreachable.map((d) => d.actual ?? '(no error text)'),
          },
        );
      }
      // A row today carries either measured diffs or one unreachable row, but
      // judge on what is present rather than on the producer's current shape:
      // only MEASURED diffs reach the onMismatch policy.
      if (schemaDiffs.length === 0) continue;
      const mode = await resolveOnMismatch(loadDef, r.datasource);
      if (mode === 'ignore') continue;
      if (mode === 'warn') {
        ctx.logger?.warn?.('[external-validation] external schema drift', {
          datasource: r.datasource,
          object: r.object,
          diffs: schemaDiffs,
        });
        continue;
      }
      // mode === 'fail' (default)
      throw new ExternalSchemaMismatchError(r.datasource, r.object, schemaDiffs);
    }
  }

  /**
   * Arm a background drift checker for every federated datasource that declares
   * `external.validation.checkIntervalMs`. Each fires on its own interval and
   * emits `external.schema.drift` events — it never throws or aborts the
   * process, since drift past boot is observational, not fatal.
   *
   * No-op when metadata can't be enumerated or no datasource opts in. Re-arming
   * (e.g. a second `kernel:ready`) first clears existing timers so intervals
   * don't accumulate.
   *
   * ⭐ [#13037] **`external.validation.checkOnBoot` does not reach here, by
   * ruling.** The maintainer pinned that gate's scope to the BOOT STEP ONLY
   * (2026-08-29): a datasource that set `checkOnBoot: false` still gets the
   * background drift checker it asked for via `checkIntervalMs`, because the
   * two keys answer different questions — "gate my startup on this" versus
   * "watch this while I run". This read point was already independent and
   * stays that way; ⛔ do not add a `checkOnBoot` condition below.
   */
  async scheduleDriftChecks(ctx: PluginContext): Promise<void> {
    // [#10772] The canonical hook, not the retained alias: `destroy()` is now
    // where the body lives, and the alias exists only for embedders.
    this.destroy();
    const metadata = safeGet<MetadataServiceLike>(ctx, 'metadata');
    if (!metadata?.list) return;

    let datasources: unknown[];
    try {
      datasources = await metadata.list('datasource');
    } catch (err) {
      ctx.logger?.warn?.('[external-validation] could not list datasources for drift checks', { err });
      return;
    }

    for (const def of datasources as DatasourceDef[]) {
      const interval = def?.external?.validation?.checkIntervalMs;
      const name = def?.name;
      if (!name || typeof interval !== 'number' || interval <= 0) continue;

      const timer = setInterval(() => {
        // Fire-and-forget: the checker swallows its own errors.
        void this.runDriftCheck(ctx, name);
      }, interval);
      // Don't let the drift timer keep the process alive on its own.
      (timer as { unref?: () => void }).unref?.();
      this.driftTimers.set(name, timer);
      ctx.logger?.info?.('[external-validation] armed background drift check', {
        datasource: name,
        intervalMs: interval,
      });
    }
  }

  /**
   * Re-validate one datasource's federated objects and emit an
   * `external.schema.drift` event per mismatch. Exposed for testing; invoked
   * from the interval armed by {@link scheduleDriftChecks}. Never throws.
   *
   * ## [#10961] The work is scoped by the CALL, not by a filter over a sweep
   *
   * This body used to ask for `validateAll()` — every federated object on every
   * federated datasource, each validation driving a live remote-schema
   * `introspect(datasource)` — and then keep the rows whose `datasource`
   * matched the one this timer was armed for. The events were right; the WORK
   * was the whole farm, and `scheduleDriftChecks` arms one of these PER
   * DATASOURCE. Measured on a three-datasource fixture
   * (`external-validation-drift-scope.test.ts`, run against the pre-fix body):
   * two armed timers introspected six remotes per cycle where two were asked
   * for, and each additional tick repeated it.
   *
   * That makes this the periodic twin of the request-gate defect #10537 named,
   * and worse in the one way that matters: a request gate has a caller waiting
   * on the answer and paying attention to the latency, while this is
   * **unattended** — the fan-out repeats on every interval, forever, with
   * nobody reading the result it discards.
   *
   * `validateDatasource(datasource)` is the scoped twin, composed service-side
   * from the same primitives (`listObjects` → filter → `validateObject`) with
   * the same federation predicate, so it returns row-for-row what the
   * post-filter kept. The rows are therefore taken as they arrive: the
   * selection is keyed on `o.datasource ?? 'default'`, which is exactly the
   * value `validateObject` reports back as `result.datasource`, so re-filtering
   * on `r.datasource` here would re-assert a property the call already
   * guarantees — and would leave a reader unsure whether the fan-out is still
   * somewhere in this path.
   *
   * ## Absence DEGRADES — it does not fall back, and it does not get loud
   *
   * A wired service with no scoped spelling could be served by sweeping and
   * post-filtering, which is precisely the behaviour above. A silent fallback
   * would leave the fan-out armed, unattended, on a path no test drives, for
   * exactly the deployments nobody is looking at. So it is refused.
   *
   * But refused QUIETLY, and this is deliberately NOT the `503` the REST
   * registrar answers for the same absence: **the kind of gate decides the
   * shape of honesty.** A request gate has a caller who asked a question and is
   * entitled to be told the answer cannot be produced. A background timer has
   * no caller — "loud" there means spraying errors at nobody, or manufacturing
   * 5xx noise from a check nothing requested. The honest degradation for an
   * unattended checker is to **not do the thing, and record why it was not
   * done**: no events, no throw, one `warn` naming the consequence (drift is
   * not being watched) and the fix.
   *
   * `warn` and not `error` per AGENTS.md's degradation table: this is a
   * FUNCTIONAL degradation — a check is not armed, visibly smaller than it
   * should be — not a durability one. Nothing claims to have been persisted.
   *
   * The probe is re-run on EVERY tick and its verdict is recorded nowhere: a
   * service registered after this plugin armed its timers starts being checked
   * on the next interval, with no cached "absent" to undo.
   *
   * @returns the number of drift events emitted.
   */
  async runDriftCheck(ctx: PluginContext, datasource: string): Promise<number> {
    const svc = safeGet<ExternalDatasourceServiceLike>(ctx, 'external-datasource');
    if (!svc) {
      // Federation simply is not wired into this host. Nothing is degraded and
      // nobody needs telling — the same quiet skip the boot gate takes.
      ctx.logger?.debug?.('[external-validation] service not registered; skipping drift check', {
        datasource,
      });
      return 0;
    }

    if (typeof svc.validateDatasource !== 'function') {
      ctx.logger?.warn?.(
        '[external-validation] background drift check SKIPPED — the registered external-datasource '
          + 'service has no scoped `validateDatasource(datasource)`, and this checker will NOT sweep '
          + 'the whole farm instead: a timer armed for one datasource must not introspect every other '
          + 'federated remote on every tick. Consequence: schema drift on this datasource is not being '
          + 'watched, and no `external.schema.drift` event will be emitted for it. Fix: register an '
          + '`external-datasource` service that can validate a single datasource (ObjectStack\'s own '
          + '`ExternalDatasourceService` does), or drop `external.validation.checkIntervalMs` from the '
          + 'datasource so nothing is armed.',
        { datasource },
      );
      return 0;
    }

    let report: SchemaValidationReportLike;
    try {
      report = await svc.validateDatasource(datasource);
    } catch (err) {
      ctx.logger?.warn?.('[external-validation] drift check could not be performed', {
        datasource,
        err,
      });
      return 0;
    }

    const drifted = report.results.filter((r) => !r.ok);
    for (const r of drifted) {
      const event: ExternalSchemaDriftEvent = {
        datasource: r.datasource,
        object: r.object,
        diffs: r.diffs,
      };
      try {
        await ctx.trigger('external.schema.drift', event);
      } catch (err) {
        ctx.logger?.warn?.('[external-validation] failed to emit drift event', {
          datasource,
          object: r.object,
          err,
        });
      }
    }
    if (drifted.length > 0) {
      // [#11166] Same distinction as the boot gate, one layer down: an
      // `unreachable` row is "could not watch", not "schema changed". The
      // event above is still emitted for it — audit/notification consumers
      // discriminate on the entry's `kind` — but the operator-facing summary
      // must not claim drift for a remote nobody read.
      const changed = drifted.filter((r) => r.diffs.some((d) => d.kind !== 'unreachable'));
      const unread = drifted.filter((r) => r.diffs.every((d) => d.kind === 'unreachable'));
      if (changed.length > 0) {
        ctx.logger?.warn?.('[external-validation] background drift detected', {
          datasource,
          objects: changed.map((r) => r.object),
        });
      }
      if (unread.length > 0) {
        ctx.logger?.warn?.(
          '[external-validation] background drift check could not read the remote — these objects '
            + 'are UNWATCHED this tick, not drifted; the schema was not seen. Fix: check the '
            + 'datasource connection/credentials.',
          { datasource, objects: unread.map((r) => r.object) },
        );
      }
    }
    return drifted.length;
  }
}

/** Convenience factory mirroring the createXxxPlugin convention. */
export function createExternalValidationPlugin(): ExternalValidationPlugin {
  return new ExternalValidationPlugin();
}

/**
 * Reads one datasource definition per NAME per sweep, answering `undefined` for
 * anything it could not read.
 *
 * [#13037] Introduced because the boot gate now asks the definition two
 * questions — "does this datasource opt out of the boot check?" and, only for
 * the rows that stayed, "what is its `onMismatch` policy?" — and asking twice
 * would double the metadata reads for every mismatching row. Memoized per
 * SWEEP, not per plugin instance: a second `kernel:ready` re-reads, so an
 * operator who fixed a datasource between boots is not served a stale verdict.
 *
 * Swallowing the throw preserves `resolveOnMismatch`'s pre-existing contract
 * (an unreadable definition falls back to the strict default) and gives the new
 * gate the same safe direction: a definition nobody could read is validated,
 * never silently skipped.
 */
function createDatasourceDefLoader(
  metadata: MetadataServiceLike | undefined,
): (datasource: string) => Promise<DatasourceDef | undefined> {
  const cache = new Map<string, Promise<DatasourceDef | undefined>>();
  return (datasource: string) => {
    let hit = cache.get(datasource);
    if (!hit) {
      hit = (async () => {
        try {
          return (await metadata?.get?.('datasource', datasource)) as DatasourceDef | undefined;
        } catch {
          return undefined;
        }
      })();
      cache.set(datasource, hit);
    }
    return hit;
  };
}

/**
 * [#13037] Does the BOOT sweep apply to this datasource?
 *
 * ## ⭐ Scope, pinned by the maintainer at the ruling (2026-08-29)
 *
 * **This gate covers the BOOT STEP ONLY.** `scheduleDriftChecks()` and its
 * `external.validation.checkIntervalMs` read point stay INDEPENDENT of
 * `checkOnBoot` — a datasource that opts out of the boot check keeps whatever
 * background drift checking it armed, and arming one is not an opt back in.
 * The two knobs sit in the same block and answer different questions: one is
 * "gate my startup on this", the other is "watch this while I run". ⛔ Do not
 * extend this predicate to `scheduleDriftChecks` / `runDriftCheck`.
 *
 * ## What `false` buys, stated precisely
 *
 * The datasource's rows are dropped before the boot gate looks at them, so for
 * that datasource: no `onMismatch` policy is applied (a measured mismatch
 * therefore CANNOT abort boot through it), no unreachable-remote warning is
 * raised, and its objects are not counted in the all-clear.
 *
 * What it deliberately does NOT buy is the remote round-trip: `validateAll()`
 * is the service's whole-farm entry and takes no datasource argument, so the
 * introspection has already happened by the time this runs. Narrowing the work
 * itself would mean composing the sweep out of the OPTIONAL scoped twin
 * (`validateDatasource`), which changes what the sweep does when the twin is
 * absent and changes the row set when it is present — and the ruling requires
 * the `true`/default path to stay behaviourally identical. Recorded rather than
 * quietly done.
 *
 * ## Why the test is `=== false` and not a truthiness check
 *
 * `checkOnBoot` is declared `z.boolean().default(true)`, so on a PARSED
 * datasource the key is always materialized — `true` or an explicit `false`.
 * Only that explicit `false` opts out. Everything else validates: an absent
 * key, an unparsed or legacy stored row, a managed datasource with no
 * `external` block at all, and a definition the metadata service could not
 * hand back. Boot validation is the safe direction, so every uncertainty
 * resolves towards running it.
 *
 * ⚠️ The value read here is the one the metadata service returns, i.e. the
 * POST-parse definition — the same read point `resolveOnMismatch` has always
 * used. It is deliberately not softened with a `??` alias chain: `checkonboot`
 * and `validateonboot` are **not** accepted spellings that fold to this key,
 * they are entries in `strictObject`'s `aliases` table, which runs only from
 * the `unrecognized_keys` REJECTION path (measured: both spellings fail
 * `DatasourceSchema.safeParse` with "Did you mean … → `checkOnBoot`?"). There
 * is exactly one authorable spelling, so there is exactly one read. Pinned by
 * `external-validation-checkonboot.test.ts`, which fails loudly if that ever
 * stops being true — a real fold would need this read point revisited, not a
 * consumer-side fallback (AGENTS.md Prime Directive #12).
 */
async function bootCheckEnabled(
  loadDef: (datasource: string) => Promise<DatasourceDef | undefined>,
  datasource: string,
): Promise<boolean> {
  const ds = await loadDef(datasource);
  return ds?.external?.validation?.checkOnBoot !== false;
}

async function resolveOnMismatch(
  loadDef: (datasource: string) => Promise<DatasourceDef | undefined>,
  datasource: string,
): Promise<'fail' | 'warn' | 'ignore'> {
  const ds = await loadDef(datasource);
  return ds?.external?.validation?.onMismatch ?? 'fail';
}

function safeGet<T>(ctx: PluginContext, name: string): T | undefined {
  try {
    return ctx.getService<T>(name);
  } catch {
    return undefined;
  }
}
