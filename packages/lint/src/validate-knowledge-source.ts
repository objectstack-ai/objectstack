// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0161 K4, row 4] Knowledge sources (`knowledgeSources`, the governed
 * type `knowledge_source`) that reference what the stack does not have, or an
 * object the knowledge service never searches for a caller it judges:
 * reported by `os validate` / `build` / `lint` and by the runtime publish
 * gate, with one set of rule ids and messages.
 *
 * ADR-0161 K4 states both halves: an item "is refused when the object or a
 * named field does not exist (the lint and `os validate` checks are row 4)",
 * and "a packaged item meets the gates that need no principal in `os validate`
 * and at publish (row 4)". So those findings are errors, and the publish door
 * refuses them. What each one costs differs: a missing object leaves the
 * source nothing to index, a missing field indexes no text for that member,
 * and a gated object is never searched for any caller the service judges.
 * That is the one point where this rule departs from its precedent,
 * `validateAiContext`, which only advises at publish (ADR-0160 D1: a context
 * pack still reads what resolves); K4 orders the refusal here.
 *
 * Five verdicts:
 *
 * - `knowledge-source-object-unknown`: `source.object` names no object of the
 *   stack or of a package of its artifact (`packages[]`), or, at the publish
 *   door, of the objects the host serves. An `error` where the snapshot is
 *   enough to know: under the package closure the door states (worded for
 *   the closure with {@link closureDependencyRemedy}), at the door with no
 *   closure (the whole collection the host serves), and on the CLI for a
 *   stack whose manifest declares no dependency the artifact does not carry.
 *   A `warning` with the hedge on the CLI when the manifest declares such a
 *   dependency: the build cannot see that package's objects, and the publish
 *   door judges the source against its closure, which holds them (the
 *   `flow-trigger-unknown-object` split). On the CLI the ladder
 *   `validateObjectReferences` resolves object names by also applies: a
 *   platform object a known package registers is not judged when the stack
 *   does not carry it (its declaration is not in hand), and a
 *   platform-prefixed name no known package registers is a `warning`. Under
 *   a closure only the first holds, and only for a name the closure may
 *   drop. The closure keeps every system object the host serves
 *   (`narrowObjectsToPackageClosure` in `runtime-gate.ts`, limb 1, which asks
 *   `isSystemObject`), and by name alone that reading keeps every `sys_`
 *   object, so an absent `sys_` name, known or not, exists nowhere the host
 *   serves: an `error`, with no dependency remedy. A `cloud_` or `ai_` name
 *   is not on that arm: limb 1 keeps such an object only when its definition
 *   says `isSystem: true`, which the name does not tell, so its absence may
 *   be the closure's own; a known one is not judged, and any other is
 *   outside the closure. Against the whole collection at the door every
 *   absent name, platform or not, is absent from every package the host
 *   serves, so it is an `error`, worded for an author with no stack and no
 *   manifest (the organization's objects, or a package to install). An
 *   empty whole collection at the door is no universe, and judges nothing.
 * - `knowledge-source-field-unknown` (`error`): a `source.content` or
 *   `source.metadataFields` member names no field of the object: neither one
 *   it declares (its own stack's extensions folded in, `objectsAsServed`) nor
 *   a column addressable on it without being declared
 *   ({@link injectedColumnsFor}: `id`, which the driver provisions, and the
 *   system columns the registry injects). The index reads that member off
 *   every record and finds nothing.
 * - `knowledge-source-object-not-searchable` (`error`): the object's API
 *   exposure refuses `search`: `canServeApiOperation(enable, 'search')`, the
 *   decision and operation the knowledge service's admission asks
 *   (`knowledge-source-admission.ts` in `@objectstack/service-knowledge`,
 *   gate 2). `enable.apiEnabled: false` refuses it, and so does an
 *   `enable.apiMethods` list that does not grant `list` (search derives from
 *   `list`; `search` itself is a retired list value the parse strips) or that
 *   grants `list` beside `enable.searchable: false`. With no `apiMethods`
 *   list, `searchable: false` does not refuse it.
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
import { injectedColumnsFor } from './system-fields.js';
import { isSystemObject } from './validate-security-posture.js';

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
 * The object's declared fields as a name → definition map, or `undefined`
 * when it declares no readable map. Existence also admits the columns
 * addressable without a declaration ({@link injectedColumnsFor}), which carry
 * no credential and no `internal` flag, so they need no definition here.
 */
function declaredFieldsOf(object: AnyRec): Map<string, AnyRec> | undefined {
  const raw = object.fields;
  if (!raw || typeof raw !== 'object') return undefined;
  return new Map(recordsOf(raw).map((f) => [str(f.name), f] as const).filter(([name]) => name !== ''));
}

/**
 * The ids of the packages the stack's manifest declares in `dependencies`
 * that its artifact (`packages[]`) does not carry: packages whose objects the
 * build cannot see, and the publish door's closure holds.
 */
function unseenDeclaredDependencies(stack: AnyRec): string[] {
  const manifest = stack.manifest;
  if (!isRec(manifest)) return [];
  const declared = manifest.dependencies;
  const ids = Array.isArray(declared)
    ? declared.filter((d): d is string => typeof d === 'string' && d !== '')
    : isRec(declared)
      ? Object.keys(declared)
      : [];
  if (ids.length === 0) return [];
  const carried = new Set<string>();
  for (const entry of packagesOf(stack)) {
    const id = isRec(entry.manifest) ? str(entry.manifest.id) : '';
    if (id) carried.add(id);
  }
  return ids.filter((id) => !carried.has(id) && id !== str(manifest.id));
}

/**
 * Report every knowledge source of `stack` whose object or fields the stack
 * does not have, whose object the knowledge service never searches for a
 * caller it judges, or that names a field the index never carries. Reads
 * `stack.knowledgeSources`, `stack.manifest.dependencies`, `stack.objects`
 * (with the stack's own `objectExtensions` folded in) and the objects of
 * `stack.packages[]`; safe on any shape.
 *
 * @param options.packageScope The package closure the runtime publish gate
 *   narrowed `stack.objects` to (`AuthoringRuleContext.packageScope`), present
 *   only when one was in force. An unresolved object is then outside the
 *   package's reach, and the verdict says so with the closure remedy.
 * @param options.wholeCollection `true` when `stack.objects` is the whole
 *   collection a runtime host serves (a gated write that names no package),
 *   as the list-view and form members read it: an unresolved object exists
 *   nowhere, and the declared-dependency hedge does not apply.
 */
export function validateKnowledgeSource(
  stack: AnyRec,
  options: {
    packageScope?: { readonly packageId: string; readonly dependencies: readonly string[] };
    wholeCollection?: boolean;
  } = {},
): KnowledgeSourceFinding[] {
  const out: KnowledgeSourceFinding[] = [];
  if (!isRec(stack)) return out;
  const sources = collectionEntries(stack.knowledgeSources, 'knowledgeSources');
  if (sources.length === 0) return out;
  const closure = options.packageScope;
  const atDoor = !!closure || options.wholeCollection === true;

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
  // An empty whole collection means the host supplied no universe (a failed
  // registry read), as the list-view and form members read it: no object
  // verdict is drawn from it.
  const noUniverse = !closure && options.wholeCollection === true && objects.size === 0;
  // The whole collection the host serves holds every platform object a
  // package registers there, so an absent platform name, known or merely
  // prefixed, exists nowhere: judged as an unprefixed name is (K4).
  const whole = !closure && options.wholeCollection === true;
  const unseen = atDoor ? [] : unseenDeclaredDependencies(stack);

  for (const { rec, path } of sources) {
    const where = `knowledge source "${str(rec.name) || path}"`;
    const source = rec.source;
    if (!isRec(source)) continue;
    const objectName = str(source.object);
    if (!objectName) continue;
    const objectPath = `${path}.source.object`;
    const def = objects.get(objectName);

    if (!def) {
      if (noUniverse) continue;
      // Limb 1 of the closure keeps every system object the host serves, and
      // asked by name alone (`isSystemObject`) it keeps every `sys_` one: an
      // absent `sys_` name is as final under a closure as against the whole
      // collection. A `cloud_` / `ai_` name is kept only on its definition's
      // `isSystem: true`, which the name does not tell, so it is not here.
      const absentSystemObject = !!closure && isSystemObject({ name: objectName });
      // A platform object a known package registers: its declaration is not
      // in this stack, so neither its fields nor its gates can be read here.
      // Against the whole collection it is in hand, and its absence is final.
      if (!whole && !absentSystemObject && isPlatformProvidedObjectName(objectName)) continue;
      if (absentSystemObject) {
        out.push({
          severity: 'error',
          rule: KNOWLEDGE_SOURCE_OBJECT_UNKNOWN,
          where,
          path: objectPath,
          message:
            `\`source.object\` names '${objectName}', a system object the host does not serve. The closure of ` +
            `package "${closure.packageId}" holds every system object the host serves, so no dependency brings it ` +
            'in, and the source indexes nothing.' +
            suggestName(objectName, objects.keys()),
          hint: 'Name a system object the host serves (check the spelling), or another object inside that closure',
        });
      } else if (closure) {
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
      } else if (!whole && hasPlatformObjectPrefix(objectName)) {
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
      } else if (unseen.length > 0) {
        out.push({
          severity: 'warning',
          rule: KNOWLEDGE_SOURCE_OBJECT_UNKNOWN,
          where,
          path: objectPath,
          message:
            `\`source.object\` names '${objectName}', which this stack does not define. The manifest declares ` +
            `${unseen.map((id) => `"${id}"`).join(', ')} in \`dependencies\`, whose objects this build cannot see; ` +
            'if none of them defines it, the source indexes nothing, and the publish is refused.' +
            suggestName(objectName, objects.keys()),
          hint:
            'Ignore this if a declared dependency defines the object (the publish checks it against the package\'s ' +
            'closure); otherwise name an object the stack defines (check the spelling)',
        });
      } else if (whole) {
        // A write that names no package: its author has no stack and no
        // manifest, only the organization's objects and the packages it installs.
        out.push({
          severity: 'error',
          rule: KNOWLEDGE_SOURCE_OBJECT_UNKNOWN,
          where,
          path: objectPath,
          message:
            `\`source.object\` names '${objectName}', which is not an object of this organization (neither one it ` +
            'authored nor one an installed package registers), so the source indexes nothing and no search ever ' +
            'returns a hit from it.' +
            suggestName(objectName, objects.keys()),
          hint: `Name an object the organization has (check the spelling), or install the package that provides '${objectName}' first`,
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
          hint:
            'Name an object the stack defines (check the spelling) or a platform object by its full name; for an ' +
            'object another package defines, declare that package in the manifest\'s `dependencies` and install it',
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
          `the API does not serve object '${objectName}' for \`search\` (\`enable.apiEnabled\` is false, its ` +
          '`enable.apiMethods` list does not grant `list`, from which search derives, or it grants `list` beside ' +
          '`enable.searchable: false`), so the knowledge service never searches this source for a caller it judges.',
        hint:
          `Serve '${objectName}' for search: keep \`enable.apiEnabled\` true and, where it declares ` +
          '`enable.apiMethods`, include `list` with `enable.searchable` not false; or index another object',
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
          'the knowledge service never searches this source for a caller it judges.',
        hint: 'Index a business object, or a system object whose definition declares `enable.aiReadable: true`',
      });
    }

    const fields = declaredFieldsOf(def);
    if (!fields) continue;
    const addressable = injectedColumnsFor(def);
    const known = (): string[] => [...fields.keys(), ...[...addressable].filter((n) => !fields.has(n))];
    const managedBy = def.managedBy;
    const judgeMembers = (key: 'content' | 'metadataFields') => {
      const members = source[key];
      if (!Array.isArray(members)) return;
      members.forEach((member, k) => {
        if (typeof member !== 'string' || member === '') return;
        const memberPath = `${path}.source.${key}[${k}]`;
        const field = fields.get(member);
        if (!field) {
          if (addressable.has(member)) return;
          out.push({
            severity: 'error',
            rule: KNOWLEDGE_SOURCE_FIELD_UNKNOWN,
            where,
            path: memberPath,
            message:
              `\`source.${key}\` names field '${member}', which object '${objectName}' does not define, so the ` +
              'index reads nothing for it on any record.' +
              suggestName(member, known()),
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
