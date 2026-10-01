// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `client.environments.delete` under the hosted control plane's two-step
 * delete (cloud ADR-0014) — #17636.
 *
 * ## The producer, measured
 *
 * `DELETE /api/v1/cloud/environments/:id` is served by `objectstack-ai/cloud`,
 * `packages/service-cloud/src/routes/environment-lifecycle.ts`, read at cloud
 * `eeac7b22` (cloud#2188). The route reads two query flags, `force` and
 * `purge`, independently, and a 200 carries exactly one of two bodies:
 *
 *   archive  — a live environment whatever the flags, or an archived one
 *              without `purge`:
 *              `{ environmentId, deleted: false, archived: true,
 *                 purgeDeferred, retentionDays, warnings: [], message }`
 *   teardown — an archived environment with `purge`, or a `failed` one:
 *              `{ environmentId, deleted: true, purged: true, warnings }`
 *
 * Every other outcome is a non-2xx error envelope, which this client's
 * `fetch` wrapper throws — it never reaches the declared return type.
 *
 * ## `message` → `outcome`: the wire in transition (#21095)
 *
 * Ruling B on objectstack-ai/cloud#2315 — the server returns facts, the console
 * composes the message in the user's locale — and ruling A's landing order
 * (spec and this SDK first, the control plane LAST) mean a 200 from the
 * route may carry the English `message`, the closed `outcome` fact, or both,
 * depending on which control-plane release answers. The type therefore
 * declares BOTH optional, and the outcome vocabulary split by arm:
 * `archived | already_archived | purge_deferred` on the archive answer,
 * `destroyed` on the teardown answer. Nothing in this repo reads `message`
 * (measured: `git grep` over packages/, apps/ and examples/ at this change
 * finds no reader outside this file, and objectui's tree has none either).
 *
 * ## What each pin asserts
 *
 * - The URL for every combination of the two options. `force` and `purge` are
 *   independent confirmations and a production teardown needs both on ONE
 *   call, so a builder that let one option shadow the other would leave that
 *   teardown unreachable from the SDK.
 * - Both 200 bodies relay untouched, key for key.
 * - A refusal rejects, carrying the envelope's `code` and the response status.
 * - The TYPE pins: the declared answer is the discriminated union of the two
 *   bodies, no more and no less. They are compiled — `tsconfig.test.json`
 *   includes `src/**` and the package's `typecheck` script names it — so each
 *   `@ts-expect-error` is a real check.
 */

import { describe, it, expect, vi } from 'vitest';
import { ActionSchema } from '@objectstack/spec/ui';
import { ObjectStackClient } from './index';

type EnvironmentsNamespace = ObjectStackClient['environments'];
type DeleteAnswer = Awaited<ReturnType<EnvironmentsNamespace['delete']>>;
type DeleteOptions = NonNullable<Parameters<EnvironmentsNamespace['delete']>[1]>;

/**
 * The archive answer. `deleted: false` selects it, and each key is declared at
 * its wire type: assigning into typed locals is the pin, so a key weakened to
 * optional or retyped goes red here rather than in a caller.
 */
export function archiveAnswerDeclaresItsKeys(answer: DeleteAnswer): void {
    if (answer.deleted) return;
    const environmentId: string = answer.environmentId;
    const archived: true = answer.archived;
    const purgeDeferred: boolean = answer.purgeDeferred;
    const retentionDays: number = answer.retentionDays;
    const warnings: string[] = answer.warnings;
    const outcome: 'archived' | 'already_archived' | 'purge_deferred' | undefined = answer.outcome;
    const message: string | undefined = answer.message;
    void [environmentId, archived, purgeDeferred, retentionDays, warnings, outcome, message];
    // @ts-expect-error an archive tears nothing down; the archive answer carries no `purged`
    void answer.purged;
}

/**
 * The transition, pinned in both directions (#21095): `message` is no longer
 * guaranteed, `outcome` is not guaranteed yet, and the archive arm's outcome
 * vocabulary excludes the teardown's.
 */
export function archiveAnswerGuaranteesNeitherMessageNorOutcome(answer: DeleteAnswer): void {
    if (answer.deleted) return;
    // @ts-expect-error `message` is optional — the control plane is retiring the sentence for `outcome`
    const message: string = answer.message;
    // @ts-expect-error `outcome` is optional — older control planes do not report it
    const outcome: 'archived' | 'already_archived' | 'purge_deferred' = answer.outcome;
    // @ts-expect-error `destroyed` is the teardown's outcome, never an archive's
    const destroyed: NonNullable<typeof answer.outcome> = 'destroyed';
    void [message, outcome, destroyed];
}

/** The teardown answer. `deleted: true` selects it, and it carries none of the archive-only keys. */
export function teardownAnswerDeclaresItsKeys(answer: DeleteAnswer): void {
    if (!answer.deleted) return;
    const environmentId: string = answer.environmentId;
    const purged: true = answer.purged;
    const warnings: string[] = answer.warnings;
    const outcome: 'destroyed' | undefined = answer.outcome;
    void [environmentId, purged, warnings, outcome];
    // @ts-expect-error a teardown is never reported as an archive outcome
    const archivedOutcome: NonNullable<typeof answer.outcome> = 'archived';
    void archivedOutcome;
    // @ts-expect-error the teardown answer carries no `archived`
    void answer.archived;
    // @ts-expect-error the teardown answer carries no `purgeDeferred`
    void answer.purgeDeferred;
    // @ts-expect-error the teardown answer carries no `retentionDays`
    void answer.retentionDays;
    // @ts-expect-error the teardown answer carries no `message`
    void answer.message;
}

/** The three keys the previous declaration named sit on BOTH members, so a read written against it still compiles. */
export function previouslyDeclaredKeysStayReadable(answer: DeleteAnswer): void {
    const deleted: boolean = answer.deleted;
    const environmentId: string = answer.environmentId;
    const warnings: string[] = answer.warnings;
    void [deleted, environmentId, warnings];
}

/**
 * The closed outcome vocabulary across both arms, tied to the declaration in
 * BOTH directions: `satisfies` refuses a member the type lacks, and the
 * `Exclude` below refuses a type member this list lacks.
 */
const DELETE_OUTCOMES = ['archived', 'already_archived', 'purge_deferred', 'destroyed'] as const satisfies ReadonlyArray<NonNullable<DeleteAnswer['outcome']>>;
type UnlistedOutcome = Exclude<NonNullable<DeleteAnswer['outcome']>, (typeof DELETE_OUTCOMES)[number]>;
export const everyOutcomeIsListed: [UnlistedOutcome] extends [never] ? true : false = true;

/** `force` and `purge` are both declared options and may be passed together. */
export function bothOptionsAreDeclared(): void {
    const productionTeardown: DeleteOptions = { force: true, purge: true };
    void productionTeardown;
}

/** A client whose `fetch` answers one canned response. */
function clientAnswering(status: number, body: unknown) {
    const fetchMock = vi.fn().mockResolvedValue({
        ok: status >= 200 && status < 300,
        status,
        statusText: status === 200 ? 'OK' : 'Conflict',
        json: async () => body,
        headers: new Headers(),
    });
    const client = new ObjectStackClient({ baseUrl: 'http://localhost:3000', fetch: fetchMock });
    return { client, fetchMock };
}

const ARCHIVED = {
    environmentId: 'env_1',
    deleted: false,
    archived: true,
    purgeDeferred: false,
    retentionDays: 30,
    warnings: [],
    message: 'Environment archived (soft-deleted).',
};

const TORN_DOWN = {
    environmentId: 'env_1',
    deleted: true,
    purged: true,
    warnings: ['attachment storage sweep failed: timeout'],
};

/** The archive answer of a control plane that reports the fact and has retired the sentence. */
const ARCHIVED_AS_FACT = {
    environmentId: 'env_1',
    deleted: false,
    archived: true,
    outcome: 'already_archived',
    purgeDeferred: false,
    retentionDays: 30,
    warnings: [],
};

describe('client.environments.delete — the two-step delete (cloud ADR-0014)', () => {
    const CASES: Array<{ opts: DeleteOptions | undefined; query: string }> = [
        { opts: undefined, query: '' },
        { opts: {}, query: '' },
        { opts: { force: false, purge: false }, query: '' },
        { opts: { force: true }, query: '?force=1' },
        { opts: { force: true, purge: false }, query: '?force=1' },
        { opts: { purge: true }, query: '?purge=1' },
        { opts: { force: false, purge: true }, query: '?purge=1' },
        { opts: { force: true, purge: true }, query: '?force=1&purge=1' },
    ];

    for (const { opts, query } of CASES) {
        const label = opts === undefined ? 'no options' : JSON.stringify(opts);
        it(`${label} → DELETE …/environments/env_1${query}`, async () => {
            const { client, fetchMock } = clientAnswering(200, { success: true, data: ARCHIVED });

            await client.environments.delete('env_1', opts);

            expect(fetchMock).toHaveBeenCalledTimes(1);
            expect(fetchMock.mock.calls[0][0]).toBe(`http://localhost:3000/api/v1/cloud/environments/env_1${query}`);
            expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
        });
    }

    it('encodes the id and keeps both flags after it', async () => {
        const { client, fetchMock } = clientAnswering(200, { success: true, data: TORN_DOWN });

        await client.environments.delete('env/1 x', { force: true, purge: true });

        expect(fetchMock.mock.calls[0][0]).toBe(
            'http://localhost:3000/api/v1/cloud/environments/env%2F1%20x?force=1&purge=1',
        );
    });

    it('relays the archive answer key for key, and `deleted: false` narrows to it', async () => {
        const { client } = clientAnswering(200, { success: true, data: ARCHIVED });

        const answer = await client.environments.delete('env_1');

        expect(Object.keys(answer).sort()).toEqual([
            'archived', 'deleted', 'environmentId', 'message', 'purgeDeferred', 'retentionDays', 'warnings',
        ]);
        if (answer.deleted) throw new Error('expected the archive answer');
        expect(answer.archived).toBe(true);
        expect(answer.purgeDeferred).toBe(false);
        expect(answer.retentionDays).toBe(30);
        expect(answer.warnings).toEqual([]);
    });

    it('relays a deferred purge: a LIVE environment asked to purge is archived with `purgeDeferred: true`', async () => {
        const { client } = clientAnswering(200, { success: true, data: { ...ARCHIVED, purgeDeferred: true } });

        const answer = await client.environments.delete('env_1', { purge: true });

        if (answer.deleted) throw new Error('expected the archive answer');
        expect(answer.archived).toBe(true);
        expect(answer.purgeDeferred).toBe(true);
    });

    it('relays the teardown answer key for key, and `deleted: true` narrows to it', async () => {
        const { client } = clientAnswering(200, { success: true, data: TORN_DOWN });

        const answer = await client.environments.delete('env_1', { purge: true });

        expect(Object.keys(answer).sort()).toEqual(['deleted', 'environmentId', 'purged', 'warnings']);
        if (!answer.deleted) throw new Error('expected the teardown answer');
        expect(answer.purged).toBe(true);
        expect(answer.warnings).toEqual(['attachment storage sweep failed: timeout']);
    });

    it('relays an archive answer that reports `outcome` and carries no `message` (the post-transition wire)', async () => {
        const { client } = clientAnswering(200, { success: true, data: ARCHIVED_AS_FACT });

        const answer = await client.environments.delete('env_1');

        expect(Object.keys(answer).sort()).toEqual([
            'archived', 'deleted', 'environmentId', 'outcome', 'purgeDeferred', 'retentionDays', 'warnings',
        ]);
        if (answer.deleted) throw new Error('expected the archive answer');
        expect(answer.outcome).toBe('already_archived');
        expect(answer.message).toBeUndefined();
    });

    it('relays a teardown answer that reports `outcome: destroyed`', async () => {
        const { client } = clientAnswering(200, { success: true, data: { ...TORN_DOWN, outcome: 'destroyed' } });

        const answer = await client.environments.delete('env_1', { purge: true });

        if (!answer.deleted) throw new Error('expected the teardown answer');
        expect(answer.outcome).toBe('destroyed');
    });

    it('every outcome the SDK can relay is authorable as an `outcomeMessages` key on an action', () => {
        // The console composes the copy from the action's `outcomeMessages`
        // (ruling A): an outcome the spec's key grammar refused could be
        // reported and never given copy. Parsed through the real schema.
        const r = ActionSchema.safeParse({
            name: 'delete_environment',
            label: 'Delete environment',
            type: 'script',
            target: 'deleteEnvironment',
            outcomeMessages: Object.fromEntries(DELETE_OUTCOMES.map((o) => [o, `Outcome: ${o}`])),
        });
        expect(r.success, JSON.stringify((r as { error?: unknown }).error)).toBe(true);
    });

    it('rejects a refusal instead of resolving it: a production environment deleted without `force`', async () => {
        const { client } = clientAnswering(409, {
            success: false,
            error: {
                code: 'RESOURCE_CONFLICT',
                message: 'This is the organization\'s production environment. Re-run with force to delete it.',
                httpStatus: 409,
            },
        });

        await expect(client.environments.delete('env_prod')).rejects.toMatchObject({
            code: 'RESOURCE_CONFLICT',
            httpStatus: 409,
        });
    });

    it('anti-vacuity: the type pins above are real bindings in this module', () => {
        expect(typeof archiveAnswerDeclaresItsKeys).toBe('function');
        expect(typeof archiveAnswerGuaranteesNeitherMessageNorOutcome).toBe('function');
        expect(everyOutcomeIsListed).toBe(true);
        expect(typeof teardownAnswerDeclaresItsKeys).toBe('function');
        expect(typeof previouslyDeclaredKeysStayReadable).toBe('function');
        expect(typeof bothOptionsAreDeclared).toBe('function');
    });
});
