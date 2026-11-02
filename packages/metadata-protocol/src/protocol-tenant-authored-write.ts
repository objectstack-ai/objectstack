// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 E1] The pilot of the host split: `tenantAuthoredWriteRefusal`'s body,
 * moved out of `protocol.ts` by `scripts/host-split.mjs move` to prove the
 * machinery E2's section cuts use, on one member.
 *
 * A MOVE, not a redesign. The function below is the body of the
 * `ObjectStackProtocolImplementation` method of the same name as it stood,
 * re-indented one level, with `this.<member>` read as `host.<member>` and
 * nothing else changed (`node scripts/host-split.mjs check <base> …` proves
 * it). The method stays on the class with its docblock and signature, which the
 * published `.d.ts` prints, and hands its body the host (`protocol-host.ts`).
 *
 * What the body reads from elsewhere, it imports from where `protocol.ts`
 * imports it. Nothing re-exports this module, so the published surface does
 * not move.
 */

import {
    // [#20761, ADR-0126 §2] The ADR-0029 D9.6 reading of a body's own
    // provenance stamps — asked by {@link
    // ObjectStackProtocolImplementation.tenantAuthoredWriteRefusal} to tell a
    // body that CLAIMS to be code-shipped from one that does not.
    isCodeArtifactBody,
} from '@objectstack/metadata-core';
import { PLURAL_TO_SINGULAR } from '@objectstack/spec/shared';
import type { ProtocolHost } from './protocol-host.js';
import { canonicalizeMetaRequestType } from './protocol-meta-type-schema.js';

/** The body of `ObjectStackProtocolImplementation#tenantAuthoredWriteRefusal`; the method's docblock there is its contract. */
export async function tenantAuthoredWriteRefusal(host: Pick<ProtocolHost, 'overrideWriteVerdict' | 'packagedArtifactOwner' | 'packagedBaseRefusal' | 'storedFlowBindingAgrees' | 'uninstalledNamedBaseRefusal'>, request: { type: string; name: string; item: unknown; packageId?: string | null }): Promise<Error | null> {
    const folded = canonicalizeMetaRequestType(request);
    const singular = PLURAL_TO_SINGULAR[folded.type] ?? folded.type;
    if (singular !== 'flow') return null;
    const shipped = host.packagedArtifactOwner(folded) !== undefined;
    // [#28412, ADR-0146 D2 / D9] Rule 1's lock does not apply to the
    // shipping package's declared override: the one override write gate
    // ({@link overrideWriteVerdict}) admits it as the pair's own row, which
    // edits nothing the package ships. Any other write of a shipped name
    // keeps the lock.
    if (shipped && host.overrideWriteVerdict({
        type: singular,
        name: folded.name,
        item: folded.item,
        ...(folded.packageId ? { packageId: folded.packageId } : {}),
    }).verdict !== 'admit') {
        const locked = host.packagedBaseRefusal({
            type: folded.type,
            name: folded.name,
            operation: 'save',
            ...(folded.packageId ? { packageId: folded.packageId } : {}),
        });
        if (locked) return locked;
    }
    // [#20863] The named-base rule (see the docblock): a base the write
    // names must be a package the registry holds as installed. [#26708]
    // The rule is {@link uninstalledNamedBaseRefusal}'s, which
    // `saveMetaItem` asks for every other type too.
    const unbound = host.uninstalledNamedBaseRefusal({ type: singular, name: folded.name, packageId: folded.packageId });
    if (unbound) return unbound;
    if (shipped) return null;
    if (!isCodeArtifactBody(folded.item)) return null;
    const stamped = String((folded.item as { _packageId?: unknown })._packageId);
    if (folded.packageId === stamped) return null;
    if (await host.storedFlowBindingAgrees(folded.name, stamped)) return null;
    const err = new Error(
        `Flow '${folded.name}' was sent with a code-package provenance, but no managed package ships a flow of `
        + `that name. A flow written through an authoring door is authored in this deployment: which flows a `
        + `package ships is established by the package loader, never by the definition a caller sends. `
        + `Remove the provenance keys (_packageId, _packageVersion, _provenance) from the definition and send it `
        + `again. Nothing was written. See docs/adr/0126-packaged-metadata-customization-model.md.`,
    );
    (err as any).code = 'INVALID_METADATA';
    (err as any).status = 422;
    return err;
}
