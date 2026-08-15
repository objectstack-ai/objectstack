// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import {
  ExternalSchemaMismatchError,
  type SchemaDiffEntry,
} from '@objectstack/spec/shared';

/**
 * Structural subset of `IExternalDatasourceService` used here, to avoid a hard
 * dependency on the service package from runtime.
 */
interface ExternalDatasourceServiceLike {
  validateAll(): Promise<{
    ok: boolean;
    results: Array<{ ok: boolean; datasource: string; object: string; diffs: SchemaDiffEntry[] }>;
  }>;
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

  /** Tear down background drift-check timers (idempotent). */
  stop = (): void => {
    for (const timer of this.driftTimers.values()) clearInterval(timer);
    this.driftTimers.clear();
  };

  /** Exposed for testing; invoked from the kernel:ready handler. */
  async runValidation(ctx: PluginContext): Promise<void> {
    const svc = safeGet<ExternalDatasourceServiceLike>(ctx, 'external-datasource');
    if (!svc?.validateAll) {
      ctx.logger?.debug?.('[external-validation] service not registered; skipping');
      return;
    }

    const metadata = safeGet<MetadataServiceLike>(ctx, 'metadata');
    let report: Awaited<ReturnType<ExternalDatasourceServiceLike['validateAll']>>;
    try {
      report = await svc.validateAll();
    } catch (err) {
      ctx.logger?.warn?.('[external-validation] validateAll failed', { err });
      return;
    }

    const failures = report.results.filter((r) => !r.ok);
    if (failures.length === 0) {
      // [#6504] The all-clear is a UNIVERSAL claim, and this gate has no way to
      // make one when the object set it swept was itself known-partial. See
      // `announceAllClear`.
      await announceAllClear(ctx, metadata, report.results.length);
      return;
    }

    for (const r of failures) {
      const mode = await resolveOnMismatch(metadata, r.datasource);
      if (mode === 'ignore') continue;
      if (mode === 'warn') {
        ctx.logger?.warn?.('[external-validation] external schema drift', {
          datasource: r.datasource,
          object: r.object,
          diffs: r.diffs,
        });
        continue;
      }
      // mode === 'fail' (default)
      throw new ExternalSchemaMismatchError(r.datasource, r.object, r.diffs);
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
   */
  async scheduleDriftChecks(ctx: PluginContext): Promise<void> {
    this.stop();
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
   * @returns the number of drift events emitted.
   */
  async runDriftCheck(ctx: PluginContext, datasource: string): Promise<number> {
    const svc = safeGet<ExternalDatasourceServiceLike>(ctx, 'external-datasource');
    if (!svc?.validateAll) return 0;

    let report: Awaited<ReturnType<ExternalDatasourceServiceLike['validateAll']>>;
    try {
      report = await svc.validateAll();
    } catch (err) {
      ctx.logger?.warn?.('[external-validation] drift check validateAll failed', {
        datasource,
        err,
      });
      return 0;
    }

    const drifted = report.results.filter((r) => !r.ok && r.datasource === datasource);
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
      ctx.logger?.warn?.('[external-validation] background drift detected', {
        datasource,
        objects: drifted.map((r) => r.object),
      });
    }
    return drifted.length;
  }
}

/** Convenience factory mirroring the createXxxPlugin convention. */
export function createExternalValidationPlugin(): ExternalValidationPlugin {
  return new ExternalValidationPlugin();
}

async function resolveOnMismatch(
  metadata: MetadataServiceLike | undefined,
  datasource: string,
): Promise<'fail' | 'warn' | 'ignore'> {
  try {
    const ds = (await metadata?.get?.('datasource', datasource)) as DatasourceDef | undefined;
    return ds?.external?.validation?.onMismatch ?? 'fail';
  } catch {
    return 'fail';
  }
}

function safeGet<T>(ctx: PluginContext, name: string): T | undefined {
  try {
    return ctx.getService<T>(name);
  } catch {
    return undefined;
  }
}
