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
  SchemaElement,
  SchemaNode,
  ValidationResult,
} from './types.js';

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

function checkType(tag: string, input: ManifestInput, value: unknown): Diagnostic | null {
  const mismatch = (expected: string): Diagnostic => ({
    severity: 'warning',
    code: 'type-mismatch',
    message: `<${tag}> prop "${input.name}" expected ${expected}`,
    tag,
  });
  switch (input.type) {
    case 'number':
      return typeof value === 'number' ? null : mismatch('a number');
    case 'boolean':
      return typeof value === 'boolean' ? null : mismatch('a boolean');
    case 'string':
    case 'color':
    case 'date':
    case 'code':
    case 'file':
      return typeof value === 'string' ? null : mismatch('a string');
    case 'array':
      return Array.isArray(value) ? null : mismatch('an array');
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? null
        : mismatch('an object');
    case 'enum': {
      const allowed = (input.enum ?? []).map((e) => (typeof e === 'object' ? e.value : e));
      return allowed.includes(value as never)
        ? null
        : {
            severity: 'error',
            code: 'invalid-enum',
            message: `<${tag}> prop "${input.name}"=${JSON.stringify(value)} is not one of ${JSON.stringify(allowed)}`,
            tag,
          };
    }
    default:
      return null;
  }
}
