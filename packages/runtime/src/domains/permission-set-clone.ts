// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0126 §7.1, amendment ruling 2] THE PERMISSION-SET CLONE DOOR:
 * `POST /security/permission-sets/:name/clone`, body `{ name, label }`, both
 * keys required, the set closed.
 *
 * ## Why it exists
 *
 * A packaged permission set is a locked base (the 2026-08-24 lock-and-clone
 * rule, `plugin-security`'s `packaged-permission-set-lock.ts`), and the
 * sanctioned way to customize one is a clone under a new name. Until this door
 * the only clone was the Setup action `clone_permission_set`, which reads a
 * `sys_permission_set` ROW and posts its columns back to the data door. ADR-0131
 * D3 gives the catalog one home, the environment registry, and the catalog rows
 * are being retired: on a database with no `sys_permission_set` rows that
 * action has nothing to read. This door reads the definition where the catalog
 * keeps it and writes the copy where the catalog keeps it, so it works with
 * zero rows.
 *
 * It is the permission-set twin of the flow clone door
 * (`POST /automation/:name/clone`, `../flow-clone.ts`), and it keeps that
 * door's three load-bearing rules:
 *
 *  1. **Whole-definition copy — ⛔ never param-list assembly.** The copy is the
 *     catalog definition, minus {@link PERMISSION_SET_CLONE_DROPPED_KEYS}, with
 *     `name` and `label` set. No facet is enumerated, so none can be forgotten
 *     — the facet drop commit 5cb62d88b measured on the param-list clone (three
 *     of six facets silently absent) cannot happen here. A permission set has
 *     no `status`, so the mutation set is two fields, not the flow's three.
 *  2. **No linkage to the base.** The copy is an ordinary environment-authored
 *     set: no package, no provenance envelope, and no field or response key
 *     naming what it was copied from (ADR-0126 §9).
 *  3. **A new name, mandatory.** A name the catalog already holds — the
 *     source's own included — is refused 409, and the save itself is
 *     create-only, so a row written between the check and the save is refused
 *     too rather than overwritten.
 *
 * ## The keys the server drops — ONE declared list
 *
 * {@link PERMISSION_SET_CLONE_DROPPED_KEYS} is the one place that says which
 * keys never ride onto a clone. It is the server's declaration, not a client's
 * deny-list: a client never sends a body for the copy, only the new name and
 * label. Three groups, each for its own reason:
 *
 *  - **the provenance envelope** — derived from the spec
 *    (`MetadataProtectionFields`, `METADATA_READ_DECORATIONS`), so an envelope
 *    key added there is dropped here the day it lands. Carried over, `_packageId`
 *    would make the copy a package artifact (the ancestry ADR-0126 §9 rules
 *    out) and `_lock` would leave the copy as locked as its base;
 *  - **the package-authoring keys** — `packageId`, `managedBy` (ADR-0086 D3
 *    record provenance) and `protection` (the package author's lock block): each
 *    states who ships the set, and the copy is shipped by nobody;
 *  - **the privilege decisions** — `adminScope` (an ADR-0090 D12
 *    delegated-administration grant) and `isDefault` (an ADR-0090 D5 suggestion
 *    to bind the set to every signed-in member). Putting either on a brand-new
 *    set on the admin's behalf is a privilege decision, not a field copy — the
 *    exclusion the lock-and-clone rule made for `admin_scope`, extended to the
 *    one other key whose effect is to hand the set to people. The admin grants
 *    either deliberately on the copy if it needs one, and the response says so
 *    ({@link PERMISSION_SET_CLONE_NOTICE}).
 *
 * ## Authority
 *
 * The metadata door's own: `manage_metadata` (or `isSystem`), asked through the
 * shared `metaWriteCapabilityVerdict` the `/meta` save door asks, because the
 * clone IS a metadata save of a `permission` item (#22621 → A: catalog writes
 * stay with `manage_metadata` holders). ⛔ No new gate, and ⛔ not the ADR-0126
 * §5 activation gate: a clone creates a new artifact and takes nothing away
 * from any tenant, exactly as the flow clone door reasons.
 *
 * Then, as at every catalog write door, the walled catalog refusal
 * (`walledCatalogWriteVerdict`, ADR-0131 D3): under `isolated` / `group` the
 * catalog is shared by every organization, so the clone is the platform
 * operator's. That is D3's own refusal ("the server refuses anyway"), not a new
 * gate; under `single` it is inert.
 */

import { METADATA_READ_DECORATIONS, MetadataProtectionFields } from '@objectstack/spec/kernel';
import { SnakeCaseIdentifierSchema } from '@objectstack/spec/shared';
import { metaWriteCapabilityVerdict, walledCatalogWriteVerdict } from '@objectstack/metadata-core';
import { readEffectiveTenancyPosture } from './activation-gate.js';
import { securityCatalogReaderOf, type SecurityCatalogEntry } from '@objectstack/core';
import type { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { validationFailure } from '../validation-failure.js';
import type { HttpProtocolContext, HttpDispatcherResult } from '../http-dispatcher.js';
import type { DomainHandlerDeps } from '../domain-handler-registry.js';

/** The door's first path segment under `/security`. */
export const PERMISSION_SET_CLONE_SEGMENT = 'permission-sets';

/** The metadata type the door reads and writes. */
const PERMISSION_METADATA_TYPE = 'permission';

/** The two fields a clone mutates (ADR-0126 §7.1; a permission set has no `status`). */
export const PERMISSION_SET_CLONE_MUTATED_FIELDS = ['name', 'label'] as const;

/**
 * The keys that never survive onto a clone — see the module doc for why each
 * group is here. Exported so the tests assert against the same constant the
 * door applies, never a restated copy.
 */
export const PERMISSION_SET_CLONE_DROPPED_KEYS: readonly string[] = Object.freeze([
    ...METADATA_READ_DECORATIONS,
    ...Object.keys(MetadataProtectionFields),
    'packageId',
    'managedBy',
    'protection',
    'adminScope',
    'isDefault',
]);

/**
 * What a successful clone tells the caller: what was not copied, and that the
 * copy grants nobody until it is given to someone.
 */
export const PERMISSION_SET_CLONE_NOTICE =
    'The copy is a new permission set authored in this environment, with no link to the set it was copied '
    + 'from: changes to that set do not reach it. Not copied: delegated-admin scope (`adminScope`) and the '
    + 'everyone-baseline suggestion (`isDefault`) — grant either deliberately on the copy if it needs one. '
    + 'The copy is held by nobody yet: add it to a position, or assign it to users.';

/** ADR-0112 status for a target name the catalog already holds. */
export const PERMISSION_SET_CLONE_NAME_TAKEN_STATUS = 409;

/**
 * Does this request belong to the door? Every `POST` whose third segment is
 * `clone` under `permission-sets`, with no upper bound on depth, so the arm is
 * exactly as wide as the match: a deeper path is refused by the arm with the
 * shape named, never passed on to the suggestion routes.
 */
export function isPermissionSetCloneWrite(parts: readonly string[], method: string): boolean {
    return method === 'POST' && parts[0] === PERMISSION_SET_CLONE_SEGMENT && parts[2] === 'clone';
}

/**
 * Build the clone of `source` under `target`: a deep copy of the whole
 * definition, {@link PERMISSION_SET_CLONE_DROPPED_KEYS} removed, then exactly
 * {@link PERMISSION_SET_CLONE_MUTATED_FIELDS} set.
 *
 * DEEP copy, not a spread: the source is the registry's own object, shared with
 * every reader of the catalog (`SecurityCatalogEntry.definition`, "never mutate
 * it"), so a shallow copy would leave the clone sharing its `objects` / `fields`
 * maps with the base. The result is not validated here: the metadata save
 * validates it against `PermissionSetSchema`, one policy, not a second.
 */
export function clonePermissionSetDefinition(
    source: Readonly<Record<string, unknown>>,
    target: { name: string; label: string },
): Record<string, unknown> {
    const copy = structuredClone(source) as Record<string, unknown>;
    for (const key of PERMISSION_SET_CLONE_DROPPED_KEYS) delete copy[key];
    copy.name = target.name;
    copy.label = target.label;
    return copy;
}

function nameTakenMessage(name: string): string {
    return (
        `Permission set '${name}' already exists — a clone must take a NEW machine name. `
        + 'Permission sets are assigned by name, so a second definition under one name would change what every '
        + `holder of '${name}' is granted (ADR-0126 §7.1). Retry with a name no permission set uses (for example '${name}_copy').`
    );
}

function readCloneBody(body: unknown): { name: string; label: string } {
    const cloneBody = body ?? {};
    if (typeof cloneBody !== 'object' || Array.isArray(cloneBody)) {
        throw validationFailure('Invalid clone body — expected { name: string, label: string }', [
            { field: '(body)', code: 'invalid_type', message: 'expected an object' },
        ]);
    }
    const unknownKeys = Object.keys(cloneBody).filter((k) => k !== 'name' && k !== 'label');
    if (unknownKeys.length > 0) {
        throw validationFailure(
            `Unknown key${unknownKeys.length > 1 ? 's' : ''} ${unknownKeys.map((k) => `\`${k}\``).join(', ')} — the clone body is { name: string, label: string }`,
            unknownKeys.map((k) => ({ field: k, code: 'unknown_field', message: 'not a clone field — the clone body is { name, label }' })),
        );
    }
    const name = (cloneBody as { name?: unknown }).name;
    if (typeof name !== 'string' || name.trim() === '') {
        throw validationFailure(
            'A clone requires a new machine name — `name` is mandatory (ADR-0126 §7.1). '
            + 'The clone is a sibling permission set, not a revision of the one it was copied from.',
            [{ field: 'name', code: name === undefined ? 'required' : 'invalid_type', message: 'expected a non-empty string' }],
        );
    }
    // The metadata name rule, asked of its one declaration, so the refusal is
    // this door's 400 naming the field rather than a 422 from the save.
    const nameRule = SnakeCaseIdentifierSchema.safeParse(name);
    if (!nameRule.success) {
        throw validationFailure(
            `'${name}' is not a valid permission-set name — use lowercase snake_case: start with a lowercase letter, then lowercase letters, digits and underscores, at least 2 characters (e.g. 'sales_rep_copy').`,
            [{ field: 'name', code: 'invalid_string', message: nameRule.error.issues[0]?.message ?? 'not snake_case' }],
        );
    }
    const label = (cloneBody as { label?: unknown }).label;
    if (typeof label !== 'string' || label.trim() === '') {
        throw validationFailure(
            'A clone requires a new display name — `label` is mandatory. '
            + 'Two permission sets sharing one label are indistinguishable where an admin assigns them.',
            [{ field: 'label', code: label === undefined ? 'required' : 'invalid_type', message: 'expected a non-empty string' }],
        );
    }
    return { name, label };
}

/**
 * `POST /security/permission-sets/:name/clone`.
 *
 * Order of operations, each step where it is for the reason given:
 *
 *  1. **Authority, first** — ahead of the path and body checks and of any
 *     lookup, so a refused caller learns nothing: neither the body contract nor
 *     whether the source exists.
 *  2. **Shape**: `['permission-sets', source, 'clone']`.
 *  3. **Body**: closed `{ name, label }`, the name meeting the metadata name
 *     rule — refused before the catalog is consulted.
 *  4. **Source**, through the catalog reader the security plugin binds to the
 *     engine — the read `resolveUserAuthzGrants` uses, registry first. ⛔ No
 *     `sys_permission_set` row is read. No reader bound, or one that cannot
 *     answer ⇒ 503; unknown ⇒ 404.
 *  5. **Target**: a name the catalog holds ⇒ 409.
 *  6. **The save**, through the metadata protocol's `saveMetaItem`, create-only
 *     (`parentVersion: null`), environment-wide, no package: the same save the
 *     `/meta` door makes, so the same schema, publish gates and hooks judge it,
 *     and the catalog serves the copy from where it serves every
 *     environment-authored set. A save that loses the race for the name (a row
 *     written under it after step 5's read) is step 5's 409, in step 5's words.
 */
export async function handlePermissionSetCloneWrite(
    deps: DomainHandlerDeps,
    parts: readonly string[],
    body: unknown,
    context: HttpProtocolContext,
): Promise<HttpDispatcherResult> {
    // ── 1. authority ────────────────────────────────────────────────────────
    const ec: any = context.executionContext;
    const verdict = metaWriteCapabilityVerdict({
        isSystem: ec?.isSystem === true,
        systemPermissions: ec?.systemPermissions,
        operation: 'save',
    });
    if (!verdict.allowed) {
        return { handled: true, response: deps.error(verdict.message, 403) };
    }
    // [ADR-0131 D3] The walled catalog refusal, the metadata door's own and
    // asked right after its capability gate, exactly as the dispatcher's
    // `PUT /meta` asks it: a clone creates an environment permission set, so
    // under `isolated` / `group` only the platform operator rung (or the engine
    // itself) makes one. Inert under `single`. Before any read, so a refused
    // caller learns nothing about the source or the target name.
    const walled = walledCatalogWriteVerdict({
        type: PERMISSION_METADATA_TYPE,
        tenancyPosture: await readEffectiveTenancyPosture(deps, context),
        isSystem: ec?.isSystem === true,
        callerPosture: ec?.posture,
    });
    if (!walled.allowed) {
        return { handled: true, response: deps.error(walled.message, 403) };
    }

    try {
        // ── 2. shape ────────────────────────────────────────────────────────
        if (parts.length !== 3 || !parts[1]) {
            return {
                handled: true,
                response: deps.error('Path must be /security/permission-sets/:name/clone', 400),
            };
        }
        const sourceName = decodeURIComponent(parts[1]);

        // ── 3. body ─────────────────────────────────────────────────────────
        const target = readCloneBody(body);

        // ── 4. source ───────────────────────────────────────────────────────
        if (!context.environmentId) {
            const def = deps.getDefaultEnvironmentId();
            if (def) context.environmentId = def;
        }
        const ql: any = (await deps.resolveProjectKernelObjectQL(context))
            ?? await deps.getObjectQL(context, context.environmentId);
        const reader = ql ? securityCatalogReaderOf(ql) : undefined;
        if (!reader) {
            return {
                handled: true,
                response: deps.error(
                    `Cannot read permission set '${sourceName}' — no security catalog is bound to this deployment's data engine.`,
                    503,
                    { code: 'SERVICE_UNAVAILABLE' },
                ),
            };
        }
        let source: SecurityCatalogEntry | undefined;
        let taken: SecurityCatalogEntry | undefined;
        try {
            source = await reader.resolve(PERMISSION_METADATA_TYPE, sourceName);
            // ── 5. target (asked of the same read) ──────────────────────────
            if (source) taken = await reader.resolve(PERMISSION_METADATA_TYPE, target.name);
        } catch (err: any) {
            return {
                handled: true,
                response: deps.error(
                    `Cannot read the security catalog (${err?.message ?? String(err)}). Refusing rather than answering `
                    + 'a clone from a read that did not happen.',
                    503,
                    { code: 'SERVICE_UNAVAILABLE' },
                ),
            };
        }
        if (!source) {
            return {
                handled: true,
                response: deps.error(`Permission set '${sourceName}' has no definition — there is nothing to clone.`, 404),
            };
        }
        if (taken || target.name === source.name) {
            return {
                handled: true,
                response: deps.error(nameTakenMessage(target.name), PERMISSION_SET_CLONE_NAME_TAKEN_STATUS),
            };
        }

        // ── 6. the save ─────────────────────────────────────────────────────
        const clone = clonePermissionSetDefinition(source.definition, target);
        const protocol: Partial<Pick<ObjectStackProtocolImplementation, 'saveMetaItem'>> | undefined =
            await deps.resolveServiceOrLoud(context, 'protocol');
        if (typeof protocol?.saveMetaItem !== 'function') {
            return {
                handled: true,
                response: deps.error(
                    'This deployment has no metadata protocol to save the copy through, so a permission set cannot be cloned here.',
                    501,
                ),
            };
        }
        // [ADR-0131 D6] No organization and no package: the copy lands
        // environment-wide, as every `/meta` write does. `parentVersion: null`
        // is `If-None-Match: *` — save only where no row exists — so a row
        // written under the target name after the catalog read is refused, not
        // overwritten.
        //
        // ⚠️ The save is NOT what keeps the source's provenance off the copy.
        // Its authoring rule (`tenantAuthoredWriteRefusal`) judges `flow`
        // writes only and answers null for `permission`, and its provenance
        // strip removes stamps silently. The guarantee is the drop above —
        // {@link PERMISSION_SET_CLONE_DROPPED_KEYS} — and the unit pin that
        // asserts every dropped key absent from the saved item.
        try {
            await protocol.saveMetaItem({
                type: PERMISSION_METADATA_TYPE,
                name: target.name,
                item: clone,
                parentVersion: null,
            });
        } catch (err: unknown) {
            // [#23577] The create-only pin refused: a row was written under the
            // target name after the catalog read above, so the name is taken —
            // step 5's condition, answered with step 5's refusal. The protocol's
            // own conflict sentence speaks to a `/meta` caller (it prescribes
            // `If-Match`), and this door takes no version from its caller.
            if ((err as { code?: unknown } | null)?.code === 'METADATA_CONFLICT') {
                return {
                    handled: true,
                    response: deps.error(nameTakenMessage(target.name), PERMISSION_SET_CLONE_NAME_TAKEN_STATUS),
                };
            }
            throw err;
        }

        // ⛔ No ancestry on the way out (ADR-0126 §9): the response names the
        // set that was created and nothing about what it was copied from.
        return { handled: true, response: deps.success({ permissionSet: clone, notice: PERMISSION_SET_CLONE_NOTICE }) };
    } catch (err: unknown) {
        // A validation failure keeps its 400; a save refusal keeps its own
        // status and code (a precondition conflict 409, a schema refusal 422).
        return { handled: true, response: deps.errorFromThrown(err, 500) };
    }
}
