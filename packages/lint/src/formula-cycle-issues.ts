// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#33100] A formula field that reads its own value — itself
 * (`f_total = record.f_total * 2`) or through the formulas it reads
 * (`f_x = record.f_y + 1`, `f_y = record.f_x + 1`) — is refused where it is
 * authored: the object door (save and publish) and `os build`.
 *
 * The engine computes an object's formulas in dependency order, each after
 * the formulas it reads, so a formula over a formula reads the computed value.
 * A formula on a cycle has no such order: the engine never evaluates it, and
 * it reads `null` on every row with a fault naming the cycle. Both seams take
 * the order and the sentence from `@objectstack/formula`'s `formulaReadOrder`,
 * so the refusal here and the fault there are the same words.
 *
 * Reads are the platform's one member reader's (`analyzeRelationshipTraversals`
 * over `record`: `record.x`, `record.?x`, `record['x']`, inside `has()` too),
 * taken as the engine's plan takes them: the fields read as values
 * (`bareFields`) and the fields read through (`traversals`). A source the
 * reader cannot parse names no reads here; the expression pass refuses it on
 * its own.
 */
import { analyzeRelationshipTraversals, formulaReadOrder } from '@objectstack/formula';

type AnyRec = Record<string, unknown>;

/** One formula on a cycle, as a finding of the expression rule (an `ExprIssue`). */
export interface FormulaCycleIssue {
  where: string;
  message: string;
  source: string;
  severity: 'error';
}

/** The CEL source of a formula's `expression` (string shorthand or a `cel` envelope); `undefined` otherwise. */
function formulaSourceOf(def: AnyRec): string | undefined {
  const raw = def.expression;
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object') {
    const rec = raw as AnyRec;
    if (typeof rec.dialect === 'string' && rec.dialect !== 'cel') return undefined;
    if (typeof rec.source === 'string') return rec.source;
  }
  return undefined;
}

/**
 * Every formula field of object `objectName` that sits on a cycle of
 * formulas, in the order `fields` lists them, located on its `expression` as
 * the field-formula pass locates its findings
 * (`object 'x_job' · field 'f_total' expression`). `fields` are the object's
 * fields by name, as served (an `objectExtensions` field included, so a cycle
 * through one is seen); only the names in `report` get a finding, so each is
 * located on a field the caller's walk names. [#33153] `report` given as a map
 * names each reported field's location itself: the extension walk's, from
 * {@link extensionFormulaLoci}.
 */
export function formulaCycleIssues(
  objectName: string,
  fields: ReadonlyMap<string, AnyRec>,
  report: ReadonlySet<string> | ReadonlyMap<string, string>,
): FormulaCycleIssue[] {
  const sources = new Map<string, string>();
  for (const [name, def] of fields) {
    if (def.type !== 'formula') continue;
    const source = formulaSourceOf(def);
    if (source !== undefined) sources.set(name, source);
  }
  if (sources.size === 0) return [];
  const reads = new Map<string, string[]>();
  for (const [name, source] of sources) {
    const analysis = analyzeRelationshipTraversals(source);
    // The engine's read set (`storedExpressionReads` in `@objectstack/objectql`):
    // the fields read as values and the fields read through.
    const named = analysis ? [...analysis.bareFields, ...analysis.traversals.keys()] : [];
    reads.set(name, named.filter((read) => sources.has(read)));
  }
  const { cycles } = formulaReadOrder(reads);
  const issues: FormulaCycleIssue[] = [];
  for (const [field, source] of sources) {
    const message = cycles.get(field);
    if (message === undefined || !report.has(field)) continue;
    const where = report instanceof Map ? report.get(field) : undefined;
    issues.push({ where: where ?? `object '${objectName}' · field '${field}' expression`, message, source, severity: 'error' });
  }
  return issues;
}

/**
 * [#33153] Where the extension walk locates a cycle member an
 * `objectExtensions` entry adds to `target`: each field name an entry adds,
 * mapped to that entry's location for it
 * (`object 'T' · objectExtensions[0] · field 'f' expression`, the location
 * the field-formula pass gives the same field). `entries` are the target's
 * entries in fold order (`objectExtensionsByTarget`), so a name two entries
 * add is located at the later one, the definition the registry serves. A
 * name in `left` is left out: the caller's names whose member is located
 * elsewhere. The build passes the names the authored target declares (the
 * object walk locates those at the object, so a cycle closing through a
 * declared formula keeps that location); the `object_extension` door passes
 * none, since it judges the written entry's own definition of every name the
 * entry adds, over everything the target served before the write.
 */
export function extensionFormulaLoci(
  target: string,
  entries: ReadonlyArray<{ path: string; fields: readonly AnyRec[] }>,
  left: ReadonlySet<string>,
): Map<string, string> {
  const loci = new Map<string, string>();
  for (const entry of entries) {
    for (const field of entry.fields) {
      const name = field.name;
      if (typeof name !== 'string' || left.has(name)) continue;
      loci.set(name, `object '${target}' · ${entry.path} · field '${name}' expression`);
    }
  }
  return loci;
}
