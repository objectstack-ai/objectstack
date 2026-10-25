/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Spec-vocabulary detector for `objectui validate` (#3090).
 *
 * `{ field: 'x' }` inside a standalone `type: 'form'` component is the spec
 * form-VIEW vocabulary (an object-field reference) — a different layer from
 * the runtime vocabulary this CLI validates (`name` = form data path). The
 * zod error for it ("name: expected string, received undefined") reads as an
 * instruction to bolt a `name` on, which converts the metadata WRONGLY: an
 * agent following it loses the object-schema merge the spec shape stands for.
 * This detector lets the CLI say what actually happened and what the real fix
 * is. The error message is the prompt the next agent executes — it has to
 * point at the boundary, not at the symptom.
 *
 * Scope is deliberately exact: only `fields` arrays hanging DIRECTLY off a
 * `type: 'form'` node. Section fields (`type: 'object-form'` → `sections[]`)
 * legitimately accept the spec shape — `normalizeSectionField` translates
 * them — and a runtime FormField's `field` key legitimately holds the
 * resolved metadata OBJECT, so only a STRING `field` marks the spec shape.
 */

export interface SpecVocabularyFinding {
  /** JSON-ish path to the entry, e.g. `children[0].fields[2]`. */
  path: string;
  /** The spec `field` value (the referenced object field). */
  field: string;
  /** Set when the entry ALSO carries a runtime `name` (mixed vocabularies). */
  mixedName?: string;
}

export function findSpecVocabularyFormFields(
  node: unknown,
  path = '',
): SpecVocabularyFinding[] {
  if (Array.isArray(node)) {
    return node.flatMap((child, i) => findSpecVocabularyFormFields(child, `${path}[${i}]`));
  }
  if (node === null || typeof node !== 'object') return [];

  const record = node as Record<string, unknown>;
  const findings: SpecVocabularyFinding[] = [];

  if (record.type === 'form' && Array.isArray(record.fields)) {
    record.fields.forEach((f, i) => {
      if (f && typeof f === 'object' && typeof (f as any).field === 'string') {
        const name = (f as any).name;
        findings.push({
          path: `${path ? `${path}.` : ''}fields[${i}]`,
          field: (f as any).field,
          ...(typeof name === 'string' ? { mixedName: name } : {}),
        });
      }
    });
  }

  for (const [key, value] of Object.entries(record)) {
    // The entries themselves were just inspected; don't re-walk them as
    // generic children or each finding would double-report.
    if (record.type === 'form' && key === 'fields') continue;
    findings.push(
      ...findSpecVocabularyFormFields(value, path ? `${path}.${key}` : key),
    );
  }
  return findings;
}
