// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Custom REST endpoint backing the `showcase_recalc_estimate` **api** action.
 *
 * The showcase exercises every `ActionType`; `type: 'api'` means "POST to a
 * custom endpoint". That endpoint has to exist, or the button 404s on click —
 * a soft failure the build can't catch (an `api` action only needs a target
 * *string*; the URL's reachability isn't statically verifiable). So we mount a
 * real route here.
 *
 * Wiring: there is no declarative endpoint surface in a bundle, so we register
 * imperatively against the `http.server` service. We do it on `kernel:ready`
 * (the service is reliably available then, and Hono's route matcher is only
 * frozen later on `kernel:listening`, so the route lands in time).
 *
 * Contract: the objectui ActionRunner POSTs the record as the JSON body for a
 * string-target api action, so the body carries `id` + the record fields.
 * We recompute `estimate_hours` from the schedule window (working at 8h/day)
 * and persist it; `refreshAfter: true` on the action repaints the new value.
 */

interface RecalcHostContext {
  ql: { update: (object: string, data: Record<string, unknown>, options?: unknown) => Promise<unknown> };
  logger?: { info?: (...a: unknown[]) => void; warn?: (...a: unknown[]) => void; error?: (...a: unknown[]) => void };
  hook?: (event: string, handler: () => Promise<void> | void) => void;
  getService?: <T = unknown>(name: string) => Promise<T>;
}

/** Inclusive day-count between two dates × 8h; falls back to one day. */
function estimateFromWindow(start: unknown, end: unknown): number {
  const s = typeof start === 'string' || start instanceof Date ? new Date(start as string) : undefined;
  const e = typeof end === 'string' || end instanceof Date ? new Date(end as string) : undefined;
  if (s && e && !Number.isNaN(s.getTime()) && !Number.isNaN(e.getTime()) && e >= s) {
    const days = Math.round((e.getTime() - s.getTime()) / 86_400_000) + 1;
    return Math.max(1, days) * 8;
  }
  return 8;
}

export function registerRecalcEndpoint(ctx: RecalcHostContext): void {
  const mount = async (): Promise<void> => {
    let server: { post?: (path: string, handler: (req: unknown, res: unknown) => unknown) => void } | undefined;
    try {
      server = await ctx.getService?.('http.server');
    } catch {
      server = undefined;
    }
    if (!server || typeof server.post !== 'function') {
      ctx.logger?.warn?.('[showcase] http.server unavailable — POST /api/v1/showcase/recalc not mounted');
      return;
    }

    server.post('/api/v1/showcase/recalc', async (req: unknown, res: unknown) => {
      const r = res as {
        status: (code: number) => void;
        json: (body: unknown) => void;
      };
      try {
        const body = ((req as { body?: Record<string, unknown> })?.body) ?? {};
        const id = (body.id ?? body.recordId) as string | undefined;
        if (!id) {
          r.status(400);
          r.json({ success: false, error: 'recordId required' });
          return;
        }
        const estimate_hours = estimateFromWindow(body.start_date, body.end_date);
        await ctx.ql.update('showcase_task', { id, estimate_hours }, { where: { id } });
        r.json({ success: true, data: { id, estimate_hours } });
      } catch (err) {
        r.status(500);
        r.json({ success: false, error: err instanceof Error ? err.message : String(err) });
      }
    });

    ctx.logger?.info?.('[showcase] mounted POST /api/v1/showcase/recalc');
  };

  if (typeof ctx.hook === 'function') {
    ctx.hook('kernel:ready', mount);
  } else {
    void mount();
  }
}
