// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * # Flow clone — whole-definition copy under a new machine name (ADR-0126 §7.1)
 *
 * The copy half of ADR-0126's packaged-metadata customization model, shaped on
 * the landed permission-set clone (`sys-permission-set.object.ts`, commit e170b0ae5): an
 * admin who cannot edit a packaged flow in place gets an ordinary,
 * org-authored sibling to edit instead.
 *
 * Three properties of that ADR are load-bearing here, and each one is a rule
 * this module exists to make mechanical rather than remembered.
 *
 * ## 1. WHOLE-DEFINITION COPY — ⛔ never param-list assembly
 *
 * {@link cloneFlowDefinition} copies the parsed definition and mutates exactly
 * three fields. It does NOT enumerate the facets a flow has, and adding a facet
 * to `FlowSchema` must never require an edit here.
 *
 * That is not stylistic. The permission-set clone this is shaped on assembles
 * its payload from an enumerated param list, and commit 5cb62d88b records what an
 * enumerated list costs: three of the six facets (`system_permissions`,
 * `row_level_security`, `tab_permissions`) were simply not listed, so cloning a
 * set carrying system permissions or RLS produced a clone with NONE of them —
 * created, success toast fired, difference discoverable only by diffing the two
 * records. Fail-closed, and therefore quiet.
 *
 * A flow has far more facets than a permission set — `description`,
 * `successMessage`/`errorMessage`, `version`, `type`, `variables`, `nodes`,
 * `edges`, `runAs`, the retry/error-handling block, and whatever `FlowSchema`
 * grows next — so the enumerated shape is not merely riskier here, it is
 * unmaintainable. ADR-0126 §7.1 rules it out by name.
 *
 * `flow-clone.test.ts` asserts this as the counter-example of commit 5cb62d88b: deep
 * equality of the cloned definition against the source, minus the three
 * mutated fields. A dropped facet fails that test rather than shipping.
 *
 * ## 2. NO ANCESTRY (amendment ruling 2)
 *
 * The clone is "an ordinary org/install-owned flow with no recorded
 * relationship to what it was copied from"; ADR-0126 §9 records that clone
 * provenance is deliberately NOT tracked — "no `cloned_from` column, no
 * 'clone based on v3, base now v5' line". So this module mints no provenance
 * field, and the route stamps none on the response.
 *
 * It also has the converse duty, which is the less obvious half: it must not
 * carry the SOURCE's provenance forward. A packaged flow's parsed definition
 * carries the ADR-0010 protection envelope — `_packageId`, `_packageVersion`,
 * `_provenance: 'package'`, `_lock`, … — because `FlowSchema` spreads
 * `MetadataProtectionFields` (`flow.zod.ts`). Copied verbatim onto a clone,
 * those keys would:
 *
 *   - record where the clone came from, which is exactly the ancestry ruling 2
 *     forbids — `_packageId` names the base's package;
 *   - make the clone a PACKAGE artifact rather than an org-owned one, so
 *     package upgrade/uninstall would re-seed or remove the admin's own work;
 *   - carry the base's `_lock` onto the clone, leaving it as uneditable as the
 *     flow the admin cloned to get around — which defeats the entire feature;
 *   - and classify the clone as a code artifact to `isCodeArtifactBody`
 *     (ADR-0029 D9.6), the test the boot pull's flow precedence reads.
 *
 * So the envelope is dropped, and the drop is DERIVED from the spec's own
 * declaration ({@link MetadataProtectionFields}) rather than restated as a
 * literal list here — an envelope key added to the spec is stripped by this
 * module the day it lands, with no edit and no second list to drift.
 *
 * [#20761] What was once the one place this module read more into ADR-0126
 * than its card spelled out is now the rule itself: a flow written through an
 * authoring door is tenant-authored, and the one authoring rule every door asks
 * (`tenantAuthoredWriteRefusal` in `@objectstack/metadata-protocol`) refuses a
 * definition whose stamps claim a package for a name no package ships — so a
 * copy that carried the base's envelope would be refused, not saved. The clone
 * door asks that rule of the copy this module builds and then saves it as an
 * ordinary tenant row. Pinned in `domains/automation-flow-clone.test.ts` (the
 * envelope drop) and `domains/automation-tenant-authored-write.test.ts` (the
 * rule and the save).
 *
 * ## 3. REFERENCES ARE NOT RE-POINTED
 *
 * ADR-0126 §9: automatic re-pointing of references on clone is explicitly not
 * chartered — no reference index exists (#11665 §3.2) — so "the clone's
 * references stay pointed at what the original pointed at, and the surface
 * tells the admin so". {@link FLOW_CLONE_NOTICE} is that sentence, returned on
 * every successful clone so the fact is stated where the admin is standing
 * rather than only in an ADR.
 */

import { getMetadataTypeRedactor, METADATA_READ_DECORATIONS, MetadataProtectionFields } from '@objectstack/spec/kernel';

/**
 * The deployment status a clone is created with.
 *
 * `'draft'` is `FlowSchema`'s own default for a flow that has not been
 * deployed, and it is the honest value for something that was created a
 * moment ago and has never been reviewed.
 *
 * ⚠️ It does NOT make the clone inert, and nothing here should be read as
 * claiming it does. The engine disables a flow on `status` `'obsolete'` or
 * `'invalid'` only (`engine.ts` `registerFlow`); `'draft'` and `'active'` both
 * stay enabled and both get their trigger bound, so a clone of a record-change
 * flow starts firing on the same writes as its base. That is stated plainly in
 * {@link FLOW_CLONE_NOTICE} instead of being papered over.
 *
 * ⛔ Deliberately not `'obsolete'`, tempting as an auto-off clone is: ADR-0126
 * §7.2 rules that clone and disable are INDEPENDENT primitives —
 * "cloned-without-disabled and disabled-without-clone are both ordinary states
 * the surface shows plainly, not halves of an unfinished ceremony". Folding a
 * disable into the clone would be inventing the ceremony the ADR declined, and
 * would also mean this action silently retires a flow the admin asked it to
 * create.
 */
export const FLOW_CLONE_STATUS = 'draft' as const;

/**
 * The three fields a clone mutates — ADR-0126 §7.1, "mutates only
 * `name`/`label`/`status`".
 *
 * Exported so the test asserts the mutation set from the same constant the
 * implementation applies, rather than restating it (a second list here is the
 * facet-drop mechanism of commit 5cb62d88b in miniature).
 */
export const FLOW_CLONE_MUTATED_FIELDS = ['name', 'label', 'status'] as const;

/**
 * Keys that must NOT survive onto a clone — the ADR-0010 protection envelope
 * plus the read-time decorations.
 *
 * DERIVED from the spec, never restated: `MetadataProtectionFields` is the
 * declaration `FlowSchema` itself spreads, and `METADATA_READ_DECORATIONS` is
 * the canonical list of keys the metadata read path stamps onto a served
 * document (which are not valid inputs to the schema that produced them — see
 * `metadata-read-decorations.ts`; a served flow carrying `_diagnostics` is what
 * broke the cold-boot flow bind in cloud#971).
 *
 * The read decorations would usually be absent here — a clone reads its source
 * from the engine's flow map, not over `/meta` — but the strip costs nothing
 * and closes the case where a caller's source came through a served read.
 */
export const FLOW_CLONE_DROPPED_KEYS: readonly string[] = Object.freeze([
    ...METADATA_READ_DECORATIONS,
    ...Object.keys(MetadataProtectionFields),
]);

/**
 * What the clone response tells the admin, in the admin's own words.
 *
 * Two facts, both required to be stated rather than discovered:
 *
 *  1. References are not re-pointed (ADR-0126 §9). A cloned flow's subflow
 *     nodes, action calls and object references point exactly where the
 *     original's did.
 *  2. The clone is armed. `status: 'draft'` is a lifecycle label, not an
 *     off-switch — see {@link FLOW_CLONE_STATUS}. An admin who clones a
 *     record-change flow and walks away has two flows running on one trigger,
 *     and the only thing standing between them and that surprise is this
 *     sentence.
 *
 * [#20726, ADR-0126 §7.2] The off-switch it names is the CLONE's own: its
 * `status`, published through `PUT /:name`. A clone carries no package
 * envelope (see {@link FLOW_CLONE_DROPPED_KEYS}), so it is a flow authored in
 * this deployment, and the activation toggle — which switches packaged flows
 * only — refuses it. That holds whatever the clone was copied from: the clone
 * door takes any registered flow as its source, packaged or not, so the
 * notice makes no claim about the source's provenance.
 */
export const FLOW_CLONE_NOTICE =
    'References are not re-pointed: this clone calls exactly what the original called '
    + '(subflows, actions and objects are unchanged). It is created with status `draft`, '
    + 'which is a lifecycle label and NOT an off-switch — a cloned record-change or schedule '
    + 'flow is bound to its trigger and will run alongside the flow it was copied from. '
    + 'If that is not what you want, switch the clone off through its own status: send its '
    + 'complete definition with `status: \'obsolete\'` to `PUT /api/v1/automation/<name>`. '
    + 'The activation toggle (`POST /api/v1/automation/<name>/toggle`) switches packaged flows '
    + 'only and refuses the clone.';

/** ADR-0112 envelope for the same-name refusal: a status AND a code. */
export const FLOW_CLONE_NAME_TAKEN_STATUS = 409;

/**
 * The same-name refusal, naming the sanctioned path.
 *
 * ADR-0126 §7.1 refuses a same-name clone outright, and the reason is worth
 * carrying to the caller rather than answering a bare "conflict": storage
 * legitimately holds both rows — the uniqueness index keys on
 * `(type, name, organization_id, COALESCE(package_id, ''))` (ADR-0005
 * amendment, #6825) — so nothing downstream stops the second definition from
 * existing. What breaks is the engine, whose flow map is keyed by BARE name:
 * the two definitions collapse into one slot and the survivor is decided by
 * registration order. #11665 §2.2 measured it as a silent, non-deterministic
 * replacement; #11997 tracks the shadow diagnostics for the case where it has
 * already happened.
 *
 * The message therefore says what to do, not merely what went wrong — a clone
 * dialog is the exact moment the admin is typing a name, so a refusal that
 * does not name the remedy sends them looking for one.
 */
export function flowCloneNameTakenMessage(name: string): string {
    return (
        `Flow '${name}' already exists — a clone must take a NEW machine name. `
        + 'Same-name clones are refused on purpose: the automation engine keys flows by bare '
        + 'name, so a second definition under one name silently shadows the other and which of '
        + 'the two actually dispatches depends on registration order (ADR-0126 §7.1). '
        + `Retry with a machine name no flow uses (for example '${suggestCloneName(name)}').`
    );
}

/**
 * A name suggestion for the refusal message. Purely advisory text — nothing
 * reads it back, and the caller is free to ignore it.
 *
 * Kept inside the `^[a-z_][a-z0-9_]*$` shape `FlowSchema.name` requires, so the
 * suggestion is one the caller can actually submit.
 */
function suggestCloneName(name: string): string {
    return `${name}_copy`;
}

/**
 * Build the clone of `source` under `target`.
 *
 * Whole-definition copy: everything the source carries comes across, then
 * exactly {@link FLOW_CLONE_MUTATED_FIELDS} are set and
 * {@link FLOW_CLONE_DROPPED_KEYS} are removed. No facet is enumerated, so no
 * facet can be forgotten (§1 above).
 *
 * DEEP copy, not a spread: the source is the engine's LIVE `FlowParsed` object
 * out of its flow map, so a shallow copy would leave the clone sharing its
 * `nodes`/`edges`/`variables` arrays with the flow it was copied from — and the
 * first edit to either would silently rewrite the other. A parsed flow
 * definition is JSON-shaped data (it is what `FlowSchema` produced from
 * metadata), so `structuredClone` is total over it.
 *
 * The result is NOT validated here. It goes back through the engine's own
 * `registerFlow`, which canonicalizes and validates it exactly as it does a
 * create — one validation policy, not a second one that agrees today.
 */
export function cloneFlowDefinition(
    source: unknown,
    target: { name: string; label: string },
): Record<string, unknown> {
    const copy = structuredClone(source) as Record<string, unknown>;
    for (const key of FLOW_CLONE_DROPPED_KEYS) delete copy[key];
    copy.name = target.name;
    copy.label = target.label;
    copy.status = FLOW_CLONE_STATUS;
    return copy;
}

// ---------------------------------------------------------------------------
// [#20790] C1 — a source that holds a credential is never cloned in one step
// ---------------------------------------------------------------------------

/**
 * One credential the clone's source holds, by class — never the value. The
 * automation engine answers it (`AutomationEngine.flowCredentialHoldings`):
 * a literal in the definition (a packaged flow's source), or one the
 * write-only flow credential channel holds for a position of it.
 */
export interface FlowCloneCredentialHolding {
    /** The node config key (`secret`, `signingSecret`). */
    readonly key: string;
    /** What an administrator is told the credential is; the key's spelling when absent. */
    readonly label?: string;
    readonly held: 'literal' | 'channel';
}

/** The slice of the automation service the clone door asks about credentials. */
export interface FlowCloneCredentialSource {
    flowCredentialHoldings?(name: string): readonly FlowCloneCredentialHolding[];
}

/** ADR-0112 pair for the credential refusal: the source's state forbids the copy. */
export const FLOW_CLONE_CREDENTIAL_REFUSAL_STATUS = 409;
export const FLOW_CLONE_CREDENTIAL_REFUSAL_CODE = 'RESOURCE_CONFLICT';

/**
 * The literal credentials a definition carries, through the `flow` redactor
 * the automation plugin registers in `@objectstack/spec/kernel` — the
 * projection of the platform's one credential-location table. The clone
 * door's answer when the automation service does not report holdings itself
 * (a host that composes another engine); it cannot see a channel-held one,
 * because such a host has no channel.
 */
export function literalFlowCredentialHoldings(source: unknown): FlowCloneCredentialHolding[] {
    const redactor = getMetadataTypeRedactor('flow');
    if (!redactor || !source || typeof source !== 'object' || Array.isArray(source)) return [];
    return redactor(source as Record<string, unknown>).redactedKeys.map((path) => ({
        key: path.slice(path.lastIndexOf('.') + 1),
        held: 'literal' as const,
    }));
}

/**
 * The clone door's credential refusal (#20790 C1, Q2 A), or `undefined` when
 * the source holds none.
 *
 * A flow's credentials are its own: an inbound hook's secret authenticates
 * posts to THAT hook, an `http` node's signing secret proves a delivery came
 * from THAT flow. A whole-definition copy (§1 above) would carry a literal
 * one across, and the metadata save door would then store it as the copy's
 * own — two flows sharing one secret, which is never allowed. A secret the
 * write-only channel holds is not in the definition at all, so the copy would
 * arrive without it: an inbound copy refused at registration, an outbound
 * copy delivering unsigned. Both are refused here instead, with the remedy:
 * the administrator authors the copy with its own secret.
 *
 * ⚠️ So a PACKAGED inbound flow (the ADR-0126 §7.1 customization path) can no
 * longer be cloned in one step — a cost the ruling accepted. The positions are
 * named by class only, never by value, node or path.
 */
export function flowCloneCredentialRefusal(
    sourceName: string,
    holdings: readonly FlowCloneCredentialHolding[],
): (Error & { code: string; status: number; statusCode: number }) | undefined {
    if (holdings.length === 0) return undefined;
    const classes = [...new Set(holdings.map((h) => h.label ?? `the credential at \`${h.key}\``))].sort().join(' and ');
    const keys = new Set(holdings.map((h) => h.key));
    const remedies = [
        keys.has('secret') ? 'a new `config.secret` on its start node' : undefined,
        keys.has('signingSecret') ? 'a new `config.signingSecret` on each http node that signs' : undefined,
        [...keys].some((k) => k !== 'secret' && k !== 'signingSecret') ? 'a new value for each credential' : undefined,
    ].filter((s): s is string => s !== undefined);
    const err = new Error(
        `Flow '${sourceName}' cannot be cloned in one step: it holds ${classes}, and a copy would share it — two `
            + 'flows never share a secret. Author the copy with its own instead: read this flow\'s definition (its '
            + 'credentials are withheld from it), create a new flow under a new machine name with that definition, '
            + `and set ${remedies.join(' and ')}.`,
    ) as Error & { code: string; status: number; statusCode: number };
    err.code = FLOW_CLONE_CREDENTIAL_REFUSAL_CODE;
    err.status = FLOW_CLONE_CREDENTIAL_REFUSAL_STATUS;
    err.statusCode = FLOW_CLONE_CREDENTIAL_REFUSAL_STATUS;
    return err;
}
