// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8069] The webhook lane's veto over redelivering one of its own
 * `sys_http_delivery` rows.
 *
 * ## Why a guard exists at all
 * `service-messaging` owns the replay mechanics and deliberately knows nothing
 * about `sys_webhook`. So the row-local refusal it can make on its own — "this
 * row was never sent, so there is nothing to re-send" — cannot answer the
 * question the maintainer's ruling of 2026-08-12 actually asks: *is the signing
 * configuration for this delivery still available?* That question is only
 * answerable here, where the subscription and its encrypted secret live.
 *
 * ## What it refuses, and why each case
 * A redelivery replays the row's bytes together with the signature computed at
 * enqueue. That is safe exactly while the configuration those bytes were
 * authorised under still stands. It refuses when:
 *
 *  1. **The subscription is gone.** Nothing is left to say whether this URL
 *     should still receive this payload, or under which key — and an operator
 *     deleting a webhook has expressed that it should stop. The maintainer
 *     named this case specifically.
 *  2. **A secret is stored but does not come back.** The subscription is signed
 *     and the key cannot be recovered — a rotated KMS key, an unregistered
 *     CryptoProvider, a deleted `sys_secret` row. Deliveries for it are being
 *     dropped right now; replaying an old one is the same fail-open by another
 *     route.
 *  3. **The lookup itself failed.** Handled by the caller
 *     (`assertRedeliverAllowed` turns a throwing guard into a refusal), because
 *     "we could not check" must never read as "allowed".
 *
 * It ALLOWS a subscription that is legitimately unsigned (`secret` is optional
 * on the authoring envelope) and any row from another producer (`source !==
 * 'webhook'`) — this guard speaks only for webhook rows.
 *
 * ## The narrow fail-open this closes deliberately
 * Case 2 is checked as *"a value is stored but nothing came back"*, not as
 * *"the resolver threw"*. `resolveWebhookSecret` returns `undefined` — the same
 * value it uses for "authored unsigned" — when the column holds something that
 * is not a resolvable ref, so a `try/catch` alone would treat an unrecoverable
 * key as a legitimately unsigned webhook and allow the replay. Presence is
 * decidable from the masked read even though the value is not, so the guard
 * asks the question it can actually answer.
 */

import type { IDataEngine } from '@objectstack/spec/contracts';
import {
    WEBHOOK_OBJECT,
    WEBHOOK_SECRET_FIELD,
    resolveWebhookSecret,
} from './webhook-secret.js';

/** The delivery-row fields this guard reads. Structural — no messaging import. */
export interface RedeliverGuardRow {
    /** Producer domain; only `'webhook'` rows are this guard's business. */
    source: string;
    /** Partition/ordering anchor — the `sys_webhook` row id for webhook rows. */
    refId: string;
}

/**
 * Build the guard `MessagingService.registerRedeliverGuard('webhook', …)` takes.
 *
 * Returns a refusal reason, or `undefined` to allow.
 */
export function createWebhookRedeliverGuard(
    engine: IDataEngine,
    subscriptionsObject: string = WEBHOOK_OBJECT,
): (row: RedeliverGuardRow) => Promise<string | undefined> {
    return async (row) => {
        if (row.source !== 'webhook') return undefined;

        const subscription = (await engine.findOne(subscriptionsObject, {
            where: { id: row.refId },
        })) as Record<string, unknown> | null;

        if (!subscription) {
            return (
                `the ${subscriptionsObject} subscription '${row.refId}' this delivery belongs to no `
                + 'longer exists, so there is nothing left to say whether it may still be signed and '
                + 'sent (#8069). Recreate the webhook if the endpoint should keep receiving events; '
                + 'new events are then delivered signed.'
            );
        }

        // Presence is decidable on the masked read — a set secret comes back as
        // the engine's mask, an unset one as null — even though the value is not.
        const storesSecret =
            subscription[WEBHOOK_SECRET_FIELD] != null
            && subscription[WEBHOOK_SECRET_FIELD] !== '';
        if (!storesSecret) return undefined;

        const plaintext = await resolveWebhookSecret(engine, subscription as { id: string }, subscriptionsObject);
        if (plaintext) return undefined;

        return (
            `webhook '${String(subscription.name ?? row.refId)}' stores a signing secret that cannot `
            + 'be recovered, so this delivery cannot be authenticated as coming from us — refusing '
            + 'rather than sending (#7799, #8069). Fix: register a CryptoProvider with the same key '
            + 'the secret was written under and make sure the sys_secret row is reachable.'
        );
    };
}
