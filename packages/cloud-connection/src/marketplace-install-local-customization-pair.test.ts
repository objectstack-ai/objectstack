// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0146 D2 / D3] `planCustomizationPairInstall` — the pure walk of a
 * paired customization package's body into the items its install writes.
 *
 * Pinned:
 *  - the keys `GET /packages/:id/export` writes for a pair — `viewItems`, a
 *    collection (`dashboards`), `objectExtensions` — each become items of the
 *    canonical type, named as the export names them, in the registry's load
 *    order (an extension before a view that names its fields);
 *  - a `views:` container is saved under the object it binds;
 *  - the package's own keys (identity, base, deployment) are not items, and
 *    seed `data` is reported, not refused;
 *  - every key with no item form, a nameless item, a non-array collection and
 *    two items claiming one name are refused, every one of them at once.
 */

import { describe, it, expect } from 'vitest';
import { planCustomizationPairInstall } from './marketplace-install-local-customization-pair.js';

const OVERRIDES = { package: 'com.example.showcase', basedOn: '0.1.0' };

/** What `GET /packages/com.example.showcase.custom/export` wrote, flat. */
function exportedPair(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        dashboards: [{ name: 'showcase_overview', label: 'Overview (ours)', overrides: OVERRIDES }],
        viewItems: [{ name: 'showcase_task.in_progress', label: 'In progress (ours)', overrides: OVERRIDES }],
        id: 'com.example.showcase.custom',
        name: 'ObjectStack Showcase (custom)',
        version: '0.1.0',
        namespace: 'showcase_custom',
        dependencies: { 'com.example.showcase': '^0' },
        ...extra,
    };
}

describe('planCustomizationPairInstall — the items of an exported pair', () => {
    it('reads every item the export carries, typed and named as the export writes them, in load order', () => {
        const plan = planCustomizationPairInstall(exportedPair({
            objectExtensions: [{ extend: 'showcase_task', fields: { showcase_custom_flag: { type: 'boolean' } } }],
        }));
        expect(plan.ok).toBe(true);
        if (!plan.ok) return;
        expect(plan.items.map((i) => [i.type, i.name, i.path])).toEqual([
            ['object_extension', 'showcase_task', 'objectExtensions[0]'],
            ['view', 'showcase_task.in_progress', 'viewItems[0]'],
            ['dashboard', 'showcase_overview', 'dashboards[0]'],
        ]);
        expect(plan.items[1]!.item).toEqual({ name: 'showcase_task.in_progress', label: 'In progress (ours)', overrides: OVERRIDES });
        expect(plan.carriesSeedData).toBe(false);
    });

    it('saves a `views:` container under the object it binds', () => {
        const plan = planCustomizationPairInstall(exportedPair({
            viewItems: undefined,
            views: [{ list: { type: 'grid', data: { provider: 'object', object: 'showcase_task' }, columns: ['title'] } }],
        }));
        expect(plan.ok).toBe(true);
        if (!plan.ok) return;
        expect(plan.items.find((i) => i.type === 'view')).toMatchObject({ name: 'showcase_task', path: 'views[0]' });
    });

    it('treats the package\'s own keys as no items, and reports seed `data` without refusing it', () => {
        const plan = planCustomizationPairInstall(exportedPair({
            label: 'Showcase (custom)',
            data: [{ object: 'showcase_task', records: [{ title: 'First' }] }],
        }));
        expect(plan.ok).toBe(true);
        if (!plan.ok) return;
        expect(plan.items).toHaveLength(2);
        expect(plan.carriesSeedData).toBe(true);
    });

    it('ignores an empty collection', () => {
        const plan = planCustomizationPairInstall(exportedPair({ reports: [] }));
        expect(plan.ok).toBe(true);
    });

    it('refuses every key with no item form, every nameless item and every duplicate, at once', () => {
        const plan = planCustomizationPairInstall(exportedPair({
            translations: [{ en: { showcase_task: { label: 'Task' } } }],
            unclassifiedKey: { anything: true },
            reports: { not: 'an array' },
            apps: [{ label: 'no name' }],
            dashboards: [
                { name: 'showcase_overview', overrides: OVERRIDES },
                { name: 'showcase_overview', overrides: OVERRIDES },
            ],
        }));
        expect(plan.ok).toBe(false);
        if (plan.ok) return;
        const text = plan.problems.join('\n');
        expect(text).toContain('`translations` is not part of a paired customization package');
        expect(text).toContain('`unclassifiedKey` is not part of a paired customization package');
        expect(text).toContain('`reports` is not an array of report definitions');
        expect(text).toContain('`apps[0]` has no name');
        expect(text).toContain("two items claim dashboard 'showcase_overview' (`dashboards[0]` and `dashboards[1]`)");
        expect(plan.problems).toHaveLength(5);
    });

    it('keys an email template by its locale: two locales are two items, one locale twice is refused', () => {
        const two = planCustomizationPairInstall(exportedPair({
            emailTemplates: [
                { name: 'showcase_welcome', locale: 'en-US', subject: 'Ours', overrides: OVERRIDES },
                { name: 'showcase_welcome', locale: 'fr-FR', subject: 'Bienvenue' },
            ],
        }));
        expect(two.ok).toBe(true);
        const twice = planCustomizationPairInstall(exportedPair({
            emailTemplates: [
                { name: 'showcase_welcome', locale: 'fr-FR', subject: 'A' },
                { name: 'showcase_welcome', locale: 'fr-FR', subject: 'B' },
            ],
        }));
        expect(twice.ok).toBe(false);
        if (twice.ok) return;
        expect(twice.problems).toEqual([
            "two items claim email_template 'showcase_welcome' (locale 'fr-FR') (`emailTemplates[0]` and `emailTemplates[1]`)",
        ]);
    });

    it('refuses an object extension that names no object', () => {
        const plan = planCustomizationPairInstall(exportedPair({ objectExtensions: [{ fields: {} }] }));
        expect(plan.ok).toBe(false);
        if (plan.ok) return;
        expect(plan.problems).toEqual(['`objectExtensions[0]` has no name']);
    });
});
