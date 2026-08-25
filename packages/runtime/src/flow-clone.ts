// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * # Flow clone — whole-definition copy under a new machine name (ADR-0126 §7.1)
 *
 * The copy half of ADR-0126's packaged-metadata customization model, shaped on
 * the landed permission-set clone (`sys-permission-set.object.ts`, #11513): an
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
 * its payload from an enumerated param list, and #11703 measured what an
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
 * `flow-clone.test.ts` asserts this as the #11703 counter-example: deep
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
 * ⚠️ This is the one place the implementation reads more into ADR-0126 than the
 * card spelled out; it is flagged on the PR for the reviewer. Everything else
 * below is the ADR verbatim.
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

import { METADATA_READ_DECORATIONS, MetadataProtectionFields } from '@objectstack/spec/kernel';

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
 * #11703 mechanism in miniature).
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
 */
export const FLOW_CLONE_NOTICE =
    'References are not re-pointed: this clone calls exactly what the original called '
    + '(subflows, actions and objects are unchanged). It is created with status `draft`, '
    + 'which is a lifecycle label and NOT an off-switch — a cloned record-change or schedule '
    + 'flow is bound to its trigger and will run alongside the flow it was copied from. '
    + 'Disable it (`POST /api/v1/automation/<name>/toggle` with `{"enabled": false}`) if that '
    + 'is not what you want.';

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
