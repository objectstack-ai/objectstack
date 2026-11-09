// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29985 codemod] The static tables of the "Write gates: overlay, code-only,
 * organization, sealed and packaged-base refusals, locks, version tokens,
 * conflict audit" section of `ObjectStackProtocolImplementation`: the
 * initializers of `OVERLAY_ALLOWED_TYPES`, `STATIC_REGISTRY_TYPES`,
 * `RUNTIME_CREATE_ALLOWED_TYPES`, `OVERLAY_CAPABLE_TYPES` moved out of
 * `protocol.ts` whole by `scripts/codemod-split-protocol.mjs --members`
 * (#30147).
 *
 * A MOVE, not a redesign. Each initializer below is the one the class field of
 * the same name carried, byte for byte; the field keeps its docblock,
 * modifiers and type, and reads its table from here. An initializer runs
 * while its class is evaluated, so this module imports neither `protocol.ts`
 * nor any module that does: only what the initializers read, from where
 * `protocol.ts` imports it. Nothing re-exports this module, so the published
 * surface does not move.
 */

import { SINGULAR_TO_PLURAL } from '@objectstack/spec/shared';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';

export class ProtocolWriteGatesTables {
    /** The initializer of `ObjectStackProtocolImplementation.OVERLAY_ALLOWED_TYPES`; the field's declaration there is its contract. */
    static readonly OVERLAY_ALLOWED_TYPES: ReadonlySet<string> = (() => {
        const out = new Set<string>();
        for (const entry of DEFAULT_METADATA_TYPE_REGISTRY) {
            if (!entry.allowEnvironmentOverlay) continue;
            out.add(entry.type);
            const plural = SINGULAR_TO_PLURAL[entry.type];
            if (plural) out.add(plural);
        }
        return out;
    })();

    /** The initializer of `ObjectStackProtocolImplementation.STATIC_REGISTRY_TYPES`; the field's declaration there is its contract. */
    static readonly STATIC_REGISTRY_TYPES: ReadonlySet<string> = (() => {
        const out = new Set<string>();
        for (const entry of DEFAULT_METADATA_TYPE_REGISTRY) {
            out.add(entry.type);
            const plural = SINGULAR_TO_PLURAL[entry.type];
            if (plural) out.add(plural);
        }
        return out;
    })();

    /** The initializer of `ObjectStackProtocolImplementation.RUNTIME_CREATE_ALLOWED_TYPES`; the field's declaration there is its contract. */
    static readonly RUNTIME_CREATE_ALLOWED_TYPES: ReadonlySet<string> = (() => {
        const out = new Set<string>();
        for (const entry of DEFAULT_METADATA_TYPE_REGISTRY) {
            if (!entry.allowRuntimeCreate) continue;
            out.add(entry.type);
            const plural = SINGULAR_TO_PLURAL[entry.type];
            if (plural) out.add(plural);
        }
        return out;
    })();

    /** The initializer of `ObjectStackProtocolImplementation.OVERLAY_CAPABLE_TYPES`; the field's declaration there is its contract. */
    static readonly OVERLAY_CAPABLE_TYPES: ReadonlySet<string> = (() => {
        const out = new Set<string>();
        for (const entry of DEFAULT_METADATA_TYPE_REGISTRY) {
            if (!entry.supportsOverlay) continue;
            out.add(entry.type);
            const plural = SINGULAR_TO_PLURAL[entry.type];
            if (plural) out.add(plural);
        }
        return out;
    })();
}
