// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The served form of a picklist-bound field, turned back into the authored
 * form before a writer that seeded its body from a served read PUTs it
 * (objectui#10202, objectui#11692).
 *
 * ## Why the writer has to do this
 *
 * A select field may name a shared list instead of carrying its own options:
 * `picklist: 'industry'` (`FieldSchema.picklist`, `@objectstack/spec`
 * `data/picklist.zod.ts`). The runtime serves such a field with BOTH keys:
 * `picklist`, still naming the list, and `options`, RESOLVED from that list and
 * from every `picklistExtensions` entry other packages add to it
 * (`PicklistServedFieldSchema`). Every object read carries that served form —
 * the object list `GET /meta/object`, `GET /meta/object/NAME`, and the
 * `effective` layer of `GET /meta/object/NAME/layers` alike, because the
 * runtime resolves the binding in the one fold all three share.
 *
 * The authoring door refuses the two keys together: `FieldSchema` adds an issue
 * at `fields.FIELD.options` whose prescription is "Keep `picklist` and delete
 * `options`". So a writer that sends its seed back unchanged gets
 * `422 INVALID_METADATA` for the whole object, whatever the author edited —
 * an OWD batch edit, a relabel, a field reorder, anything.
 * The resolved list belongs to the picklist, not to the field: the producer of
 * the PUT drops it (objectstack's producer obligation, pinned server-side in
 * `protocol-picklist-served-roundtrip.test.ts`).
 *
 * ## What this changes, and what it never touches
 *
 * EVERY field that names a picklist leaves without `options` — not only the one
 * the author edited, because the whole document is re-sent and any bound field
 * in it is refused. A field that names no picklist is not touched at all: its
 * inline `options` stay byte-identical. No other key of any field, and no key of
 * the document, is touched.
 *
 * "Names a picklist" is the spec's own test, `picklist !== undefined` (the
 * `FieldSchema` refinement), so this drops `options` on exactly the fields the
 * door would refuse for carrying both.
 *
 * Both `fields` shapes a document can carry are handled: the spec's record keyed
 * by field name, and the array `readFields` / `writeFields` round-trip for a
 * document that arrived that way.
 *
 * ⛔ Not at the transport. `MetadataClient.save` and the other metadata-write
 * doors cannot tell a served copy from an author who wrote both keys, and the
 * second must stay a loud refusal with its prescription. The writer can tell:
 * it seeded its body from the served read. So this is exported for WRITERS —
 * the opposite of `assertObjectMetadataWritable`, which is exported for doors —
 * and the rule each writer applies is one sentence: a body seeded from a served
 * object read goes through this function on its way to the PUT; a body built
 * from the author's own input does not.
 *
 * ## Why it lives in this package (objectui#11692)
 *
 * The writers that seed from a served read are not all in one package: the
 * Studio and metadata-admin surfaces live in `@object-ui/app-shell`, and the
 * Setup fields and objects pages in `@object-ui/plugin-designer`, which does
 * not depend on `app-shell`. Both depend on this package, which also owns the
 * client that serves the read and carries the write — the same reason
 * `extractDraftBody` lives here. One function, not one copy per package: a
 * second copy is free to drift from the spec's served shape on its own.
 *
 * Pure: the input is never mutated, and a document with nothing to drop comes
 * back BY REFERENCE, so a caller can tell "unchanged" by identity.
 */
export function dropServedPicklistOptions<T extends Record<string, unknown>>(body: T): T {
  if (!body || typeof body !== 'object') return body;
  const fields = body.fields;
  if (Array.isArray(fields)) {
    let changed = false;
    const next = fields.map((def) => {
      const stripped = withoutServedOptions(def);
      if (stripped !== def) changed = true;
      return stripped;
    });
    return changed ? { ...body, fields: next } : body;
  }
  if (fields && typeof fields === 'object') {
    let changed = false;
    // `Object.fromEntries` keeps a field literally named `__proto__` as an own
    // key, where assignment into a literal would invoke the prototype setter
    // and drop it (the hazard `MetadataService.toFieldsMap` documents).
    const next = Object.fromEntries(
      Object.entries(fields as Record<string, unknown>).map(([name, def]) => {
        const stripped = withoutServedOptions(def);
        if (stripped !== def) changed = true;
        return [name, stripped];
      }),
    );
    return changed ? { ...body, fields: next } : body;
  }
  return body;
}

/** One field without its served `options` — the same reference when there is nothing to drop. */
function withoutServedOptions(def: unknown): unknown {
  if (!def || typeof def !== 'object' || Array.isArray(def)) return def;
  const record = def as Record<string, unknown>;
  if (record.picklist === undefined) return def;
  if (!Object.prototype.hasOwnProperty.call(record, 'options')) return def;
  const { options: _served, ...authored } = record;
  return authored;
}
