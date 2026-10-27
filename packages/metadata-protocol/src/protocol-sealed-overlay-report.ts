// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 cut 21] The boot report of `ObjectStackProtocolImplementation`
 * that says out loud which stored ENVIRONMENT `sys_metadata` rows no read
 * serves because they overlay sealed managed content
 * (`reportSealedOverlayRows`, ADR-0131 D6): per type, a capped sample of
 * names and the two remedies. Moved out of `protocol.ts` whole.
 *
 * A MOVE, not a redesign. The function below is the body of the
 * `ObjectStackProtocolImplementation` method of the same name as it stood,
 * re-indented one level and otherwise unedited: the same grouping by type,
 * the same sample cap, and the same warning text.
 *
 * ## How the moved body reaches the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning). The class keeps the method — the
 * published `dist/*.d.ts` lists its name, docblock and declared signature.
 * The body reads no member of the class, so there is no host: the method's
 * stub calls the plain function directly, as `namesWithOwnStoredRow`'s does
 * in `protocol-stored-overlay-reads.ts`. Its one caller keeps calling the
 * class method.
 *
 * The body reads none of `protocol.ts`'s module-level declarations and
 * imports nothing. Nothing re-exports this module, so the published surface
 * does not move.
 */

/** The body of `ObjectStackProtocolImplementation#reportSealedOverlayRows`; the method's docblock there is its contract. */
export function reportSealedOverlayRows(rows: ReadonlyArray<{ type: string; name: string }>): void {
    if (rows.length === 0) return;
    const SAMPLE_PER_TYPE = 5;
    const byType = new Map<string, string[]>();
    for (const { type, name } of rows) {
        const names = byType.get(type) ?? [];
        names.push(name);
        byType.set(type, names);
    }
    const detail = Array.from(byType.entries())
        .map(([type, names]) => {
            const shown = names.slice(0, SAMPLE_PER_TYPE);
            const more = names.length > shown.length ? `, +${names.length - shown.length} more` : '';
            return `${type}×${names.length} (${shown.join(', ')}${more})`;
        })
        .join('; ');
    console.warn(
        `[Protocol] [metadata_sealed_overlay_unserved] ${rows.length} active environment sys_metadata row(s) ` +
        `overlay an item a managed package ships, on a type that is sealed against overlays (ADR-0131 D6): ` +
        `${detail}. No read serves them — the package's own definition is served. ` +
        `Each row is kept at rest, untouched (an object's table and its columns stay as they are). To keep ` +
        `the change, re-express it as a new item under a new ` +
        `name (a linkage-free clone of the managed item), then delete the stored row; otherwise delete the ` +
        `stored row.`,
    );
}
