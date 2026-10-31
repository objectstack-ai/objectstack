// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27884] Which READERS a stored metadata document of a capability-gated type
 * is served to — the ONE row both exits that serve the document ask.
 *
 * ## The two exits, one row
 *
 * A datasource document (a driver, its connection configuration and the handle
 * of its bound secret) is stored as a row of the stored-metadata family
 * (`sys_metadata`, and its version snapshots in `sys_metadata_history`), typed
 * by the row's `type` column. It is served through two exits:
 *
 *  - the `/meta` read doors, whose type-level read admission
 *    (`metaTypeReadRefusal`, `@objectstack/rest`) refuses a caller without the
 *    row's capability before any store read; and
 *  - every caller-context engine read of the family's rows, whichever door
 *    issues it, narrowed by
 *    {@link storedMetadataTypesWithheldFrom}, which the engine composes into
 *    the read's predicate (`stored-metadata-type-read-gate.ts`,
 *    `@objectstack/objectql`).
 *
 * One operation reached through two mounted routes cannot admit two different
 * sets of callers, so both read THIS table. It lives here because the `/meta`
 * gate lives in `@objectstack/rest` and the engine gate in
 * `@objectstack/objectql`, neither of which depends on the other, and this
 * package is the one both already depend on. `@objectstack/rest` re-exports it
 * as `META_TYPE_READ_CAPABILITIES`, the same frozen object.
 *
 * ## The rows, and why each capability
 *
 *  - `datasource` → `manage_platform_settings`. The datasource family's own
 *    door — `GET /api/v1/datasources[/:name]` (`DATASOURCE_ADMIN_CAPABILITY`,
 *    `@objectstack/service-datasource`) — serves exactly that configuration and
 *    admits only this capability.
 *  - `external_catalog` → `manage_platform_settings`. The cached remote-schema
 *    snapshot of a federated datasource: the remote tables and columns the
 *    federation family's read door introspects live and admits only this
 *    capability for.
 *
 * ⛔ A row names the capability the type's OWN door already requires —
 * matched, never minted; a type with no such door has no row. ⛔ Never a
 * second copy of this table at either exit.
 */
export const STORED_METADATA_TYPE_READ_CAPABILITIES: Readonly<Record<string, string>> = Object.freeze({
    datasource: 'manage_platform_settings',
    external_catalog: 'manage_platform_settings',
});

/**
 * [#27884] The stored metadata types a caller is NOT served, read from
 * {@link STORED_METADATA_TYPE_READ_CAPABILITIES}: every type whose capability
 * is absent from the caller's resolved `systemPermissions` (the capability set
 * the request's authorization resolver stamps on the execution context).
 *
 * Empty for a holder of every row's capability. Every listed type for a caller
 * that carries no capability set at all, an anonymous one included: absence is
 * never a grant. The caller's `isSystem` is not read here — an elevated read is
 * the platform's own, and the engine gate admits it before asking.
 */
export function storedMetadataTypesWithheldFrom(caller: unknown): string[] {
    const held = caller && typeof caller === 'object'
        ? (caller as { systemPermissions?: unknown }).systemPermissions
        : undefined;
    const holds = Array.isArray(held) ? held : [];
    return Object.entries(STORED_METADATA_TYPE_READ_CAPABILITIES)
        .filter(([, capability]) => !holds.includes(capability))
        .map(([type]) => type);
}

/**
 * [#27884] Whether stored documents of `type` are served only to holders of a
 * capability — the question a caller-blind exit asks (a realtime event, whose
 * subscribers are unknown at publish, withholds such a document's body from
 * everyone).
 */
export function isCapabilityGatedStoredMetadataType(type: unknown): boolean {
    return typeof type === 'string'
        && Object.prototype.hasOwnProperty.call(STORED_METADATA_TYPE_READ_CAPABILITIES, type);
}
