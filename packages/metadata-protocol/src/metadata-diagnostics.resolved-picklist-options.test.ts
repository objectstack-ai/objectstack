// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #26886 — load-time diagnostics judge a picklist-bound field as its author
 * wrote it, never with the `options` the runtime resolved onto it.
 *
 * Every object read serves a field that authors `picklist: '<name>'` with the
 * list's options written beside it, and the field schema refuses `picklist`
 * and `options` together. Judging the served copy flagged every shared-picklist
 * field of every app. The resolution marks the array it derived
 * (`markResolvedPicklistOptions`), and only a marked array is left out of the
 * judgement:
 *
 *  - a field naming only a picklist, served with resolved options: clean;
 *  - a field that AUTHORS both keys (an unmarked array): still flagged, with
 *    the rule's own message, at `fields.NAME.options`;
 *  - a field with inline `options` only: clean, before and after.
 *
 * The mark never reaches a response or a memo key: a marked document and an
 * unmarked one with the same JSON are two verdicts.
 */
import { describe, expect, it } from 'vitest';
import { markResolvedPicklistOptions } from '@objectstack/metadata-core';
import { computeMetadataDiagnostics, decorateMetadataItem } from './metadata-diagnostics.js';

const BOTH_KEYS = '`picklist` and `options` cannot both be declared';

const resolved = () => markResolvedPicklistOptions([{ label: 'Tech', value: 'tech' }]);
const authored = () => [{ label: 'Tech', value: 'tech' }];

function objectWith(fields: Record<string, unknown>) {
    return { name: 'pk_probe', label: 'Probe', fields: { name: { name: 'name', type: 'text', label: 'Name' }, ...fields } };
}

const industry = (options: unknown[]) =>
    ({ name: 'industry', type: 'select', label: 'Industry', picklist: 'industry', options });

function bothKeysPaths(diagnostics: ReturnType<typeof computeMetadataDiagnostics>): string[] {
    return (diagnostics?.errors ?? []).filter((e) => e.message.startsWith(BOTH_KEYS)).map((e) => e.path);
}

describe('diagnostics — options resolved from a shared picklist', () => {
    it('a field naming only a picklist, served with its resolved options, is clean', () => {
        expect(computeMetadataDiagnostics('object', objectWith({ industry: industry(resolved()) }))).toEqual({ valid: true });
    });

    it('a field that authors `options` beside `picklist` is still flagged, at its options path', () => {
        const diagnostics = computeMetadataDiagnostics('object', objectWith({ industry: industry(authored()) }));
        expect(diagnostics?.valid).toBe(false);
        expect(bothKeysPaths(diagnostics)).toEqual(['fields.industry.options']);
    });

    it('a field with inline `options` only is clean', () => {
        const inline = { name: 'stage', type: 'select', label: 'Stage', options: [{ label: 'Open', value: 'open' }] };
        expect(computeMetadataDiagnostics('object', objectWith({ stage: inline }))).toEqual({ valid: true });
    });

    it('a marked array on a field with no `picklist` is judged as written', () => {
        // A one-character option value is refused; left out, nothing would be.
        const stray = { name: 'stage', type: 'select', label: 'Stage', options: markResolvedPicklistOptions([{ label: 'X', value: 'x' }]) };
        const diagnostics = computeMetadataDiagnostics('object', objectWith({ stage: stray }));
        expect(diagnostics?.errors?.map((e) => e.path)).toEqual(['fields.stage.options.0.value']);
    });

    it('a marked and an unmarked document with the same JSON are two verdicts, in either order', () => {
        const marked = objectWith({ industry: industry(resolved()) });
        const unmarked = objectWith({ industry: industry(authored()) });
        expect(JSON.stringify(marked)).toBe(JSON.stringify(unmarked));
        expect(bothKeysPaths(computeMetadataDiagnostics('object', unmarked))).toEqual(['fields.industry.options']);
        expect(computeMetadataDiagnostics('object', marked)).toEqual({ valid: true });
        expect(bothKeysPaths(computeMetadataDiagnostics('object', unmarked))).toEqual(['fields.industry.options']);
    });

    it('the served item keeps both keys and carries no trace of the mark', () => {
        const served = decorateMetadataItem('object', objectWith({ industry: industry(resolved()) })) as any;
        expect(served._diagnostics).toEqual({ valid: true });
        expect(served.fields.industry).toMatchObject({ picklist: 'industry', options: [{ label: 'Tech', value: 'tech' }] });
        expect(JSON.parse(JSON.stringify(served.fields.industry))).toEqual(industry(authored()));
        expect(Object.keys(served.fields.industry.options)).toEqual(['0']);
    });
});
