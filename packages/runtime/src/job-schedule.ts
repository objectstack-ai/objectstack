// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { JobSchedule } from '@objectstack/spec/contracts';

/**
 * Downgrade an AUTHORED `Schedule` — the tier `defineJob` / `JobSchema.parse`
 * produces (`@objectstack/spec` `system/job.zod.ts`) — into the BOUNDARY
 * `JobSchedule` that `IJobService.schedule` consumes
 * (`@objectstack/spec/contracts`).
 *
 * The two tiers differ in exactly one place: `CronScheduleSchema.expression`
 * is a `CronExpressionInputSchema`, so parsing rewrites the authored
 * `'0 1 * * *'` into the canonical expression envelope
 * `{ dialect: 'cron', source: '0 1 * * *' }` — while the boundary type
 * documents `expression` as a **bare cron string**, because `CronJobAdapter`
 * hands it straight to croner, which rejects anything else with
 * `"CronPattern: Pattern has to be of type string."`.
 *
 * #4567: nothing bridged the two, so every declarative cron job threw inside
 * the adapter and the throw was swallowed by AppPlugin's per-job catch —
 * declared, built, booted, never scheduled. This function is the ONE declared
 * conversion point, sitting exactly on the authoring↔boundary seam #4538 drew;
 * the adapters stay strict (no `typeof === 'object'` tolerance downstream, per
 * Prime Directive #12).
 *
 * A bare string `expression` is still accepted here because that is the
 * *authoring input* form (`z.input` of the same schema): bundles assembled
 * without a `JobSchema.parse` round-trip legitimately carry it. Both are
 * authoring-tier spellings of one value; neither reaches the adapter.
 *
 * Anything that cannot be reduced to the boundary shape — an unknown schedule
 * type, an AST-only or non-cron expression envelope, a cron entry with no
 * source — **throws**, naming the job. Silence is precisely what #4567 was.
 */
export function toBoundaryJobSchedule(schedule: unknown, jobName: string): JobSchedule {
    if (!schedule || typeof schedule !== 'object') {
        throw new Error(
            `job "${jobName}": schedule must be an object of type cron | interval | once, got ${typeof schedule}`,
        );
    }
    const s = schedule as Record<string, unknown>;

    if (s.type === 'cron') {
        return { type: 'cron', expression: cronSource(s.expression, jobName), ...timezoneOf(s) };
    }

    if (s.type === 'interval') {
        if (typeof s.intervalMs !== 'number' || !Number.isFinite(s.intervalMs) || s.intervalMs <= 0) {
            throw new Error(
                `job "${jobName}": interval schedule needs a positive \`intervalMs\`, got ${JSON.stringify(s.intervalMs)}`,
            );
        }
        return { type: 'interval', intervalMs: s.intervalMs };
    }

    if (s.type === 'once') {
        if (typeof s.at !== 'string' || s.at.trim() === '') {
            throw new Error(
                `job "${jobName}": once schedule needs an ISO 8601 \`at\`, got ${JSON.stringify(s.at)}`,
            );
        }
        return { type: 'once', at: s.at };
    }

    throw new Error(
        `job "${jobName}": unknown schedule type ${JSON.stringify(s.type)} (expected cron | interval | once)`,
    );
}

/** Reduce an authored cron `expression` (envelope or bare string) to the bare cron string croner needs. */
function cronSource(expression: unknown, jobName: string): string {
    if (typeof expression === 'string') {
        if (expression.trim() === '') {
            throw new Error(`job "${jobName}": cron schedule has an empty expression`);
        }
        return expression;
    }

    if (expression && typeof expression === 'object') {
        const env = expression as Record<string, unknown>;
        if (env.dialect !== undefined && env.dialect !== 'cron') {
            throw new Error(
                `job "${jobName}": cron schedule carries a ${JSON.stringify(env.dialect)} expression; ` +
                'a job schedule must use the `cron` dialect',
            );
        }
        if (typeof env.source === 'string' && env.source.trim() !== '') return env.source;
        if (env.ast !== undefined) {
            throw new Error(
                `job "${jobName}": cron expression is AST-only; the job scheduler needs the \`source\` string`,
            );
        }
    }

    throw new Error(
        `job "${jobName}": cron schedule missing a usable expression (got ${JSON.stringify(expression)})`,
    );
}

/** Carry a string `timezone` across; drop anything else rather than handing croner a non-string. */
function timezoneOf(s: Record<string, unknown>): { timezone?: string } {
    return typeof s.timezone === 'string' && s.timezone !== '' ? { timezone: s.timezone } : {};
}
