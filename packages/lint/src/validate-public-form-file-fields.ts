// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A form open to anonymous intake that declares a file field is refused
 * (ruling C on #25572: a guest form takes no attachment, and there is no guest
 * upload door).
 *
 * A form view is open to anonymous intake when its `sharing` declares
 * `enabled: true`, `allowAnonymous: true` and a `publicLink`. Which form
 * candidates of a view that opens is ONE rule, `anonymousFormIntakeCandidates`
 * (`@objectstack/spec/ui`), the same function both anonymous doors
 * (`GET /forms/:slug`, `POST /forms/:slug/submit`) serve from, so this rule
 * judges exactly the forms a visitor can reach and no other.
 *
 * Such a form collects the fields its sections declare: a section field entry
 * is a bare field name or `{ field }`, and both doors read the same two
 * spellings. When one of them is a field whose type is in
 * `FILE_REFERENCE_TYPES` (`@objectstack/spec/data`: `image`, `file`, `avatar`,
 * `video`, `audio`), the form declares a field no visitor can fill: a file
 * field's value is a `sys_file` id, an anonymous caller has no upload route to
 * mint one, and the submit door refuses the value. Declared but impossible, so
 * it is refused where it is written, naming the field.
 *
 * The prescription is the route the ruling chose: the visitor registers and
 * signs in, then fills a form that collects the file. Never a guest upload.
 *
 * ## Where it runs
 *
 * A field's type lives on the object and the `sharing` on the view, so the
 * rule needs both. It is a stack-level authoring rule (`authoring-rules.ts`):
 * `os validate`, `os build` and `os lint` run it over the whole stack, and the
 * runtime publish gate runs it on a `view` write, whose snapshot carries the
 * `objects` collection as resolution context (`runtime-gate.ts`). An `object`
 * write's snapshot carries no views, so changing a field's type under a
 * published public form is caught by the CLI commands and by that view's next
 * publish, not by the object's own write.
 *
 * Both section spellings are read, `sections` and the legacy `groups` alias
 * (folded onto `sections` at parse), because `os lint` hands this rule the
 * unparsed stack. A form whose bound object, or whose field, does not resolve
 * in the stack is not judged here: the field-reference rules own that answer.
 */

import { FILE_REFERENCE_TYPES } from '@objectstack/spec/data';
import { anonymousFormIntakeCandidates, type AnonymousFormIntakeCandidate } from '@objectstack/spec/ui';

import { collectionEntries } from './collection-entries.js';
import { recordsOf } from './object-graph.js';
import { viewObjectName } from './view-walk.js';

export const PUBLIC_FORM_FILE_FIELD = 'public-form-file-field';

export interface PublicFormFileFieldFinding {
  severity: 'error';
  /** Diagnostic rule id: always {@link PUBLIC_FORM_FILE_FIELD}. */
  rule: string;
  /** Human-readable location, e.g. `view "supplier_intake" · formViews.apply`. */
  where: string;
  /** Config path of the section field entry, e.g. `views[0].formViews.apply.sections[1].fields[2]`. */
  path: string;
  message: string;
  hint: string;
}

type AnyRec = Record<string, unknown>;

function isRec(v: unknown): v is AnyRec {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function strName(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** object name → field name → declared type. Reads the map and the list shapes of `fields`. */
function indexFieldTypes(stack: AnyRec): Map<string, Map<string, string>> {
  const idx = new Map<string, Map<string, string>>();
  for (const obj of recordsOf(stack.objects)) {
    const name = strName(obj.name);
    if (!name) continue;
    const types = new Map<string, string>();
    for (const field of recordsOf(obj.fields)) {
      const fieldName = strName(field.name);
      const type = strName(field.type);
      if (fieldName && type) types.set(fieldName, type);
    }
    idx.set(name, types);
  }
  return idx;
}

/** Where a candidate sits in its view: `form`, `formViews.KEY` or `config`. */
function candidateSlot(view: AnyRec, candidate: AnonymousFormIntakeCandidate): string {
  if (candidate.form === view.form) return 'form';
  if (candidate.key !== undefined && isRec(view.formViews) && view.formViews[candidate.key] === candidate.form) {
    return `formViews.${candidate.key}`;
  }
  return 'config';
}

/**
 * The object an open candidate submits into, in the order the anonymous doors
 * resolve it (`anonymousFormObjectName`, `@objectstack/metadata-core`): the
 * form's own binding, then the view's list block, its default form, and the
 * view itself.
 */
function candidateObjectName(view: AnyRec, form: AnyRec): string | undefined {
  return (
    viewObjectName(form) ??
    (isRec(view.list) ? viewObjectName(view.list) : undefined) ??
    (isRec(view.form) ? viewObjectName(view.form) : undefined) ??
    viewObjectName(view)
  );
}

/** A section field entry is a bare field name or `{ field, … }`. */
function fieldNameOf(entry: unknown): string | undefined {
  if (typeof entry === 'string') return strName(entry);
  return isRec(entry) ? strName(entry.field) : undefined;
}

/** Refuse every file-typed field a form open to anonymous intake declares. Empty = clean. */
export function validatePublicFormFileFields(stack: AnyRec): PublicFormFileFieldFinding[] {
  const findings: PublicFormFileFieldFinding[] = [];
  const fieldTypes = indexFieldTypes(stack);

  for (const { rec: view, path: viewPath } of collectionEntries(stack.views, 'views')) {
    const viewName = strName(view.name) ?? strName(view.object) ?? viewPath;
    for (const candidate of anonymousFormIntakeCandidates(view)) {
      const objectName = candidateObjectName(view, candidate.form);
      const types = objectName ? fieldTypes.get(objectName) : undefined;
      if (!types) continue;
      const slot = candidateSlot(view, candidate);
      const where = `view "${viewName}" · ${slot}`;

      for (const bucket of ['sections', 'groups'] as const) {
        const sections = Array.isArray(candidate.form[bucket]) ? (candidate.form[bucket] as unknown[]) : [];
        for (let s = 0; s < sections.length; s++) {
          const section = sections[s];
          const entries = isRec(section) && Array.isArray(section.fields) ? (section.fields as unknown[]) : [];
          for (let f = 0; f < entries.length; f++) {
            const fieldName = fieldNameOf(entries[f]);
            const type = fieldName ? types.get(fieldName) : undefined;
            if (!fieldName || !type || !FILE_REFERENCE_TYPES.has(type)) continue;
            findings.push({
              severity: 'error',
              rule: PUBLIC_FORM_FILE_FIELD,
              where,
              path: `${viewPath}.${slot}.${bucket}[${s}].fields[${f}]`,
              message:
                `${viewName}: the form at ${slot} is open to anonymous intake (its sharing publishes ` +
                `/forms/${candidate.slug} with allowAnonymous: true) and declares "${fieldName}", a ` +
                `${type} field on object "${objectName}". A public form takes no attachment: an ` +
                `anonymous visitor has no upload door, so this field can never be filled.`,
              hint:
                `Take "${fieldName}" off this public form. To collect a file from a visitor, have ` +
                `them register and sign in, then fill a form that is not open to anonymous intake ` +
                `and declares "${fieldName}".`,
            });
          }
        }
      }
    }
  }

  return findings;
}
