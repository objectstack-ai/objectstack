/**
 * ObjectUI — SDUI tree validation against the registry manifest (ADR-0080 §3/§6)
 *
 * Shallow, author-time validation: unknown component, unknown/missing prop,
 * wrong coarse type, illegal enum value. Collects `requires` (plugin provenance)
 * and binding sites the SERVER must resolve against object schema (we cannot
 * resolve objects/fields here — that check is framework-side by design).
 */

import type {
  Diagnostic,
  Manifest,
  ManifestInput,
  ManifestInputType,
  SchemaElement,
  SchemaNode,
  ValidationResult,
} from './types.js';
import { inputTypeArms } from './input-type.js';

/** Base props every node may carry (mirrors BaseSchema) — never "unknown prop". */
const BASE_PROPS = new Set([
  'type',
  'id',
  'className',
  'style',
  'visible',
  'visibleOn',
  'disabled',
  'disabledOn',
  'children',
]);

const isExpr = (v: unknown): boolean =>
  typeof v === 'object' && v !== null && '$expr' in (v as Record<string, unknown>);

export function validateTree(tree: SchemaElement | null, manifest: Manifest): ValidationResult {
  const diagnostics: Diagnostic[] = [];
  const requires = new Set<string>();
  const bindings: ValidationResult['bindings'] = [];

  const visit = (node: SchemaNode): void => {
    if (typeof node === 'string') return;
    const comp = manifest.components[node.type];
    if (!comp) {
      diagnostics.push({
        severity: 'error',
        code: 'unknown-component',
        message: `<${node.type}> is not a known component`,
        tag: node.type,
      });
    } else {
      if (comp.namespace) requires.add(comp.namespace);
      const byName = new Map(comp.inputs.map((i) => [i.name, i]));

      // required present?
      for (const input of comp.inputs) {
        if (input.required && !(input.name in node)) {
          diagnostics.push({
            severity: 'error',
            code: 'missing-required-prop',
            message: `<${node.type}> is missing required prop "${input.name}"`,
            tag: node.type,
          });
        }
      }

      // each provided prop
      for (const [key, value] of Object.entries(node)) {
        if (BASE_PROPS.has(key)) continue;
        const input = byName.get(key);
        if (!input) {
          diagnostics.push({
            severity: 'warning',
            code: 'unknown-prop',
            message: `<${node.type}> has no prop "${key}"`,
            tag: node.type,
          });
          continue;
        }
        if (input.binding) {
          bindings.push({ tag: node.type, input: key, kind: input.binding, value });
        }
        if (isExpr(value)) {
          // A braced value that failed JSON materialization compiled to the
          // parser's deferred `{ $expr }` marker — and NOTHING downstream
          // evaluates that marker: this tier parses, never executes
          // (ADR-0080), and no renderer consumes `$expr`. The value therefore
          // reaches the renderer as an opaque object, every defensive
          // non-array/non-object read degrades it to "not declared", and the
          // author's binding silently vanishes (objectui#6598: eight `columns`
          // spellings on a data block, all eaten without a single diagnostic —
          // rows rendered, zero data columns). ADR-0078 prohibits exactly this
          // parsed-but-silently-inert state, so name it at compile time, with
          // the fix in the message. Warning, not error, per the objectui#5709
          // precedent for inert authored keys — escalation to error (and any
          // widening of the accepted literal grammar, e.g. single-quoted
          // strings) is a contract decision tracked on objectui#6598.
          //
          // LOCKSTEP: this diagnostic is the byte-equal port of objectui's
          // `packages/sdui-parser` copy (objectui PR #6613). The two copies
          // must agree on the accepted grammar AND on diagnostic codes — if
          // they drift, the save gate and the renderer speak different
          // dialects and a page can save clean and render inert. Change this
          // block only together with the objectui copy.
          diagnostics.push({
            severity: 'warning',
            code: 'inert-expression',
            message:
              `<${node.type}> prop "${key}" is a braced expression this tier never evaluates — ` +
              `the value will be silently ignored at render. Write it as JSON ` +
              `(double-quoted strings and keys), e.g. columns={["name","amount"]} not columns={['name','amount']}`,
            tag: node.type,
          });
        } else {
          const typeDiag = checkType(node.type, input, value);
          if (typeDiag) diagnostics.push(typeDiag);
        }
      }

      // containment
      if (node.children?.length && !comp.isContainer) {
        diagnostics.push({
          severity: 'warning',
          code: 'not-a-container',
          message: `<${node.type}> does not accept children`,
          tag: node.type,
        });
      }
    }

    if (node.children) node.children.forEach(visit);
  };

  if (tree) visit(tree);
  return { diagnostics, requires: [...requires], bindings };
}

/* LOCKSTEP: everything below this line is the byte-equal port of objectui's
 * `packages/sdui-parser` coarse type check (objectui#3832 — union-typed inputs
 * are checked over their arms). The two copies must agree on the accepted
 * grammar AND on diagnostic codes/severities — if they drift, the save gate
 * and the renderer speak different dialects. Change these functions only
 * together with the objectui copy. */

/** The values an `enum` arm admits, flattened from either declaration form. */
const enumValues = (input: ManifestInput): unknown[] =>
  (input.enum ?? []).map((e) => (typeof e === 'object' ? e.value : e));

/**
 * Does ONE coarse arm accept this value?
 *
 * An arm outside the vocabulary — and `'slot'`, which describes a child
 * position rather than a value — accepts everything, preserving the old
 * `default: return null` branch: those inputs never drew a diagnostic and must
 * not start now.
 */
function armAccepts(arm: ManifestInputType, input: ManifestInput, value: unknown): boolean {
  switch (arm) {
    case 'number':
      return typeof value === 'number';
    case 'boolean':
      return typeof value === 'boolean';
    case 'string':
    case 'color':
    case 'date':
    case 'code':
    case 'file':
      return typeof value === 'string';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'enum':
      return enumValues(input).includes(value as never);
    default:
      return true;
  }
}

/** How one arm is named in a diagnostic message. */
function armExpectation(arm: ManifestInputType, input: ManifestInput): string {
  switch (arm) {
    case 'number':
      return 'a number';
    case 'boolean':
      return 'a boolean';
    case 'array':
      return 'an array';
    case 'object':
      return 'an object';
    case 'enum':
      return `one of ${JSON.stringify(enumValues(input))}`;
    default:
      return 'a string';
  }
}

/**
 * Coarse type check, over the arms an input declares (objectui#3832).
 *
 * ANY arm accepting the value clears the prop — that is what lets a key whose
 * contract is a union (`string | number`, or a string plus an inline
 * translation map) be declared honestly instead of picking one arm and having
 * this function report the other arm's legal values.
 *
 * When NO arm accepts it the prop is still reported; a union widens what counts
 * as legal, it does not turn the check off. Two properties of the reporting are
 * deliberate:
 *
 *  - A single-arm input produces the byte-identical diagnostic it always did,
 *    `invalid-enum` included. This change adds a form; it does not restate the
 *    old one.
 *  - A multi-arm input produces ONE diagnostic naming every arm, at the
 *    STRICTEST arm's severity — `error` when an `enum` arm is present, because
 *    an enum's closed list is the one fact this layer can be certain about, and
 *    a value outside it should not become dismissible merely because a second
 *    arm was added next to it. Its code is `type-mismatch` (not `invalid-enum`)
 *    since the reported fact is "fits none of the declared arms", and the
 *    message carries the allowed values so the author still sees the list.
 */
function checkType(tag: string, input: ManifestInput, value: unknown): Diagnostic | null {
  const arms = inputTypeArms(input.type);
  if (arms.length === 0) return null;
  if (arms.some((arm) => armAccepts(arm, input, value))) return null;

  if (arms.length === 1 && arms[0] === 'enum') {
    return {
      severity: 'error',
      code: 'invalid-enum',
      message: `<${tag}> prop "${input.name}"=${JSON.stringify(value)} is not one of ${JSON.stringify(enumValues(input))}`,
      tag,
    };
  }

  return {
    severity: arms.includes('enum') ? 'error' : 'warning',
    code: 'type-mismatch',
    message: `<${tag}> prop "${input.name}" expected ${arms
      .map((arm) => armExpectation(arm, input))
      .join(' or ')}`,
    tag,
  };
}
