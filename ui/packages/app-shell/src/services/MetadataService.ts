/**
 * MetadataService
 *
 * Encapsulates CRUD operations for object definitions and field definitions
 * against the ObjectStack metadata API (`client.meta.saveItem`).
 *
 * This service bridges the gap between the local-state-only ObjectManager /
 * FieldDesigner components and the backend persistence layer.
 *
 * Pattern:
 *   1. Optimistically update local UI state
 *   2. Persist via `client.meta.saveItem('object', name, data)`
 *   3. Refresh MetadataProvider cache on success
 *   4. Rollback local state on failure
 *
 * @module services/MetadataService
 */

import { stripReadDecorations } from '@objectstack/spec/kernel';
import {
  assertObjectMetadataWritable,
  dropServedPicklistOptions,
  RELATIONSHIP_TYPES_REQUIRING_REFERENCE,
  viewItemObjectName,
  type ObjectStackAdapter,
} from '@object-ui/data-objectstack';
import type { ObjectDefinition, DesignerFieldDefinition } from '@object-ui/types';
// The retired-field-key tombstone registry lives at a dedicated internal
// subpath, not the main barrel — objectui#6527 option B (maintainer ruling,
// 2026-08-28): a barrel import eagerly evaluates every other barrel member,
// which widened an unrelated consumer's module graph under the prior shape.
import { retiredFieldKeysFor } from '@object-ui/types/internal/retired-field-keys';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape written to the metadata API for an object definition. */
export interface ObjectMetadataPayload {
  name: string;
  label?: string;
  pluralLabel?: string;
  description?: string;
  icon?: string;
  // No `group` (objectui#6223): `ObjectSchema` has no object-level grouping
  // key — its 42-key accept set contains `fieldGroups`, which groups the FIELDS
  // inside one object, and nothing that categorises objects against each other.
  // The designer's grouping IS a real feature, but a UI-only one: the Object
  // Manager's group column and its group select are display categories derived
  // from the object itself (`sys_` prefix / `isSystem` -> `System Objects` vs
  // `Custom Objects`), never authored data the server round-trips. Writing it
  // made `PUT /api/v1/meta/object/:name` refuse the key by name.
  // No `sortOrder` (objectui#6223): `ObjectSchema` has no object-level ordering
  // key either. What populated it was the ARRAY INDEX the converter happened to
  // be at (`sortOrder: index`), i.e. the order the list was already in — a
  // display concern of the manager, not object metadata. (Distinct from the
  // field-level `sortOrder`, which objectui#6045 has since removed for its own
  // reasons — `FieldSchema` refuses that spelling too, at the other level.)
  // No `enabled` (objectui#6238): `ObjectSchema` refuses it BY NAME and the
  // spec has no object-level on/off flag at all. The near-spelling `enable` is
  // NOT it — that is `ObjectCapabilities`, a system-features module object, so
  // `enabled: false` -> `enable: false` fails on the VALUE where it passes on
  // the name. This declaration was objectui#4687's shape (never populated by
  // `toObjectPayload`); the key reached the wire only through the tombstone
  // bodies the two delete methods wrote by hand, and those now go through the
  // metadata API's own delete door instead — see `deleteMetadataItem`.
  /**
   * The object's fields, keyed by field NAME — the map `ObjectSchema` requires
   * (objectui#6240). This used to be `FieldMetadataPayload[]`.
   *
   * An array is a VALUE-level refusal, which is the class the key-name parity
   * gate (`scripts/check-designer-field-key-parity.mjs`, coverage note 4)
   * cannot see: `fields` is in `ObjectSchema`'s accept set under either shape,
   * so the gate was green for as long as the array was on the wire.
   *
   * Measured against the installed `@objectstack/spec` 17.2.0 (ESM build):
   *
   *   fields: [{ name: 'n', type: 'text', label: 'N' }]
   *     => invalid_type @ fields  ("expected record, received array")
   *   fields: []                        => invalid_type @ fields
   *   fields: { n: { type: 'text' } }   => parses green
   *   fields: {}                        => parses green
   *   (key absent)                      => invalid_type @ fields — it is REQUIRED
   *
   * And the route is not lenient about it. `metadata-protocol`'s
   * `saveMetaItem` resolves type `object` to this very `ObjectSchema`
   * (`spec/kernel/metadata-type-schemas.ts`), `safeParse`s the whole item and
   * THROWS `422 INVALID_METADATA` before anything is persisted — the array was
   * refused, never stripped and never stored.
   *
   * Still OPTIONAL, deliberately — see `toObjectPayload`. `undefined` here
   * means "the caller did not say what the fields are", and that must NOT be
   * spelled `{}`: `{}` parses green and a PUT is an upsert, so it would land as
   * "this object has no fields" and wipe them.
   */
  fields?: Record<string, FieldMetadataPayload>;
  // No `relationships` (objectui#6223): the spec models relationships on the
  // FIELD — `reference` / `master_detail` plus object-level `indexes` — and
  // `ObjectSchema` refuses an object-level `relationships` array as an
  // unrecognized key. This shape stopped putting the key on the wire there;
  // objectui#11434 then retired `ObjectDefinition.relationships` from the UI
  // model too (a `?: never` tombstone), so a relationship is authored as a
  // reference field.
}

/** Shape written to the metadata API for a field definition. */
export interface FieldMetadataPayload {
  name: string;
  label?: string;
  type: string;
  group?: string;
  description?: string;
  required?: boolean;
  unique?: boolean;
  readonly?: boolean;
  hidden?: boolean;
  defaultValue?: string;
  placeholder?: string;
  options?: Array<{ label: string; value: string; color?: string }>;
  externalId?: boolean;
  trackHistory?: boolean;
  // No `indexed` (objectui#4644): the spec has no field-level index flag —
  // `FieldSchema.safeParse` rejects the key by name, so writing it made
  // `PUT /api/v1/meta/object/:name` fail with 422 `INVALID_METADATA`.
  // Object-level `indexes[]` is the real surface.
  // No `referenceTo` (objectui#6041): the spec spells the relationship
  // target `reference`. `FieldSchema.safeParse` refuses `referenceTo` BY NAME
  // ("Did you mean `referenceTo` -> `reference`?"), so a lookup field authored
  // in the designer made `PUT /api/v1/meta/object/:name` fail 422
  // `INVALID_METADATA` and blocked every later save of that object.
  reference?: string;
  // No `formula` (objectui#6043): the spec spells a formula field's expression
  // `expression`, and it is CEL. `FieldSchema.safeParse` refuses `formula` BY
  // NAME ("Did you mean `formula` -> `expression`?"), so a formula field
  // authored in the designer made `PUT /api/v1/meta/object/:name` fail 422
  // `INVALID_METADATA` and blocked every later save of that object.
  //
  // Deliberately NOT renamed to `expression`. `FieldSchema` validates the key
  // but not the LANGUAGE: measured on 17.2.0 it accepts
  // `expression: '!!!not cel at all!!!'`. Emitting the retired textarea's
  // non-CEL contents under the accepted spelling would have turned a loud,
  // immediate 422 into a formula that parses and then silently evaluates to
  // null. Expressions are authored in metadata-admin's `ObjectFieldInspector`,
  // which lints them against the real `@objectstack/formula` engine.
  // No `sortOrder` (objectui#6045): `FieldSchema` refuses it BY NAME and the
  // spec has no field-level ordering key at all. The near-spelling `sortable`
  // is NOT it — that is a boolean ("whether field is sortable in list views"),
  // a different concept, so this is objectui#4687's shape (a declaration with
  // zero readers and zero writers) and not objectui#6041's rename. The spec
  // models field order by DECLARATION ORDER in the object's `fields` record;
  // a designer that wants explicit ordering reorders that record rather than
  // carrying an index. (Distinct from the object-level `sortOrder` retired by
  // objectui#6223, and from the saved-view `sortOrder` in `ObjectView.tsx`,
  // which is per-view display order and untouched by this card.)
}

// ---------------------------------------------------------------------------
// Converters: UI types → API payloads
// ---------------------------------------------------------------------------

/**
 * Convert an `ObjectDefinition` (UI) to the API payload shape.
 *
 * `ObjectDefinition` carries two keys that deliberately do NOT cross into the
 * payload (objectui#6223): `group` and `sortOrder` are the Object Manager's own
 * display category and display order. `ObjectSchema` refuses both as
 * unrecognized keys, so copying them across is what turned a designer save
 * into a 422. The UI model keeps them; the wire shape does not. A third, `relationships`, has no
 * object-level home in the spec either: objectui#6223 kept it off the wire, and
 * objectui#11434 retired it from the UI model as well. The explicit field list
 * below is what keeps a value handed in from outside the type system off the
 * wire.
 */
function toObjectPayload(obj: ObjectDefinition, fields?: FieldMetadataPayload[]): ObjectMetadataPayload {
  return {
    name: obj.name,
    label: obj.label,
    pluralLabel: obj.pluralLabel,
    description: obj.description,
    icon: obj.icon,
    // No fields supplied means the CALLER DID NOT SAY, which is not the same
    // statement as `{}` ("this object has no fields") — and a PUT is an upsert,
    // so writing `{}` here would delete every field of the object on a save
    // that only meant to rename it. The body then still fails `ObjectSchema`
    // (`fields` is required), which is a loud 422 that persists nothing — the
    // right outcome for a caller that under-specified an upsert, and the same
    // outcome as before this change. `saveFields` is the opposite case and
    // treats its argument as authoritative; see there.
    //
    // This parameter stays OPTIONAL after objectui#6490 made `saveObject`'s
    // public one required, and the optionality is the point rather than a
    // leftover: the type now says no in-repo caller can reach this branch, and
    // the branch is what a caller who ignores the types still lands in. It is
    // the last line of defence against the wipe, so it may not be deleted as
    // newly-unreachable code.
    fields: fields ? toFieldsMap(fields) : undefined,
  };
}

/*
 * `RELATIONSHIP_TYPES_REQUIRING_REFERENCE` — the field types whose `reference`
 * `@objectstack/spec` requires to be present and non-empty — is imported above
 * and no longer declared here.
 *
 * objectui#8676: it used to be declared here AND word-for-word again in
 * `plugin-designer`'s `MetadataFieldsPage`. Two remembered copies of one
 * contract fact is the same hazard as a remembered list of writers, so both
 * writers now read the single declaration in `@object-ui/data-objectstack`,
 * beside the write doors, where a pin DERIVES the set from the installed spec
 * on every run instead of restating a measurement. The reasoning that used to
 * sit here — including ⛔ why this is one invariant and not a client-side
 * revalidation of the document through `FieldSchema` — moved with it, to
 * `object-metadata-write-guard.ts`.
 */

/**
 * Why THIS value cannot be a target, and what the contract does about it —
 * both halves, because the four states differ on both.
 *
 * Measured for objectui#7714 on `@objectstack/spec` 17.3.0, at field level and
 * again through `ObjectSchema`, which agree on every row:
 *
 * | `reference`     | the spec's verdict                                 |
 * |-----------------|----------------------------------------------------|
 * | absent          | refused — `custom` at `reference`                  |
 * | `''`            | refused — `custom` at `reference`                  |
 * | non-string      | refused — **`invalid_type`**, not a missing target |
 * | whitespace-only | ⚠️ **accepted** — refused only by this writer      |
 *
 * A single "…and this one has none" would be wrong for two of the four. A
 * non-string is not a field that HAS no target; it is a field whose value is
 * the wrong KIND, and "pick the target object" is not the repair for
 * `reference: 42`. And the 422 the other three branches promise is one this
 * writer cannot deliver for the whitespace case — the spec would let that
 * through — so that branch says what actually happens instead.
 */
function describeUnusableTarget(reference: unknown): string {
  if (reference === undefined) {
    return (
      'and this one has none. `@objectstack/spec` requires it (17.3.0), so the server refuses ' +
      'the whole object document with 422 `INVALID_METADATA` — which then blocks EVERY later ' +
      'save of this object, not just this field.'
    );
  }
  if (typeof reference !== 'string') {
    return (
      `and this one holds ${reference === null ? 'null' : `a ${typeof reference}`} instead of ` +
      'an object name. `@objectstack/spec` refuses that (17.3.0) as `invalid_type` at path ' +
      '`reference` — not as a missing target — so the server refuses the whole object document ' +
      'with 422 `INVALID_METADATA`, which then blocks EVERY later save of this object.'
    );
  }
  if (reference === '') {
    return (
      'and this one is empty. `@objectstack/spec` requires a non-empty value (17.3.0), so the ' +
      'server refuses the whole object document with 422 `INVALID_METADATA` — which then blocks ' +
      'EVERY later save of this object, not just this field.'
    );
  }
  return (
    'and this one is blank — whitespace names no object, so nothing could ever resolve it. ' +
    '`@objectstack/spec` applies its non-empty test to the TRIMMED value (since 17.4.0), so the ' +
    'server refuses the whole object document with 422 `INVALID_METADATA` — which then blocks ' +
    'EVERY later save of this object, not just this field. This writer refuses it first, at ' +
    'editor time, naming the field (objectui#7714; upstream objectstack#16920).'
  );
}

/**
 * Refuse a relationship field whose target is unusable — BEFORE the PUT.
 *
 * ## The failure this closes, measured in a running designer
 *
 * `@objectstack/spec` 17.3.0 made `reference` a hard requirement on `lookup`
 * and `master_detail` (a `custom` refinement at path `reference`, not an
 * `unrecognized_keys` name refusal). At 17.2.0 the requirement was prose only —
 * `{ type: 'lookup', label: 'L' }` parsed green at field level AND through
 * `ObjectSchema` — so the designer was free to persist a target-less draft and
 * did.
 *
 * objectui#7714 drove that against a real 17.3.0 backend rather than inferring
 * it. Creating a `lookup` and leaving its target empty PUT the whole object and
 * got `422 INVALID_METADATA` at `fields.<name>.reference`; the next edit — to a
 * DIFFERENT, already-saved field — was refused identically, because the
 * half-filled draft rides along in the same document. The author sees the later
 * edit rendered as applied while the server has none of it, and the only escape
 * that does not require noticing the lookup is a reload, which discards it.
 * That is the cost of letting the draft leave the client: not one failed save,
 * but every subsequent save of that object for the rest of the session.
 *
 * ## Why this raises instead of letting the server answer
 *
 * The maintainer's reconciliation (objectui#7122 ruled item 4, 2026-09-05) is
 * that the incomplete draft stays in the client and is never PUT: an editing
 * session's half-finished work belongs to the client, not to the metadata
 * store. ⛔ Not the alternative of stripping the incomplete field out of the
 * body while still reporting a successful save — that shows the author a field
 * the server never received, the silent-drop shape objectstack#4001 closed.
 *
 * ## Why an exception, and why HERE
 *
 * Same mechanism, same reason and the same call site as the nameless-field and
 * duplicate-name refusals below: it raises before the request, so a refused
 * list issues NO PUT AT ALL, and the designer page runs its save inside a `try`
 * whose `catch` already renders the message in the page's existing error
 * surface. No new UI affordance is introduced — the author sees the same banner
 * a nameless or duplicated field already produces.
 *
 * `MetadataFieldsPage` carries the sibling copy for the same reason it carries
 * the sibling `toFieldsMap` and `carryOver`: the two writers convert different
 * input types on different paths and neither owns the other's. Both are pinned,
 * and each pin asserts the same four states so the copies cannot drift.
 *
 * ⭐ The two pins are named here so the sentence above can be re-run rather
 * than believed: `objectui#7714 · the refusal message distinguishes the four
 * states`, in `MetadataService.specKeyReference.test.ts` (this writer) and in
 * `MetadataFieldsPage.specKeyReference.test.tsx` (the sibling). The naming is
 * the repair objectui#8925 made: the designer-side pin did not exist, so that
 * sentence was false on three of its four rows — its `absent`, `non-string`
 * and `empty` branches could all be rewritten with the whole `plugin-designer`
 * package still green — while three separate places went on restating it.
 *
 * ## The `.trim()` MIRRORS the contract — it is no longer a local opinion
 *
 * The predicate is `typeof reference === 'string' && reference.trim() !== ''`.
 * It WAS a declared divergence when written: 17.3.0's objectstack#13632 refinement spelled
 * its emptiness test as an equality against `''`, so the spec accepted a
 * whitespace-only target while this writer refused it. objectstack#16920
 * (merged 2026-09-08) applies that test to the
 * TRIMMED value — `packages/spec/src/data/field.zod.ts`, the `FieldSchema`
 * `superRefine`:
 *
 *   if (
 *     (field.type === 'lookup' || field.type === 'master_detail') &&
 *     (field.reference === undefined || field.reference.trim() === '')
 *   ) { ctx.addIssue({ code: 'custom', path: ['reference'], … }); }
 *
 * Same `custom` issue, same `reference` path, same message as absent and `''`
 * already got. The notion of blank is `.trim()` at both ends, so this guard and
 * the contract refuse the identical set: nothing here is stricter any more.
 *
 * ⭐ That fix SHIPPED IN 17.4.0, and the pin has reached it (objectui#8772):
 *
 *   FieldSchema.safeParse({ type: 'lookup', label: 'L', reference: '   ' })
 *     => success = false, `custom` at path ["reference"]
 *   ObjectSchema.safeParse({ …, fields: { rel: { …, reference: '   ' } } })
 *     => success = false, `custom` at path ["fields","rel","reference"]
 *
 * (controls in the same run: `'account'` and `' account '` are both accepted,
 * so the schema is consulted and this is a real reading — and the trim is for
 * the TEST only, so a target with surrounding whitespace is still stored as
 * written.)
 *
 * ⛔ Those two lines say WHEN the contract changed, not what is installed
 * today. The claim that rotted here said the opposite — "this repo's pin IS
 * 17.3.0", a present-tense reading of an artifact — and it went false the
 * moment the pin moved, while still being shown to authors (objectui#8897).
 * What is installed is MEASURED, never asserted in prose: the reading lives in
 * `MetadataService.specKeyReference.test.ts`, which re-parses the schema on
 * every run and is the only thing here entitled to an opinion about the pin.
 *
 * ⭐ Kept — and now kept for its OWN reason rather than the divergence's. It
 * refuses at EDITOR time, before the PUT, naming the field while it is still on
 * screen; the contract refuses at the publish gate, where the same shape
 * arrives as a 422 on the whole object document with the half-filled draft
 * riding along inside it. A whitespace-only `reference` names no object at
 * either end — the spec's own `ObjectSchema.fields` key grammar
 * (`/^[a-z_][a-z0-9_]*$/`) admits no whitespace-bearing name for it to resolve
 * to — so admitting it buys the author nothing and only moves the identical
 * failure past the guard, past the PUT and into a STORED document, where it
 * surfaces with no field named and no save to attach the message to.
 *
 * ⭐ The refusal MESSAGE below has RETIRED its divergence wording, which is what
 * the note it replaces said would happen — "it retires with the pin bump, not
 * with this note". objectui#8897 is that retirement. It no longer tells the
 * author that the spec ACCEPTS a blank target and that the PUT would succeed;
 * against the installed artifact both halves were false, and that sentence was
 * the one USER-VISIBLE carrier of this rot. It now names the trim, which is
 * what still distinguishes a blank target from an empty one in the four-state
 * split, and the verbatim pin moved with it.
 */
function assertRelationshipTargetPresent(
  field: { type?: string; reference?: unknown },
  fieldName: string,
  writer: string,
): void {
  if (!RELATIONSHIP_TYPES_REQUIRING_REFERENCE.includes(String(field?.type))) return;
  const reference = field?.reference;
  if (typeof reference === 'string' && reference.trim() !== '') return;
  throw new Error(
    `${writer} cannot save the field \`${fieldName}\`: a \`${field?.type}\` field needs a ` +
      `\`reference\` naming the object it links to, ${describeUnusableTarget(reference)} ` +
      'Pick the target object, or change the field to a non-relationship type.',
  );
}

/**
 * Key a list of field payloads by field NAME — the shape `ObjectSchema.fields`
 * requires (objectui#6240).
 *
 * Declaration order is preserved, and that is load-bearing rather than
 * incidental: the spec models field order as DECLARATION ORDER in this record
 * and has no field-level ordering key at all (objectui#6045), so insertion
 * order here IS the designer's order.
 *
 * ## Why a missing name THROWS instead of writing `{ undefined: … }`
 *
 * The key can only come from the field's `name`. Both writer inputs declare it
 * required (`FieldMetadataPayload.name`, `DesignerFieldDefinition.name`), but
 * neither writer owns its input at runtime: `saveObject`'s `existingFields` is
 * public API (`MetadataService` is reachable from app-shell's barrel through
 * `useMetadataService`) and `saveFields` is handed whatever the designer's
 * in-memory model holds. A nameless field keys as the literal string
 * `"undefined"` — and the spec does NOT catch that. Measured on 17.2.0:
 *
 *   ObjectSchema.safeParse({ …, fields: { undefined: { type: 'text', label: 'N' } } })
 *     => success = true
 *
 * So the loud, immediate, harmless array-shaped 422 would have been traded for
 * a silently corrupt STORED document. That is the AI-authored-metadata failure
 * mode this repo keeps closing, and this conversion is exactly where it would
 * have been opened.
 *
 * ## Why a duplicate name throws too
 *
 * That one is the conversion's OWN hazard rather than an inherited one: an
 * array can carry two entries named `n` and a map cannot, so the later entry
 * would silently swallow the earlier. Refusing is the only reading that does
 * not lose a field the caller declared.
 *
 * ## Why `Object.fromEntries` and not assignment into a literal
 *
 * `map['__proto__'] = field` does not create a key — it invokes the prototype
 * setter — so a field named `__proto__`, built by assignment, vanishes from the
 * serialised body: this function's whole subject wearing a different spelling.
 * The name matches the record's snake_case key rule (`/^[a-z_][a-z0-9_]*$/`),
 * and through `@objectstack/spec` 17.4.0 the spec accepted the body with that
 * field and without it alike, so the drop was silent. Since 17.5.0 the spec
 * REFUSES a `fields` map that carries an own `__proto__` key, by name, at
 * `fields.__proto__`, because `z.record()` would drop the key from its output
 * while reporting success. (`constructor` and `prototype` are refused on the
 * same map too, by a reserved-name rule.)
 *
 * That refusal is why the construction is still load-bearing: it can name the
 * field only if the body still CARRIES the key. Assignment would hand the
 * server a body that has already lost the field, and the spec accepts what is
 * left. `Object.fromEntries` defines an own property instead. The version
 * numbers say WHEN the contract changed, not what is installed today. The
 * writer's half is re-measured by the "keys a field literally named
 * `__proto__` instead of silently dropping it" test, and the spec's
 * `__proto__` verdict by the "keys the record with a snake_case rule" test,
 * both in `MetadataService.objectPayloadFieldsMap.test.ts`. Nothing in this
 * package re-measures the `constructor` / `prototype` half; it is a reading of
 * 17.5.0, recorded on objectui#9787.
 */
function toFieldsMap(fields: FieldMetadataPayload[]): Record<string, FieldMetadataPayload> {
  const entries: Array<[string, FieldMetadataPayload]> = [];
  const seen = new Set<string>();

  fields.forEach((field, index) => {
    const name = field?.name;
    if (typeof name !== 'string' || name.trim() === '') {
      throw new Error(
        `[MetadataService] cannot build the object's \`fields\` map: the field at index ${index} has no ` +
          '`name`. `ObjectSchema.fields` is keyed by field name, so a nameless field would be written under ' +
          'the literal key "undefined" — which the spec ACCEPTS, leaving a corrupt document stored with ' +
          'nothing to report it. Give the field a name.',
      );
    }
    if (seen.has(name)) {
      throw new Error(
        `[MetadataService] cannot build the object's \`fields\` map: duplicate field name \`${name}\` at ` +
          `index ${index}. A name-keyed map cannot carry two fields under one name, so the later one would ` +
          'silently replace the earlier. Rename or remove one of them.',
      );
    }
    seen.add(name);
    // Third refusal at this door, and the reason it lives here rather than in
    // `saveFields`: this is the ONE conversion every PUT of an object's fields
    // passes through — `saveFields` for a field save, `toObjectPayload` for an
    // object save that carries `existingFields` — so one guard covers both
    // writers on this path. It raises before the request, so a refused list
    // issues no PUT and the half-filled draft stays in the client.
    assertRelationshipTargetPresent(field, name, '[MetadataService]');
    entries.push([name, field]);
  });

  return Object.fromEntries(entries);
}

/**
 * Field keys a designer once WROTE that `FieldSchema` refuses BY NAME, dropped
 * out of {@link carryOver} (objectui#6488).
 *
 * Derived from the tombstone registry (`RETIRED_FIELD_KEY_TOMBSTONES` in
 * `@object-ui/types`, objectui#6527) — this carry-over is the registry's
 * `metadataServiceCarryOver` site. The registry names each retired key, the
 * card that retired it, and which sites strip it; the per-key evidence lives
 * there. This site's list is the widest of the three because it is the one
 * with a recorded DEFENSIVE entry: no shipped writer ever populated a
 * field-level `sortOrder` (objectui#6045 — "the key never reached the wire"),
 * and it rides here as insurance against a document some OTHER client stored
 * while an older server accepted the key — see its tombstone for the recorded
 * verdict. Every other entry is a key a shipped build emitted before its card
 * retired it, so a document stored back then can still carry it inside a
 * field.
 *
 * Carrying such a key out again would be a hard `422 INVALID_METADATA` that
 * blocks EVERY later save of that object — and with the controls gone, an
 * author has no way to clear it from the UI. Stripping is what makes an
 * edit-and-save round-trip of such an object come out parseable; nothing that
 * the server would store is lost, because these are exactly the values it
 * refuses.
 *
 * The strip is keyed to those tombstones and is NOT a blanket unknown-key
 * purge: every other key the server sent still rides through, which is the
 * whole point of the carry-over. Deliberately not derived from `FieldSchema`'s
 * accept set either — measured on 17.2.0, a plugin-registered key
 * (`x_plugin_thing`) is `unrecognized_keys` to the INSTALLED spec while the
 * SERVER that sent it accepts it, so filtering by the client's schema would
 * drop precisely the keys this card exists to preserve.
 */
const RETIRED_FIELD_KEYS = retiredFieldKeysFor('metadataServiceCarryOver');

/**
 * The previous SERVER entry for one field, minus {@link RETIRED_FIELD_KEYS} —
 * the keys {@link toFieldPayload} spreads so a save cannot drop what the
 * designer does not model (objectui#6488).
 *
 * Same shape, same name and the same reason as `MetadataFieldsPage`'s
 * `carryOver`, which has solved this one writer over all along.
 */
function carryOver(prev?: Record<string, unknown>): Record<string, unknown> {
  if (!prev) return {};
  const present = RETIRED_FIELD_KEYS.filter((k) => k in prev);
  if (present.length === 0) return { ...prev };
  const next = { ...prev };
  for (const k of present) delete next[k];
  return next;
}

/**
 * The `fields` map of the fetched document, as a lookup for {@link carryOver}.
 *
 * Anything that is not a record is read as "no previous entries" rather than
 * coerced. An ARRAY in particular cannot be a stored document's shape —
 * `ObjectSchema` answers `fields: []` with `invalid_type` (objectui#6240), so a
 * served array means something other than metadata came back, and guessing at
 * its entries would be inventing a previous state to carry over.
 */
function previousFieldsOf(existingObject: Record<string, unknown>): Record<string, unknown> {
  const raw = existingObject.fields;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return raw as Record<string, unknown>;
}

/**
 * The previous entry for `name`, or `undefined` when there is none to carry.
 *
 * `hasOwnProperty` rather than a plain lookup, for the reason {@link toFieldsMap}
 * documents at the other end of the same map: `previous['__proto__']` reads
 * `Object.prototype` — an inherited object that is not a previous field entry
 * at all. `__proto__` has not been a legal field name since `@objectstack/spec`
 * 17.5.0, which refuses it as a `fields` key; but that refusal judges the PUT,
 * and this lookup runs before it — for whatever name a caller hands
 * `saveFields`, and over a stored document written before 17.5.0. Re-measured
 * by the "does not read `Object.prototype` as a previous entry for a field
 * named `__proto__`" test in `MetadataService.fieldKeyCarryOver.test.ts`.
 */
function previousFieldEntry(previous: Record<string, unknown>, name: string): Record<string, unknown> | undefined {
  if (!Object.prototype.hasOwnProperty.call(previous, name)) return undefined;
  const entry = previous[name];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return undefined;
  return entry as Record<string, unknown>;
}

/**
 * Convert a `DesignerFieldDefinition` (UI) to the API payload shape, carrying
 * over the previous SERVER entry's unmodelled keys (objectui#6488).
 *
 * ## Why the carry-over
 *
 * This shape models what the FIELD DESIGNER can author, which is a subset of
 * what `FieldSchema` accepts. Measured on the installed `@objectstack/spec`
 * 17.2.0, `expression` (a formula authored in metadata-admin), `precision`,
 * `scale`, `system` and `sortable` all parse green on a field — and none of
 * them is a key this converter names. Rebuilding the entry from the designer
 * model alone therefore DROPPED every one of them on every field save, and a
 * PUT is an upsert, so the drop lands in storage.
 *
 * That loss is not new but was unreachable: while `fields` went out as an array
 * the whole body was refused `422` before persistence (objectui#6240), so
 * nothing this dropped ever reached storage. From that fix onward it does.
 *
 * ## Why the modelled keys are still written UNCONDITIONALLY
 *
 * The mirror hazard, and the one thing that would make this fix worse than the
 * bug: carry-over must not resurrect a value the author deliberately CLEARED.
 * Every key below is named on every call, so a cleared property arrives as an
 * explicit `undefined` that OVERRIDES the carried value and is then dropped by
 * `JSON.stringify` — absent from the body, which on an upsert is the deletion.
 * A conditional spread (`...(field.x ? { x: field.x } : {})`) would leave the
 * server's old value standing and fail the author's deletion silently. Pinned
 * both ways in `MetadataService.fieldKeyCarryOver.test.ts`.
 *
 * It no longer copies `sortOrder` (objectui#6045). `FieldSchema` refuses that
 * key by name and nothing on the tree ever populated it, so the write was
 * latent — `JSON.stringify` drops the `undefined` — but one reorder feature
 * away from a hard 422 that blocks every later save of the object.
 */
function toFieldPayload(
  field: DesignerFieldDefinition,
  prev?: Record<string, unknown>,
): FieldMetadataPayload & Record<string, unknown> {
  return {
    ...carryOver(prev),
    name: field.name,
    label: field.label,
    type: field.type,
    group: field.group,
    description: field.description,
    required: field.required,
    unique: field.unique,
    readonly: field.readonly,
    hidden: field.hidden,
    defaultValue: field.defaultValue as string | undefined,
    placeholder: field.placeholder,
    options: field.options,
    externalId: field.externalId,
    trackHistory: field.trackHistory,
    reference: field.referenceTo,
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class MetadataService {
  constructor(private adapter: ObjectStackAdapter) {}

  // -----------------------------------------------------------------------
  // Generic metadata operations (any type)
  // -----------------------------------------------------------------------

  /**
   * Fetch all items for a given metadata category.
   * Returns the items array from the API response, defaulting to `[]`.
   */
  async getItems(category: string): Promise<Record<string, unknown>[]> {
    const client = this.adapter.getClient();
    const res: unknown = await client.meta.getItems(category);
    if (res && typeof res === 'object' && 'items' in res && Array.isArray((res as { items: unknown[] }).items)) {
      return (res as { items: Record<string, unknown>[] }).items;
    }
    return [];
  }

  /**
   * The ONE place this class puts metadata on the wire (objectui#8676).
   *
   * `@objectstack/client`'s `meta.saveItem` is the third of the three in-repo
   * transports that can PUT `/meta/:type/:name`, and the only one that lives in
   * a package this repo does not own — so the invariant cannot be pushed down
   * into it the way it is pushed into `MetadataClient.save`. This method is the
   * compensating seam: the SDK door is reached through it and through nothing
   * else in this class, so the guard runs once rather than three times, and
   * `scripts/check-object-metadata-write-doors.mjs` has one site to judge.
   *
   * ⚠ The guard here is a BACKSTOP, not the primary refusal for the two
   * object-shaped callers. `saveObject` and `saveFields` both build their
   * `fields` through {@link toFieldsMap}, which refuses the same half-filled
   * relationship EARLIER and with the designer-facing four-state wording those
   * writers' pins assert. Nothing here replaces that; this covers the callers
   * that do NOT pass through a conversion — `saveMetadataItem`, whose `category`
   * is a runtime value and can be `'object'`, and whoever calls it next.
   */
  private async putMetadataItem(
    category: string,
    name: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    assertObjectMetadataWritable(category, data, 'MetadataService');
    const client = this.adapter.getClient();
    await client.meta.saveItem(category, name, data);
  }

  /**
   * Persist a metadata item (upsert) for any category.
   *
   * `${category}:${name}` is the key the adapter's generic metadata read
   * caches under, and it is right for every category but one. A `view` row is
   * also read back under two OBJECT-scoped keys (`view:{object}:{name}` and
   * `view-overrides:{object}`), which `view:{name}` names neither of — so a
   * caller passing `'view'` here would leave the object page's override map
   * stale for the cache's 5-minute TTL, which is objectui#4373's defect on a
   * third writer. That is why this routes through the adapter's one seam
   * instead of restating the pair (the third restatement would have been the
   * third time this repo paid for one; see `invalidateViewKeys`).
   *
   * No in-repo caller passes `'view'` today — but this class is public API
   * (`useMetadataService`, exported from app-shell's barrel), so "unreachable"
   * would have been an unmeasured claim about consumers we do not own.
   *
   * The object binding comes from the body being written, via the same
   * accessor `listViewOverrides` narrows those rows by — not from a fourth
   * private copy of "which object is this?".
   *
   * ⛔ No `dropServedPicklistOptions` here (objectui#11692). This method reads
   * nothing: `data` is the caller's, so it cannot tell a served copy of a
   * picklist-bound field from an author who wrote `picklist` and `options`
   * together, and the second must stay the server's loud 422 with its
   * prescription. A caller that seeded `data` from a served object read applies
   * the conversion itself. Pinned (no read, the pair still refused) in
   * `MetadataService.picklistServedOptions-11692.test.ts`.
   */
  async saveMetadataItem(category: string, name: string, data: Record<string, unknown>): Promise<void> {
    await this.putMetadataItem(category, name, data);
    this.adapter.invalidateCache(`${category}:${name}`);
    if (category === 'view') {
      const objectName = viewItemObjectName(data);
      if (objectName) this.adapter.invalidateViewKeys(objectName, name);
    }
  }

  /**
   * Delete a metadata item through the metadata API's own delete door
   * (`DELETE /api/v1/meta/:type/:name`). Works for any metadata category.
   *
   * **It used to PUT a hand-written tombstone** — `{ name, enabled: false,
   * _deleted: true }` — and objectui#6238 measured what the server does with
   * that body. Neither key is a metadata convention:
   *
   *   - `enabled` and `_deleted` are refused BY NAME by 25 of the 26 overlay
   *     schemas the framework validates a PUT against (`getMetadataTypeSchema`,
   *     the registry `saveMetaItem`'s `resolveOverlaySchema` reads), `object`
   *     among them: `422 INVALID_METADATA`, `unrecognized_keys`.
   *   - Where the type's schema is tolerant (`view`) or unregistered
   *     (`analytics_cube`, `connector`, `sharing_rule`, `webhook`) the body is
   *     STORED VERBATIM — the framework persists the request item, never
   *     `parsed.data` — and `_deleted` has no reader anywhere in the platform.
   *     So on exactly the categories that did not 422, the "soft delete" was a
   *     silent no-op that left the item live carrying two junk keys.
   *
   * There was no third outcome: nothing strips the keys, and no spec surface
   * expresses "this item exists but is off" (`ObjectSchema`'s 42-key accept set
   * has no such flag), so there is no correct spelling this could be renamed
   * to. The delete door is `DELETE /:type/:name` — generic over `:type` on the
   * same route family and capability gate as the PUT — which is the same
   * request `MetadataClient.reset` issues for `MetadataObjectsPage`'s object
   * deletes and `ResourceEditPage`'s generic ones. One operation, one mechanism.
   *
   * **Still not wired to the view seam, and the reason is unchanged and
   * structural** (objectui#4373): both view cache keys are OBJECT-scoped and
   * this signature has no object parameter. The old tombstone body carried no
   * object binding to derive one from; a DELETE has no body at all, so it
   * carries even less. Splitting `name` on `.` would be a second,
   * silently-wrong identity rule (a source-declared view's name is not
   * qualified), and inventing an object argument for a method with no callers
   * is a surface we would be guessing at. If a `'view'` caller ever appears,
   * the fix is to give it the object it already knows and call
   * `adapter.invalidateViewKeys(objectName, name)` here.
   */
  async deleteMetadataItem(category: string, name: string): Promise<void> {
    const client = this.adapter.getClient();
    await client.meta.deleteItem(category, name);
    this.adapter.invalidateCache(`${category}:${name}`);
  }

  // -----------------------------------------------------------------------
  // Object operations
  // -----------------------------------------------------------------------

  /**
   * Persist an object definition to the backend.
   * Works for both create and update (the API is an upsert).
   *
   * ## Why `existingFields` is REQUIRED (objectui#6490)
   *
   * `ObjectSchema.fields` is not merely typed, it is REQUIRED. Measured against
   * the installed `@objectstack/spec` 17.2.0:
   *
   *   ObjectSchema.safeParse({ name: 'account', label: 'Account' })
   *     => success = false   invalid_type @ fields
   *
   * and `metadata-protocol`'s `saveMetaItem` parses the whole item against that
   * same schema and throws BEFORE it persists. So a call that omitted the field
   * list built a body the server was guaranteed to refuse with
   * `422 INVALID_METADATA` — this method cannot write a valid document without
   * it. Requiring the argument moves that guaranteed RUNTIME failure to compile
   * time; runtime accept/reject is unchanged, because the only calls it breaks
   * are calls that already failed, every time they ran.
   *
   * An EMPTY list is a different statement from a missing one, and it is
   * accepted: `[]` says "this object has no fields", writes `{}`, and under the
   * upsert that is a field wipe the caller asked for — the same authoritative
   * reading `saveFields` gives its own empty list. Pinned alongside the
   * anti-wipe control in `MetadataService.objectPayloadFieldsMap.test.ts`, so
   * the two readings of "no fields" stay distinguishable.
   *
   * Two readings were declined by the maintainer ruling (2026-08-27), recorded
   * here so neither returns as a shortcut:
   *
   *   - ⛔ **Not a `{}` default.** `{}` parses GREEN, so defaulting would delete
   *     every field of the object on a save that only meant to rename it —
   *     trading a loud, harmless 422 for silent data loss. `toObjectPayload`
   *     still omits the key for an input that supplies nothing, and that branch
   *     is still reachable: this class is public API through
   *     `useMetadataService`, so a JavaScript consumer, or one that casts past
   *     the types, can arrive there. What it must get is the 422, not the wipe.
   *   - ⛔ **Not fetch-and-merge.** `saveFields` GETs the current document and
   *     spreads it, and an object save could preserve the stored `fields` the
   *     same way — but that builds capability for a path with zero measured
   *     pull and makes this parameter redundant, which then wants retiring on
   *     its own terms (ADR-0049 shape).
   *
   * ⛔ And, for the same reason it does not fetch, no `dropServedPicklistOptions`
   * (objectui#11692): this method reads nothing, so every key it sends is one
   * the caller handed it, and it cannot tell a served copy from an authored
   * `picklist` + `options` pair — which must stay the server's loud 422.
   * `FieldMetadataPayload` declares no `picklist`, so a fresh typed field
   * literal cannot carry the binding here at all. Pinned (no read, the pair
   * still refused) in `MetadataService.picklistServedOptions-11692.test.ts`.
   */
  async saveObject(obj: ObjectDefinition, existingFields: FieldMetadataPayload[]): Promise<void> {
    const payload = toObjectPayload(obj, existingFields);
    await this.putMetadataItem('object', obj.name, payload as unknown as Record<string, unknown>);
    this.adapter.invalidateCache(`object:${obj.name}`);
  }

  /**
   * Delete an object definition from the backend
   * (`DELETE /api/v1/meta/object/:name`).
   *
   * The note this replaces said the metadata API "currently exposes `saveItem`
   * but no dedicated `deleteItem`", and that a tombstone PUT recorded the
   * intent until a real delete existed. Both halves were stale by the time
   * objectui#6238 measured them: `@objectstack/client` 17.2.0 declares
   * `meta.deleteItem(type, name)` on the very client this service already
   * holds, and it issues the SAME `DELETE /api/v1/meta/:type/:name` that
   * `MetadataClient.reset` does — the mechanism `MetadataObjectsPage` has been
   * using for designer object deletes all along. Nothing was recording an
   * intent in the meantime: `ObjectSchema` refuses `enabled` and `_deleted` by
   * name, so this call returned `422 INVALID_METADATA` every time it ran.
   *
   * `reset` semantics are the overlay's, and that is the governed answer rather
   * than a shortfall: it removes the customization row, which IS deletion for
   * an object the designer authored, and restores the artifact for one a
   * package declares — an object you are not allowed to delete. Which of the
   * two an item is, is what the API's own `deletable` / `resettable` verdicts
   * report (`MetadataClient`), not something a client-side flag should decide.
   */
  async deleteObject(objectName: string): Promise<void> {
    const client = this.adapter.getClient();
    await client.meta.deleteItem('object', objectName);
    this.adapter.invalidateCache(`object:${objectName}`);
  }

  // -----------------------------------------------------------------------
  // Field operations (fields are stored as part of their parent object)
  // -----------------------------------------------------------------------

  /**
   * Persist updated fields for an object.
   *
   * Fetches the current object metadata, replaces its `fields` MAP with the
   * provided designer fields, and saves the whole object back.
   *
   * It used to write an ARRAY here (objectui#6240), and note which direction
   * that ran in: the server's own document arrives with `fields` as a map, and
   * `fields.map(toFieldPayload)` converted the correct shape INTO the refused
   * one on every field save. `ObjectSchema` requires a record, so the resulting
   * PUT was answered `422 INVALID_METADATA` (`invalid_type @ fields`) and
   * nothing persisted — measured, not inferred: `metadata-protocol`'s
   * `saveMetaItem` parses the whole item against `ObjectSchema` and throws
   * before it writes.
   *
   * Two properties of this body are deliberate and are pinned in
   * `MetadataService.objectPayloadFieldsMap.test.ts`:
   *
   *   - **The spread still preserves unknown server keys.** `...existingObject`
   *     is what carries every key of the fetched document this service does not
   *     model, and reshaping `fields` must not cost that. It now matters more
   *     than it did, not less: while the body was refused, nothing it preserved
   *     ever reached storage.
   *   - **The field list is AUTHORITATIVE, so an empty one writes `{}`.** That
   *     is the opposite of `saveObject`'s optional `existingFields`, and the
   *     asymmetry is the point: here the designer is stating the object's
   *     complete field set, so "no fields" is a thing it can mean; there, a
   *     missing argument means the caller did not say.
   *
   * …and a third, pinned in `MetadataService.readDecorationStrip.test.ts`:
   *
   *   - **The framework's own read decorations do NOT go back out**
   *     (objectui#6480). The same spread that preserves unknown server keys
   *     also carries `_diagnostics` and `_draft` — keys the framework ADDS to a
   *     served document and `ObjectSchema` refuses by name — so the body is
   *     passed through the spec's `stripReadDecorations` before it is sent.
   *     Note the direction this cuts: the preservation property above is about
   *     keys the AUTHOR owns, and this one is about keys the FRAMEWORK owns.
   *     Only the second kind may be dropped, and only because the read path
   *     regenerates them.
   *
   * …and a fourth, pinned in `MetadataService.fieldKeyCarryOver.test.ts`:
   *
   *   - **Per-FIELD server keys are carried over** (objectui#6488). The spread
   *     above is object-level and does nothing for keys INSIDE a field, so
   *     entries rebuilt from the designer model dropped every key the server
   *     sent that this converter does not name — `expression`, `precision`,
   *     `scale`, `system`, `sortable`, anything a plugin registered. The
   *     previous entries ride in on the very document this method already
   *     fetched, so `toFieldPayload` merges onto them; see there for the mirror
   *     property that keeps a CLEARED designer property cleared.
   *
   * …and a fifth, pinned in `MetadataService.picklistServedOptions-11692.test.ts`:
   *
   *   - **A picklist-bound field leaves without its served `options`**
   *     (objectui#11692). The fetched document is the SERVED one, so a field
   *     naming a shared picklist carries `picklist` beside the options the
   *     runtime resolved from the list, and the carry-over above brings the
   *     binding back out. The authoring door refuses `options` beside
   *     `picklist` for the WHOLE object, so the body passes through
   *     `dropServedPicklistOptions` before the PUT. The binding can only have
   *     come from that read: `DesignerFieldDefinition` declares no `picklist`,
   *     so this method has no way to author one and none to remove one. A
   *     bound field's `options` are therefore never half of an authored pair
   *     here; they are the served copy, or a designer-model value the door
   *     refuses beside the binding whatever it holds. Fields without a
   *     `picklist` keep their `options` exactly as before.
   */
  async saveFields(objectName: string, fields: DesignerFieldDefinition[]): Promise<void> {
    const client = this.adapter.getClient();

    // Fetch current object metadata to preserve non-field properties
    let existingObject: Record<string, unknown> = {};
    try {
      const raw: any = await client.meta.getItem('object', objectName);
      existingObject = raw?.item ?? raw ?? {};
    } catch {
      // Object may not exist yet on the backend; proceed with fields-only save
    }

    // The per-FIELD half of the same preservation property (objectui#6488).
    // `...existingObject` below carries unknown keys of the DOCUMENT; it does
    // nothing for keys INSIDE a field, and those entries are rebuilt from the
    // designer model. The previous entries are already in hand — this is the
    // document the object-level spread just fetched — so the carry-over costs
    // no extra request, which is also why it belongs at this drop site rather
    // than anywhere upstream.
    const previousFields = previousFieldsOf(existingObject);

    // `...existingObject` is a verbatim spread of whatever the server sent, so
    // simply not writing `_diagnostics` / `_draft` is not enough: a served
    // document that carries either one spreads it straight back out, and
    // `ObjectSchema` refuses both BY NAME. Strip them on the way out — the
    // objectui#4644 strip-on-load shape applied on the write side where the
    // spread is, exactly as `MetadataObjectsPage.handleObjectsChange` does for
    // `group` (objectui#6223).
    //
    // The list is the SPEC'S (`METADATA_READ_DECORATIONS`), reached through its
    // own exported helper rather than copied here, because a local copy goes
    // stale the next time the framework adds a decoration — and a decoration
    // this writer does not know to remove is precisely the defect.
    //
    // Not a lenient "drop whatever the schema refuses" pass (AGENTS.md #0.1):
    // it removes exactly the two keys the framework ADDS AT READ TIME and never
    // stores, so a genuinely unrecognized key still fails loudly. Nothing is
    // lost by dropping them even though a PUT is an upsert — `_diagnostics` is
    // the read-path validation verdict, recomputed on every read, and `_draft`
    // reflects the row's `state` column and the `mode` parameter, never the
    // body. The ADR-0010 protection envelope (`_lock`, `_provenance`, …) IS
    // write-path state the server merges back, and the spec deliberately keeps
    // it out of the decoration list, so this strip does not touch it.
    const updatedObject = stripReadDecorations({
      ...existingObject,
      name: objectName,
      fields: toFieldsMap(fields.map((field) => toFieldPayload(field, previousFieldEntry(previousFields, field.name)))),
    }) as Record<string, unknown>;

    await this.putMetadataItem('object', objectName, dropServedPicklistOptions(updatedObject));
    this.adapter.invalidateCache(`object:${objectName}`);
  }

  // -----------------------------------------------------------------------
  // Diff helpers — determine what changed between two arrays
  // -----------------------------------------------------------------------

  /**
   * Detect changes between previous and next object arrays.
   *
   * Returns the single object that was created, updated, or deleted.
   * If multiple objects changed simultaneously the function returns `null`
   * (callers should treat this as a bulk save of the entire array).
   */
  static diffObjects(
    prev: ObjectDefinition[],
    next: ObjectDefinition[],
  ): { type: 'create' | 'update' | 'delete'; object: ObjectDefinition } | null {
    const prevMap = new Map(prev.map((o) => [o.id, o]));
    const nextMap = new Map(next.map((o) => [o.id, o]));

    // Detect creation (exists in next but not prev)
    for (const [id, obj] of nextMap) {
      if (!prevMap.has(id)) return { type: 'create', object: obj };
    }

    // Detect deletion (exists in prev but not next)
    for (const [id, obj] of prevMap) {
      if (!nextMap.has(id)) return { type: 'delete', object: obj };
    }

    // Detect update (same id but different content)
    for (const [id, nextObj] of nextMap) {
      const prevObj = prevMap.get(id);
      if (prevObj && JSON.stringify(prevObj) !== JSON.stringify(nextObj)) {
        return { type: 'update', object: nextObj };
      }
    }

    return null;
  }

  /**
   * Detect changes between previous and next field arrays.
   */
  static diffFields(
    prev: DesignerFieldDefinition[],
    next: DesignerFieldDefinition[],
  ): { type: 'create' | 'update' | 'delete'; field: DesignerFieldDefinition } | null {
    const prevMap = new Map(prev.map((f) => [f.id, f]));
    const nextMap = new Map(next.map((f) => [f.id, f]));

    for (const [id, field] of nextMap) {
      if (!prevMap.has(id)) return { type: 'create', field };
    }

    for (const [id, field] of prevMap) {
      if (!nextMap.has(id)) return { type: 'delete', field };
    }

    for (const [id, nextField] of nextMap) {
      const prevField = prevMap.get(id);
      if (prevField && JSON.stringify(prevField) !== JSON.stringify(nextField)) {
        return { type: 'update', field: nextField };
      }
    }

    return null;
  }
}
