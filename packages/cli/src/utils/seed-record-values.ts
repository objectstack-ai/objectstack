// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27259] Seed record VALUES, judged at authoring time by the judge the seed
 * load runs. A currency field seeded `{ value: 10, currency: 'USD' }` used to
 * pass `os validate` at exit 0 and be refused only when the seed loaded,
 * through the record validator. `os validate` and `os build` now refuse it
 * first, with the load's own code and sentence, located at the record's field.
 *
 * ## One judge
 *
 * ⛔ Not an `@objectstack/lint` registry member and not a second shape table.
 * The verdict is `validateInsertValues` (`@objectstack/objectql`): the insert
 * write's value verdict, the same normalizations and the same
 * `validateRecordInScope` call. This file owns only the WALK — which values
 * the load hands that judge as written, against which field map.
 *
 * The field map is the registry's, not the author's declaration: the stack's
 * objects are registered into a driverless `ObjectQL` (the shape
 * `authoring-filter-judge.ts` measured), with the stack's picklists and
 * picklist extensions, so a picklist-bound field carries the options the
 * runtime resolves for it.
 *
 * ## What is not handed to the judge
 *
 * Each is a value the load REWRITES before the write, or one whose verdict a
 * deployment decides, so judging it as written here would refuse what the load
 * accepts:
 *  - a value holding an expression envelope (`cel\`…\``): the load evaluates
 *    it first;
 *  - a value holding a `seedFile(path)` reference: the load stores the file
 *    and writes its id (`collectSeedFiles` judges the path);
 *  - a reference, file or structured-JSON field (the ADR-0104 value-shape
 *    classes): the load resolves a reference's natural key to an id, and the
 *    shape check refuses only on a deployment whose migration evidence says
 *    so;
 *  - a picklist-bound field whose list this stack does not declare: its
 *    options live in another package (`judgePicklistReferences` reports it);
 *  - a dataset whose object this stack does not declare or the registry
 *    refuses: the object is another package's, or the boot refuses it.
 *
 * A field the object does not declare is left to the answer it already has
 * (`defineSeed` refuses it at load of the config).
 *
 * ## Known limits
 *
 *  - A `beforeInsert` hook is not run here. The seed write runs object hooks
 *    (the seed context skips automation triggers, not hooks), and they run
 *    BEFORE the record validator, so a hook that rewrites a seed value into an
 *    accepted shape lets the load store it while this walk refuses it as
 *    written. The authoring door has no hook runtime by design; a refusal of
 *    a value a hook would have fixed comes from here.
 *  - Coverage is the folded stack's: `authoringRuleUnionStack` folds the
 *    stack's own collections and its `packages[]` bodies. A dataset under
 *    `manifest.data` whose object is declared only under `manifest.objects`
 *    (outside `packages[]`) finds no field map and goes unjudged, by the
 *    dataset clause above: fail-open, never a false refusal.
 */

import { createLogger } from '@objectstack/core';
import { ObjectQL, validateInsertValues, VALIDATION_FAILED_CODE, type FieldValidationError } from '@objectstack/objectql';
import { FILE_REFERENCE_TYPES, REFERENCE_VALUE_TYPES, STRUCTURED_JSON_TYPES, isSeedFileReference } from '@objectstack/spec/data';
import { isExpressionEnvelopeShaped } from '@objectstack/spec/automation';
import { datasetsOf } from './bundle-seed-files.js';
import { objectsOf, registrationCopy } from './authoring-filter-judge.js';
import { authoringRuleUnionStack } from './stack-collections.js';

type AnyRec = Record<string, unknown>;

/** A refusal, located in the stack like a seed file issue is. */
export interface SeedRecordValueIssue {
  /** Where the value sits, e.g. `data[0].records[4].budget`. */
  location: string;
  /** The dataset's object. */
  object: string;
  field: string;
  /** The record validator's code, e.g. `invalid_number`. */
  code: string;
  /** The record validator's sentence, as the seed load prints it. */
  message: string;
}

const isRec = (v: unknown): v is AnyRec => !!v && typeof v === 'object' && !Array.isArray(v);

/** Does the value hold anything the load rewrites before the write? */
function rewrittenAtLoad(value: unknown): boolean {
  if (isExpressionEnvelopeShaped(value) || isSeedFileReference(value)) return true;
  if (Array.isArray(value)) return value.some(rewrittenAtLoad);
  if (isRec(value)) return Object.values(value).some(rewrittenAtLoad);
  return false;
}

/** A driverless engine whose registry holds the stack's objects and picklists. */
function stackEngine(stack: AnyRec): ObjectQL {
  const ql = new ObjectQL({ logger: createLogger({ level: 'silent' }) });
  ql.registry.logLevel = 'silent';
  for (const picklist of Array.isArray(stack.picklists) ? stack.picklists : []) {
    if (!isRec(picklist) || typeof picklist.name !== 'string') continue;
    try {
      ql.registry.registerItem('picklist', { ...picklist }, 'name');
    } catch {
      // Refused by the registry: a field naming it is then left unjudged.
    }
  }
  for (const extension of Array.isArray(stack.picklistExtensions) ? stack.picklistExtensions : []) {
    if (!isRec(extension)) continue;
    try {
      ql.registry.registerPicklistExtension(extension as Parameters<typeof ql.registry.registerPicklistExtension>[0], 'stack');
    } catch {
      // Refused by the registry, as above.
    }
  }
  for (const obj of objectsOf(stack.objects)) {
    try {
      ql.registerObject(registrationCopy(obj) as Parameters<ObjectQL['registerObject']>[0]);
    } catch {
      // Refused by the registry: its datasets are left unjudged, see the header.
    }
  }
  return ql;
}

/** Is this field's value one the judge reads as written? See the header. */
function judgedField(ql: ObjectQL, def: AnyRec | undefined): boolean {
  if (!def || typeof def.type !== 'string') return false;
  const type = def.type;
  if (REFERENCE_VALUE_TYPES.has(type) || FILE_REFERENCE_TYPES.has(type) || STRUCTURED_JSON_TYPES.has(type)) return false;
  if (typeof def.picklist === 'string' && def.picklist.length > 0) {
    return ql.registry.resolvePicklistOptions(def.picklist) !== undefined;
  }
  return true;
}

/**
 * Judge every seed record value of `stack` with the insert write's value
 * verdict: the datasets where they sit (top level, manifest, each package
 * body), against the objects and picklists of every package. Reads only.
 */
export function judgeSeedRecordValues(stack: AnyRec): SeedRecordValueIssue[] {
  const datasets = datasetsOf(stack);
  if (!datasets.some(({ dataset }) => Array.isArray(dataset.records) && dataset.records.length > 0)) return [];
  const ql = stackEngine(authoringRuleUnionStack(stack));
  const issues: SeedRecordValueIssue[] = [];
  for (const { dataset, location } of datasets) {
    const objectName = (dataset as { object?: unknown }).object;
    if (typeof objectName !== 'string' || !Array.isArray(dataset.records)) continue;
    const schema = ql.registry.getObject(objectName) as { fields?: Record<string, AnyRec> } | undefined;
    if (!schema?.fields) continue;
    const fields = schema.fields;
    dataset.records.forEach((record, r) => {
      if (!isRec(record)) return;
      const row: AnyRec = {};
      for (const [name, value] of Object.entries(record)) {
        if (!Object.prototype.hasOwnProperty.call(fields, name)) continue;
        if (!judgedField(ql, fields[name]) || rewrittenAtLoad(value)) continue;
        row[name] = value;
      }
      try {
        validateInsertValues(schema as Parameters<typeof validateInsertValues>[0], row);
      } catch (err) {
        const refused = err as { code?: unknown; fields?: FieldValidationError[] };
        if (refused?.code !== VALIDATION_FAILED_CODE || !Array.isArray(refused.fields)) throw err;
        for (const f of refused.fields) {
          issues.push({
            location: `${location}.records[${r}].${f.field}`,
            object: objectName,
            field: f.field,
            code: f.code,
            message: f.message,
          });
        }
      }
    });
  }
  return issues;
}
