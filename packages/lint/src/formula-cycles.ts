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
 * the reader the engine's plan uses. A source the reader cannot parse names no
 * reads here; the expression pass refuses it on its own.
 */
import { analyzeRelationshipTraversals, formulaReadOrder } from '@objectstack/formula';

type AnyRec = Record<string, unknown>;

/** One formula on a cycle: the field, its CEL source, and the sentence naming the cycle. */
export interface FormulaCycleFinding {
  field: string;
  source: string;
  message: string;
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
 * Every formula field of one object that sits on a cycle of formulas, in the
 * order `fields` lists them. `fields` are the object's fields by name, as
 * served (an `objectExtensions` field included, so a cycle through one is
 * seen); only the names in `report` get a finding, so the caller locates each
 * on a field its own walk names.
 */
export function formulaCycleFindings(
  fields: ReadonlyMap<string, AnyRec>,
  report: ReadonlySet<string>,
): FormulaCycleFinding[] {
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
    reads.set(name, analysis ? [...analysis.bareFields].filter((read) => sources.has(read)) : []);
  }
  const { cycles } = formulaReadOrder(reads);
  const findings: FormulaCycleFinding[] = [];
  for (const [field, source] of sources) {
    const message = cycles.get(field);
    if (message !== undefined && report.has(field)) findings.push({ field, source, message });
  }
  return findings;
}
