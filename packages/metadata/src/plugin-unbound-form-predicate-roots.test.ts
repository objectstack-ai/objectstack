// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The artifact-ingestion door warns — once per artifact, operator-visibly —
 * when a pre-current-era artifact carries form-view predicates whose ROOT
 * identifier is unbound and therefore faults OPEN (#12915 scope C, maintainer
 * ruling 2026-08-28 「同意C」).
 *
 * `__fixtures__/hotcrm-17.1-built-bare-root-predicates.artifact.json` reproduces
 * the measured shape: a lead form view whose `disqualification_reason` /
 * `duplicate_of_type` / `duplicate_of_lead` entries are unconditionally
 * `required: true` and gated by `visibleWhen` predicates rooted at a BARE field
 * identifier — the 17.1 era's working spelling. On a 17.2 runtime each faults,
 * visibility fails open, the fields render, and their `required: true`
 * dead-ends console record creation while the same payload POSTs 201 through
 * REST. Nothing refused and nothing logged; this suite pins the log.
 *
 * The suite is deliberately weighted toward the SILENT directions — a notice
 * that fires on a healthy or current artifact trains operators to ignore the
 * channel, which costs more than the missed warning it was meant to prevent.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveInstalledSpecVersion } from '@objectstack/metadata-core';
import { MetadataPlugin } from './plugin.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(HERE, '__fixtures__/hotcrm-17.1-built-bare-root-predicates.artifact.json');

/** Fresh parse per test — `_parseAndRegisterArtifact` mutates items in place. */
function loadFixture(): any {
    return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
}

function fakeCtx() {
    return {
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        registerService: vi.fn(),
        getService: vi.fn(() => undefined),
        trigger: vi.fn(),
    } as any;
}

function newPlugin(): any {
    return new MetadataPlugin({ watch: false, config: { bootstrap: 'lazy' } });
}

/** Just the notices this feature emits — never the #12772 conversion summaries. */
function unboundRootWarnings(ctx: any): string[] {
    return (ctx.logger.warn.mock.calls as any[])
        .map((call) => String(call[0]))
        .filter((message) => message.includes('root identifier is NOT bound'));
}

describe('artifact door — unbound form-predicate roots are announced to the operator (#12915)', () => {
    it('the fixture carries the incident shape (premise guard)', () => {
        const fixture = loadFixture();
        // If a later edit ever launders these away, every assertion below stops
        // testing the incident while staying green.
        expect(fixture.manifest.engines.protocol).toBe('^17.0.0-rc.1');
        const leadFields = fixture.views[0].form.sections[0].fields;
        const gated = leadFields.filter(
            (f: any) => f?.required === true && f?.visibleWhen?.dialect === 'cel',
        );
        expect(gated.map((f: any) => f.field)).toEqual([
            'disqualification_reason',
            'duplicate_of_type',
            'duplicate_of_lead',
        ]);
        // Bare roots: no `record.` prefix anywhere in those three sources.
        for (const field of gated) expect(field.visibleWhen.source).not.toContain('record.');
        // …and the fixture also carries the two SILENT controls: a `record.`-rooted
        // predicate whose string literal contains identifier-shaped text, and a
        // second view that is entirely healthy.
        expect(leadFields.at(-1).visibleWhen.source).toBe('record.note != "status unqualified"');
        expect(fixture.views[1].form.sections[0].fields[1].visibleWhen.source)
            .toBe('record.status == "closed"');
    });

    it('emits ONE notice naming the affected view, the version evidence and the rebuild remedy', async () => {
        const plugin = newPlugin();
        const ctx = fakeCtx();

        await plugin._parseAndRegisterArtifact(ctx, loadFixture(), 'fixture-bare-roots');

        const warnings = unboundRootWarnings(ctx);
        expect(warnings).toHaveLength(1);
        const notice = warnings[0]!;

        // Version evidence — the authored floor and the runtime it is below.
        expect(notice).toContain('fixture-bare-roots');
        expect(notice).toContain('17.0.0');
        expect(notice).toContain(String(resolveInstalledSpecVersion()));
        // Volume, the roots seen, and the bound vocabulary to compare against.
        expect(notice).toContain('3 form-view predicate(s)');
        expect(notice).toContain("'status'");
        expect(notice).toContain("'duplicate_of_type'");
        expect(notice).toContain("'record', 'previous', 'parent', 'data'");
        // Which view, with the first path as the anchor.
        expect(notice).toContain('1 view(s): crm_lead');
        expect(notice).toContain('views[0].form.sections[0].fields[4].visibleWhen');
        // The consequence in one clause, and the prescription.
        expect(notice).toContain('fails OPEN');
        expect(notice).toContain("'os build'");
        // The healthy sibling view is NOT named.
        expect(notice).not.toContain('crm_case');
    });

    it('does not repeat on re-ingestion — the HMR watcher replays the same artifact', async () => {
        const plugin = newPlugin();
        const ctx = fakeCtx();

        await plugin._parseAndRegisterArtifact(ctx, loadFixture(), 'fixture-bare-roots');
        await plugin._parseAndRegisterArtifact(ctx, loadFixture(), 'fixture-bare-roots');
        await plugin._parseAndRegisterArtifact(ctx, loadFixture(), 'fixture-bare-roots');

        expect(unboundRootWarnings(ctx)).toHaveLength(1);
    });

    it('says NOTHING about an artifact authored against the current surface', async () => {
        // The boundary that keeps this out of contract territory: the notice
        // lives inside the versioned window #12772 built, so an artifact
        // declaring the current floor gets zero notices even carrying the very
        // same bare-root predicates. Derived from the installed spec rather than
        // hardcoded, so the pin cannot rot into vacuity on the next spec bump.
        const current = resolveInstalledSpecVersion();
        expect(current, 'spec version must resolve for this pin to mean anything').toBeTruthy();

        const fixture = loadFixture();
        fixture.manifest.engines.protocol = `^${current}`;

        const plugin = newPlugin();
        const ctx = fakeCtx();
        await plugin._parseAndRegisterArtifact(ctx, fixture, 'fixture-current-floor');

        expect(unboundRootWarnings(ctx)).toEqual([]);
    });

    it('says NOTHING about an old artifact whose predicates all carry a bound root', async () => {
        const fixture = loadFixture();
        for (const field of fixture.views[0].form.sections[0].fields) {
            if (field.visibleWhen) field.visibleWhen.source = `record.${field.visibleWhen.source}`;
        }
        // Still old, still gated-required — only the root is now bound.
        expect(fixture.manifest.engines.protocol).toBe('^17.0.0-rc.1');

        const plugin = newPlugin();
        const ctx = fakeCtx();
        await plugin._parseAndRegisterArtifact(ctx, fixture, 'fixture-record-rooted');

        expect(unboundRootWarnings(ctx)).toEqual([]);
    });

    it('does not cry wolf on identifier-shaped text inside a string literal', async () => {
        // Reduced to the single control so a failure here reads as "the literal
        // stripping broke", not "something in the fixture changed".
        const fixture = loadFixture();
        fixture.views = [
            {
                form: {
                    type: 'simple',
                    data: { object: 'crm_lead' },
                    sections: [{
                        name: 'lead',
                        fields: [{
                            field: 'note',
                            visibleWhen: { dialect: 'cel', source: 'record.note == "status unqualified"' },
                        }],
                    }],
                },
            },
        ];

        const plugin = newPlugin();
        const ctx = fakeCtx();
        await plugin._parseAndRegisterArtifact(ctx, fixture, 'fixture-literal-control');

        expect(unboundRootWarnings(ctx)).toEqual([]);
    });

    it('changes NO behaviour: the artifact still registers and its predicates are untouched', async () => {
        const plugin = newPlugin();
        const ctx = fakeCtx();
        const pristine = loadFixture();

        const total = await plugin._parseAndRegisterArtifact(ctx, loadFixture(), 'fixture-bare-roots');
        expect(total).toBeGreaterThan(0);

        // No refusal (the call above would have thrown) and no rewrite: the
        // registered view carries the authored source verbatim, bare root and
        // all. Rewriting is #12915 scope A, deferred by the same ruling.
        const registered: any = await plugin.manager.get('view', 'crm_lead');
        expect(registered).toBeDefined();
        const authored = pristine.views[0].form.sections[0].fields;
        const stored = registered.form.sections[0].fields;
        for (const [index, field] of authored.entries()) {
            expect(stored[index].visibleWhen?.source).toBe(field.visibleWhen?.source);
        }
    });
});
