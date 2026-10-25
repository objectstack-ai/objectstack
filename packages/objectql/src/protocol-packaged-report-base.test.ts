// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #25788 — `ObjectStackProtocolImplementation.getPackagedReportBase`, against a
 * REAL `SchemaRegistry`: the twin of `protocol-packaged-dashboard-base.test.ts`.
 *
 * A report is overlay-editable (ADR-0126 Regime O), and the translation bundle
 * now carries `reports.<name>.label` / `.description`, so `translateReport`
 * must lose to a string an org re-authored (ADR-0029 D9.2a). It decides that by
 * comparing against the PACKAGED declaration, and that comparison is only as
 * good as the body this accessor returns: the one the code package shipped,
 * never an overlay hydrated under the plain registry key.
 */

import { describe, it, expect } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { translateReport, type TranslationBundle } from '@objectstack/spec/system';
import { SchemaRegistry } from './registry.js';

const PKG = 'com.example.showcase';
const REPORT = 'opps_by_stage';

const SHIPPED_LABEL = 'Opportunities by Stage';
const EDITED_LABEL = 'Pipeline by stage (ours)';

/** The report as the code package ships it. */
const packagedBody = () => ({
    name: REPORT,
    label: SHIPPED_LABEL,
    description: 'Summary of opportunities grouped by stage',
    type: 'summary',
    dataset: 'pipeline',
    rows: ['stage'],
    values: ['amount'],
});

/** The same report as an org's published overlay stores it — the label edited. */
const overlayBody = () => ({ ...packagedBody(), label: EDITED_LABEL });

const BUNDLE: TranslationBundle = {
    'zh-CN': { reports: { [REPORT]: { label: '各阶段商机', description: '按阶段汇总的商机' } } },
};

function makeSession() {
    const registry = new SchemaRegistry({ multiTenant: false });
    registry.logLevel = 'silent';
    const protocol: any = new ObjectStackProtocolImplementation({ registry } as any, undefined, 'env_test');
    return { protocol, registry };
}

describe('#25788 getPackagedReportBase — the packaged declaration, never an overlay', () => {
    it('answers the body the code package shipped', () => {
        const s = makeSession();
        s.registry.registerItem('report', packagedBody(), 'name', PKG);
        const base = s.protocol.getPackagedReportBase(REPORT);
        expect(base?.label).toBe(SHIPPED_LABEL);
        expect(base?._packageId).toBe(PKG);
    });

    it('is immune to an overlay hydrated under the plain registry key', () => {
        const s = makeSession();
        s.registry.registerItem('report', packagedBody(), 'name', PKG);
        s.registry.registerItem('report', overlayBody(), 'name');

        // The trap is live: the plain registry read answers the overlay…
        expect((s.registry.getItem('report', REPORT) as any)?.label).toBe(EDITED_LABEL);
        // …and the packaged base does not move.
        expect(s.protocol.getPackagedReportBase(REPORT)?.label).toBe(SHIPPED_LABEL);
    });

    it('is undefined for a report no code package ships, an unknown name, and an empty name', () => {
        const s = makeSession();
        s.registry.registerItem('report', { ...packagedBody(), name: 'tenant_report' }, 'name');
        expect(s.protocol.getPackagedReportBase('tenant_report')).toBeUndefined();
        expect(s.protocol.getPackagedReportBase('no_such_report')).toBeUndefined();
        expect(s.protocol.getPackagedReportBase('')).toBeUndefined();
    });

    it('is undefined when the host registry cannot answer', () => {
        const partial: any = new ObjectStackProtocolImplementation({ registry: {} } as any, undefined, 'env_test');
        expect(partial.getPackagedReportBase(REPORT)).toBeUndefined();
        const none: any = new ObjectStackProtocolImplementation({} as any, undefined, 'env_test');
        expect(none.getPackagedReportBase(REPORT)).toBeUndefined();
    });

    it('hands `translateReport` the base it needs: the edit is kept, the untouched description translated', () => {
        const s = makeSession();
        s.registry.registerItem('report', packagedBody(), 'name', PKG);
        s.registry.registerItem('report', overlayBody(), 'name');
        const packagedBase = s.protocol.getPackagedReportBase(REPORT);

        const served = translateReport(overlayBody(), BUNDLE, { locale: 'zh-CN', packagedBase }) as any;
        expect(served.label).toBe(EDITED_LABEL);
        expect(served.description).toBe('按阶段汇总的商机');

        const shipped = translateReport(packagedBody(), BUNDLE, { locale: 'zh-CN', packagedBase }) as any;
        expect(shipped.label).toBe('各阶段商机');
    });
});
