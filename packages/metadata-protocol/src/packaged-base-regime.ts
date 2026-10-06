// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20819, #20910, ADR-0126 §2 / §3] THE packaged-base regime table — the one
 * declaration of which metadata types' locked-base refusals speak for their
 * ADR-0126 customization regime, and of the sanctioned routes each such type
 * HAS. Every door that refuses an in-place write onto a packaged item of one of
 * these types builds its prescription from this table, and from nothing else:
 *
 *  - the metadata protocol's package door (`protocol.ts`
 *    `refusePackagedBaseOverride` / `refusePackagedBaseRemoval`), on an
 *    environment-scoped kernel — {@link packagedBaseRegimeSentence};
 *  - the repository's type door (`SysMetadataRepository.assertAllowed`), the
 *    same refusal one layer down where the `/meta` protocol is not
 *    environment-scoped — {@link packagedBaseRegimeSentence} too;
 *  - the named-base `ITEM_LOCKED` limb (`SysMetadataRepository
 *    .readOnlyBaseOverrideError`) with the hatch closed — {@link
 *    packagedBaseRegimePrescription}.
 *
 * It lives in its own module because the two files that read it import each
 * other one way only (`protocol.ts` imports the repository): a table declared
 * in either would make the other reach back for it. Internal — not exported
 * from the package entry.
 *
 * ## Why it exists
 *
 * ADR-0126 §2 requires a Regime C refusal to name the sanctioned path — "in-place
 * edit refused loudly at the write door, the refusal naming the sanctioned path"
 * — and §10 gives the reason: a locked base that refuses with its sanctioned
 * path in the message is what keeps AI-written metadata from guessing. The
 * regime is recorded nowhere else in code (the ADR's table is prose, and the
 * registry entries carry no regime field), so this map is its one declaration
 * for the refusal — never a second list of type names, and never a type branch
 * in any door's prose.
 *
 * ## ONE regime, PER-TYPE routes
 *
 * A row is the type's regime plus the sanctioned routes that regime gives THAT
 * type: the regime decides the sentence's shape (locked; here is the sanctioned
 * path), the row supplies the paths, and the builders below compose the sentence
 * from the row alone. ADR-0126 §3's Regime C types declared here, each with only
 * the primitives it has, each route the one it is SERVED at:
 *
 *  - `flow` — both (§7): the clone under a new name (§7.1,
 *    `POST /automation/:name/clone`, body `{ name, label }`, both keys required)
 *    and the enable/disable switch (§7.2, `POST /automation/:name/toggle`, body
 *    `{ enabled }`);
 *  - `action` — the switch only (§8 item 2, amendment ruling 3):
 *    `POST /actions/_activation/:object/:action`, body `{ enabled }`, the
 *    `:object` segment spelled `global` for an object-less action. ⛔ No clone:
 *    the action-clone half is not chartered, so a clone route named here would
 *    advertise one that does not exist;
 *  - `permission` — the clone only (§8 item 3, the landed lock-and-clone
 *    machinery): the "Clone" action on the permission set, which posts the copy
 *    to `POST /data/sys_permission_set` under a new name. Spelled as
 *    `plugin-security`'s own lock refusal spells that same path
 *    (`packaged-permission-set-lock.ts`), so one condition reads one way at
 *    every door.
 *
 * Both switch routes are gated by the ONE §5 write-authority gate
 * (`packages/runtime/src/domains/activation-gate.ts`), so both carry the same
 * operator-only clause. Still absent: ADR-0126 §3's pre-charted `tool` /
 * `skill` / `position` — no sanctioned path is built for them, and a row with no
 * route does not compile ({@link PackagedBaseRegimeCRoutes}).
 *
 * ## The one origin-gated row
 *
 * [#21899] ADR-0126 §3 places `datasource` OUTSIDE the three regimes, and says
 * how: "origin-gated: code-defined read-only, runtime-created free". A
 * code-defined datasource has no runtime route at all — no overlay, no clone,
 * no switch: `DatasourceSchema.origin` (`@objectstack/spec`) declares it
 * "authored as `*.datasource.ts`, GitOps-owned, read-only in the UI", ADR-0062
 * ratifies it read-only, and the datasource-admin service refuses to edit or
 * remove one ("… is code-defined and cannot be edited at runtime."). So its row
 * carries no routes; it names the source that owns the datasource, and its
 * sentence states the admin door's verdict in the admin door's words, then that
 * remedy. The two doors keep their own codes (`NOT_OVERRIDABLE` / 403 here,
 * `DATASOURCE_ADMIN_ERROR` / 400 there); the verdict and the remedy agree.
 *
 * The row is also what {@link isOriginGatedType} answers from, for the one
 * removal both the protocol's delete door and the repository's delete gate
 * allow on such a type: deleting a STORED row under a code-defined name. The
 * runtime registers a code-defined datasource in memory only and never
 * persists it, so a stored row under its name is never a layer of it — it is
 * residue a runtime write left — and removing it restores the code definition.
 *
 * ⛔ No sentence built here names the `OS_METADATA_WRITABLE` hatch. The hatch
 * still opens these locks exactly as before, so which writes are refused does
 * not move — only what the refusal prescribes. ⛔ Nor does a Regime C sentence
 * prescribe editing the source and redeploying: the administrator of an
 * installed package cannot do that, and a Regime C type has a runtime route
 * instead. The origin-gated row has none, so the source is the only remedy
 * there is to name.
 */

import { PLURAL_TO_SINGULAR } from '@objectstack/spec/shared';

/**
 * An ADR-0126 customization regime a packaged-base refusal speaks for — only the
 * ones it needs today: Regime C, and the origin-gated posture §3 records for a
 * type outside the regimes.
 */
export type PackagedBaseRegime = 'C' | 'origin-gated';

/**
 * The sanctioned routes a Regime C type's row supplies to its refusal: how to
 * reach that type's clone-as-sibling, and how to reach its enable/disable
 * switch — each spelled as the route a client calls (and its body), never as
 * prose about the type. A row declares the primitives its type HAS and only
 * those: the union refuses a row naming neither.
 */
export type PackagedBaseRegimeCRoutes =
    | { readonly clone: string; readonly switchOff?: string }
    | { readonly clone?: string; readonly switchOff: string };

/**
 * One type's row: its regime, and what that regime names for it — a Regime C
 * type's sanctioned routes, or an origin-gated type's owning source.
 */
export type PackagedBaseRegimeRow =
    | { readonly regime: 'C'; readonly routes: PackagedBaseRegimeCRoutes }
    | {
        readonly regime: 'origin-gated';
        /** The type's noun, opening the sentence the way the type's own admin door opens it. */
        readonly noun: string;
        /** The source pattern a code-defined item of the type is authored in. */
        readonly source: string;
        /** The decision record the sentence cites. */
        readonly docs: string;
    };

/** The table. Keyed by the canonical (singular) metadata type. */
export const PACKAGED_BASE_REGIME: Readonly<Record<string, PackagedBaseRegimeRow>> = {
    flow: {
        regime: 'C',
        routes: {
            clone: 'POST /api/v1/automation/:name/clone, body {name, label}',
            switchOff: 'POST /api/v1/automation/:name/toggle, body {enabled: false}; '
                + 'operator-only where one install serves several organizations',
        },
    },
    action: {
        regime: 'C',
        routes: {
            switchOff: 'POST /api/v1/actions/_activation/:object/:action, body {enabled: false}, '
                + ':object = global for an object-less action; '
                + 'operator-only where one install serves several organizations',
        },
    },
    permission: {
        regime: 'C',
        routes: {
            clone: 'the "Clone" action on the permission set, '
                + 'or POST /api/v1/data/sys_permission_set with a new name',
        },
    },
    datasource: {
        regime: 'origin-gated',
        noun: 'Datasource',
        source: '*.datasource.ts',
        docs: 'docs/adr/0062-external-datasource-runtime.md',
    },
};

/** The type's row, read on the canonical type, or `undefined` when it declares no regime. */
export function packagedBaseRegimeRow(type: string): PackagedBaseRegimeRow | undefined {
    const singular = PLURAL_TO_SINGULAR[type] ?? type;
    return Object.prototype.hasOwnProperty.call(PACKAGED_BASE_REGIME, singular)
        ? PACKAGED_BASE_REGIME[singular]
        : undefined;
}

/**
 * A Regime C row's prescription: its sanctioned paths in one fixed order —
 * clone first, then the switch — and the citation of the ADR that decided them.
 * Nothing in it reads the type: a flow reads "Clone it …, or switch it off …"
 * because its row has both, an action reads only the switch and a permission set
 * only the clone because theirs have one.
 */
function regimeCPrescription(routes: PackagedBaseRegimeCRoutes): string {
    // [verb opening the sentence, verb after "or", the rest of the path]
    const paths: Array<readonly [string, string, string]> = [
        ...(routes.clone
            ? [['Clone', 'clone', ` it under a new name to customize it (${routes.clone})`] as const]
            : []),
        ...(routes.switchOff ? [['Switch', 'switch', ` it off (${routes.switchOff})`] as const] : []),
    ];
    const prescription = paths
        .map(([opening, following, rest], i) => (i === 0 ? opening : following) + rest)
        .join(', or ');
    return `${prescription}. See docs/adr/0126-packaged-metadata-customization-model.md.`;
}

/**
 * The PRESCRIPTION half of a regime's refusal, built from the row alone: a
 * Regime C row's sanctioned paths ({@link regimeCPrescription}), or an
 * origin-gated row's owning source — the only remedy such a type has — and the
 * row's citation.
 */
function rowPrescription(row: PackagedBaseRegimeRow): string {
    switch (row.regime) {
        case 'C':
            return regimeCPrescription(row.routes);
        case 'origin-gated':
            return `Edit the ${row.source} source that declares it and redeploy. See ${row.docs}.`;
    }
}

/**
 * The regime prescription for `type` — the row's remedy and its citation, one
 * sentence pair, no opener — or `undefined` when the type declares no regime and
 * the emitter keeps its own remedy.
 */
export function packagedBaseRegimePrescription(type: string): string | undefined {
    const row = packagedBaseRegimeRow(type);
    return row ? rowPrescription(row) : undefined;
}

/**
 * [#21899] Is `type` origin-gated (ADR-0126 §3: code-defined read-only,
 * runtime-created free)? The one removal such a type allows on a code-defined
 * name is deleting a STORED row under it: the runtime never persists a
 * code-defined item of the type, so the row is residue a runtime write left,
 * never a layer of the item, and removing it restores the code definition. Read
 * by the protocol's delete door and by the repository's delete gate — one row,
 * so the two cannot disagree about which types this is.
 */
export function isOriginGatedType(type: string): boolean {
    return packagedBaseRegimeRow(type)?.regime === 'origin-gated';
}

/**
 * The whole regime sentence for a packaged item `type/name` refused on save or
 * on removal — the lock, then {@link packagedBaseRegimePrescription} — or
 * `undefined` when the type declares no regime and the emitter keeps its own
 * sentence. Read on the canonical type, and spoken with it.
 *
 * The lock is the regime's: a Regime C item "is provided by a code package, and
 * its packaged base is locked"; an origin-gated item "is code-defined and cannot
 * be edited (removed) at runtime: it is read-only" — the datasource-admin
 * service's own verdict on the same item, so the two doors onto one code-defined
 * datasource state one verdict and one remedy.
 *
 * Kept under the REST door's 500-character client-message bound
 * (`truncateClientMessage`, `packages/rest/src/error-response.ts`), past which
 * the tail is truncated. Characters before the item's name, save / removal:
 * `flow` 411 / 404, `action` 365 / 358, `permission` 317 / 310, `datasource`
 * 192 / 193 — so a name of up to 88 characters arrives whole for every row
 * (pinned). A `flow`'s sentence is byte-identical to the one the row table
 * replaced (pinned literally).
 */
export function packagedBaseRegimeSentence(
    type: string, name: string, operation: 'save' | 'delete',
): string | undefined {
    const singular = PLURAL_TO_SINGULAR[type] ?? type;
    const row = packagedBaseRegimeRow(singular);
    if (row === undefined) return undefined;
    const lock = row.regime === 'origin-gated'
        ? `${row.noun} '${name}' is code-defined and cannot be `
            + (operation === 'delete' ? 'removed' : 'edited') + ' at runtime: it is read-only. '
        : `Metadata item '${singular}/${name}' is provided by a code package, and its packaged base is locked `
            + (operation === 'delete' ? `against removal. ` : `against in-place edits. `);
    return lock + rowPrescription(row);
}
