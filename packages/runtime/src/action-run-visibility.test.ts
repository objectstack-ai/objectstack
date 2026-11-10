// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0106 D1] The run doors' visibility question (`action-run-visibility.ts`)
 * answers what the `/meta` projection answers, case by case: an action the
 * `/meta` doors withhold from a caller is one the run doors withhold, one they
 * serve is one the run doors run, and a posture they cannot evaluate is a
 * fault on both.
 *
 * The `/meta` side is asked through its own exits, never restated: an action
 * embedded in an object is projected by the object door's projection
 * (`projectMetaObjectSchema` over the related posture, the `GET
 * /meta/object/:name` answer), a standalone one by the action door's
 * (`projectMetaActionForCaller` against its own `objectName`). The run side is
 * asked with what a run door holds: the object it runs the action under and
 * that object's definition.
 *
 * Postures come from the real `resolveObjectSchemaMaskPosture` over a
 * security double, so the exemptions (system context, D4 capability) and the
 * D6 tiers are the deployment's own.
 */

import { describe, expect, it } from 'vitest';
import {
    relateObjectSchemaMaskPosture,
    resolveObjectSchemaMaskPosture,
    type ObjectSchemaMaskPosture,
} from '@objectstack/metadata-core';
import { projectMetaActionForCaller, projectMetaObjectSchema } from '@objectstack/rest';
import { GLOBAL_ACTION_OBJECT_KEY } from '@objectstack/objectql';
import { actionProjectionOwnerName, projectActionForCaller, type ActionObjectMasker } from './action-run-visibility.js';

const PROJECT = {
    name: 'run_vis_project',
    label: 'Project',
    fields: {
        title: { name: 'title', type: 'text', label: 'Title' },
        budget: { name: 'budget', type: 'currency', label: 'Budget' },
    },
};
const VENDOR = {
    name: 'run_vis_vendor',
    label: 'Vendor',
    fields: {
        name: { name: 'name', type: 'text', label: 'Name' },
        rate: { name: 'rate', type: 'currency', label: 'Rate' },
    },
};
const OBJECTS: Record<string, unknown> = { [PROJECT.name]: PROJECT, [VENDOR.name]: VENDOR };

/** Each caller's readable fields, per object, as the security service answers them. */
type Readable = Record<string, string[] | 'throws' | undefined>;
const MEMBER: Readable = { [PROJECT.name]: ['title'], [VENDOR.name]: ['name'] };
const STAFF: Readable = { [PROJECT.name]: ['title', 'budget'], [VENDOR.name]: ['name', 'rate'] };
const WALLED: Readable = { [PROJECT.name]: [], [VENDOR.name]: ['name', 'rate'] };
const OUTAGE: Readable = { [PROJECT.name]: 'throws', [VENDOR.name]: 'throws' };
const UNDETERMINED: Readable = { [PROJECT.name]: undefined, [VENDOR.name]: undefined };

const CALLERS: ReadonlyArray<{ id: string; readable: Readable; context: Record<string, unknown> }> = [
    { id: 'member denied budget and rate', readable: MEMBER, context: { userId: 'u_member', systemPermissions: [] } },
    { id: 'staff denied nothing', readable: STAFF, context: { userId: 'u_staff', systemPermissions: [] } },
    { id: 'walled: denied every field of the project', readable: WALLED, context: { userId: 'u_walled', systemPermissions: [] } },
    { id: 'security service outage', readable: OUTAGE, context: { userId: 'u_member', systemPermissions: [] } },
    { id: 'field universe undetermined', readable: UNDETERMINED, context: { userId: 'u_member', systemPermissions: [] } },
    { id: 'system context', readable: MEMBER, context: { userId: 'u_member', isSystem: true } },
    { id: 'D4-exempt author', readable: MEMBER, context: { userId: 'u_author', systemPermissions: ['manage_metadata'] } },
];

function maskerFor(readable: Readable, context: Record<string, unknown>): ActionObjectMasker {
    const security = {
        getMetadataReadableFields: async (objectName: string) => {
            const answer = readable[objectName];
            if (answer === 'throws') throw new Error('security service unavailable');
            return answer;
        },
    };
    return (objectName) => resolveObjectSchemaMaskPosture({ objectName, context, security, enabled: true });
}

type Verdict = 'serve' | 'withhold' | 'fault';

/** The `/meta` object door's verdict on an action embedded in `object`: is it among the served object's actions? */
async function objectDoorVerdict(masker: ActionObjectMasker, object: Record<string, unknown>, action: unknown): Promise<Verdict> {
    let posture: ObjectSchemaMaskPosture;
    try {
        posture = await masker(String(object.name));
    } catch {
        return 'fault';
    }
    const document = { ...object, actions: [action] };
    const projected = projectMetaObjectSchema(await relateObjectSchemaMaskPosture(posture, document), document);
    if (!projected.ok) return 'fault';
    return projected.document.actions?.length === 1 ? 'serve' : 'withhold';
}

/** The `/meta` action door's verdict on a standalone action entry. */
async function actionDoorVerdict(masker: ActionObjectMasker, action: { objectName?: string }): Promise<Verdict> {
    const projected = await projectMetaActionForCaller(
        { masker, readObject: async (name) => OBJECTS[name] },
        action,
        action.objectName,
    );
    return projected.kind;
}

/** A run door's verdict, given the object it runs the action under and the definition it resolved. */
async function runDoorVerdict(masker: ActionObjectMasker, action: unknown, objectName: string): Promise<Verdict> {
    const projected = await projectActionForCaller(masker, {
        action, objectName, obj: OBJECTS[objectName], readObject: (name) => OBJECTS[name],
    });
    return projected.kind;
}

/** Action shapes, each by what its params bind. */
const SHAPES = {
    'a param bound to an own field the member cannot read': { params: [{ field: 'budget' }] },
    'a param bound to an own field every caller reads': { params: [{ field: 'title' }] },
    'no field-bound param': { params: [{ name: 'note', type: 'text' }] },
    'no params at all': {},
    'an objectOverride param bound to a field the member cannot read': { params: [{ field: 'rate', objectOverride: VENDOR.name }] },
    'an objectOverride param bound to a field every caller reads': { params: [{ field: 'name', objectOverride: VENDOR.name }] },
} as const;

describe('[ADR-0106 D1] the run doors withhold exactly the actions the /meta projection withholds', () => {
    for (const caller of CALLERS) {
        for (const [shape, declared] of Object.entries(SHAPES)) {
            it(`${caller.id} · an action embedded in its object with ${shape}: the run door and the object door agree`, async () => {
                const masker = maskerFor(caller.readable, caller.context);
                const action = { name: 'act', label: 'Act', type: 'script', ...declared };
                expect(await runDoorVerdict(masker, action, PROJECT.name))
                    .toBe(await objectDoorVerdict(masker, PROJECT, action));
            });

            it(`${caller.id} · a standalone action on an object with ${shape}: the run door and the action door agree`, async () => {
                const masker = maskerFor(caller.readable, caller.context);
                const action = { name: 'act', label: 'Act', type: 'script', objectName: PROJECT.name, ...declared };
                expect(await runDoorVerdict(masker, action, PROJECT.name)).toBe(await actionDoorVerdict(masker, action));
            });
        }

        for (const shape of [
            'an objectOverride param bound to a field the member cannot read',
            'an objectOverride param bound to a field every caller reads',
            'no field-bound param',
            'no params at all',
        ] as const) {
            it(`${caller.id} · an object-less action with ${shape}, run with no object: the run door and the action door agree`, async () => {
                const masker = maskerFor(caller.readable, caller.context);
                const action = { name: 'act', label: 'Act', type: 'script', ...SHAPES[shape] };
                expect(await runDoorVerdict(masker, action, GLOBAL_ACTION_OBJECT_KEY)).toBe(await actionDoorVerdict(masker, action));
            });
        }
    }

    it('the verdicts the table agrees on are the ruled ones: the member is withheld exactly the actions binding a field they cannot read', async () => {
        const masker = maskerFor(MEMBER, { userId: 'u_member', systemPermissions: [] });
        const verdicts: Record<string, Verdict> = {};
        for (const [shape, declared] of Object.entries(SHAPES)) {
            verdicts[shape] = await runDoorVerdict(masker, { name: 'act', type: 'script', ...declared }, PROJECT.name);
        }
        expect(verdicts).toEqual({
            'a param bound to an own field the member cannot read': 'withhold',
            'a param bound to an own field every caller reads': 'serve',
            'no field-bound param': 'serve',
            'no params at all': 'serve',
            'an objectOverride param bound to a field the member cannot read': 'withhold',
            'an objectOverride param bound to a field every caller reads': 'serve',
        });
        // A posture that cannot be evaluated is a fault, never a run.
        const outage = maskerFor(OUTAGE, { userId: 'u_member', systemPermissions: [] });
        expect(await runDoorVerdict(outage, { name: 'act', ...SHAPES['no params at all'] }, PROJECT.name)).toBe('fault');
    });

    it('CONTROL — the system context is served every action, without asking the security service', async () => {
        let asked = 0;
        const masker: ActionObjectMasker = (objectName) => resolveObjectSchemaMaskPosture({
            objectName,
            context: { userId: 'u_member', isSystem: true },
            security: { getMetadataReadableFields: async () => { asked += 1; return []; } },
            enabled: true,
        });
        for (const declared of Object.values(SHAPES)) {
            expect(await runDoorVerdict(masker, { name: 'act', ...declared }, PROJECT.name)).toBe('serve');
        }
        expect(asked).toBe(0);
    });

    it('the object an action is judged on is the one the door runs it under; an object-less run judges its objectOverride params alone', () => {
        expect(actionProjectionOwnerName(PROJECT.name, PROJECT)).toBe(PROJECT.name);
        expect(actionProjectionOwnerName(PROJECT.name, undefined)).toBe(PROJECT.name);
        expect(actionProjectionOwnerName(GLOBAL_ACTION_OBJECT_KEY, undefined)).toBeUndefined();
    });
});
