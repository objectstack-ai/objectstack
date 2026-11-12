// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32445, ruling 6810324463 letter A, PR 2] The Setup action "Send in-app
 * message" and the door it calls are one surface declared in two packages:
 * the action on `sys_notification` (`@objectstack/platform-objects`), the door
 * here. This pins the pair, so neither half can move alone:
 *
 *  - the action's same-origin `target` is the route the door mounts;
 *  - its `requiredPermissions` is exactly the capability the door demands, so
 *    the action is listed to exactly the callers the door admits — and that
 *    capability is an organization-scoped one the platform administrator's
 *    grant holds;
 *  - its form is the door's closed body set, one param per key.
 */

import { describe, it, expect } from 'vitest';
import { SysNotification } from '@objectstack/platform-objects';
import { ADMIN_FULL_ACCESS_CAPABILITIES } from '@objectstack/spec';
import { PLATFORM_CAPABILITIES } from '@objectstack/spec/security';
import { IN_APP_MESSAGE_BODY_KEYS, IN_APP_MESSAGE_CAPABILITY, IN_APP_MESSAGE_ROUTE, IN_APP_MESSAGE_SEVERITIES } from './in-app-message-routes.js';

type Param = { name?: string; field?: string; type?: string; multiple?: boolean; required?: boolean; defaultValue?: unknown };

const action = (SysNotification.actions ?? []).find((a: { name: string }) => a.name === 'send_in_app_message') as
    | { type: string; target: string; locations: string[]; requiredPermissions?: string[]; params?: Param[] }
    | undefined;

describe('send_in_app_message ↔ POST /api/v1/messaging/in-app-messages', () => {
    it('is a same-origin api action on the Notification Events list toolbar, aimed at the door', () => {
        expect(action).toBeDefined();
        expect(action!.type).toBe('api');
        expect(action!.locations).toEqual(['list_toolbar']);
        expect(action!.target).toBe(IN_APP_MESSAGE_ROUTE);
    });

    it("declares exactly the door's capability — an organization-scoped one the platform administrator holds", () => {
        expect(action!.requiredPermissions).toEqual([IN_APP_MESSAGE_CAPABILITY]);
        expect(PLATFORM_CAPABILITIES.find((c) => c.name === IN_APP_MESSAGE_CAPABILITY)?.scope).toBe('org');
        expect(ADMIN_FULL_ACCESS_CAPABILITIES.systemPermissions).toContain(IN_APP_MESSAGE_CAPABILITY);
    });

    it("draws the door's closed body set, one param per key, and nothing else", () => {
        const names = (action!.params ?? []).map((p) => p.name ?? p.field);
        expect([...names].sort()).toEqual([...IN_APP_MESSAGE_BODY_KEYS].sort());
        const byName = new Map((action!.params ?? []).map((p) => [p.name ?? p.field, p]));
        expect(byName.get('recipients')).toMatchObject({ type: 'user', multiple: true });
        expect(byName.get('everyone')).toMatchObject({ type: 'boolean' });
        expect(byName.get('title')).toMatchObject({ required: true });
        expect(byName.get('body')).toMatchObject({ required: true });
        // Field-backed: the event's own severity field, whose options are the door's.
        expect(byName.get('severity')).toMatchObject({ field: 'severity', defaultValue: 'info' });
        const options = (SysNotification.fields.severity as { options?: Array<{ value: string }> }).options ?? [];
        expect(options.map((o) => o.value)).toEqual([...IN_APP_MESSAGE_SEVERITIES]);
    });
});
