// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0161 K4, row 4] Knowledge sources (`knowledgeSources`, the governed
 * type `knowledge_source`) that reference what the stack does not have, or an
 * object the knowledge service never searches: reported by `os validate` /
 * `build` / `lint` and by the runtime publish gate, with one set of rule ids
 * and messages.
 *
 * ADR-0161 K4 states both halves: an item "is refused when the object or a
 * named field does not exist (the lint and `os validate` checks are row 4)",
 * and "a packaged item meets the gates that need no principal in `os validate`
 * and at publish (row 4)". A source that fails one of them can never serve a
 * hit, so those findings are errors, and the publish door refuses them. That
 * is the one point where this rule departs from its precedent,
 * `validateAiContext`, which only advises at publish: a context pack still
 * reads what resolves (ADR-0160 D1), a knowledge source over a missing object
 * or a gated object indexes nothing.
 *
 * Five verdicts:
 *
 * - `knowledge-source-object-unknown` (`error`): `source.object` names no
 *   object of the stack, of a package of its artifact (`packages[]`), or, at
 *   the publish door, of the objects the host serves (the package's closure
 *   when one is stated, worded for the closure with the shared remedy,
 *   {@link closureDependencyRemedy}). The ladder `validateObjectReferences`
 *   resolves every object name by: a platform object a known package
 *   registers is not judged when the stack does not carry it (its declaration
 *   is not in hand), and a platform-prefixed name no known package registers
 *   is a `warning`, because a third-party package may still provide it.
 * - `knowledge-source-field-unknown` (`error`): a `source.content` or
 *   `source.metadataFields` member names no field of the object: neither one
 *   it declares (its own stack's extensions folded in, `objectsAsServed`) nor
 *   a system column the platform injects on it ({@link injectedColumnDefsFor}).
 *   The index reads the member off every record and finds nothing.
 * - `knowledge-source-object-not-searchable` (`error`): the object's API
 *   exposure refuses `search` — `canServeApiOperation(enable, 'search')`, the
 *   decision and operation the knowledge service's admission asks
 *   (`knowledge-source-admission.ts` in `@objectstack/service-knowledge`,
 *   gate 2): `enable.apiEnabled: false`, or an `enable.apiMethods` list
 *   without `search`.
 * - `knowledge-source-system-object-not-ai-readable` (`error`): a system
 *   object (a `sys_` name, the admission's gate 3) that does not opt into AI
 *   reads — `isAiReadExposed`, the spec's one reading of
 *   `enable.aiReadable`.
 * - `knowledge-source-field-never-indexed` (`warning`): a member names a
 *   credential-class field (`isMaskedOnReadFieldType`, the spec's
 *   declaration the service's withheld set asks) or an `internal` field. The
 *   index never carries either, even when named (ADR-0161 K5), so the author
 *   hears that the member is skipped (ADR-0078).
 *
 * Not judged here, because they need an environment or a principal: the
 * disabled-package gate and the field-queryable gate. Both are asked at save,
 * as the authoring principal (`authoredKnowledgeSourceRefusal` in
 * `@objectstack/metadata-core`). The fields a `where` reads are judged there
 * too. The predicates are the spec's own, asked as the admission module asks
 * them: no gate is restated here.
 *
 * An object the stack does not define is reported once and its fields are not
 * judged; an object with no readable field map is not field-judged. Both gates
 * are judged on every object whose definition is in hand.
 */

import { canServeApiOperation, isAiReadExposed, isMaskedOnReadFieldType, type EnableLike } from '@objectstack/spec/data';
import { hasPlatformObjectPrefix, isPlatformProvidedObjectName } from '@objectstack/spec/system';
import { collectionEntries } from './collection-entries.js';
import { closureDependencyRemedy, objectsAsServed, packagesOf, recordsOf, suggestName } from './object-graph.js';
import { injectedColumnDefsFor } from './system-fields.js';

export type KnowledgeSourceSeverity = 'error' | 'warning';

export interface KnowledgeSourceFinding {
  severity: KnowledgeSourceSeverity;
  rule: string;
  /** Human-readable location, e.g. `knowledge source "support_kb"`. */
  where: string;
  /** Config path, e.g. `knowledgeSources[0].source.content[1]`. */
  path: string;
  message: string;
  hint: string;
}

export const KNOWLEDGE_SOURCE_OBJECT_UNKNOWN = 'knowledge-source-object-unknown';
export const KNOWLEDGE_SOURCE_FIELD_UNKNOWN = 'knowledge-source-field-unknown';
export const KNOWLEDGE_SOURCE_OBJECT_NOT_SEARCHABLE = 'knowledge-source-object-not-searchable';
export const KNOWLEDGE_SOURCE_SYSTEM_OBJECT_NOT_AI_READABLE = 'knowledge-source-system-object-not-ai-readable';
export const KNOWLEDGE_SOURCE_FIELD_NEVER_INDEXED = 'knowledge-source-field-never-indexed';

/** The operation a knowledge search is judged as — the admission module's `KNOWLEDGE_SEARCH_OPERATION`. */
const SEARCH_OPERATION = 'search';

type AnyRec = Record<string, unknown>;

const isRec = (v: unknown): v is AnyRec => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * The admission module's system-object reading (gate 3): a `sys_` name, the
 * predicate the MCP record tools refuse by.
 */
const isSystemObjectName = (name: string): boolean => /^sys_/i.test(name);

/**
 * The object's fields as a name → definition map, or `undefined` when it
 * declares no readable map: the declared fields plus the system columns the
 * registry injects on it, a declared field winning over the injected one of
 * its name. The index reads a record as served, which carries those columns.
 */
function fieldMapOf(object: AnyRec): Map<string, AnyRec> | undefined {
  const raw = object.fields;
  if (!raw || typeof raw !== 'object') return undefined;
  const fields = new Map(recordsOf(raw).map((f) => [str(f.name), f] as const).filter(([name]) => name !== ''));
  for (const [name, def] of injectedColumnDefsFor(object)) if (!fields.has(name)) fields.set(name, { ...def });
  return fields;
}

/**
 * Report every knowledge source of `stack` whose object or fields the stack
 * does not have, whose object the knowledge service never searches, or that
 * names a field the index never carries. Reads `stack.knowledgeSources`,
 * `stack.objects` (with the stack's own `objectExtensions` folded in) and the
 * objects of `stack.packages[]`; safe on any shape.
 *
 * @param options.packageScope The package closure the runtime publish gate
 *   narrowed `stack.objects` to (`AuthoringRuleContext.packageScope`), present
 *   only when one was in force. An unresolved object is then outside the
 *   package's reach, and the verdict says so with the closure remedy.
 */
export function validateKnowledgeSource(
  stack: AnyRec,
  options: { packageScope?: { readonly packageId: string; readonly dependencies: readonly string[] } } = {},
): KnowledgeSourceFinding[] {
  const out: KnowledgeSourceFinding[] = [];
  if (!isRec(stack)) return out;
  const sources = collectionEntries(stack.knowledgeSources, 'knowledgeSources');
  if (sources.length === 0) return out;
  const closure = options.packageScope;

  // The stack's own objects as served, then what a package of its artifact
  // ships (ADR-0130 D4: the release artifact is the co-ownership boundary, so
  // the per-package pass of `os build` resolves a sibling's object).
  const objects = new Map<string, AnyRec>();
  for (const o of objectsAsServed(stack).objects) if (str(o.name)) objects.set(str(o.name), o);
  for (const entry of packagesOf(stack)) {
    const body = entry.manifest;
    if (!isRec(body)) continue;
    for (const o of recordsOf(body.objects)) if (str(o.name) && !objects.has(str(o.name))) objects.set(str(o.name), o);
  }

  for (const { rec, path } of sources) {
    const where = `knowledge source "${str(rec.name) || path}"`;
    const source = rec.source;
    if (!isRec(source)) continue;
    const objectName = str(source.object);
    if (!objectName) continue;
    const objectPath = `${path}.source.object`;
    const def = objects.get(objectName);

    if (!def) {
      // A platform object a known package registers: its declaration is not
      // in this stack, so neither its fields nor its gates can be read here.
      if (isPlatformProvidedObjectName(objectName)) continue;
      if (closure) {
        out.push({
          severity: 'error',
          rule: KNOWLEDGE_SOURCE_OBJECT_UNKNOWN,
          where,
          path: objectPath,
          message:
            `\`source.object\` names '${objectName}', which is outside the closure of package "${closure.packageId}" ` +
            '(the package, the packages its manifest declares in `dependencies`, and platform objects), so the ' +
            'source indexes nothing where the package is installed without that dependency.' +
            suggestName(objectName, objects.keys()),
          hint: closureDependencyRemedy(objectName, closure.packageId, 'name an object inside that closure'),
        });
      } else if (hasPlatformObjectPrefix(objectName)) {
        out.push({
          severity: 'warning',
          rule: KNOWLEDGE_SOURCE_OBJECT_UNKNOWN,
          where,
          path: objectPath,
          message:
            `\`source.object\` names '${objectName}', which has a platform prefix, but no known package registers it ` +
            'and this stack does not define it, so the source likely indexes nothing.' +
            suggestName(objectName, objects.keys()),
          hint: 'Check the spelling against the object the providing package registers, or ignore this if a third-party package provides it',
        });
      } else {
        out.push({
          severity: 'error',
          rule: KNOWLEDGE_SOURCE_OBJECT_UNKNOWN,
          where,
          path: objectPath,
          message:
            `\`source.object\` names '${objectName}', which this stack does not define, so the source indexes nothing ` +
            'and no search ever returns a hit from it.' +
            suggestName(objectName, objects.keys()),
          hint: 'Name an object the stack defines (check the spelling), or a platform object by its full name',
        });
      }
      continue;
    }

    // [ADR-0161 K4] The gates that need no principal, in the admission's order.
    const enable = (isRec(def.enable) ? def.enable : undefined) as EnableLike | undefined;
    if (!canServeApiOperation(enable, SEARCH_OPERATION)) {
      out.push({
        severity: 'error',
        rule: KNOWLEDGE_SOURCE_OBJECT_NOT_SEARCHABLE,
        where,
        path: objectPath,
        message:
          `the API does not serve object '${objectName}' for \`search\` (\`enable.apiEnabled\` is false, or its ` +
          '`enable.apiMethods` list does not include `search`), so the knowledge service never searches this source.',
        hint: `Serve '${objectName}' for \`search\`, or index another object`,
      });
    }
    if (isSystemObjectName(objectName) && !isAiReadExposed(def)) {
      out.push({
        severity: 'error',
        rule: KNOWLEDGE_SOURCE_SYSTEM_OBJECT_NOT_AI_READABLE,
        where,
        path: objectPath,
        message:
          `'${objectName}' is a system object that does not opt into AI reads (\`enable.aiReadable: true\`), so ` +
          'its records are never indexed for retrieval.',
        hint: 'Index a business object, or a system object whose definition declares `enable.aiReadable: true`',
      });
    }

    const fields = fieldMapOf(def);
    if (!fields) continue;
    const managedBy = def.managedBy;
    const judgeMembers = (key: 'content' | 'metadataFields') => {
      const members = source[key];
      if (!Array.isArray(members)) return;
      members.forEach((member, k) => {
        if (typeof member !== 'string' || member === '') return;
        const memberPath = `${path}.source.${key}[${k}]`;
        const field = fields.get(member);
        if (!field) {
          out.push({
            severity: 'error',
            rule: KNOWLEDGE_SOURCE_FIELD_UNKNOWN,
            where,
            path: memberPath,
            message:
              `\`source.${key}\` names field '${member}', which object '${objectName}' does not define, so the ` +
              'index reads nothing for it on any record.' +
              suggestName(member, fields.keys()),
            hint: `Name a field of '${objectName}' (check the spelling), or remove it from \`${key}\``,
          });
          return;
        }
        const credential = isMaskedOnReadFieldType(field.type, managedBy);
        if (credential || field.internal === true) {
          out.push({
            severity: 'warning',
            rule: KNOWLEDGE_SOURCE_FIELD_NEVER_INDEXED,
            where,
            path: memberPath,
            message:
              `\`source.${key}\` names field '${member}' of '${objectName}', which is ` +
              (credential ? `a credential-class field (\`${str(field.type)}\`)` : 'declared `internal: true`') +
              ', and the index never carries it, so the member is skipped.',
            hint: `Remove '${member}' from \`${key}\``,
          });
        }
      });
    };
    judgeMembers('content');
    judgeMembers('metadataFields');
  }
  return out;
}
