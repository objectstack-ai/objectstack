// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27762] The own-reference rule on the metadata save door, for a
 * `datasource` body's `external.credentialsRef`.
 *
 * The rule is the one #27582 set for the engine's secret fields and #27722
 * applied to the datasource admin door's create: **a non-system write may only
 * seal a new value or keep its own record's stored reference.** A credentials
 * reference is minted by the platform when a secret is bound (the datasource
 * admin door's `secret`), and the readers of a stored datasource act on
 * whatever reference its row holds. This door seals nothing, so the one
 * reference a save through it may name is the one its own stored row already
 * holds:
 *
 *  - a create (no stored row) naming any reference is refused;
 *  - an edit naming a reference other than its row's, or naming one where its
 *    row holds none, is refused;
 *  - an edit sending back its row's own reference — the GET → edit → PUT
 *    round trip, since the read serves the reference — keeps it, and so does a
 *    first draft sending back the reference of the active row it overlays;
 *  - a body that names no reference is not judged here (what it stores is
 *    unchanged by this rule).
 *
 * "Its own stored row" is the row the save writes, read the way
 * {@link authoredLockFamily} reads it for the lock family: the repository's
 * write address for the save's state, package and bundle member, and for a
 * draft with no draft row yet, the active row it overlays. Stored rows only:
 * a code-defined datasource is refused by the package door before this is
 * asked, and its declaration is no stored row.
 *
 * Refused `VALIDATION_ERROR` / 400 before anything is written, with ONE answer
 * whatever the reference names: the judge compares the value with the save's
 * own row and nothing else, never looks the reference up, and the message
 * never echoes it.
 *
 * Every save through `saveMetaItem` is judged — the REST `PUT` doors, the
 * runtime dispatcher's `/meta` door, MCP and in-process authoring, and the
 * package copy and unmanaged import, which write new rows that hold no
 * reference of their own. The server-stated rewrites of a row this store
 * already holds (`source` set: the stored-metadata migration) keep their
 * pass-through, as the system principal does under the #27582 rule.
 *
 * [#27818] The doors that make a STORED body the active row ask the same
 * judge, as `door: 'restore'` and `door: 'publish'`: the restore doors
 * (`rollbackMetaItem` and `revertCommit`'s restore limb, through the restore
 * path's save-door refusal family) on the history body they write back, and
 * the draft publish (the per-item publish and the package publish) on the
 * draft it promotes. Each is judged as an active write into the row it lands
 * in, so the one reference the body may name is the one that row holds NOW:
 * a version or draft stored before the save door judged the key, or before
 * the row's own reference moved, is refused rather than brought back live. A
 * body naming no reference is written as it stands, as a save omitting the
 * key is. No server-stated restore or publish exists, so none passes through.
 */

import { itemDiscriminator } from '@objectstack/metadata-core';
import type { SysMetadataRepository } from './sys-metadata-repository.js';

/** The `external.credentialsRef` a body names, or `undefined` when it names none. */
function namedCredentialsRef(body: unknown): unknown {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
    const external = (body as { external?: unknown }).external;
    if (!external || typeof external !== 'object' || Array.isArray(external)) return undefined;
    return (external as { credentialsRef?: unknown }).credentialsRef;
}

/**
 * The refusal a `datasource` save owes when its body names an
 * `external.credentialsRef` its own stored row does not hold, else `undefined`.
 * See the module header for the rule, the row it reads and who passes.
 */
export async function datasourceCredentialsRefSaveRefusal(args: {
    /** The repository's write-address read — the one store access this judge makes; it writes nothing. */
    headAt: SysMetadataRepository['headAt'];
    /** Singular type name. */
    type: string;
    name: string;
    item: unknown;
    mode: 'draft' | 'publish';
    packageId: string | null | undefined;
    /** The server-stated `source` of a rewrite; `undefined` for every authoring save. */
    source: string | undefined;
    /**
     * [#27818] The door asking: the save (omitted), a restore writing a stored
     * version back, or a publish promoting a stored draft. It changes only the
     * refusal's words, never what is judged.
     */
    door?: 'restore' | 'publish';
}): Promise<(Error & { code: 'VALIDATION_ERROR'; status: 400 }) | undefined> {
    if (args.type !== 'datasource' || args.source !== undefined) return undefined;
    const named = namedCredentialsRef(args.item);
    if (named === undefined) return undefined;
    const ref = { type: args.type, name: args.name, org: 'env' } as Parameters<SysMetadataRepository['headAt']>[0];
    const state: 'active' | 'draft' = args.mode === 'draft' ? 'draft' : 'active';
    const member = itemDiscriminator(args.type, args.item);
    const target = await args.headAt(ref, { state, packageId: args.packageId ?? null, member });
    let head = target.head;
    if (!head && state === 'draft') {
        head = (await args.headAt(ref, { state: 'active', packageId: target.packageId, member })).head;
    }
    const own = namedCredentialsRef(head?.body);
    if (typeof own === 'string' && own === named) return undefined;
    const adminDoor = `To bind a credential, send the secret to the datasource admin door instead (Setup → Datasources, `
        + `\`POST /api/v1/datasources\` or \`PATCH /api/v1/datasources/${args.name}\`).`;
    const why = 'because a reference is minted by the platform when a secret is bound.';
    const message = args.door === 'restore'
        ? `Datasource '${args.name}' was not restored: the version restored names an \`external.credentialsRef\` `
            + `this datasource's stored definition does not hold now, and a restore may only bring back the credentials `
            + `reference that definition holds, ${why} Restore a version that names the reference a read of this `
            + `datasource serves, or one that names none to restore it with no credential bound. ${adminDoor}`
        : args.door === 'publish'
            ? `Datasource '${args.name}' was not published: its draft names an \`external.credentialsRef\` this `
                + `datasource's active definition does not hold now, and a publish may only make live the credentials `
                + `reference that definition holds, ${why} Save the draft again with the key omitted, or discard it, `
                + `to publish it with no credential bound. ${adminDoor}`
            : `Datasource '${args.name}' was not saved: \`external.credentialsRef\` may only name the credentials `
                + `reference this datasource's own stored definition already holds, ${why} Send back the reference a `
                + `read of this datasource serves, or omit the key to save it with no credential bound. ${adminDoor}`;
    const err = new Error(message) as Error & { code: 'VALIDATION_ERROR'; status: 400 };
    err.code = 'VALIDATION_ERROR';
    err.status = 400;
    return err;
}
