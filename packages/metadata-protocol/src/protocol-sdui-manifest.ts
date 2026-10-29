// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 cut 33] The deployment's ADR-0080 SDUI component manifest, from
 * `ObjectStackProtocolImplementation`, moved out of `protocol.ts` whole:
 * `resolveSduiManifest`, read per publish, and
 * `reportPageRequiresAbsentAtLoad`, the load half of the plugin-presence
 * check that reads it.
 *
 * A MOVE, not a redesign. Each function below is the body of the
 * `ObjectStackProtocolImplementation` method of the same name as it stood,
 * re-indented one level and otherwise unedited.
 *
 * ## How the moved bodies reach the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning), as `protocol-batch-data.ts` applies it.
 * The class keeps each method — the published `dist/*.d.ts` lists its name,
 * docblock and declared signature — and its body is one literal of exactly
 * the {@link SduiManifestHost} members it reads, plus a `.call`; a body that
 * reads no member is called as a plain function. The services registry and
 * the warned-once flag are handed over as getters (the flag also as a
 * setter), so each read and write reaches the class field as it stands at
 * call time. Every caller keeps calling the class methods.
 *
 * What the bodies read from elsewhere, they import from where `protocol.ts`
 * imports it. Nothing re-exports this module, so the published surface does
 * not move.
 */

import type { ObjectStackProtocolImplementation } from './protocol.js';
import { SDUI_MANIFEST_SERVICE, findPageRequiresAbsentFromManifest, isUsableSduiManifest } from './runtime-authoring-gate.js';

/**
 * The `ObjectStackProtocolImplementation` members the functions below read —
 * every one of them, and no other; each function's `this` is the `Pick` of
 * the members it reads. Each is typed AS the class member (an indexed access
 * on the class), so a change to a member's signature on the class is a change
 * here too, and naming a member the class does not have is a compile error.
 */
export interface SduiManifestHost {
    readonly getServicesRegistry: ObjectStackProtocolImplementation['getServicesRegistry'];
    unusableSduiManifestWarned: ObjectStackProtocolImplementation['unusableSduiManifestWarned'];
}

/** The body of `ObjectStackProtocolImplementation#resolveSduiManifest`; the method's docblock there is its contract. */
export function resolveSduiManifest(this: Pick<SduiManifestHost, 'getServicesRegistry' | 'unusableSduiManifestWarned'>): unknown {
    const value = this.getServicesRegistry?.().get(SDUI_MANIFEST_SERVICE);
    if (value === undefined || isUsableSduiManifest(value)) return value;
    if (!this.unusableSduiManifestWarned) {
        this.unusableSduiManifestWarned = true;
        console.warn(
            `[Protocol] the '${SDUI_MANIFEST_SERVICE}' service is not an SDUI component manifest `
            + `(a JSON object with a \`components\` map) — html page sources are saved without being `
            + `compiled against it, and a page's \`requires\` is not validated. Register the parsed `
            + `sdui.manifest.json of the console this deployment serves.`,
        );
    }
    return undefined;
}

/** The body of `ObjectStackProtocolImplementation#reportPageRequiresAbsentAtLoad`; the method's docblock there is its contract. */
export function reportPageRequiresAbsentAtLoad(name: string, body: unknown, sduiManifest: unknown): void {
    const absent = findPageRequiresAbsentFromManifest('page', body, sduiManifest);
    if (!absent || absent.length === 0) return;
    const one = absent.length === 1;
    const named = absent.map((ns) => `'${ns}'`).join(', ');
    console.warn(
        `[Protocol] [page_requires_plugin_absent] stored page/${name} requires ${named}, `
        + `${one ? 'a namespace' : 'namespaces'} no component in this deployment's SDUI component manifest `
        + `carries: the plugin${one ? ' that provides it is' : 's that provide them are'} not loaded in the `
        + `console this deployment serves. The page is loaded and served anyway, and what its source draws `
        + `from ${one ? 'that plugin' : 'those plugins'} will not render. Install ${one ? 'it' : 'them'} in `
        + `that console, or take ${one ? 'its' : 'their'} components out of the page's source and save the `
        + `page without \`requires\` — it is derived from the source at save.`,
    );
}
