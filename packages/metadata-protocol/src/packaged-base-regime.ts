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
 * [#21944] One code-defined datasource has no source file: the host's
 * `default`, defined by the database the server starts with. The row lists it
 * under `hostOwned`, and its sentence names that configuration instead of a
 * `*.datasource.ts` nobody can find. Every other name keeps the source remedy.
 *
 * The row is also what {@link isOriginGatedType} answers from, for the one
 * removal both the protocol's delete door and the repository's delete gate
 * allow on such a type: deleting a STORED row under a code-defined name. The
 * runtime registers a code-defined datasource in memory only and never
 * persists it, so a stored row under its name is never a layer of it — it is
 * residue a runtime write left — and removing it restores the code definition.
 *
 * ⛔ No sentence built here prescribes the `OS_METADATA_WRITABLE` hatch. [ADR-0131
 * D6] Managed content is sealed: the hatch opens no write onto, and no removal
 * of, an item a managed package ships, on any door, so a sentence that named it
 * as a remedy would send the operator to a door that does not open. The one
 * sentence that names it at all is {@link managedItemSealedSentence}'s, for a
 * type with no regime row, and it names it to say it does not apply: an operator
 * who set it and read a refusal that never mentioned it would conclude it was
 * ignored and set it again. ⛔ Nor does a Regime C sentence prescribe editing the
 * source and redeploying: the administrator of an installed package cannot do
 * that, and a Regime C type has a runtime route instead. The origin-gated row
 * has none, so the source is the only remedy there is to name.
 *
 * ## "A managed package"
 *
 * [ADR-0131 D6] A package reaches a deployment in one of two install modes, and
 * only the managed one registers its content as code. The install mode is not
 * modelled yet (the manifest declaration of permitted modes is later work), so
 * every package whose items the artifact loader registered is managed, and every
 * sentence here names it so: the install mode is what the refusal is about, not
 * the fact that the item happens to be code.
 *
 * ## The remedy follows what the caller DID: an edit, or a create
 *
 * [#22591] One sealed item is refused for two different acts, and each has its
 * own remedy. A save that changes the item under the name (an EDIT) is told
 * where that item can change: its row's sanctioned path, or its source. A save
 * that brings an item of the caller's own into existence under a name a package
 * or a built-in already holds (a CREATE, or a rename into that name) is told the
 * one thing it can do instead: choose another name. "Edit the source artifact"
 * sends that author to an artifact they did not write and cannot edit, and a
 * Regime C path customizes the package's item, which is not what they asked for.
 *
 * The create sentence is ONE sentence for every type ({@link heldNameSentence}),
 * never a row: the remedy does not depend on the type, so a type added later
 * gets it without a row, and a row added later cannot take it away. Only the
 * opener and the citation are the row's, as in the edit sentences. The act is
 * the caller's fact, never inferred here: a door that knows it is taking a name
 * says so with the `create` operation ({@link SealedItemOperation}), and every
 * other save keeps the edit remedy, byte for byte.
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
        /**
         * [#21944] Names the HOST defines from its own configuration rather than
         * from a {@link source} file, each with what defines it. For such a name
         * the source-file remedy is false — no such file exists, and an artifact
         * may not declare the name at all — so its sentence names this instead.
         */
        readonly hostOwned?: Readonly<Record<string, string>>;
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
        // [#21944] `default` is the host's primary datasource: the runtime's
        // DefaultDatasourcePlugin builds it from the database the server is
        // started with (a URL flag or config, OS_DATABASE_URL, a default-routing
        // rule, or the unified default file — `resolve-project-database.ts`).
        // The name is reserved for it: AppPlugin refuses an artifact that
        // declares `default`, and the datasource-admin service refuses to create
        // one. So no `*.datasource.ts` declares it, and its remedy says so.
        hostOwned: { default: "the host's database configuration (the database URL the server starts with)" },
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
    return `${prescription}. See ${REGIME_C_ADR}.`;
}

/** [ADR-0126 §2] The decision record every Regime C sentence cites. */
const REGIME_C_ADR = 'docs/adr/0126-packaged-metadata-customization-model.md';

/**
 * The PRESCRIPTION half of a regime's refusal, built from the row alone: a
 * Regime C row's sanctioned paths ({@link regimeCPrescription}), or an
 * origin-gated row's owning source — the only remedy such a type has — and the
 * row's citation.
 */
function rowPrescription(row: PackagedBaseRegimeRow, name?: string): string {
    switch (row.regime) {
        case 'C':
            return regimeCPrescription(row.routes);
        case 'origin-gated': {
            const host = name !== undefined && row.hostOwned !== undefined
                && Object.prototype.hasOwnProperty.call(row.hostOwned, name)
                ? row.hostOwned[name]
                : undefined;
            return host !== undefined
                ? `It is defined by ${host}: change that configuration and restart the server. See ${row.docs}.`
                : `Edit the ${row.source} source that declares it and redeploy. See ${row.docs}.`;
        }
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
 * The lock is the regime's: a Regime C item "is provided by a managed package and
 * is sealed" ([ADR-0131 D6] — the install mode, see the module header); an
 * origin-gated item "is code-defined and cannot be edited (removed) at runtime:
 * it is read-only" — the datasource-admin service's own verdict on the same item,
 * so the two doors onto one code-defined datasource state one verdict and one
 * remedy.
 *
 * Kept under the REST door's 500-character client-message bound
 * (`truncateClientMessage`, `packages/rest/src/error-response.ts`), past which
 * the tail is truncated. Characters outside the item's name, save / removal:
 * `flow` 395 / 388, `action` 349 / 342, `permission` 301 / 294,
 * `datasource` 192 / 193 — so a name of up to 88 characters arrives whole for
 * every row (pinned). [#21944] A row's `hostOwned` name is a fixed, short name
 * with its own remedy (`default`: under 300 characters whole).
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
        : `Metadata item '${singular}/${name}' is provided by a managed package and is sealed `
            + (operation === 'delete' ? `against removal. ` : `against in-place edits. `);
    return lock + rowPrescription(row, name);
}

/** [ADR-0131 D6] The decision record every sealed-item sentence without a regime row cites. */
const MANAGED_SEAL_ADR = 'docs/adr/0131-total-organization-ownership-no-null-organization-id.md';

/**
 * [#22591] What a refused write did to the item's name — the fact the remedy
 * follows (module header, "The remedy follows what the caller DID"):
 *
 *  - `save` — a change to the item already under the name: an edit. The
 *    default for every save whose caller declares nothing else, so a door
 *    that cannot tell keeps the remedy it always gave;
 *  - `create` — a save that brings an item of the caller's own into existence
 *    under the name: a create, or a rename into the name. Refused on exactly
 *    the ground, with exactly the code and status, a `save` is;
 *  - `delete` — a removal.
 */
export type SealedItemOperation = 'save' | 'create' | 'delete';

/**
 * [#22591] The sentence for a CREATE under a name a managed package or a
 * built-in holds, or a rename into it — ONE sentence for every type (module
 * header): who holds the name, the one remedy a create has (choose a name no
 * package or built-in holds), where the names in use are listed, and the type's
 * own decision record. The opener and the citation are the row's, as in the edit
 * sentences — an origin-gated type's item is code-defined, not shipped by a
 * managed package; a Regime C type's record is the one whose §2 makes a new
 * machine name mandatory for an item authored beside a packaged one.
 *
 * ⛔ It names neither the source artifact, nor a row's sanctioned path, nor the
 * `OS_METADATA_WRITABLE` hatch: all three act on the item that holds the name,
 * and the caller asked for an item of their own. The listing route is the
 * type's own `/meta` list, which answers the names the type serves.
 *
 * Kept under the REST door's 500-character client-message bound: outside the
 * item's name and its type's three mentions it is 255 characters at most
 * (measured; pinned with an 88-character name on the longest type).
 */
function heldNameSentence(singular: string, name: string): string {
    const row = packagedBaseRegimeRow(singular);
    const holder = row?.regime === 'origin-gated'
        ? `${row.noun} '${name}' is code-defined`
        : `Metadata item '${singular}/${name}' is provided by a managed package`;
    const docs = row === undefined ? MANAGED_SEAL_ADR : row.regime === 'C' ? REGIME_C_ADR : row.docs;
    return `${holder}, so its name is taken. To author your own ${singular}, choose a name no package or `
        + `built-in holds (GET /api/v1/meta/${singular} lists the names in use). See ${docs}.`;
}

/**
 * [ADR-0131 D6] THE refusal sentence for a write onto, or a removal of, an item a
 * managed package ships, on a type with no environment overlay — every door that
 * refuses one builds it here, and nowhere else: the metadata protocol's package
 * doors (`refusePackagedBaseOverride` / `refusePackagedBaseRemoval`) and the
 * repository's type door (`SysMetadataRepository.assertAllowed`), which answers
 * the same condition one layer down for the writes that reach it without passing
 * a package door (draft promotion, restore, revert).
 *
 * [#22591] A `create` — a save that takes the name for an item of the caller's
 * own — reads {@link heldNameSentence} whatever the type. An edit (`save`) and a
 * removal read on:
 *
 * A type with a regime row speaks for its regime ({@link packagedBaseRegimeSentence}:
 * the sanctioned path, never the hatch). Every other type reads the managed seal
 * itself: the item is sealed, its type takes no environment overlay, the
 * `OS_METADATA_WRITABLE` hatch does not open it, and the one remedy that exists —
 * changing the definition where it is declared. The hatch is named to say it
 * does not apply (see the module header for why it is named at all), and the
 * registry flag that produced the verdict is named so the reader can tell this
 * refusal from the regime-O overlay it is not.
 *
 * Kept under the REST door's 500-character client-message bound: the sentence
 * outside the item's type and name is 321 / 275 characters, save / removal (measured).
 */
export function managedItemSealedSentence(type: string, name: string, operation: SealedItemOperation): string {
    const singular = PLURAL_TO_SINGULAR[type] ?? type;
    if (operation === 'create') return heldNameSentence(singular, name);
    const regime = packagedBaseRegimeSentence(singular, name, operation);
    if (regime !== undefined) return regime;
    return `Metadata item '${singular}/${name}' is provided by a managed package and is sealed `
        + (operation === 'delete' ? 'against removal' : 'against in-place edits')
        + `: its type takes no environment overlay (allowOrgOverride=false), and OS_METADATA_WRITABLE does not `
        + `open a managed item. `
        + (operation === 'delete' ? '' : 'Edit the source artifact and redeploy. ')
        + `See ${MANAGED_SEAL_ADR}.`;
}
