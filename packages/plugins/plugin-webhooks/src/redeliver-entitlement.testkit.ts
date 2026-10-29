// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A `security` service double for the redeliver door's entitlement gate
 * (`redeliver-entitlement.ts`): it answers `explain` the way the real service
 * answers the one question the gate asks — may this caller `update`
 * `sys_webhook`? — for the users it is told are webhook administrators, and
 * records every question it was asked.
 *
 * A suite whose subject is NOT entitlement (tenant scope, the veto, the auth
 * gate, the session read) registers {@link webhookAdministrationSecurity} with
 * no argument, so every signed-in caller in it is an administrator and the
 * suite drives the door's admitted path exactly as it did before the gate.
 */

export interface AskedEntitlement {
    readonly object: string;
    readonly operation: string;
    readonly userId: unknown;
    /** The organization the caller's context was resolved in when the gate asked. */
    readonly tenantId: unknown;
}

export interface WebhookAdministrationSecurityDouble {
    readonly asked: AskedEntitlement[];
    explain(request: { object: string; operation: string }, context?: { userId?: unknown; tenantId?: unknown }): Promise<any>;
}

/**
 * @param isAdministrator which signed-in users may administer webhooks;
 *   omitted, every one may.
 */
export function webhookAdministrationSecurity(
    isAdministrator: (userId: unknown) => boolean = () => true,
): WebhookAdministrationSecurityDouble {
    const asked: AskedEntitlement[] = [];
    return {
        asked,
        async explain(request, context) {
            asked.push({
                object: request.object,
                operation: request.operation,
                userId: context?.userId,
                tenantId: context?.tenantId,
            });
            const allowed = request.object === 'sys_webhook'
                && request.operation === 'update'
                && isAdministrator(context?.userId);
            return { allowed, layers: [] };
        },
    };
}
