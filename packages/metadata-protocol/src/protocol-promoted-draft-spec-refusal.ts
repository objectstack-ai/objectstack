// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#35924] The save door's spec parse, asked again of an object draft at its
 * promotion.
 *
 * `saveMetaItem` parses every object body against the current `ObjectSchema`
 * (`resolveOverlaySchema` → `getMetadataTypeSchema('object')`) and refuses a
 * body it rejects `422 INVALID_METADATA`. `promoteDraftForPublish` re-runs the
 * save door's other refusals on the stored draft, because a draft stored
 * before a rule landed was never judged by it (#4463 D1), but it did not ask
 * the parse. So an object draft saved before a narrowing `ObjectSchema`
 * refinement landed was promoted live at publish, unjudged by that refinement
 * — the ADR-0154 D10 chain-column rule's sealed object without `tenant_id`
 * is the first measured case. This is the parse, asked of the draft the
 * promotion reads, with the save door's envelope: the same code and status,
 * the same `issues[]` (registered refusal params included, #36594) and the
 * same sentence on the default face.
 *
 * ## The body judged is the body the publish serves
 *
 * A stored row is read through the ADR-0087 conversion chain
 * (`applyConversionsToStoredItem`, replayed with its retired entries by the
 * protocol's read and by the database loader that registers the row), so a
 * draft stored in a spelling a later release retired is served — and
 * registered — in today's canonical shape. The parse judges that converted
 * body ({@link convertStoredItemDetailed}, no notice logged here: the read
 * warns once when it serves the row), not the stored bytes, so a draft the
 * chain converts keeps publishing exactly as before. What is still refused
 * after the chain is what the publish would make live while the current
 * schema refuses it.
 *
 * `object` only: the type the card measured. The save door parses every type
 * with a registered schema; whether the promotion should ask every one of
 * them is a separate question (each type's stored-draft population differs —
 * a `flow` is judged through `storedFlowVerdictBody`, a `view` stores its
 * parsed projection), and is not answered here.
 */

import { resolveOverlaySchema } from './protocol-meta-type-schema.js';
import { zodIssuesToMetadataIssues, type MetadataIssueEntry } from './protocol-metadata-issues.js';
import { convertStoredItemDetailed } from './protocol-stored-item-conversion.js';
import { specValidationFindings } from './protocol-write-face.js';

/** The refusal {@link promotedObjectDraftSpecRefusal} answers: the save door's spec-validation 422. */
export type PromotedDraftSpecRefusal = Error & { code: 'INVALID_METADATA'; status: 422; issues: MetadataIssueEntry[] };

/**
 * The save door's spec-validation refusal of the object draft `body` the
 * promotion of `object/name` reads, judged as the publish would serve it;
 * `undefined` when the current `ObjectSchema` admits it (or no schema is
 * registered for `object`, as the save door then parses nothing).
 */
export function promotedObjectDraftSpecRefusal(name: string, body: unknown): PromotedDraftSpecRefusal | undefined {
    const schema = resolveOverlaySchema('object', body);
    if (!schema) return undefined;
    const served = convertStoredItemDetailed('object', body).item;
    const parsed = schema.safeParse(served);
    if (parsed.success) return undefined;
    const issues = zodIssuesToMetadataIssues(parsed.error.issues, { refusalParams: true });
    // No write face: the publish doors declare none, so the sentence carries
    // the findings in full, as every undeclared face of the save door does.
    const err = new Error(
        `object/${name} failed spec validation: ${specValidationFindings(undefined, issues)}`,
    ) as PromotedDraftSpecRefusal;
    err.code = 'INVALID_METADATA';
    err.status = 422;
    err.issues = issues;
    return err;
}
