// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Detect FREE identifiers in a hook/action handler — names the body references
 * but that are bound neither by the function (params, locals) nor by the JS
 * runtime (globals). The canonical case (#1876, build↔runtime parity) is a
 * handler that calls a **module-scope helper**:
 *
 *   const slugify = (s) => s.toLowerCase();           // module scope
 *   defineStack({ hooks: [{ ..., handler: (ctx) => { ctx.record.slug = slugify(ctx.record.name); } }] });
 *
 * When such a handler is lowered to a metadata-only `body`, the `slugify`
 * reference ships without its definition and throws `ReferenceError` at runtime
 * — `objectstack build` is green but the app does not boot. By reporting the
 * free identifier the caller can keep the handler OUT of the body-only form and
 * fall back to BUNDLING it (esbuild bundles the real closure, so `slugify` comes
 * along) — no ReferenceError, no build break.
 *
 * Safety bias, and the one direction it does NOT hold. `bindings`
 * over-approximates (every name declared ANYWHERE in the function counts as
 * bound), which biases toward NOT flagging — safe, because a false positive
 * only ever costs a self-contained handler a bundle instead of an inline
 * (size/over-caution), never correctness.
 *
 * The AMBIENT-NAME allowlist used to be described the same way, and that was
 * the defect: "assume the runtime has it" is only conservative for names the
 * runtime being assumed about actually has. The lowered body's runtime is the
 * QuickJS sandbox, not the Node process that runs `objectstack build` — and the
 * allowlist named globals (`Intl` the reported one) that Node has and the
 * sandbox does not. Not flagging those did not preserve behaviour: it lowered a
 * body that throws `ReferenceError` in production while `validate`, `typecheck`,
 * `test` and `build` all stay green, because the in-process test runs the RAW
 * function in Node, where the global exists. So the allowlist is now two sets —
 * {@link SANDBOX_GLOBALS}, whose membership is MEASURED inside the sandbox, and
 * {@link NODE_ONLY_GLOBALS}, the host-only remainder, which is REPORTED as free
 * so the handler falls back to the bundle (where it runs in Node and works).
 */

// `ts-morph` is already a CLI runtime dependency and re-exports the full
// TypeScript compiler namespace, so we use its `ts` rather than adding a direct
// `typescript` dependency.
import { ts } from 'ts-morph';

/**
 * Identifiers the HOOK SANDBOX provides ambiently — the allowlist proper.
 *
 * ⛔ MEMBERSHIP IS MEASURED, NEVER RECALLED. Every name here was read out of the
 * shipped QuickJS build by `sandbox-globals-probe.test.ts`, which evaluates a
 * `typeof`/`in globalThis` probe for each member INSIDE the same
 * `QuickJSScriptRunner` the runtime evaluates a lowered body in, and fails if
 * this set is not exactly the probe's present-set. That pin is what keeps the
 * split honest: a name added here from memory reddens it.
 *
 * `undefined` is in this set on the `in globalThis` limb, not the `typeof` one —
 * `typeof undefined` is the string `'undefined'` for a global that genuinely
 * exists, so a typeof-only probe would have called the one global whose VALUE is
 * undefined absent. The probe asks both questions for that reason.
 */
export const SANDBOX_GLOBALS: ReadonlySet<string> = new Set([
  // Value/namespace globals
  'Math', 'JSON', 'Date', 'Object', 'Array', 'String', 'Number', 'Boolean',
  'RegExp', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise', 'Symbol', 'BigInt',
  'Function', 'Reflect', 'Proxy',
  'ArrayBuffer', 'SharedArrayBuffer', 'DataView',
  'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array',
  'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array',
  // Error constructors
  'Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError',
  'EvalError', 'URIError', 'AggregateError',
  // Global functions
  'parseInt', 'parseFloat', 'isNaN', 'isFinite',
  'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI',
  // Literal-ish globals
  'undefined', 'NaN', 'Infinity', 'globalThis',
]);

/**
 * Identifiers the NODE HOST provides that the sandbox does NOT — measured
 * absent by the same probe, from the same allowlist this file used to hold as
 * one generous list.
 *
 * A free reference to one of these is REPORTED (`FreeIdentifierResult.nodeOnly`)
 * rather than waved through, and {@link detectFreeIdentifiers}'s caller turns it
 * into a lowering refusal that names the identifier and the remedy. The refusal
 * is the SAFE direction and costs nothing an author can lose: `lowerCallables`
 * catches it and ships the handler through the `.mjs` bundle, which runs
 * in-process in Node, where these names are real. What changes is that the
 * platform stops emitting a `body.source` it knows cannot run.
 *
 * ⛔ This set is NOT a wish-list for sandbox capabilities. Moving a name out of
 * it means the shipped QuickJS build gained the global — a runtime change,
 * measured by the probe, never an edit here.
 */
export const NODE_ONLY_GLOBALS: ReadonlySet<string> = new Set([
  // ECMA-402. Standard in every browser and in Node; absent from this QuickJS
  // build. The name the defect was reported under.
  'Intl',
  // Host/Web platform additions, not ECMAScript. QuickJS is the language, not
  // the platform — nothing installs these into the VM.
  'structuredClone', 'queueMicrotask', 'atob', 'btoa',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder',
  // `console` is a HOST object, and the sandbox deliberately routes logging
  // through the capability-gated `ctx.log` instead — see `buildBodyLogSurface`
  // in the runtime's body runner. A lowered body calling `console.log` throws.
  'console',
  // The one member that is not a global at all: `arguments` is an implicit
  // binding of ordinary function scope, and the runner wraps a lowered body in
  // an ARROW (`(async (ctx) => { … })(ctx)`), which provides none. It measures
  // absent for a different reason than the rest and is refused for the same
  // one — a body naming it throws where the raw `function (ctx) {…}` handler,
  // run in-process, does not.
  'arguments',
]);

export interface FreeIdentifierResult {
  /**
   * Sorted, de-duplicated names the handler references and NOTHING in the
   * lowered body's world binds — module-scope helpers/imports/consts AND the
   * {@link NODE_ONLY_GLOBALS} the sandbox does not provide. Empty when the
   * handler really is self-contained inside the sandbox.
   */
  free: string[];
  /**
   * The subset of {@link free} that the Node HOST provides but the sandbox does
   * not. Carried separately because the two halves have opposite remedies: a
   * module-scope name can be inlined into the handler, a host-only global
   * cannot be inlined at all and needs a string handler ref or a validation
   * rule. Callers that flatten this back into one list re-create the paragraph
   * of English this field exists to replace.
   */
  nodeOnly: string[];
  /** True when the source could not be parsed into a single function node. */
  unparsed: boolean;
}

/**
 * Parse `rawFunctionSource` (the result of `String(fn)`) into a single
 * function-like node. Handlers come in three `.toString()` shapes — arrow,
 * function expression/declaration, and object-method shorthand — so we try
 * three wraps and take the first that yields exactly one function-like node.
 */
function parseFunction(rawFunctionSource: string): ts.FunctionLikeDeclarationBase | null {
  const wraps = [
    rawFunctionSource, // function decl / named function expression statement
    `(${rawFunctionSource})`, // arrow / anonymous function expression
    `({${rawFunctionSource}})`, // object-method shorthand `name(ctx){...}`
  ];
  for (const code of wraps) {
    const sf = ts.createSourceFile('__handler__.js', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    let found: ts.FunctionLikeDeclarationBase | null = null;
    let count = 0;
    const visit = (node: ts.Node): void => {
      if (
        ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isMethodDeclaration(node)
      ) {
        count += 1;
        if (!found) found = node;
        return; // don't descend — nested functions are part of THIS one's body
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(sf, visit);
    // Exactly one top-level function-like node means the wrap matched cleanly.
    if (found && count === 1) return found;
  }
  return null;
}

/** Collect every binding name declared ANYWHERE within `fn` (over-approx). */
function collectBindings(fn: ts.FunctionLikeDeclarationBase): Set<string> {
  const bound = new Set<string>();

  const addBindingName = (name: ts.BindingName | ts.PropertyName | undefined): void => {
    if (!name) return;
    if (ts.isIdentifier(name)) {
      bound.add(name.text);
    } else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
      for (const el of name.elements) {
        if (ts.isBindingElement(el)) addBindingName(el.name);
      }
    }
  };

  const walk = (node: ts.Node): void => {
    if (ts.isParameter(node)) {
      addBindingName(node.name);
    } else if (ts.isVariableDeclaration(node)) {
      addBindingName(node.name);
    } else if (ts.isFunctionDeclaration(node) && node.name) {
      bound.add(node.name.text);
    } else if (ts.isClassDeclaration(node) && node.name) {
      bound.add(node.name.text);
    } else if (
      (ts.isFunctionExpression(node) || ts.isClassExpression(node)) &&
      node.name
    ) {
      // A named function/class expression binds its own name in its body.
      bound.add(node.name.text);
    } else if (ts.isCatchClause(node) && node.variableDeclaration) {
      addBindingName(node.variableDeclaration.name);
    } else if (ts.isBindingElement(node)) {
      addBindingName(node.name);
    }
    ts.forEachChild(node, walk);
  };

  // The function's own name (named function decl/expr) is in scope within it.
  if (
    (ts.isFunctionDeclaration(fn) || ts.isFunctionExpression(fn)) &&
    fn.name
  ) {
    bound.add(fn.name.text);
  }
  for (const p of fn.parameters) addBindingName(p.name);
  if (fn.body) walk(fn.body);
  // Parameter default initializers may declare nothing but reference things —
  // covered by the reference pass. Destructuring defaults are bindings:
  for (const p of fn.parameters) ts.forEachChild(p, walk);

  return bound;
}

/**
 * Collect identifiers used in VALUE position (potential references). Excludes
 * the false-positive sources: property-access member names, non-shorthand
 * object/class member keys, and statement labels. Binding names that slip
 * through are harmless — they are subtracted via `bindings` downstream.
 */
function collectReferences(fn: ts.FunctionLikeDeclarationBase): Set<string> {
  const refs = new Set<string>();

  const walk = (node: ts.Node): void => {
    // Skip type annotations entirely (compiled JS rarely has them, but be safe).
    if (ts.isTypeNode(node)) return;

    if (ts.isPropertyAccessExpression(node)) {
      // `a.b` — visit `a` (could be a ref) but NOT `b` (member name).
      walk(node.expression);
      return;
    }
    if (ts.isQualifiedName(node)) {
      walk(node.left);
      return;
    }
    if (ts.isPropertyAssignment(node)) {
      // `{ key: value }` — `key` is not a ref (unless computed). Visit value;
      // visit computed key names.
      if (ts.isComputedPropertyName(node.name)) walk(node.name.expression);
      walk(node.initializer);
      return;
    }
    if (ts.isMethodDeclaration(node) || ts.isPropertyDeclaration(node) || ts.isGetAccessor(node) || ts.isSetAccessor(node)) {
      if (node.name && ts.isComputedPropertyName(node.name)) walk(node.name.expression);
      ts.forEachChild(node, (c) => { if (c !== node.name) walk(c); });
      return;
    }
    if (ts.isLabeledStatement(node)) {
      // The label identifier is not a reference; visit the statement body.
      walk(node.statement);
      return;
    }
    if (ts.isBreakOrContinueStatement(node)) {
      return; // label, if any, is not a value reference
    }
    if (ts.isShorthandPropertyAssignment(node)) {
      // `{ x }` — x IS a value reference.
      refs.add(node.name.text);
      return;
    }
    if (ts.isIdentifier(node)) {
      refs.add(node.text);
      return;
    }
    ts.forEachChild(node, walk);
  };

  if (fn.body) walk(fn.body);
  // Parameter DEFAULT initializers are evaluated in scope and may reference
  // free identifiers; include them (their binding names are excluded above).
  for (const p of fn.parameters) {
    if (p.initializer) walk(p.initializer);
  }
  return refs;
}

/**
 * Compute the free identifiers of a handler function source.
 * Returns `{ free: [], nodeOnly: [], unparsed: true }` when the source can't be
 * parsed — the caller treats "unparsed" as "don't block extraction"
 * (conservative).
 */
export function detectFreeIdentifiers(rawFunctionSource: string): FreeIdentifierResult {
  const fn = parseFunction(rawFunctionSource);
  if (!fn) return { free: [], nodeOnly: [], unparsed: true };

  const bound = collectBindings(fn);
  const refs = collectReferences(fn);

  const free: string[] = [];
  const nodeOnly: string[] = [];
  for (const name of refs) {
    if (bound.has(name)) continue;
    // Only the SANDBOX set waives a name. A `NODE_ONLY_GLOBALS` member falls
    // through to `free` on purpose — that is the whole fix — and is ALSO
    // recorded in `nodeOnly` so the refusal can name the right remedy.
    if (SANDBOX_GLOBALS.has(name)) continue;
    free.push(name);
    if (NODE_ONLY_GLOBALS.has(name)) nodeOnly.push(name);
  }
  free.sort();
  nodeOnly.sort();
  return { free, nodeOnly, unparsed: false };
}
