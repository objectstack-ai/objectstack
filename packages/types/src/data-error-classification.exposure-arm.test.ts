// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22737] The exposure arm of the shared classification: a thrown
 * `OBJECT_API_DISABLED` / `OBJECT_API_METHOD_NOT_ALLOWED` that names an object
 * OTHER than the one the route addressed (the data door's refusal of a
 * nested-relation condition's target) answers with that object and the
 * effective `allowed` set, the REST door's own body for these codes. Before the
 * arm, the generic passthrough stamped the route's object beside the code.
 *
 * Controls: an error naming the route's own object, and a door given no object
 * (the analytics dataset route's `classifiedRefusalAnswer`), keep the
 * passthrough's body byte for byte, `allowed` absent as before. Both REST doors
 * asking this arm are pinned in `@objectstack/rest`'s door-parity suite.
 */

import { describe, it, expect } from 'vitest';
import { mapDataError } from './data-error-classification.js';

function exposureRefusal(code: 'OBJECT_API_DISABLED' | 'OBJECT_API_METHOD_NOT_ALLOWED', object: string): any {
    const disabled = code === 'OBJECT_API_DISABLED';
    const err: any = new Error(disabled
        ? `Object '${object}' is not exposed via the API`
        : `API operation 'list' is not allowed on object '${object}'`);
    err.code = code;
    err.status = disabled ? 404 : 405;
    err.object = object;
    if (!disabled) err.allowed = ['get'];
    return err;
}

describe('[#22737] the exposure arm names the refused object, not the route object', () => {
    it('404: the target is the envelope object', () => {
        const wire = mapDataError(exposureRefusal('OBJECT_API_DISABLED', 'xa_target'), 'xa_source');
        expect({ status: wire.status, code: wire.body.code, object: wire.body.object })
            .toEqual({ status: 404, code: 'OBJECT_API_DISABLED', object: 'xa_target' });
        expect(wire.body).not.toHaveProperty('allowed');
    });

    it('405: the target is the envelope object, and the effective set rides as `allowed`', () => {
        const wire = mapDataError(exposureRefusal('OBJECT_API_METHOD_NOT_ALLOWED', 'xa_target'), 'xa_source');
        expect({ status: wire.status, code: wire.body.code, object: wire.body.object, allowed: wire.body.allowed })
            .toEqual({ status: 405, code: 'OBJECT_API_METHOD_NOT_ALLOWED', object: 'xa_target', allowed: ['get'] });
    });

    it('CONTROL: an error naming the route object keeps the passthrough body byte for byte', () => {
        expect(mapDataError(exposureRefusal('OBJECT_API_DISABLED', 'xa_source'), 'xa_source')).toEqual({
            status: 404,
            body: { error: "Object 'xa_source' is not exposed via the API", code: 'OBJECT_API_DISABLED', object: 'xa_source' },
        });
        expect(mapDataError(exposureRefusal('OBJECT_API_METHOD_NOT_ALLOWED', 'xa_source'), 'xa_source')).toEqual({
            status: 405,
            body: {
                error: "API operation 'list' is not allowed on object 'xa_source'",
                code: 'OBJECT_API_METHOD_NOT_ALLOWED',
                object: 'xa_source',
            },
        });
    });

    it('CONTROL: a door given no object keeps the passthrough body byte for byte', () => {
        expect(mapDataError(exposureRefusal('OBJECT_API_METHOD_NOT_ALLOWED', 'xa_target'))).toEqual({
            status: 405,
            body: { error: "API operation 'list' is not allowed on object 'xa_target'", code: 'OBJECT_API_METHOD_NOT_ALLOWED' },
        });
    });
});
