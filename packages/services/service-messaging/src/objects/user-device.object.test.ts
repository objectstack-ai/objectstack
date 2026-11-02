// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `sys_user_device`'s declaration (ADR-0012 §6): system-owned and closed to
 * the generic data API, no organization column (spec rule a), and the same
 * platform vocabulary as the registration it stores.
 */

import { describe, it, expect } from 'vitest';
import { RegisterDeviceRequestSchema } from '@objectstack/spec/api';
import { UserDeviceSchema } from '@objectstack/spec/system';
import { UserDevice } from './user-device.object.js';

describe('sys_user_device declaration', () => {
    it('is closed to the generic data API: no method is exposed', () => {
        expect(UserDevice.enable?.apiEnabled).toBe(false);
        expect(UserDevice.enable?.apiMethods).toEqual([]);
        expect(UserDevice.managedBy).toBe('engine-owned');
    });

    it('has no organization column and opts out of tenancy (a device belongs to a user)', () => {
        expect(Object.keys(UserDevice.fields)).not.toContain('organization_id');
        expect(UserDevice.tenancy).toEqual({ enabled: false });
    });

    it('stores the platform vocabulary the registration admits, no more and no less', () => {
        const declared = (UserDevice.fields.platform as any).options.map((o: any) => (typeof o === 'string' ? o : o.value));
        const admitted = (RegisterDeviceRequestSchema as any).shape.platform.options;
        expect([...declared].sort()).toEqual([...admitted].sort());
        expect((UserDeviceSchema as any).shape.platform.options.slice().sort()).toEqual([...admitted].sort());
    });

    it('carries the two unique indexes the registry relies on', () => {
        expect(UserDevice.indexes).toEqual(expect.arrayContaining([
            expect.objectContaining({ fields: ['user_id', 'device_id'], unique: 'global' }),
            expect.objectContaining({ fields: ['token'], unique: 'global' }),
        ]));
    });
});
