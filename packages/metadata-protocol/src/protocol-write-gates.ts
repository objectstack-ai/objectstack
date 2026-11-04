// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29985 codemod] The "Write gates: overlay, code-only, organization, sealed
 * and packaged-base refusals, locks, version tokens, conflict audit" section of
 * `ObjectStackProtocolImplementation`: the bodies of `isArtifactBacked`,
 * `isNestedArtifactField`, `packagedArtifactOwner`, `storedFlowBindingAgrees`,
 * `refusePackagedBaseRemoval`, `baseServesBundleMember`, `pairOfAddedMember`,
 * `findPairAddedMemberRow`, `registryMemberServedAt` moved out of `protocol.ts`
 * whole by `scripts/codemod-split-protocol.mjs`.
 *
 * A MOVE, not a redesign. Each function below is the body of the class method
 * of the same name as `packages/metadata-protocol/scripts/host-split.mjs` moves
 * one (ruling E, item E1): re-indented one level, with `this.<member>` read as
 * `host.<member>` and nothing else changed. Each method stays on the class
 * with its docblock and signature, which the published `.d.ts` prints, and
 * hands its body the host (`protocol-host.ts`); the docblock there is the
 * contract.
 *
 * What a body reads from elsewhere, it imports from where `protocol.ts`
 * imports it. Nothing re-exports this module, so the published surface does
 * not move.
 */

import { managedItemSealedSentence } from './packaged-base-regime.js';
import type { StoredOverlayRow } from './item-lock.js';
import { itemDiscriminator } from '@objectstack/metadata-core';
import { PLURAL_TO_SINGULAR } from '@objectstack/spec/shared';
import { customizationPackageId } from '@objectstack/spec/kernel';
import { baseAddressServesMember, shippingPackageIds } from './protocol-environment-rows.js';
import { canonicalMetaType, canonicalizeMetaRequestType } from './protocol-meta-type-schema.js';
import { boundPackageOf } from './protocol-package-bindings.js';
import type { ShippingPackages } from './protocol-package-bindings.js';
import { memberOption } from './protocol-bundle-members.js';
import type { ProtocolHost } from './protocol-host.js';

/** The body of `ObjectStackProtocolImplementation#isArtifactBacked`; the method's docblock there is its contract. */
export function isArtifactBacked(host: Pick<ProtocolHost, 'isDeclaredCodeDatasource' | 'isNestedArtifactField' | 'lookupArtifactItem'>, type: string, name: string): boolean {
    // `lookupArtifactItem` only returns items whose `_packageId` marks a
    // genuine code package (the `'sys_metadata'` rehydration sentinel is
    // excluded), and — via `SchemaRegistry.getArtifactItem` — is immune
    // to plain-key shadows hydrated from overlay rows.
    if (host.lookupArtifactItem(type, name) !== undefined) return true;
    return host.isNestedArtifactField(type, name) || host.isDeclaredCodeDatasource(type, name);
}

/** The body of `ObjectStackProtocolImplementation#isNestedArtifactField`; the method's docblock there is its contract. */
export function isNestedArtifactField(host: Pick<ProtocolHost, 'lookupArtifactItem'>, type: string, name: string): boolean {
    if ((PLURAL_TO_SINGULAR[type] ?? type) !== 'field') return false;
    // `<object>.<field>` — both halves are snake_case and carry no dot of
    // their own, so the FIRST separator is the only one.
    const sep = name.indexOf('.');
    if (sep <= 0 || sep === name.length - 1) return false;
    const objectArtifact = host.lookupArtifactItem('object', name.slice(0, sep)) as
        { fields?: Record<string, unknown> } | undefined;
    const fields = objectArtifact?.fields;
    if (!fields || typeof fields !== 'object') return false;
    return Object.prototype.hasOwnProperty.call(fields, name.slice(sep + 1));
}

/** The body of `ObjectStackProtocolImplementation#packagedArtifactOwner`; the method's docblock there is its contract. */
export function packagedArtifactOwner(host: Pick<ProtocolHost, 'lookupArtifactItem'>, request: { type: string; name: string }): string | undefined {
    const folded = canonicalizeMetaRequestType(request);
    const artifact = host.lookupArtifactItem(folded.type, folded.name) as { _packageId?: unknown } | undefined;
    const packageId = artifact?._packageId;
    return typeof packageId === 'string' && packageId !== '' ? packageId : undefined;
}

/** The body of `ObjectStackProtocolImplementation#storedFlowBindingAgrees`; the method's docblock there is its contract. */
export async function storedFlowBindingAgrees(host: Pick<ProtocolHost, 'findEnvironmentRow' | 'rethrowUnlessMetadataStoreUnprovisioned'>, name: string, packageId: string): Promise<boolean> {
    try {
        // [#21911] The explicit system opt-in — see findServedOverlayRow.
        const row = await host.findEnvironmentRow('sys_metadata', {
            where: { type: 'flow', name, package_id: packageId },
            context: { isSystem: true },
        });
        return row != null;
    } catch (error) {
        host.rethrowUnlessMetadataStoreUnprovisioned(error, 'sys_metadata');
        return false;
    }
}

/** The body of `ObjectStackProtocolImplementation#refusePackagedBaseRemoval`; the method's docblock there is its contract. */
export function refusePackagedBaseRemoval(host: Pick<ProtocolHost, 'isSealedManagedItem' | 'mergesOverlayAtRead'>, request: { type: string; name: string }): void {
    const legacyOverlayRemoval = host
        .mergesOverlayAtRead(request.type);
    if (host.isSealedManagedItem(request.type, request.name) && !legacyOverlayRemoval) {
        // [#20819, ADR-0131 D6] Sentence per ADR-0126 regime, as in the save door.
        const err = new Error(managedItemSealedSentence(request.type, request.name, 'delete'));
        (err as any).code = 'NOT_OVERRIDABLE';
        (err as any).status = 403;
        throw err;
    }
}

/** The body of `ObjectStackProtocolImplementation#baseServesBundleMember`; the method's docblock there is its contract. */
export function baseServesBundleMember(host: Pick<ProtocolHost, 'shippedArtifactsOf'>, type: string, name: string, base: string, item: unknown, shipping: ShippingPackages): boolean {
    const member = itemDiscriminator(canonicalMetaType(type), item);
    const baseShipsMember = shippingPackageIds(host.shippedArtifactsOf(type, name, shipping, member)).has(base);
    return baseAddressServesMember(base, boundPackageOf((item as { _packageId?: unknown } | null | undefined)?._packageId), baseShipsMember);
}

/** The body of `ObjectStackProtocolImplementation#pairOfAddedMember`; the method's docblock there is its contract. */
export function pairOfAddedMember(host: Pick<ProtocolHost, 'shippedArtifactsOf' | 'shippingPackagesOf' | 'shipsBundleName'>, type: string, name: string, base: string, member: string): string | undefined {
    const shipping = host.shippingPackagesOf(type);
    if (!host.shipsBundleName(type, name, base, shipping)) return undefined;
    if (shippingPackageIds(host.shippedArtifactsOf(type, name, shipping, member)).has(base)) return undefined;
    const pair = customizationPackageId(base);
    return pair.ok ? pair.value : undefined;
}

/** The body of `ObjectStackProtocolImplementation#findPairAddedMemberRow`; the method's docblock there is its contract. */
export async function findPairAddedMemberRow(host: Pick<ProtocolHost, 'findServedOverlayRow' | 'pairOfAddedMember'>, type: string, name: string, base: string, member: string | undefined, wantedMember: string,
        activeRows?: readonly StoredOverlayRow[],): Promise<any> {
    const pairOfAddition = host.pairOfAddedMember(type, name, base, wantedMember);
    if (pairOfAddition === undefined) return undefined;
    return (await host.findServedOverlayRow({
        type, name, state: 'active', packageId: pairOfAddition, ...memberOption(member),
    }, activeRows))?.row;
}

/** The body of `ObjectStackProtocolImplementation#registryMemberServedAt`; the method's docblock there is its contract. */
export function registryMemberServedAt(host: Pick<ProtocolHost, 'baseServesBundleMember' | 'engine' | 'shippedArtifactsOf' | 'shippingPackagesOf' | 'shipsBundleName'>, type: string, name: string, base: string, item: unknown, member: string | undefined): unknown {
    const shipping = host.shippingPackagesOf(type);
    if (!host.shipsBundleName(type, name, base, shipping)) return item;
    if (host.baseServesBundleMember(type, name, base, item, shipping)) return item;
    if (member !== undefined) return undefined;
    const own = host.shippedArtifactsOf(type, name, shipping)
        .find((artifact) => (artifact as { _packageId?: unknown } | null)?._packageId === base);
    if (own === undefined) return undefined;
    const candidate = host.engine.registry.getItem(type, name, base, itemDiscriminator(canonicalMetaType(type), own));
    return candidate !== undefined && host.baseServesBundleMember(type, name, base, candidate, shipping) ? candidate : undefined;
}
