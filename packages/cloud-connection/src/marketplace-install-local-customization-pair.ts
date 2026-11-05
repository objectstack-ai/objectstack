// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0146 D2 / D3, #30106] The PURE half of installing a base's paired
 * customization package (`<base>.custom`) through
 * `POST /api/v1/marketplace/install-local`: which items one package body
 * carries, in the order they are written, and every refusal the body alone
 * decides. The orchestration — the pair's ensure door, one save per item, the
 * rollback — is `MarketplaceInstallLocalPlugin#installCustomizationPair`.
 *
 * ## Why a pair is never installed as code
 *
 * ADR-0146 D3: the pair is "an ordinary writable package", and D2: what an
 * administrator authors into it is "exported (`GET /packages/:id/export`),
 * committed, reviewed and deployed to another environment as any package is".
 * On the environment that authored it the pair is a writable package and every
 * item is a stored `sys_metadata` row bound to it; every read that serves a
 * declared override reads those rows (`isServedOverrideRowOf`), and the
 * customization read lists them (`listServedOverrides`). A managed install
 * registers a package's items in the registry as code instead, so a pair
 * installed that way served none of its overrides, listed none of them, and
 * made the pair read-only, which closed the customization door behind it —
 * while the install answered success. So a pair's install lands what the
 * export describes: the target's own writable pair (its ensure door, the one
 * creation path D3 names) holding the items, each written through the save
 * door a Studio edit takes, which judges it as it judges that edit.
 *
 * ## What the body carries
 *
 * The keys `GET /packages/:id/export` writes (`PackageExportManifestSchema`):
 *
 *  - one array per metadata collection, spelled as the manifest spells it
 *    (`PLURAL_TO_SINGULAR`) — each element one item of that type, a `views:`
 *    container saved under the object it binds, as the artifact loader names
 *    it;
 *  - `viewItems` (`ASSEMBLED_VIEW_ITEMS_KEY`), the export's channel for a
 *    standalone view — where a view override travels;
 *  - `objectExtensions`, each one an `object_extension` item named by the
 *    object it extends (ADR-0146 D10; the export reads the pair back the same
 *    way, `packages/runtime/src/domains/packages.ts`);
 *  - the package's own keys, classified by `UNMANAGED_INSTALL_KEY_DISPOSITIONS`
 *    (`@objectstack/spec/kernel`), the one table of a package body's
 *    non-collection keys: `identity` / `base` keys describe the package, `door`
 *    keys are this door's (seed `data` is reported as not loaded), and
 *    `deployment` keys are read by a stack's boot and by no install.
 *
 * Every other key that carries content — code, a `translations` bundle, a
 * contribution the item rows cannot hold, an artifact envelope, a key the
 * table does not classify — is refused before anything is written, naming
 * each key: an export of a pair never writes one, and dropping it would be the
 * silent partial install this door exists to refuse.
 */

import {
    DEFAULT_METADATA_TYPE_REGISTRY,
    UNMANAGED_INSTALL_KEY_DISPOSITIONS,
    unmanagedInstallValueCarries,
} from '@objectstack/spec/kernel';
import { PLURAL_TO_SINGULAR } from '@objectstack/spec/shared';
import { ASSEMBLED_VIEW_ITEMS_KEY, deriveViewContainerObject, isAggregatedViewContainer } from '@objectstack/spec/ui';

/**
 * The collection a pair's object extensions travel in, and the metadata type
 * each entry is stored as. `PLURAL_TO_SINGULAR` carries no such pair — an
 * extension merges into its target rather than registering under a type of
 * its own — so the export states the pair where it reads the items out
 * (`assemblePackageManifest`), and this reading states it where they go back.
 */
export const PAIR_OBJECT_EXTENSIONS_KEY = 'objectExtensions';
export const PAIR_OBJECT_EXTENSION_TYPE = 'object_extension';

/** One item a pair install writes, in write order. */
export interface PairInstallItem {
    /** Canonical (singular) metadata type. */
    readonly type: string;
    /** The name it is saved under. */
    readonly name: string;
    /** The body, as the export carries it. */
    readonly item: Record<string, unknown>;
    /** Where it sits in the body, e.g. `viewItems[0]`. */
    readonly path: string;
}

/** What {@link planCustomizationPairInstall} answers. */
export type PairInstallPlan =
    | {
        readonly ok: true;
        readonly items: readonly PairInstallItem[];
        /** The body carries seed `data`, which a pair install does not load (it is data, not an item). */
        readonly carriesSeedData: boolean;
    }
    | {
        readonly ok: false;
        /** One located sentence per problem, every one of them — nothing is written. */
        readonly problems: readonly string[];
    };

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

/** The keys of a pair body that are NOT items and whose content no pair install can write. */
const REFUSED_DISPOSITIONS: ReadonlySet<string> = new Set(['code', 'uncopyable', 'envelope', 'converted']);

function loadOrderOf(type: string): number {
    return DEFAULT_METADATA_TYPE_REGISTRY.find((entry) => entry.type === type)?.loadOrder ?? Number.MAX_SAFE_INTEGER;
}

/** The name an item of `type` is saved under, or `undefined` when it carries none. */
function itemNameOf(type: string, item: Record<string, unknown>): string | undefined {
    if (type === PAIR_OBJECT_EXTENSION_TYPE) {
        return typeof item.extend === 'string' && item.extend !== '' ? item.extend : undefined;
    }
    if (type === 'view' && (isAggregatedViewContainer(item) || item.name === undefined)) {
        const object = deriveViewContainerObject(item);
        return typeof object === 'string' && object !== '' ? object : undefined;
    }
    return typeof item.name === 'string' && item.name !== '' ? item.name : undefined;
}

/**
 * The items one flat pair body carries, in write order (the registry's
 * `loadOrder`, so an object and its extensions are written before a view that
 * names their fields), or every problem the body alone shows. Pure.
 */
export function planCustomizationPairInstall(body: Record<string, unknown>): PairInstallPlan {
    const problems: string[] = [];
    const ranked: Array<PairInstallItem & { rank: readonly [number, number, number] }> = [];
    let carriesSeedData = false;
    Object.entries(body).forEach(([key, value], keyIndex) => {
        const type = key === ASSEMBLED_VIEW_ITEMS_KEY
            ? 'view'
            : key === PAIR_OBJECT_EXTENSIONS_KEY
                ? PAIR_OBJECT_EXTENSION_TYPE
                : (Object.prototype.hasOwnProperty.call(PLURAL_TO_SINGULAR, key) ? PLURAL_TO_SINGULAR[key] : undefined);
        if (type === undefined) {
            if (!unmanagedInstallValueCarries(value)) return;
            const disposition = Object.prototype.hasOwnProperty.call(UNMANAGED_INSTALL_KEY_DISPOSITIONS, key)
                ? UNMANAGED_INSTALL_KEY_DISPOSITIONS[key]
                : undefined;
            if (key === 'data' && disposition === 'door') carriesSeedData = true;
            if (disposition === undefined || REFUSED_DISPOSITIONS.has(disposition)) {
                problems.push(`\`${key}\` is not part of a paired customization package: its items are written as `
                    + 'stored items of the pair, and this key has no item form');
            }
            return;
        }
        if (value === undefined || value === null) return;
        if (!Array.isArray(value)) {
            problems.push(`\`${key}\` is not an array of ${type} definitions`);
            return;
        }
        value.forEach((item: unknown, index) => {
            const path = `${key}[${index}]`;
            if (!isPlainRecord(item)) {
                problems.push(`\`${path}\` is not a ${type} definition object`);
                return;
            }
            const name = itemNameOf(type, item);
            if (name === undefined) {
                problems.push(`\`${path}\` has no name`);
                return;
            }
            ranked.push({ type, name, item, path, rank: [loadOrderOf(type), keyIndex, index] });
        });
    });
    const seen = new Map<string, string>();
    for (const entry of ranked) {
        const slot = `${entry.type} '${entry.name}'`;
        const first = seen.get(slot);
        if (first !== undefined) problems.push(`two items claim ${slot} (\`${first}\` and \`${entry.path}\`)`);
        else seen.set(slot, entry.path);
    }
    if (problems.length > 0) return { ok: false, problems };
    ranked.sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1] || a.rank[2] - b.rank[2]);
    return { ok: true, items: ranked.map(({ rank: _rank, ...entry }) => entry), carriesSeedData };
}
