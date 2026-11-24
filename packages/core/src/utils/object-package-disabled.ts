// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7557, #24097] The ONE refusal for an object whose owning package is
 * disabled, raised by every API reader of that object: the data plane
 * (`ObjectStackProtocolImplementation.assertObjectRegistered`), the by-name
 * `/meta` reads (`getMetaItem`, `getMetaItemLayered`), and the Change Owner
 * doors (`security/change-record-owner.ts`). One constructor, so the answers
 * cannot drift apart in code, status or text.
 *
 * Why it lives in `@objectstack/core`: the Change Owner rules live here, and
 * ADR-0076 D2's boundary keeps this package from importing
 * `@objectstack/metadata-protocol`, where the refusal was first written. It
 * moved down for the reason `objectNotFoundError` and `recordNotFoundError`
 * did; `@objectstack/metadata-protocol` re-exports it from its original home.
 */
export function objectPackageDisabledError(object: string): Error {
    const disabled: any = new Error(
        `Object '${object}' belongs to a disabled package and is not being served. `
        + 'Re-enable the package to restore access.',
    );
    disabled.code = 'OBJECT_PACKAGE_DISABLED';
    disabled.status = 404;
    disabled.object = object;
    return disabled;
}
