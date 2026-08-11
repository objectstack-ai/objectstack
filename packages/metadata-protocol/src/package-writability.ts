// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0070 — the read-only-package predicate, in ONE place.
 *
 * A package is either a **writable base** (an org may author into it, and its
 * lifecycle is the org's to manage) or **read-only** (it belongs to the
 * deployment that ships it). Until #7560 this distinction was a private method
 * on {@link ObjectStackProtocolImplementation}, reachable only by the metadata
 * authoring path — so `saveMetaItem` refused to author INTO a platform package
 * while `PATCH /packages/:id/disable` and `DELETE /packages/:id` happily took
 * the whole package out of the running deployment.
 *
 * The two callers now share this function rather than each spelling the rule:
 * a third read-only signal added here reaches the authoring gate and the
 * lifecycle gate together, which is the only way the two can't drift apart.
 */

/**
 * The engine surface this predicate reads. Structural on purpose — it is
 * satisfied by the real `ObjectQLEngine`, by `MetadataHostEngine`, and by the
 * partial doubles the gate tests build, and it keeps this module free of a
 * dependency on `@objectstack/objectql`.
 */
export interface PackageWritabilityEngine {
    /** Booted code packages, keyed by manifest id (`registerApp` populates it). */
    manifests?: { has?(id: string): boolean };
    registry?: {
        getPackage?(id: string): { manifest?: { scope?: string } } | undefined;
    };
}

/**
 * Manifest scopes that mark a package as platform-delivered, hence read-only.
 * `system` is the platform's own; `cloud` is marketplace / control-plane
 * delivered. Anything else (`project`, or an absent scope) is an org's own.
 */
export const READ_ONLY_PACKAGE_SCOPES: readonly string[] = ['system', 'cloud'];

/**
 * True when `packageId` is a **writable base** — a DB-backed package an org or
 * the AI may author *new* metadata into, and whose lifecycle the org owns
 * (ADR-0070 D2). The two read-only kinds return `false`:
 *
 *   • **Booted code packages** — they register a manifest into the engine at
 *     startup (`registerApp` → `engine.manifests`); their items are code-shipped
 *     artifacts. Only `allowOrgOverride` overlays are allowed (ADR-0005), never
 *     fresh authored items.
 *   • **Installed / platform packages** — manifest `scope` is `system` or
 *     `cloud` (marketplace / platform-delivered).
 *
 * A project-scoped DB package, or a bare ADR-0048 *authoring-workspace* id with
 * no registered manifest, is writable.
 *
 * NOTE: the code-package signal is the engine manifest map ONLY — we
 * deliberately do NOT fall back to "owns ≥1 registered object" (the old
 * `isLoadedPackage` heuristic). A writable base accrues registered objects once
 * its drafts publish, and that must never flip the base to read-only — that is
 * the exact #2252 read-only-after-publish trap ADR-0070 removes.
 *
 * NOTE: this is a property of the PACKAGE, not of the caller. There is
 * deliberately no `isSystem` escape hatch: #7033 decided *who may call* the
 * package routes, and #7560 is what those routes may do once the caller is
 * allowed. An authorized admin — and the engine itself — still may not disable
 * or delete a package the deployment ships. Internal code that legitimately
 * tears a code package down calls `registry.uninstallPackage` directly and never
 * passes through a gate.
 *
 * An absent/empty `packageId` is NOT writable: the authoring path treats "no
 * base resolved" as a refusal (`WRITABLE_PACKAGE_REQUIRED`), and answering
 * "writable" for an unknown would make this predicate fail open.
 */
export function isWritablePackage(engine: unknown, packageId: string | null | undefined): boolean {
    if (!packageId) return false;
    const e = engine as PackageWritabilityEngine | null | undefined;
    // Booted code package → read-only artifact source.
    if (e?.manifests?.has?.(packageId)) return false;
    // Installed / platform package → read-only by manifest scope.
    const scope = e?.registry?.getPackage?.(packageId)?.manifest?.scope;
    if (typeof scope === 'string' && READ_ONLY_PACKAGE_SCOPES.includes(scope)) return false;
    // Project-scoped base, or unregistered authoring-workspace id → writable.
    return true;
}
