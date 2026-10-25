// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The object-metadata write invariant, placed at the DOOR rather than at the
 * writers (objectui#8676).
 *
 * ## Why this module exists — the enumeration, not the count
 *
 * objectui#7714 ruled one client behaviour: *a half-filled relationship stays
 * client-side and the PUT body never carries a `lookup` without a non-empty
 * `reference`*. Its PR implemented that ruling by naming the writers it knew
 * about — two of them — and putting the assertion inside each one's array-to-map
 * conversion (`toFieldsMap`). The very failure the ruling was written against
 * was then reproduced on a THIRD writer neither conversion covers, in that
 * card's own required dogfood (fixed in `9073cf018`). objectui#8676 swept and
 * found nine more.
 *
 * The durable half of that card is a sentence about method, not a number:
 *
 * > a ruling that enumerates writers is only as good as the enumeration.
 *
 * A hand list of writers is stale the next time somebody adds one, and nothing
 * says so. So this invariant is not attached to writers at all. It is attached
 * to the DOORS — the places that put bytes on the wire — because the doors are a
 * CLOSED set that this repository owns, while the writers are an OPEN set it
 * does not. Three in-repo transports can PUT `/meta/:type/:name`, and
 * `scripts/check-object-metadata-write-doors.mjs` derives that set on every run
 * rather than restating it:
 *
 *   1. `MetadataClient.save`           `packages/data-objectstack/src/metadata-client.ts`
 *   2. `importObjectDraft`             `packages/app-shell/src/views/metadata-admin/external/api.ts`
 *   3. the `@objectstack/client` SDK's `meta.saveItem`, reached in this repo
 *      through `MetadataService`'s one seam
 *
 * Every writer in the repo reaches the server through one of those three. Guard
 * them and the writer count stops mattering; add a fourth transport and the gate
 * turns red naming it. That is the whole design: ⛔ do not re-open this by
 * adding a writer list anywhere.
 *
 * ## What it asserts, and the two things it deliberately does NOT
 *
 * It asserts two field-level invariants, and nothing else:
 *
 *   - objectui#7714's: a relationship (`lookup` / `master_detail`) carries a
 *     usable `reference`;
 *   - objectui#11253's: a choice (`select` / `radio`) carries an option source,
 *     a non-empty `options` list or a shared `picklist`. This is the objectui
 *     branch of the maintainer's ruling A on objectstack#20827, whose door
 *     refuses "a `select` / `radio` with neither `options` nor `picklist`".
 *
 * ⛔ **NOT a client-side revalidation of the document.** Parsing the whole body
 * through `ObjectSchema` before the PUT would refuse plugin-registered keys the
 * SERVER accepts, and it would promote a client PREDICTION into a block — which
 * is exactly what objectui#4306 / objectui#6980 ruled against for the designer's
 * live Zod pass, on the stated ground that a schema issue on a draft the server
 * ACCEPTS would dead-bolt Save with no on-screen editor able to clear it.
 *
 * Neither invariant forecloses anything the server would have taken, and that
 * is the whole of the dead-bolt argument for both:
 *
 *   - The relationship refusal: the same body is refused one layer down with a
 *     422 on `fields.NAME.reference`, so the guard only moves an identical
 *     refusal earlier, where it can name the field while it is still on screen.
 *   - The choice refusal: the same body is refused one layer down at
 *     `fields.NAME.options`, an empty list included, since `@objectstack/spec`
 *     17.7.0 shipped the door (objectstack#21390, the ruling's own door). Until
 *     that release the installed spec still accepted a choice with no option
 *     source and this refusal was deliberately AHEAD of the server, by the
 *     ruling's execution parameter (2): "if Studio saves a `select` before its
 *     options exist, the objectui side changes its order first (a card in that
 *     lane) and the door closes after". The door has closed, the order changed
 *     first, and the refusal collapsed into the relationship form at
 *     objectui#11717's bump. The editors still clear it on screen: the Studio
 *     data page and the metadata-admin object editor carry an options editor in
 *     that field's inspector (both pinned by their
 *     `*.choiceWithoutOptions-11253` suites); plugin-designer's drawer has no
 *     options editor, so it stops offering the choice types, a stored `select`
 *     keeps its type there and can be retyped or removed, and a stored `radio`
 *     is among the types that page carries through unedited and sends to
 *     metadata-admin, as it already does for a target-less `master_detail`.
 *     `object-metadata-write-guard.derivation.test.ts` re-measures "refused one
 *     layer down" for both invariants on every run.
 *
 * ⛔ **NOT strip-and-report-saved.** Dropping the offending field and reporting
 * success would trade a visible refusal for an invisible deletion —
 * objectstack#4001's shape, ruled out for this family in objectui#7714 and again
 * in `9073cf018`. It throws; the caller surfaces the message.
 *
 * ## The type lists are pinned to the contract, not to memory
 *
 * {@link RELATIONSHIP_TYPES_REQUIRING_REFERENCE} and
 * {@link CHOICE_TYPES_REQUIRING_OPTIONS} are the two lists this module keeps,
 * and they are the same class of hazard the module exists to close, so neither
 * gets to be a remembered list either.
 * `object-metadata-write-guard.derivation.test.ts` DERIVES both from the
 * installed `@objectstack/spec`:
 *
 *   - the relationship set from every member of `FieldType`, parsed as
 *     `{ type, label }` through `FieldSchema`, keeping those refused at path
 *     `reference`;
 *   - the choice set from the same members run through `checkFieldCompleteness`
 *     (ADR-0078's author-time rule, which the ruling's door adopts), keeping
 *     those it reports as `field/choice-without-options` at `error` severity.
 *     The door itself shipped in 17.7.0, and the pin holds the two answers equal.
 *
 * A spec release that changes either set turns that pin red instead of leaving
 * a guard that quietly stopped covering the contract.
 *
 * The derivation is a TEST and not a runtime probe on purpose: parsing 50
 * field-type documents on the way to every save is a cost paid on the hot path
 * to re-learn something that changes at most once per spec release, and a probe
 * that throws at runtime has to choose between blocking writes and failing open.
 * A pin has neither problem — it fails at CI time, loudly, with nothing at stake.
 */

/**
 * Field types whose `reference` — the target object a relationship links to —
 * `@objectstack/spec` requires to be present and non-empty.
 *
 * Derived from the installed artifact by the pin named above, never recalled.
 */
export const RELATIONSHIP_TYPES_REQUIRING_REFERENCE: readonly string[] = ['lookup', 'master_detail'];

/**
 * Field types that offer nothing to choose without an option source — a
 * non-empty `options` list or a shared `picklist` (objectui#11253, the objectui
 * branch of the maintainer's ruling A on objectstack#20827).
 *
 * Derived from the installed artifact by the pin named above, never recalled.
 */
export const CHOICE_TYPES_REQUIRING_OPTIONS: readonly string[] = ['select', 'radio'];

/** The metadata type whose documents carry the `fields` map this guard reads. */
export const OBJECT_METADATA_TYPE = 'object';

/**
 * Whether a `reference` value names an object the server could resolve.
 *
 * The trim is not cosmetic: `ObjectSchema.fields`' own key grammar
 * (`/^[a-z_][a-z0-9_]*$/`) admits no whitespace-bearing name, so a
 * whitespace-only target names nothing at either end. Measured on the installed
 * spec by the derivation pin, which asserts the contract refuses `'   '` exactly
 * as it refuses `''` and an absent key.
 */
function isUsableTarget(reference: unknown): boolean {
  return typeof reference === 'string' && reference.trim() !== '';
}

/** Name the state of an unusable target, so the message says which of them it is. */
function describeTarget(reference: unknown): string {
  if (reference === undefined) return 'no `reference` key at all';
  if (reference === null) return 'a `null` `reference`';
  if (typeof reference !== 'string') return `a \`reference\` of type \`${typeof reference}\``;
  if (reference === '') return 'an empty `reference`';
  return 'a whitespace-only `reference`';
}

/**
 * Whether a choice field names where its options come from.
 *
 * The predicate is the ruling's own words, "neither `options` nor `picklist`",
 * read the way the contract already reads them: ADR-0078's
 * `field/choice-without-options` rule in `@objectstack/spec` takes an option
 * source to be a NON-EMPTY `options` array or a `picklist` string. An empty
 * list is therefore no source at all — the derivation pin measures that on the
 * installed `checkFieldCompleteness`, and it is the list the metadata-admin
 * canvas seeds a new choice field with. A `picklist` is never refused here,
 * whatever its value: the server judges the name it carries.
 */
function hasOptionSource(def: Record<string, unknown>): boolean {
  return (Array.isArray(def.options) && def.options.length > 0) || typeof def.picklist === 'string';
}

/** Name the state of a missing option source, so the message says which it is. */
function describeOptions(options: unknown): string {
  if (options === undefined) return 'no `options` key and no `picklist`';
  if (Array.isArray(options)) return 'an empty `options` list and no `picklist`';
  if (options === null) return 'a `null` `options` and no `picklist`';
  return `an \`options\` value of type \`${typeof options}\` and no \`picklist\``;
}

/**
 * The `fields` member of an object document, in either shape a writer may hand
 * the door.
 *
 * Both are real. The spec's stored shape is a RECORD keyed by field name, and
 * that is what `MetadataService.toFieldsMap` and `MetadataFieldsPage` emit. The
 * ARRAY shape is what `readFields`/`writeFields` round-trip for documents that
 * arrived that way, and `StudioDesignSurface` PUTs the result verbatim — so a
 * door that read only the record shape would be silently blind to a whole
 * surface, which is this card's failure mode wearing a different hat.
 */
function fieldEntries(fields: unknown): Array<{ name: string; def: Record<string, unknown> }> {
  if (Array.isArray(fields)) {
    return fields.flatMap((raw, index) => {
      if (!raw || typeof raw !== 'object') return [];
      const record = raw as Record<string, unknown>;
      const name = typeof record.name === 'string' && record.name ? record.name : `[${index}]`;
      return [{ name, def: record }];
    });
  }
  if (fields && typeof fields === 'object') {
    return Object.entries(fields as Record<string, unknown>).flatMap(([name, def]) =>
      def && typeof def === 'object' ? [{ name, def: def as Record<string, unknown> }] : [],
    );
  }
  return [];
}

/**
 * Refuse an object-metadata write whose body carries a relationship field with
 * no usable target, or a choice field with no option source.
 *
 * A no-op for every other metadata type and for any body with no readable
 * `fields` member — this door serves `view`, `app`, `flow`, `permission`,
 * `hook` and `dashboard` writes too, and has no opinion about them.
 *
 * ## The message is the same at every door, and names no code (objectui#11785)
 *
 * The thrown text reaches authors: Studio keeps it under a refusal's Details,
 * and the other surfaces that save through a door show it as their banner. So
 * it names the field, its type and the remedy, and ⛔ no class, package or
 * tracker id. The rationale for each rule lives in this module's docblock, not
 * in the runtime string. The door's label is not printed either, which makes the
 * text a function of the body alone: a caller that kept the body it sent can
 * re-run this guard on it and get the identical message, which is how Studio
 * tells this refusal apart from any other failure without parsing the prose.
 *
 * @param type    the metadata type segment of the write (`'object'`, `'view'`, …)
 * @param item    the body about to be serialised onto the wire
 * @param _writer the door's label. Every door still names itself at the call,
 *                and the stack trace says where the write stopped; the message
 *                does not print it (see above)
 * @throws Error naming the offending field, before any request is issued
 */
export function assertObjectMetadataWritable(type: unknown, item: unknown, _writer: string): void {
  if (String(type) !== OBJECT_METADATA_TYPE) return;
  if (!item || typeof item !== 'object') return;
  const fields = (item as Record<string, unknown>).fields;
  for (const { name, def } of fieldEntries(fields)) {
    if (CHOICE_TYPES_REQUIRING_OPTIONS.includes(String(def.type)) && !hasOptionSource(def)) {
      throw new Error(
        `The object was not saved: the field \`${name}\` is a ` +
          `\`${String(def.type)}\` with no options: it carries ${describeOptions(def.options)}, so it ` +
          'offers nothing to choose and nothing to check a stored value against. A choice field ' +
          'needs at least one option or a shared `picklist`, so this draft stays here until it ' +
          'has one. Add an option, or change the field to a non-choice type.',
      );
    }
    if (!RELATIONSHIP_TYPES_REQUIRING_REFERENCE.includes(String(def.type))) continue;
    if (isUsableTarget(def.reference)) continue;
    throw new Error(
      `The object was not saved: the field \`${name}\` is a ` +
        `\`${String(def.type)}\` and carries ${describeTarget(def.reference)}, so it names no object ` +
        'to link to. The server refuses the same document with a 422 on ' +
        `\`fields.${name}.reference\`, and that refusal blocks every later save of this object for ` +
        'as long as the half-filled field rides along in the draft. ' +
        'Pick the target object, or change the field to a non-relationship type.',
    );
  }
}
