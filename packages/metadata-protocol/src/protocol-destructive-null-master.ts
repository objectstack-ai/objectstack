// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28665, ADR-0055 §1] The rows a `controlled_by_parent` detail stops
 * serving, counted into the destructive-change finding that makes its master
 * required.
 *
 * `detectDestructiveObjectChanges` (`protocol.ts`) judges a save from the two
 * definitions alone and reads no row. Its `field_required_no_default` finding
 * says "existing rows with null values may fail validation", which is true of
 * an ordinary field and understates one case by a long way: the master of a
 * detail that is (or becomes) `controlled_by_parent`. Such a detail derives
 * every reader from its master, and plugin-security fails closed on a row with
 * none (ADR-0055 §1), so once the object is controlled by its parent a row
 * whose master is null answers `total: 0` on the list and 404 on the by-id
 * read and write, for the admin too. The row is still stored; nothing reads it.
 *
 * So for exactly that finding this module asks the table how many rows hold no
 * master and, when there are any, says so in the finding's own `message`: the
 * count, the consequence, and the step that avoids it. ⛔ It adds no finding,
 * no code and no member: the 409 fires where it fired before, `force` lifts it
 * as before (the gate does not run under `force`, so neither does the count),
 * and with no such row the finding is byte-identical to before. The Studio
 * confirm (`PackageOwdOverviewPanel`) already renders each `issues[].message`,
 * so the count reaches the author with no console change.
 *
 * Cost: one `count` query per finding that matches, and none otherwise. An
 * ordinary save (no finding, or a required toggle on any other field, or on a
 * master whose object is not `controlled_by_parent`) issues no query. A count
 * that cannot be answered (no table yet, a driver fault) leaves the finding as
 * it was: this is a warning's precision, not a gate, and the 409 still stands.
 */

/** One Phase 3a-destructive finding, the shape `detectDestructiveObjectChanges` returns. */
export interface DestructiveFinding {
    code: string;
    field?: string;
    message: string;
}

/**
 * Counts the stored rows of the object being saved whose `field` holds no
 * value. Called with system authority by the save door: the question is what
 * the table holds, not what the caller can read.
 */
export type NullMasterRowCounter = (field: string) => Promise<number>;

/**
 * The field names whose `field_required_no_default` finding is the master a
 * `controlled_by_parent` detail derives its access from, judged on the
 * definition the save writes (`next`). The previous sharing model does not
 * matter: a detail switched to `controlled_by_parent` in this save and one
 * that already was both stop serving a masterless row once this lands.
 */
export function controlledByParentMasterFindings(
    findings: readonly DestructiveFinding[],
    next: unknown,
): DestructiveFinding[] {
    if (!next || typeof next !== 'object') return [];
    const body = next as { sharingModel?: unknown; fields?: unknown };
    if (body.sharingModel !== 'controlled_by_parent') return [];
    const fields = body.fields && typeof body.fields === 'object' ? body.fields as Record<string, { type?: unknown }> : {};
    return findings.filter((finding) => finding.code === 'field_required_no_default'
        && typeof finding.field === 'string'
        && fields[finding.field]?.type === 'master_detail');
}

/**
 * The findings with each `controlled_by_parent` master's null-master row count
 * written into its message. Findings that do not match, a count of zero and a
 * count that fails all come back unchanged; the array keeps its order.
 */
export async function withNullMasterRowCounts(
    findings: DestructiveFinding[],
    next: unknown,
    objectName: string,
    countNullMasterRows: NullMasterRowCounter,
): Promise<DestructiveFinding[]> {
    const masters = controlledByParentMasterFindings(findings, next);
    if (masters.length === 0) return findings;
    const counted = new Map<DestructiveFinding, number>();
    for (const finding of masters) {
        let rows: number;
        try {
            rows = await countNullMasterRows(finding.field as string);
        } catch {
            continue;
        }
        if (Number.isFinite(rows) && rows > 0) counted.set(finding, rows);
    }
    if (counted.size === 0) return findings;
    return findings.map((finding) => {
        const rows = counted.get(finding);
        return rows === undefined ? finding : { ...finding, message: nullMasterMessage(objectName, finding.field as string, rows) };
    });
}

/** The finding's message once the count is known to be positive. */
function nullMasterMessage(objectName: string, field: string, rows: number): string {
    const subject = rows === 1 ? `1 existing row has no '${field}'` : `${rows} existing rows have no '${field}'`;
    return `Field '${field}' is now required but has no default value, and '${objectName}' is controlled by its parent: `
        + `${subject}, and once the object is controlled by its parent ${rows === 1 ? 'it becomes' : 'they become'} `
        + 'unreadable through every door, the admin\'s included (a detail with no master has no reader, ADR-0055). '
        + `Set '${field}' on ${rows === 1 ? 'that row' : 'each of them'} first.`;
}
