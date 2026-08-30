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
        // …and the fixture also carries the SILENT controls: a `record.`-rooted
        // predicate whose string literal contains identifier-shaped text, a
        // FIELD-level `current_user` predicate (which resolves there since
        // objectui#6010 — and, since objectui#6110 + #6111, resolves at SECTION
        // level too — so it must never be flagged), and a second view that is
        // entirely healthy.
        expect(leadFields.at(-2).visibleWhen.source).toBe('record.note != "status unqualified"');
        expect(leadFields.at(-1).visibleWhen.source).toBe('current_user.role == "admin"');
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
        // The vocabulary is printed PER SURFACE, and only for the surfaces the
        // findings actually implicate — these are all field findings, so the
        // section rule is not quoted at an operator who has no section problem.
        expect(notice).toContain(
            "bound roots on a form FIELD: 'record', 'previous', 'parent', 'data', "
            + "'current_user', 'user', 'ctx', 'os'",
        );
        expect(notice).not.toContain('form SECTION');
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

    it('says NOTHING about an old artifact whose only predicates are field-level current_user tests', async () => {
        // The regression the first correction existed for. `current_user` and
        // its ADR-0068 alias roots resolve at FIELD level (objectui#6010), so a
        // legacy artifact using them is healthy on this surface — flagging it
        // would be the cry-wolf class the card forbids. The section half of the
        // same claim is two cases below.
        for (const source of [
            'current_user.role == "admin"',
            'user.roles.size() > 0',
            'ctx.user.isPlatformAdmin',
            'os.user.role == "admin"',
        ]) {
            const fixture = loadFixture();
            fixture.views = [{
                form: {
                    type: 'simple',
                    data: { provider: 'object', object: 'crm_lead' },
                    sections: [{
                        name: 'lead',
                        fields: [{ field: 'internal_note', visibleWhen: { dialect: 'cel', source } }],
                    }],
                },
            }];
            expect(fixture.manifest.engines.protocol).toBe('^17.0.0-rc.1');

            const plugin = newPlugin();
            const ctx = fakeCtx();
            await plugin._parseAndRegisterArtifact(ctx, fixture, `fixture-cu-${source}`);

            expect(unboundRootWarnings(ctx), source).toEqual([]);
        }
    });

    it('says NOTHING about a SECTION-level current_user predicate either', async () => {
        // ⚠️ INVERTED IN PLACE (#13072). This case read "DOES flag the same
        // root at section level, and prints the section vocabulary there", and
        // asserted one warning quoting `bound roots on a form SECTION:
        // 'record', 'previous', 'parent', 'data'`. That vocabulary was derived
        // from the section contract sentence #12914 replaced: objectui#6110
        // threads the host shell's predicate scope into `isSectionVisible`
        // where it used to pass `undefined`, and objectui#6111 evaluates the
        // authored section `visibleWhen` on the `section-divider` pseudo-field
        // with the same scope bound. The predicate RESOLVES, so a notice about
        // it would be a false operator signal on a healthy legacy artifact —
        // the cry-wolf class this suite is deliberately weighted against.
        const fixture = loadFixture();
        fixture.views = [{
            form: {
                type: 'simple',
                data: { provider: 'object', object: 'crm_lead' },
                sections: [{
                    name: 'lead',
                    visibleWhen: { dialect: 'cel', source: 'current_user.role == "admin"' },
                    fields: [{ field: 'internal_note' }],
                }],
            },
        }];

        const plugin = newPlugin();
        const ctx = fakeCtx();
        await plugin._parseAndRegisterArtifact(ctx, fixture, 'fixture-section-cu');

        expect(unboundRootWarnings(ctx)).toEqual([]);
    });

    it('still flags a genuinely unbound SECTION root, and prints the section rule', async () => {
        // The control the inversion above needs: the section arm of the scan
        // still reports, so "no warning" up there is a verdict about
        // `current_user` and not a section traversal that quietly stopped
        // running. It also keeps the printed section vocabulary pinned at the
        // door, which is where an operator reads it.
        const fixture = loadFixture();
        fixture.views = [{
            form: {
                type: 'simple',
                data: { provider: 'object', object: 'crm_lead' },
                sections: [{
                    name: 'lead',
                    visibleWhen: { dialect: 'cel', source: 'stage == "closed"' },
                    fields: [{ field: 'internal_note' }],
                }],
            },
        }];

        const plugin = newPlugin();
        const ctx = fakeCtx();
        await plugin._parseAndRegisterArtifact(ctx, fixture, 'fixture-section-bare');

        const warnings = unboundRootWarnings(ctx);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]!).toContain("'stage'");
        expect(warnings[0]!).toContain(
            "bound roots on a form SECTION: 'record', 'previous', 'parent', 'data', "
            + "'current_user', 'user', 'ctx', 'os'",
        );
        // No field findings here, so the field rule is not quoted.
        expect(warnings[0]!).not.toContain('form FIELD');
    });

    it('does not cry wolf on identifier-shaped text inside a string literal', async () => {
        // Reduced to the single control so a failure here reads as "the literal
        // stripping broke", not "something in the fixture changed".
        const fixture = loadFixture();
        fixture.views = [
            {
                form: {
                    type: 'simple',
                    data: { provider: 'object', object: 'crm_lead' },
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
