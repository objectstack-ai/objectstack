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
 *  2. **The subscription is inactive.** [#22804] `active` is the operator's
 *     off switch for the endpoint, and the field declares that an inactive
 *     webhook is skipped by the dispatcher. An explicit replay is the
 *     dispatcher too: sending a past delivery to a switched-off endpoint would
 *     undo the switch without saying so. The test is the dispatcher's own
 *     predicate — the subscription cache loads `{ active: true }`, so the
 *     guard allows only `active === true`, and a row whose `active` is null or
 *     absent (unreachable through the engine, which fills the declared default
 *     `true` and requires the field) is refused, exactly as the dispatcher
 *     skips it. Re-activating the webhook, then replaying, is the open path.
 *     Checked after "gone" and before the secret, so an inactive webhook whose
 *     key is also unrecoverable names the operator's first remedy.
 *  3. **A secret is stored but does not come back.** The subscription is signed
 *     and the key cannot be recovered — a rotated KMS key, an unregistered
 *     CryptoProvider, a deleted `sys_secret` row. Deliveries for it are being
 *     dropped right now; replaying an old one is the same fail-open by another
 *     route.
 *  4. **The lookup itself failed.** Handled by the caller
 *     (`assertRedeliverAllowed` turns a throwing guard into a refusal), because
 *     "we could not check" must never read as "allowed".
 *
 * It ALLOWS an active subscription that is legitimately unsigned (`secret` is
 * optional on the authoring envelope) and any row from another producer
 * (`source !== 'webhook'`) — this guard speaks only for webhook rows.
 *
 * ## The narrow fail-open this closes deliberately
 * Case 3 is checked as *"a value is stored but nothing came back"*, not as
 * *"the resolver threw"*. Presence is decidable from the masked read even
 * though the value is not, so the guard asks the question it can actually
 * answer.
 *
 * [#8542] That reasoning has since moved DOWN into `resolveWebhookSecret`,
 * which now raises `WebhookSecretUnresolvableError` instead of returning the
 * same `undefined` it uses for "authored unsigned". The reason it had to move:
 * the ENQUEUE path had the identical ambiguity and no way to see it — and there
 * it failed open, arming the subscription and delivering unsigned. One seam,
 * one rule, so a consumer cannot forget to re-derive it. This guard keeps its
 * own presence check because the refusal REASON it returns is written from the
 * subscription row, and keeps its behaviour byte for byte: an unresolvable key
 * is refused with the text below, and anything else still propagates.
 *
 * ## A declared webhook's deliveries (ADR-0131 D2/D6)
 * A declared webhook has no `sys_webhook` row: its deliveries carry
 * `ref_id = declared:<package>/<name>`, or `declared:<name>` for the
 * environment's own (`declaredWebhookRefId`), and the guard asks the same
 * questions of the declaration, through the reader the dispatcher uses. A
 * `ref_id` naming a package is judged by exactly that package's declaration
 * (ADR-0150 D5), never another holder's. One naming no package — the
 * environment's, or a delivery written before the package coordinate, the
 * 18.x ceremony's re-source among them — is judged by the declaration a
 * caller with no package resolves (D3): with one holder exactly as before;
 * with two it is refused naming both, and sent to neither.
 * Not declared any more is case 1, switched off (the activation ledger, or a
 * declared `isActive: false` no ledger row overrides) is case 2. Case 3 cannot
 * arise: the signing key is code, held with the declaration. A delivery whose
 * `ref_id` names a `sys_webhook` row is judged by that row, whatever name it
 * holds: the dispatcher reads such a row as itself (regime C), and the
 * ownership ceremony re-sourced every pristine 18.0 copy's deliveries to
 * `declared:NAME` before it deleted the copy.
 */

import type { IDataEngine } from '@objectstack/spec/contracts';
import {
    DeclaredWebhookAmbiguousError,
    declaredWebhookActivationPath,
    declaredWebhookAddressOfRefId,
    type DeclaredWebhookReader,
} from './declared-webhooks.js';
import {
    WEBHOOK_OBJECT,
    WEBHOOK_SECRET_FIELD,
    isWebhookSecretUnresolvable,
    resolveWebhookSecret,
} from './webhook-secret.js';

/**
 * [#21913] The execution context the guard reads `sys_webhook` under: the
 * explicit system opt-in. The guard runs inside the messaging service's
 * redeliver path, after the delivery row has been read under the requesting
 * caller's organization, and reads the subscription that row belongs to only
 * for its existence, `active` switch, name and secret posture — the inputs of
 * the refusal reason it returns. What it reads and returns is unchanged by the opt-in; it
 * may simply no longer rely on a missing principal to pass the security
 * middleware's principal-less hand-off, which ADR-0096 D5 closes.
 */
const SYSTEM_CTX = { isSystem: true } as const;

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
    declared?: DeclaredWebhookReader,
): (row: RedeliverGuardRow) => Promise<string | undefined> {
    return async (row) => {
        if (row.source !== 'webhook') return undefined;

        const address = declaredWebhookAddressOfRefId(row.refId);
        if (address !== undefined) return judgeDeclared(declared, address);

        const subscription = (await engine.findOne(
            subscriptionsObject,
            { where: { id: row.refId } },
            { context: SYSTEM_CTX },
        )) as Record<string, unknown> | null;

        if (!subscription) {
            return (
                `the ${subscriptionsObject} subscription '${row.refId}' this delivery belongs to no `
                + 'longer exists, so there is nothing left to say whether it may still be signed and '
                + 'sent, so it is refused rather than risk going out unsigned. Recreate the webhook if the '
                + 'endpoint should keep receiving events; '
                + 'new events are then delivered signed.'
            );
        }

        // [#22804] Case 2: the off switch. `=== true` is the dispatcher's own
        // predicate (`AutoEnqueuer` loads `{ active: true }`), so a replay is
        // refused for exactly the rows automatic dispatch skips — `false`, and
        // a null or absent value too. Before the secret checks on purpose:
        // re-activating is the remedy an operator reaches for first.
        if (subscription.active !== true) {
            return (
                `webhook '${String(subscription.name ?? row.refId)}' is inactive, and an inactive webhook `
                + 'is skipped by the dispatcher, so this delivery is refused rather than sent to an '
                + 'endpoint that was switched off. Fix: re-activate the webhook, then redeliver; '
                + 'new events are delivered again from the moment it is active.'
            );
        }

        // Presence is decidable on the masked read — a set secret comes back as
        // the engine's mask, an unset one as null — even though the value is not.
        const storesSecret =
            subscription[WEBHOOK_SECRET_FIELD] != null
            && subscription[WEBHOOK_SECRET_FIELD] !== '';
        if (!storesSecret) return undefined;

        // [#8542] The seam now RAISES for the case this guard used to detect on
        // its own — the enqueue path needed the same distinction and could only
        // get it from a throw (its `catch` is what parks the subscription), so
        // the rule moved down one level instead of being written twice. This
        // guard's contract is unchanged in both directions, which is the point:
        // a stored-but-unresolvable key still returns the refusal REASON below
        // (case 3), and any OTHER failure still propagates, because "we could
        // not check" must never read as "allowed" (case 4, handled by
        // `assertRedeliverAllowed`).
        let plaintext: string | undefined;
        try {
            plaintext = await resolveWebhookSecret(engine, subscription as { id: string }, subscriptionsObject);
        } catch (err) {
            if (!isWebhookSecretUnresolvable(err)) throw err;
        }
        if (plaintext) return undefined;

        return (
            `webhook '${String(subscription.name ?? row.refId)}' stores a signing secret that cannot `
            + 'be recovered, so this delivery cannot be authenticated as coming from us — refusing '
            + 'rather than sending it unsigned. Fix: register a CryptoProvider with the same key '
            + 'the secret was written under and make sure the sys_secret row is reachable.'
        );
    };
}

/**
 * The guard's answer for a delivery a declared webhook produced (see the module
 * doc). A lookup that throws propagates: "we could not check" never reads as
 * "allowed". A delivery naming no package of a name two packages declare is
 * refused naming both (ADR-0150 D3): it belongs to one of them, and nothing
 * says which. Both are counted when one is disabled (`holdersOf`): the row is
 * durable, and a disable does not say whose it is.
 */
async function judgeDeclared(
    declared: DeclaredWebhookReader | undefined,
    address: { packageId?: string; name: string },
): Promise<string | undefined> {
    const { name } = address;
    // [#31699 round 3] A delivery row is durable, so a reference naming no
    // package is judged against EVERY package holder of the name, a disabled
    // package's included: the delivery may be the disabled one's (written
    // before the upgrade), and nothing says it is not.
    if (address.packageId === undefined && typeof declared?.holdersOf === 'function') {
        const packages = (await declared.holdersOf(name)).filter((holder): holder is string => holder !== null);
        if (packages.length > 1) {
            return (
                `this delivery of declared webhook '${name}' names no package, and the name is declared by more than one: `
                + `${packages.map((packageId) => `package "${packageId}"`).join(', ')} (a disabled package counts: the `
                + 'delivery may be its). It is refused rather than sent to a holder picked for it. New events are '
                + 'delivered per package, each under its own reference.'
            );
        }
    }
    let declaration;
    try {
        declaration = !declared
            ? null
            : address.packageId !== undefined
                ? await declared.declaredWebhookAt(address.packageId, name)
                : await declared.declaredWebhookNamed(name);
    } catch (err) {
        if (!(err instanceof DeclaredWebhookAmbiguousError)) throw err;
        return (
            `this delivery of declared webhook '${name}' names no package, and the name is declared by more than one: `
            + `${err.message} It is refused rather than sent to a holder picked for it. New events are delivered per `
            + 'package, each under its own reference.'
        );
    }
    if (!declaration) {
        // [#31699 round 2] The slot's package (or, for a reference naming no
        // package, the name's one holder) still declares it but is disabled:
        // a disabled package's webhooks are not served, so neither dispatched
        // nor redelivered, until the package is enabled again.
        const held = await declared?.holdersOf?.(name);
        const owner = address.packageId ?? (held?.length === 1 ? held[0] ?? undefined : undefined);
        if (owner !== undefined && held?.includes(owner)) {
            return (
                `declared webhook '${name}' of package '${owner}' is not served: the package is disabled, `
                + 'and a disabled package\'s webhooks are not dispatched, so this delivery is refused. Enable the '
                + 'package, then redeliver.'
            );
        }
        return (
            `the declared webhook '${name}' this delivery belongs to is no longer declared by the application, so `
            + 'there is nothing left to say whether it may still be signed and sent, and it is refused. Declare the '
            + 'webhook again if the endpoint should keep receiving events.'
        );
    }
    if (!declaration.active) {
        return (
            `declared webhook '${name}' is switched off, and a switched-off webhook is skipped by the dispatcher, `
            + 'so this delivery is refused rather than sent to an endpoint that was switched off. Fix: switch it on '
            + `(POST ${declaredWebhookActivationPath(name, declaration.namespace)} with { "enabled": true }), then redeliver.`
        );
    }
    return undefined;
}
