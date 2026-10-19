// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7557, #24097] The API-exposure gate's by-name object read
 * (`loadObjectItem`) and an object of a DISABLED package.
 *
 * The by-name `/meta` read refuses that object `404 OBJECT_PACKAGE_DISABLED`,
 * as the listing omits it. For this gate that refusal means "no object here":
 * there is no declared exposure policy to judge, and the data plane refuses the
 * request with the same code right after. It is not a failed read, so the
 * gate's fail-open warning ("object metadata read failed") is not logged for
 * it. Before, it was logged on every `/data` request to such an object.
 *
 * Any OTHER thrown read still fails open and still warns: that half is pinned
 * beside it, so the exemption cannot widen into silence.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadObjectItem } from './meta-item-read-gate.js';

const source = (getObjectItem: (name: string) => Promise<unknown>) =>
    ({ getMetaItems: async () => ({ items: [] }), getObjectItem }) as any;

describe('#24097 — loadObjectItem and a disabled package\'s object', () => {
    let warn: ReturnType<typeof vi.spyOn>;
    let priorLevel: string | undefined;

    beforeEach(() => {
        // The warning must be observable for the "not logged" half to mean
        // anything: the suite's harness may lower the REST log level.
        priorLevel = process.env.OS_REST_LOG;
        process.env.OS_REST_LOG = 'warn';
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => {
        warn.mockRestore();
        if (priorLevel === undefined) delete process.env.OS_REST_LOG;
        else process.env.OS_REST_LOG = priorLevel;
    });

    it('OBJECT_PACKAGE_DISABLED reads as "no object", with no fail-open warning', async () => {
        const refused = Object.assign(new Error('disabled package'), {
            code: 'OBJECT_PACKAGE_DISABLED', status: 404, object: 'demo_widget',
        });

        const item = await loadObjectItem(source(async () => { throw refused; }), 'demo_widget');

        expect(item).toBeUndefined();
        expect(warn).not.toHaveBeenCalled();
    });

    it('any other thrown read still fails open AND warns', async () => {
        const item = await loadObjectItem(
            source(async () => { throw Object.assign(new Error('store down'), { status: 503 }); }),
            'demo_widget',
        );

        expect(item).toBeUndefined();
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0]?.[0])).toContain('failing open');
    });

    it('the control: a served object is returned', async () => {
        const item = await loadObjectItem(
            source(async (name) => ({ type: 'object', name, item: { name, enable: { apiEnabled: true } } })),
            'healthy_widget',
        );

        expect(item?.name).toBe('healthy_widget');
        expect(warn).not.toHaveBeenCalled();
    });
});
