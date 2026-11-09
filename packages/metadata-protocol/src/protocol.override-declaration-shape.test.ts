// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30261, ADR-0146 D2, D11] `overrideDeclarationRefusedByShape` — whether the
 * schema the save door judges a body by refuses an `overrides` key on it, so
 * that no save declaring the override can land.
 *
 * The census of `os migrate packageless-overlays` lists such a row
 * `cannot_declare` (never `movable`), and the two overlay-write closes leave
 * its write open (`overlayPairFixAdmits`). Pinned over the five overlay types
 * the ceremony moves, one well-formed body per shape: the view CONTAINER is the
 * one shape that answers `true`, in each of its spellings (`list`,
 * `listViews`, `form`, `formViews`); every other shape spreads
 * `OverrideDeclarationFields` and answers `false`. So does a `view` body that
 * claims no member of the union (refused by the container member and by a
 * member that carries the key alike), and a type the door validates with no
 * schema.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';
import { overrideDeclarationRefusedByShape } from './protocol-packaged-base-refusal.js';

const grid = (columns: readonly string[]) => ({
    type: 'grid', data: { provider: 'object', object: 'task' }, columns: columns.map((field) => ({ field })),
});

/** One well-formed body per shape of the five overlay types, and whether its shape refuses the key. */
const SHAPES: ReadonlyArray<{ shape: string; type: string; body: Record<string, unknown>; refused: boolean }> = [
    { shape: 'view container (list)', type: 'view', refused: true, body: { object: 'task', list: { label: 'All', ...grid(['title']) } } },
    { shape: 'view container (listViews)', type: 'view', refused: true, body: { object: 'task', listViews: { mine: { label: 'Mine', ...grid(['title']) } } } },
    { shape: 'view container (form)', type: 'view', refused: true, body: { object: 'task', form: { type: 'simple', fields: ['title'] } } },
    { shape: 'view container (formViews)', type: 'view', refused: true, body: { object: 'task', formViews: { quick: { type: 'simple', fields: ['title'] } } } },
    { shape: 'single view', type: 'view', refused: false, body: { name: 'task.all', object: 'task', viewKind: 'list', label: 'All', config: grid(['title']) } },
    { shape: 'list overlay', type: 'view', refused: false, body: { name: 'task.all', label: 'All', object: 'task', viewKind: 'list', columns: [{ field: 'title', label: 'Title' }] } },
    { shape: 'dashboard', type: 'dashboard', refused: false, body: { name: 'crm_board', label: 'Board', widgets: [] } },
    { shape: 'report', type: 'report', refused: false, body: { name: 'crm_report', label: 'Report', type: 'summary', dataset: 'crm_metrics', rows: ['month'], values: ['amount_sum'] } },
    { shape: 'translation', type: 'translation', refused: false, body: { name: 'crm_fr', label: 'French', locale: 'fr', messages: { save: 'Enregistrer' } } },
    { shape: 'email template', type: 'email_template', refused: false, body: { name: 'crm_welcome', label: 'Welcome', subject: 'Welcome', bodyHtml: '<p>Hi</p>' } },
];

describe('[#30261] overrideDeclarationRefusedByShape: the shapes of the five overlay types that cannot carry the declaration', () => {
    it('the fixture covers every overlay type the ceremony moves', () => {
        const overlayTypes = DEFAULT_METADATA_TYPE_REGISTRY.filter((entry) => entry.allowEnvironmentOverlay).map((entry) => entry.type).sort();
        expect([...new Set(SHAPES.map((s) => s.type))].sort()).toEqual(overlayTypes);
    });

    for (const { shape, type, body, refused } of SHAPES) {
        it(`${shape}: ${refused ? 'refuses' : 'carries'} the \`overrides\` key`, () => {
            expect(overrideDeclarationRefusedByShape(type, body)).toBe(refused);
            // The answer is the key's, not the body's value: a body already
            // carrying a declaration is answered the same way.
            expect(overrideDeclarationRefusedByShape(type, { ...body, overrides: { package: 'com.acme.crm' } })).toBe(refused);
        });
    }

    it('a view body that claims no member of the union is not answered `true` (the container member alone names the key)', () => {
        expect(overrideDeclarationRefusedByShape('view', { name: 'task.all', label: 'All' })).toBe(false);
    });

    it('another finding on a container body does not hide the key: a container with an unknown key of its own still answers `true`', () => {
        expect(overrideDeclarationRefusedByShape('view', { object: 'task', list: { label: 'All', ...grid(['title']) }, colour: 'red' })).toBe(true);
    });

    it('a type the save door validates with no schema answers `false`', () => {
        expect(overrideDeclarationRefusedByShape('function', { name: 'f' })).toBe(false);
    });
});
