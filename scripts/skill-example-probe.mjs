// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * skill-example-probe — would a SCHEMA check over the published skills'
 * example blocks have caught the teaching errors people found by hand?
 * (#22059, ruling B, step ① — the probe and its readings, NOT the gate.)
 *
 *   node scripts/check-corpus-claim-drift.mjs --probe-examples          # the readings
 *   node scripts/check-corpus-claim-drift.mjs --probe-examples --json F # also write them to F
 *
 * ⛔ THIS IS A MEASUREMENT INSTRUMENT, NOT A GATE. `--probe-examples` exits 0
 * on any reading, is wired into no `check:*` script, no workflow and no
 * baseline, and nothing fails because of what it reports. Whether its
 * validation joins `check-corpus-claim-drift`'s CI step is step ② of the
 * ruling, conditional on the hit rate this instrument reports. It exits
 * non-zero for exactly one reason: THE INSTRUMENT COULD NOT RUN (no spec
 * build, a spec build older than its sources, or a fix commit this clone does
 * not hold) — a census that silently degrades to "0 reds" is the worst output.
 * Its pure halves (extractor, transform, mapping, judge, hit/miss classifier)
 * are exercised by `check-corpus-claim-drift.mjs --self-test`, which drives
 * them with synthetic schemas so the self-test needs no build.
 *
 * ## Population
 *
 * Every `*.md` under `skills/objectstack-*` — SKILL.md, `rules/`,
 * `references/`, `guides/` — EXCEPT anything under an `evals/` directory (those
 * are prompt/expected pairs, not examples). Every fenced block whose opener's
 * first info-string token is one of LANG_FAMILY's keys is in the population;
 * every other fence (bash, js, md, none) is counted in the census as OTHER so
 * the population's edge is a number, not a silence. `jsonc` is admitted beside
 * the dispatched `json`/`json5` as JSON-with-comments and reported on its own
 * row so a reader can subtract it.
 *
 * ## Transform — what a fence becomes before a schema can judge it
 *
 * TypeScript and JSON fences are parsed with the TypeScript compiler's parser
 * (never executed) and object/array literals are STATICALLY EVALUATED; YAML
 * fences go through `yaml`. The supported shapes, by name:
 *
 *   factory-call    `defineX({...})` anywhere in the fence (outermost only)
 *   create-call     `X.create({...})`, `XSchema.parse({...})`
 *   typed-literal   `const a: T = {...}`, `{...} satisfies T`, `{...} as T`
 *   property-list   a fragment of `key: value` members (`where: {...}`) —
 *                   read by wrapping the body in an object literal
 *   bare-literal    a fragment that IS one object/array literal (`{...}`)
 *   yaml-doc        each YAML document
 *
 * Inside a literal: same-fence `const` bindings are followed; `Field.<kind>(…)`
 * is called for real on the spec's own pure helper; everything else that is not
 * a literal (a call, a function, a template with substitutions, a property
 * access, an identifier bound outside the fence) is OPAQUE. An opaque value is
 * never guessed at — every schema issue AT, UNDER or ABOVE an opaque node is
 * suppressed and counted (an `unrecognized_keys` issue survives an opaque
 * child: the key names are literal), and an object with a spread or computed
 * key forgives a missing required key. A fence none of the shapes reads is a
 * COVERAGE MISS with a reason (`syntax`, `no-candidate`, `unmapped`,
 * `ambiguous-owner`, `factory-unknown`) — counted and listed, never skipped.
 *
 * ## Mapping — which schema judges which example
 *
 * In order: (1) the code's own claim — the factory or constructor it calls,
 * or the type it is annotated with (FACTORY_TARGETS; a type `T` → the exported
 * `TSchema`); (2) an explicit `os:check-yaml <decl>` marker; (3) for a fragment,
 * KEY OWNERSHIP — the one registry metadata type (or the stack) whose object
 * shape declares every top-level key; zero or several owners is a coverage
 * miss. A fragment is judged PARTIALLY: each present key against that key's
 * own member schema, so an omitted required key is never a red there. Headings
 * are not used: they name topics, not shapes.
 *
 * ## Verdicts kept apart
 *
 *   STRUCTURAL RED   the schema refuses what was read: `unrecognized_keys`
 *                    (a wrong or retired key), `invalid_type`/`invalid_union`
 *                    (wrong nesting or shape), `invalid_value`, `too_small`, a
 *                    refinement (`custom`) — reported per Zod code.
 *   COVERAGE MISS    the transform could not produce a judgeable value.
 *
 * ## The replay (REPLAY_SET)
 *
 * For each card, the fix commit's `skills/objectstack-*` markdown is read at the
 * commit's parent (BEFORE) and at the commit (AFTER) from the local object
 * store — zero API quota — and both sides are judged by the CURRENT tree's
 * schemas. A fence is TOUCHED when its body is not found verbatim on the other
 * side. HIT = a structural issue on a touched BEFORE fence whose signature
 * (mapping, Zod code, path with indices folded, keys) no touched AFTER fence
 * carries. Every miss is classed (REPLAY_MISS_CLASSES). Judging both sides by
 * today's schemas is a stated bias, in both directions: a schema that moved
 * after the fix can turn an AFTER red ("flagged in both"), and an error that
 * was only an error relative to a later spec change can read as a HIT.
 */

import { readdirSync, readFileSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { parseSourceFile, parseDerivedText } from './ts-parse.mjs';

// ── Population ─────────────────────────────────────────────────────────────

export const PROBE_ROOT = 'skills';
export const PROBE_SKILL_DIR_RE = /^objectstack-/;
/** A directory name never descended into: fixtures, not examples. */
export const PROBE_SKIP_DIRS = Object.freeze(['evals']);

/** Fence opener language (first info-string token, lower-cased) → family. */
export const LANG_FAMILY = Object.freeze({
  ts: 'ts', typescript: 'ts', tsx: 'ts',
  json: 'json', json5: 'json', jsonc: 'json',
  yaml: 'yaml', yml: 'yaml',
});

/** The marker line directly above a fence, as `check-yaml-examples` / `check-skill-examples` spell it. */
const MARKER_RE = /^<!--\s*(os:check(?:-yaml)?)\b\s*(.*?)\s*-->$/;

/**
 * Every fenced block in a markdown text, CommonMark-shaped: a backtick or tilde
 * run of three or more opens; only a run of the SAME character at least as long,
 * alone on its line, closes — so a ```ts shown inside a ````md illustration
 * opens nothing. Indentation (a fence inside a list item) is stripped from the
 * body up to the opener's own indent. An unclosed fence runs to end of text and
 * is flagged.
 *
 * @param {string} text
 * @returns {Array<{line:number,endLine:number,indent:number,info:string,lang:string,
 *   family:string|null,body:string,heading:string|null,marker:{kind:string,decl:string}|null,unclosed:boolean}>}
 */
export function extractFences(text) {
  const lines = text.split('\n');
  const out = [];
  let open = null;
  let heading = null;
  let prevNonBlank = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (open) {
      const close = /^(\s*)(`{3,}|~{3,})\s*$/.exec(line);
      if (close && close[2][0] === open.char && close[2].length >= open.len) {
        open.endLine = i + 1;
        out.push(finishFence(open));
        open = null;
        prevNonBlank = '';
        continue;
      }
      open.body.push(stripIndent(line, open.indent));
      continue;
    }
    const opener = /^(\s*)(`{3,}|~{3,})(.*)$/.exec(line);
    if (opener && !(opener[2][0] === '`' && opener[3].includes('`'))) {
      const info = opener[3].trim();
      const lang = (info.split(/\s+/)[0] || '').replace(/^\{?\.?/, '').replace(/\}$/, '').toLowerCase();
      const m = MARKER_RE.exec(prevNonBlank.trim());
      const markerIsAdjacent = i > 0 && lines[i - 1].trim() === prevNonBlank.trim() && prevNonBlank.trim() !== '';
      open = {
        line: i + 1, endLine: -1, indent: opener[1].length, char: opener[2][0], len: opener[2].length,
        info, lang, body: [], heading,
        marker: m && markerIsAdjacent ? { kind: m[1], decl: m[2] } : null,
      };
      continue;
    }
    const h = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) heading = h[2];
    if (line.trim() !== '') prevNonBlank = line;
  }
  if (open) {
    open.unclosed = true;
    open.endLine = lines.length;
    out.push(finishFence(open));
  }
  return out;
}

function stripIndent(line, indent) {
  let n = 0;
  while (n < indent && line[n] === ' ') n++;
  return line.slice(n);
}

function finishFence(f) {
  return {
    line: f.line, endLine: f.endLine, indent: f.indent, info: f.info, lang: f.lang,
    family: Object.hasOwn(LANG_FAMILY, f.lang) ? LANG_FAMILY[f.lang] : null,
    body: f.body.join('\n'), heading: f.heading, marker: f.marker, unclosed: Boolean(f.unclosed),
  };
}

/** The skill a corpus path belongs to (`skills/objectstack-ui/rules/x.md` → `objectstack-ui`). */
export function skillOf(rel) {
  const parts = rel.split('/');
  return parts[0] === PROBE_ROOT ? parts[1] : null;
}

/** Is this repo-relative path inside the probe population? */
export function inPopulation(rel) {
  const parts = rel.split('/');
  if (parts[0] !== PROBE_ROOT || parts.length < 3) return false;
  if (!PROBE_SKILL_DIR_RE.test(parts[1])) return false;
  if (parts.slice(2, -1).some((d) => PROBE_SKIP_DIRS.includes(d))) return false;
  return rel.endsWith('.md');
}

/** Walk the population on disk, repo-relative POSIX paths, sorted. */
export function probeCorpusFiles(repoRoot) {
  const out = [];
  const root = join(repoRoot, PROBE_ROOT);
  if (!existsSync(root)) return out;
  const walk = (dir) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) {
        if (PROBE_SKIP_DIRS.includes(e)) continue;
        walk(p);
      } else {
        const rel = relative(repoRoot, p).replace(/\\/g, '/');
        if (inPopulation(rel)) out.push(rel);
      }
    }
  };
  for (const e of readdirSync(root)) {
    if (PROBE_SKILL_DIR_RE.test(e) && statSync(join(root, e)).isDirectory()) walk(join(root, e));
  }
  return out.sort();
}

/**
 * Fence census: per skill × opener language, plus the population/other split.
 * Taken by the extractor's regex over openers, never by eye.
 *
 * @param {Array<{rel:string, fences:ReturnType<typeof extractFences>}>} entries
 */
export function fenceCensus(entries) {
  const perSkill = {};
  const totals = {};
  let population = 0;
  let other = 0;
  for (const { rel, fences } of entries) {
    const skill = skillOf(rel);
    perSkill[skill] ??= {};
    for (const f of fences) {
      const key = f.family ? f.lang : `other:${f.lang || '(none)'}`;
      perSkill[skill][key] = (perSkill[skill][key] ?? 0) + 1;
      totals[key] = (totals[key] ?? 0) + 1;
      if (f.family) population++;
      else other++;
    }
  }
  return { perSkill, totals, population, other };
}

// ── Transform: fence → judgeable candidates ────────────────────────────────

/**
 * What each constructor the catalog teaches is judged against. A lower-case
 * target is a metadata TYPE resolved through the spec's own registry
 * (`getMetadataTypeSchema` — what `PUT /api/v1/meta/:type/:name` validates
 * with); a PascalCase target is an exported schema. `arg` picks the argument
 * that carries the literal, `inject` names keys the factory adds itself (judged
 * as opaque), `drop` names keys the factory consumes before parsing.
 *
 * A `define*` call whose name is not a key here is a COVERAGE MISS of reason
 * `factory-unknown` — and, when the spec exports no such factory at all, a
 * candidate teaching error in its own right (the reader copies an import that
 * does not resolve).
 */
export const FACTORY_TARGETS = Object.freeze({
  defineAction: { target: 'action' },
  defineAgent: { target: 'agent' },
  defineApp: { target: 'app' },
  'App.create': { target: 'app' },
  defineBook: { target: 'book' },
  defineCapability: { target: 'capability' },
  defineConnector: { target: 'connector' },
  defineCube: { target: 'analytics_cube' },
  defineDataset: { target: 'dataset' },
  defineDatasource: { target: 'datasource' },
  defineEmailTemplateDefinition: { target: 'email_template' },
  defineFlow: { target: 'flow' },
  defineForm: { target: 'FormViewSchema', inject: ['data'], drop: ['schemaId'] },
  defineHook: { target: 'hook' },
  defineJob: { target: 'job' },
  defineMapping: { target: 'mapping' },
  'ObjectSchema.create': { target: 'object' },
  defineObjectExtension: { target: 'ObjectExtensionSchema' },
  definePage: { target: 'page' },
  definePermissionSet: { target: 'permission' },
  definePicklist: { target: 'picklist' },
  definePosition: { target: 'position' },
  defineReport: { target: 'report' },
  defineSeed: { target: 'seed', arg: 1, inject: ['object'] },
  defineSharingRule: { target: 'sharing_rule' },
  defineSkill: { target: 'skill' },
  defineStack: { target: 'ObjectStackDefinitionSchema' },
  defineTool: { target: 'tool' },
  defineTranslation: { target: 'translation' },
  defineTranslationBundle: { target: 'TranslationBundleSchema' },
  defineView: { target: 'ViewSchema' }, // the container `defineView` parses; the `view` registry entry is the wider union
  defineViewItem: { target: 'ViewItemSchema' },
  defineWebhook: { target: 'webhook' },
});

const FACTORY_RE = /^define[A-Z][A-Za-z0-9]*$/;

/**
 * Type names whose same-named `<T>Schema` in the spec is a DIFFERENT contract,
 * so the annotation must not map to it even when the fence omits its import.
 */
export const TYPE_NOT_A_SPEC_SHAPE = Object.freeze({
  Plugin: 'the kernel\'s runtime plugin contract (`@objectstack/core`), not the `PluginSchema` manifest',
});

/** A fresh set of evaluation marks: paths (arrays of keys/indices) the judge must forgive. */
export function newMarks() {
  return { opaque: [], open: [], computed: [] };
}

function unwrapExpr(ts, node) {
  let n = node;
  while (n && (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n)
    || (ts.isSatisfiesExpression && ts.isSatisfiesExpression(n))
    || (ts.isTypeAssertionExpression && ts.isTypeAssertionExpression(n)))) {
    n = n.expression;
  }
  return n;
}

function propKey(ts, name) {
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)
    || ts.isNoSubstitutionTemplateLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name)) {
    const e = unwrapExpr(ts, name.expression);
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) || ts.isNumericLiteral(e)) return e.text;
  }
  return null;
}

function isNestedFactoryCallee(ts, callee) {
  if (ts.isIdentifier(callee)) return FACTORY_RE.test(callee.text);
  return ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)
    && Object.hasOwn(FACTORY_TARGETS, `${callee.expression.text}.${callee.name.text}`);
}

function markOpaque(ctx, path) {
  ctx.marks.opaque.push(path);
  return undefined;
}

/**
 * Statically evaluate an expression into a plain value, recording what could
 * not be known. Never executes the fence; the one call it makes is the spec's
 * own pure `Field.<kind>` helper, on an argument it has already evaluated.
 */
export function evaluateExpr(ts, raw, ctx, path) {
  const node = unwrapExpr(ts, raw);
  if (!node) return markOpaque(ctx, path);
  const SK = ts.SyntaxKind;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === SK.TrueKeyword) return true;
  if (node.kind === SK.FalseKeyword) return false;
  if (node.kind === SK.NullKeyword) return null;
  if (ts.isPrefixUnaryExpression(node) && node.operator === SK.MinusToken && ts.isNumericLiteral(node.operand)) {
    return -Number(node.operand.text);
  }
  if (ts.isIdentifier(node)) {
    if (node.text === 'undefined') return undefined;
    const bound = ctx.bindings.get(node.text);
    if (bound && !ctx.resolving.has(node.text)) {
      ctx.resolving.add(node.text);
      try {
        return evaluateExpr(ts, bound, ctx, path);
      } finally {
        ctx.resolving.delete(node.text);
      }
    }
    return markOpaque(ctx, path);
  }
  if (ts.isObjectLiteralExpression(node)) {
    const obj = {};
    for (const p of node.properties) {
      if (ts.isSpreadAssignment(p)) {
        const inner = unwrapExpr(ts, p.expression);
        const viaName = ts.isIdentifier(inner) ? inner.text : null;
        const src = viaName ? ctx.bindings.get(viaName) : inner;
        const srcNode = src ? unwrapExpr(ts, src) : null;
        if (srcNode && ts.isObjectLiteralExpression(srcNode) && !(viaName && ctx.resolving.has(viaName))) {
          if (viaName) ctx.resolving.add(viaName);
          try {
            Object.assign(obj, evaluateExpr(ts, srcNode, ctx, path));
          } finally {
            if (viaName) ctx.resolving.delete(viaName);
          }
        } else {
          ctx.marks.open.push(path);
        }
        continue;
      }
      const key = propKey(ts, p.name);
      if (key === null) {
        ctx.marks.computed.push(path);
        ctx.marks.open.push(path);
        continue;
      }
      if (ts.isPropertyAssignment(p)) obj[key] = evaluateExpr(ts, p.initializer, ctx, [...path, key]);
      else if (ts.isShorthandPropertyAssignment(p)) obj[key] = evaluateExpr(ts, p.name, ctx, [...path, key]);
      else obj[key] = markOpaque(ctx, [...path, key]); // a method or accessor: behaviour, not data
    }
    return obj;
  }
  if (ts.isArrayLiteralExpression(node)) {
    const arr = [];
    for (const el of node.elements) {
      if (ts.isSpreadElement(el)) {
        const inner = unwrapExpr(ts, el.expression);
        const src = ts.isIdentifier(inner) ? ctx.bindings.get(inner.text) : inner;
        const srcNode = src ? unwrapExpr(ts, src) : null;
        if (!srcNode || !ts.isArrayLiteralExpression(srcNode) || (ts.isIdentifier(inner) && ctx.resolving.has(inner.text))) {
          // Unknown length: every later index would be a guess, so the array is opaque whole.
          return markOpaque(ctx, path);
        }
        for (const s of srcNode.elements) arr.push(evaluateExpr(ts, s, ctx, [...path, arr.length]));
        continue;
      }
      if (el.kind === SK.OmittedExpression) {
        arr.push(undefined);
        continue;
      }
      arr.push(evaluateExpr(ts, el, ctx, [...path, arr.length]));
    }
    return arr;
  }
  if (ts.isCallExpression(node)) {
    const callee = unwrapExpr(ts, node.expression);
    const field = ctx.helpers?.Field;
    if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === 'Field'
      && field && typeof field[callee.name.text] === 'function') {
      const arg0 = node.arguments[0] ? unwrapExpr(ts, node.arguments[0]) : null;
      if (node.arguments.length <= 1 && (!arg0 || ts.isObjectLiteralExpression(arg0) || ts.isIdentifier(arg0))) {
        const config = arg0 ? evaluateExpr(ts, arg0, ctx, path) : {};
        if (config && typeof config === 'object' && !Array.isArray(config)) {
          try {
            return field[callee.name.text](config);
          } catch {
            return markOpaque(ctx, path);
          }
        }
      }
      // The array-first `Field.select([...], {...})` form rewrites its input; paths would not map.
      return markOpaque(ctx, path);
    }
    if (isNestedFactoryCallee(ts, callee) && node.arguments.length >= 1) {
      const spec = ts.isIdentifier(callee) ? FACTORY_TARGETS[callee.text] : null;
      const argIndex = spec?.arg ?? 0;
      return node.arguments[argIndex] ? evaluateExpr(ts, node.arguments[argIndex], ctx, path) : markOpaque(ctx, path);
    }
    return markOpaque(ctx, path);
  }
  return markOpaque(ctx, path);
}

function typeNameOf(ts, typeNode) {
  if (!typeNode) return null;
  if (ts.isArrayTypeNode(typeNode)) {
    const inner = typeNameOf(ts, typeNode.elementType);
    return inner && !inner.array ? { name: inner.name, array: true } : null;
  }
  if (ts.isTypeReferenceNode(typeNode) && !typeNode.typeArguments) {
    const n = typeNode.typeName;
    const name = ts.isIdentifier(n) ? n.text : n.right.text;
    return name === 'const' ? null : { name, array: false };
  }
  return null;
}

function isLiteralNode(ts, node) {
  const n = unwrapExpr(ts, node);
  return Boolean(n) && (ts.isObjectLiteralExpression(n) || ts.isArrayLiteralExpression(n));
}

/** One judgeable claim inside a parsed fence, or null. */
function candidateOf(ts, node) {
  if (ts.isCallExpression(node)) {
    const callee = unwrapExpr(ts, node.expression);
    if (ts.isIdentifier(callee) && FACTORY_RE.test(callee.text)) {
      const spec = FACTORY_TARGETS[callee.text];
      return { shape: 'factory-call', mapKey: callee.text, valueNode: node.arguments[spec?.arg ?? 0] ?? null };
    }
    if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
      const key = `${callee.expression.text}.${callee.name.text}`;
      if (Object.hasOwn(FACTORY_TARGETS, key)) return { shape: 'create-call', mapKey: key, valueNode: node.arguments[0] ?? null };
      if ((callee.name.text === 'parse' || callee.name.text === 'safeParse') && /Schema$/.test(callee.expression.text)) {
        return { shape: 'create-call', mapKey: `schema:${callee.expression.text}`, valueNode: node.arguments[0] ?? null };
      }
    }
  }
  if (ts.isVariableDeclaration(node) && node.type && node.initializer && isLiteralNode(ts, node.initializer)) {
    const t = typeNameOf(ts, node.type);
    if (t) return { shape: 'typed-literal', mapKey: `type:${t.name}${t.array ? '[]' : ''}`, valueNode: node.initializer };
  }
  if (((ts.isSatisfiesExpression && ts.isSatisfiesExpression(node)) || ts.isAsExpression(node)) && isLiteralNode(ts, node.expression)) {
    const t = typeNameOf(ts, node.type);
    if (t) return { shape: 'typed-literal', mapKey: `type:${t.name}${t.array ? '[]' : ''}`, valueNode: node.expression };
  }
  if (ts.isExportAssignment(node) && isLiteralNode(ts, node.expression)) {
    return { shape: 'bare-literal', mapKey: 'owner', valueNode: node.expression };
  }
  return null;
}

/**
 * Parse a fence body (or a wrapper synthesised around one) through
 * `scripts/ts-parse.mjs` — the one sanctioned door (`check:parse-guard`). A
 * fence is not a file on disk: its text is DERIVED from a markdown host, so it
 * takes the returnable door, `parseDerivedText`, whose origin is a certified
 * carrier module holding that same text as a string literal. A body that does
 * not parse comes back as data and is reported as a COVERAGE MISS of reason
 * `syntax` — never a recovered tree walked as if it were clean.
 */
function parseTs(ts, text, tsx) {
  const origin = parseSourceFile('skill-fence.carrier.ts', `export const fence = ${JSON.stringify(text)};\n`);
  const r = parseDerivedText(origin, tsx ? 'skill-fence.tsx' : 'skill-fence.ts', text);
  return r.failure ? { sf: null, diagnostics: r.failure.rows } : { sf: r.sourceFile, diagnostics: [] };
}

function collectBindings(ts, sf) {
  const bindings = new Map();
  const seen = new Set();
  const visit = (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      if (seen.has(n.name.text)) bindings.delete(n.name.text); // declared twice: no single value
      else bindings.set(n.name.text, n.initializer);
      seen.add(n.name.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return bindings;
}

function collectCandidates(ts, sf) {
  const out = [];
  const visit = (n) => {
    const c = candidateOf(ts, n);
    if (c) {
      out.push(c);
      return; // outermost only: a nested constructor is evaluated in place by its parent's schema
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** The single literal a wrapped fragment parses to, or null. */
function wrappedLiteral(ts, text, tsx) {
  const { sf, diagnostics } = parseTs(ts, text, tsx);
  if (diagnostics.length || sf.statements.length !== 1) return null;
  const st = sf.statements[0];
  if (!ts.isExpressionStatement(st)) return null;
  const e = unwrapExpr(ts, st.expression);
  return e && (ts.isObjectLiteralExpression(e) || ts.isArrayLiteralExpression(e)) ? { sf, node: e } : null;
}

function trimFragment(body) {
  return body.replace(/^\s*export\s+default\s+/, '').replace(/[\s;,]+$/, '');
}

/** Try the two fragment wrappers on one chunk of text. */
function readFragment(ts, text, tsx) {
  const t = trimFragment(text);
  if (t.trim() === '') return null;
  const pl = wrappedLiteral(ts, `({\n${t}\n})`, tsx);
  if (pl) return { shape: 'property-list', ...pl };
  const bl = wrappedLiteral(ts, `(\n${t}\n)`, tsx);
  if (bl) return { shape: 'bare-literal', ...bl };
  return null;
}

/** Split a fence body at blank lines into chunks that each carry code (comment-only chunks dropped). */
function chunksOf(body) {
  return body.split(/\n\s*\n/).filter((c) => c.split('\n').some((l) => l.trim() !== '' && !/^\s*\/\//.test(l)));
}

/** Names a fence imports, → the module it imports them from. */
function collectImports(ts, sf) {
  const out = new Map();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !st.importClause || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    const from = st.moduleSpecifier.text;
    const nb = st.importClause.namedBindings;
    if (st.importClause.name) out.set(st.importClause.name.text, from);
    if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) out.set(el.name.text, from);
  }
  return out;
}

const SPEC_MODULE_RE = /^@objectstack\/spec(\/|$)/;

/**
 * A type annotation names a SPEC shape only when the type is the spec's: a
 * `Plugin` imported from `@objectstack/core` is the kernel's runtime contract,
 * not `PluginSchema`, and judging it against the same-named schema reports
 * the wrong contract.
 */
function foreignTypeKey(candidate, imports) {
  if (candidate.shape !== 'typed-literal') return candidate.mapKey;
  const name = candidate.mapKey.slice(5).replace(/\[\]$/, '');
  const from = imports.get(name);
  return from && !SPEC_MODULE_RE.test(from) ? `foreign:${name} from ${from}` : candidate.mapKey;
}

function judgeableFrom(ts, sf, candidate, helpers, imports = new Map()) {
  const ctx = { bindings: collectBindings(ts, sf), resolving: new Set(), marks: newMarks(), helpers };
  if (!candidate.valueNode) return null;
  const value = evaluateExpr(ts, candidate.valueNode, ctx, []);
  return { shape: candidate.shape, mapKey: foreignTypeKey(candidate, imports), value, marks: ctx.marks };
}

/**
 * Is this text a COUNTER-EXAMPLE — code the catalog shows in order to say it is
 * wrong? Its enclosing heading says so (❌, "Incorrect"), or a comment LINE
 * opens with ❌ and no ✅ appears beside it. A ❌ trailing a property line is not
 * enough: the catalog also writes one to explain a predicate's polarity
 * (`condition: …, // ❌ TRUE = invalid`). A counter-example the schema refuses
 * CONFIRMS the text; one it accepts is a refusal the schema does not back
 * (a semantic ❌, or a claim made about another layer).
 */
export function isCounterExample(text, heading) {
  if (typeof heading === 'string' && /❌|\bincorrect\b/i.test(heading)) return true;
  return /^\s*(\/\/|#)\s*❌/m.test(text) && !text.includes('✅');
}

/**
 * A fence → `{ status, reason?, detail?, items[] }`. `status` is `read` (every
 * part produced a value), `partial` (some chunks did not) or `miss`. Each item
 * is `{ shape, mapKey, value, marks, counter }`; `mapKey` is `owner` for a
 * fragment (resolved by key ownership at mapping time) unless a marker names
 * its schema; `counter` marks a counter-example (`isCounterExample`).
 *
 * @param {{ts:any, yaml?:any, helpers?:{Field?:object}}} deps
 */
export function transformFence(fence, deps) {
  const { ts } = deps;
  const markerDecl = fence.marker?.kind === 'os:check-yaml' && fence.marker.decl ? fence.marker.decl : null;
  const tag = (items, text) => items.map((it) => ({ ...it, counter: isCounterExample(text, fence.heading) }));
  if (fence.family === 'yaml') {
    if (!deps.yaml) return { status: 'miss', reason: 'syntax', detail: 'no yaml parser', items: [] };
    const docs = deps.yaml.parseAllDocuments(fence.body);
    const items = [];
    for (const d of docs) {
      if (d.errors?.length) return { status: 'miss', reason: 'syntax', detail: d.errors[0].message, items: [] };
      const value = d.toJS();
      if (value === null || value === undefined) continue;
      items.push({ shape: 'yaml-doc', mapKey: markerDecl ? `decl:${markerDecl}` : 'owner', value, marks: newMarks() });
    }
    return items.length
      ? { status: 'read', items: tag(items, fence.body) }
      : { status: 'miss', reason: 'no-candidate', detail: 'empty YAML', items: [] };
  }
  const tsx = fence.lang === 'tsx';
  if (fence.family === 'json') {
    const frag = readFragment(ts, fence.body, false);
    if (!frag) return { status: 'miss', reason: 'syntax', detail: 'not a JSON literal', items: [] };
    const j = judgeableFrom(ts, frag.sf, { shape: frag.shape, mapKey: markerDecl ? `decl:${markerDecl}` : 'owner', valueNode: frag.node }, deps.helpers);
    return { status: 'read', items: tag([j], fence.body) };
  }
  if (fence.family !== 'ts') return { status: 'miss', reason: 'out-of-population', items: [] };

  const whole = parseTs(ts, fence.body, tsx);
  const candidates = whole.diagnostics.length ? [] : collectCandidates(ts, whole.sf);
  if (candidates.length) {
    const imports = collectImports(ts, whole.sf);
    const items = candidates.map((c) => judgeableFrom(ts, whole.sf, c, deps.helpers, imports)).filter(Boolean);
    return items.length
      ? { status: 'read', items: tag(items, fence.body) }
      : { status: 'miss', reason: 'no-candidate', detail: 'constructor with no argument', items: [] };
  }
  const frag = readFragment(ts, fence.body, tsx);
  if (frag) {
    const j = judgeableFrom(ts, frag.sf, { shape: frag.shape, mapKey: 'owner', valueNode: frag.node }, deps.helpers);
    return { status: 'read', items: tag([j], fence.body) };
  }
  // Alternatives written one after another ("// ✅ … / // ❌ …"): judge each blank-line chunk.
  const chunks = chunksOf(fence.body);
  const items = [];
  let unread = 0;
  for (const chunk of chunks.length > 1 ? chunks : []) {
    const parsed = parseTs(ts, chunk, tsx);
    const cs = parsed.diagnostics.length ? [] : collectCandidates(ts, parsed.sf);
    if (cs.length) {
      const imports = collectImports(ts, parsed.sf);
      items.push(...tag(cs.map((c) => judgeableFrom(ts, parsed.sf, c, deps.helpers, imports)).filter(Boolean), chunk));
      continue;
    }
    const f = readFragment(ts, chunk, tsx);
    if (f) {
      items.push(...tag([judgeableFrom(ts, f.sf, { shape: f.shape, mapKey: 'owner', valueNode: f.node }, deps.helpers)], chunk));
      continue;
    }
    unread++;
  }
  if (items.length && unread === 0) return { status: 'read', items };
  if (items.length) return { status: 'partial', reason: whole.diagnostics.length ? 'syntax' : 'no-candidate', items };
  if (whole.diagnostics.length) {
    const d = whole.diagnostics[0];
    return { status: 'miss', reason: 'syntax', detail: `${d.line}:${d.column} ${d.message}`, items: [] };
  }
  return { status: 'miss', reason: 'no-candidate', detail: 'parses, but carries no metadata literal', items: [] };
}

// ── Mapping: which schema judges which item ────────────────────────────────

export function isZodSchema(v) {
  return (typeof v === 'object' || typeof v === 'function') && v !== null && typeof v.safeParse === 'function';
}

/** The object shape behind a Zod v4 schema (through pipe/optional/default/lazy), or null. */
export function objectShapeOf(schema) {
  let s = schema;
  for (let i = 0; i < 16 && s; i++) {
    const def = s._zod?.def;
    if (!def) return null;
    switch (def.type) {
      case 'object':
        return def.shape;
      case 'pipe':
        // `z.preprocess(fn, X)` is pipe(transform, X): the shape is the OUT side.
        s = def.in?._zod?.def?.type === 'transform' ? def.out : def.in;
        break;
      case 'lazy':
        s = def.getter();
        break;
      case 'optional': case 'nullable': case 'default': case 'prefault': case 'readonly':
      case 'catch': case 'nonoptional': case 'success':
        s = def.innerType;
        break;
      default:
        return null;
    }
  }
  return null;
}

/**
 * The keys a shape DECLARES for authoring: a member that unwraps to `never` or
 * `undefined` is a tombstone (a key the shape names only to refuse it, e.g. a
 * container key on a list-view item), so it claims no fragment.
 */
export function declaredKeys(shape) {
  return Object.keys(shape).filter((k) => {
    let m = shape[k];
    for (let i = 0; i < 8 && m?._zod?.def; i++) {
      const t = m._zod.def.type;
      if (t === 'never' || t === 'undefined') return false;
      if (!m._zod.def.innerType) return true;
      m = m._zod.def.innerType;
    }
    return true;
  });
}

/** Every object shape behind a schema, a union's options flattened (one level of nesting each). */
export function objectShapesOf(schema, depth = 0) {
  const one = objectShapeOf(schema);
  if (one) return [one];
  if (depth > 3) return [];
  let s = schema;
  for (let i = 0; i < 16 && s; i++) {
    const def = s._zod?.def;
    if (!def) return [];
    if (def.type === 'union') return def.options.flatMap((o) => objectShapesOf(o, depth + 1));
    if (def.type === 'pipe') s = def.in?._zod?.def?.type === 'transform' ? def.out : def.in;
    else if (def.type === 'lazy') s = def.getter();
    else if (def.innerType) s = def.innerType;
    else return [];
  }
  return [];
}

function resolveDecl(name, index) {
  if (/^[a-z][a-z0-9_]*$/.test(name)) {
    const schema = index.registry(name);
    return schema ? { schema, label: name } : { miss: 'unmapped', detail: `\`${name}\` is not a registered metadata type` };
  }
  const r = index.byName(name);
  return r.schema ? { schema: r.schema, label: name } : { miss: 'unmapped', detail: r.error };
}

/**
 * KEY OWNERSHIP, in two tiers.
 *
 *   tier 1  the one registry metadata type (or the stack) whose object shape
 *           declares every top-level key — judged PARTIALLY (each present key
 *           against its own member schema), so an omitted key is never a red;
 *   tier 2  only when tier 1 finds NO owner: the one exported named object
 *           schema whose shape declares every key AND whose required keys are
 *           all present — a complete instance of a sub-schema (a flow node, an
 *           index), judged WHOLE. Several such schemas with one key set are one
 *           declaration under several names; different key sets are ambiguous.
 *
 * Several tier-1 owners is `ambiguous-owner` and stops there: a fragment a
 * metadata type could own is never handed to a narrower guess.
 */
export function resolveOwner(value, owners, named = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { miss: 'unmapped', detail: Array.isArray(value) ? 'a bare array names no owner' : 'not an object' };
  }
  const keys = Object.keys(value);
  if (keys.length === 0) return { miss: 'unmapped', detail: 'an empty object names no owner' };
  const hits = owners.filter((o) => keys.every((k) => o.keys.has(k)));
  if (hits.length === 1) return { kind: 'fragment', owner: hits[0], label: `${hits[0].name}(partial)`, tier: 1 };
  if (hits.length > 1) {
    return { miss: 'ambiguous-owner', detail: `${hits.map((o) => o.name).join(' | ')} each declare {${keys.join(', ')}}` };
  }
  const complete = named.filter((o) => keys.every((k) => o.keys.has(k)) && [...o.required].every((k) => keys.includes(k)));
  const shapes = new Set(complete.map((o) => [...o.keys].sort().join(',')));
  if (complete.length && shapes.size === 1) {
    return { kind: 'schema', schema: complete[0].schema, label: `${complete[0].name}(inferred)`, array: false, tier: 2 };
  }
  if (complete.length) {
    return { miss: 'ambiguous-owner', detail: `${complete.slice(0, 4).map((o) => o.name).join(' | ')}${complete.length > 4 ? ' | …' : ''} each fit {${keys.join(', ')}}` };
  }
  return { miss: 'unmapped', detail: `no owner declares every key of {${keys.join(', ')}}` };
}

/**
 * @param {{mapKey:string, value:any}} item
 * @param {{registry:(t:string)=>any, byName:(n:string)=>{schema?:any,error?:string}, owners:any[], exported?:Set<string>}} index
 */
export function resolveTarget(item, index) {
  const k = item.mapKey;
  if (k === 'owner') return resolveOwner(item.value, index.owners, index.named ?? []);
  if (k.startsWith('decl:')) {
    const raw = k.slice(5).trim().split(/\s+/)[0];
    const array = raw.endsWith('[]');
    const r = resolveDecl(array ? raw.slice(0, -2) : raw, index);
    return r.miss ? r : { kind: 'schema', ...r, array };
  }
  if (k.startsWith('schema:')) {
    const r = resolveDecl(k.slice(7), index);
    return r.miss ? r : { kind: 'schema', ...r, array: false };
  }
  if (k.startsWith('foreign:')) {
    const [name, from] = k.slice(8).split(' from ');
    return { miss: 'unmapped', detail: `type \`${name}\` is imported from ${from} — not a spec shape` };
  }
  if (k.startsWith('type:') && Object.hasOwn(TYPE_NOT_A_SPEC_SHAPE, k.slice(5).replace(/\[\]$/, ''))) {
    const name = k.slice(5).replace(/\[\]$/, '');
    return { miss: 'unmapped', detail: `type \`${name}\` is ${TYPE_NOT_A_SPEC_SHAPE[name]}` };
  }
  if (k.startsWith('type:')) {
    const name = k.slice(5);
    const array = name.endsWith('[]');
    const base = array ? name.slice(0, -2) : name;
    const r = resolveDecl(`${base}Schema`, index);
    return r.miss ? { miss: 'unmapped', detail: `type \`${base}\`: ${r.detail}` } : { kind: 'schema', ...r, array };
  }
  const spec = FACTORY_TARGETS[k];
  if (!spec) {
    const exported = index.exported ? index.exported.has(k) : true;
    return {
      miss: 'factory-unknown',
      detail: exported
        ? `\`${k}\` is exported but FACTORY_TARGETS names no schema for it`
        : `\`${k}\` is not exported by @objectstack/spec — the example imports a factory that does not exist`,
    };
  }
  const r = resolveDecl(spec.target, index);
  return r.miss ? r : { kind: 'schema', ...r, array: false, spec };
}

// ── Judge ──────────────────────────────────────────────────────────────────

const startsWith = (p, prefix) => prefix.length <= p.length && prefix.every((seg, i) => p[i] === seg);
const samePath = (a, b) => a.length === b.length && startsWith(a, b);

function valueAt(root, path) {
  let v = root;
  for (const seg of path) {
    if (v === null || typeof v !== 'object') return { present: false };
    if (!Object.hasOwn(v, seg)) return { present: false };
    v = v[seg];
  }
  return { present: true, value: v };
}

/**
 * Is a Zod issue a fact about the LITERAL, or could the unknown parts have
 * caused it? Untrusted: an issue at or under an opaque node; an issue above
 * one (a refinement or union over a value we did not know); a missing key on an
 * object a spread or computed key may have supplied. `unrecognized_keys`
 * survives an opaque child — the key names are literal — unless the object has
 * a computed key. A union is trusted only when EVERY branch failed for a
 * trusted reason.
 */
export function isTrusted(issue, base, marks, root) {
  const p = [...base, ...(issue.path ?? [])];
  if (marks.opaque.some((o) => startsWith(p, o))) return false;
  if (issue.code === 'invalid_union' && Array.isArray(issue.errors) && issue.errors.length) {
    return issue.errors.every((branch) => branch.some((i) => isTrusted(i, p, marks, root)));
  }
  if (issue.code === 'unrecognized_keys') return !marks.computed.some((c) => samePath(c, p));
  if (p.length > 0) {
    const parent = p.slice(0, -1);
    const missing = !valueAt(root, p).present;
    if (missing && marks.open.some((o) => samePath(o, parent))) return false;
  }
  if (marks.opaque.some((o) => o.length > p.length && startsWith(o, p))) return false;
  return true;
}

/** Fold array indices so a signature survives an edit that shifts them. */
export function issueSignature(label, issue) {
  const path = (issue.path ?? []).map((s) => (typeof s === 'number' ? '#' : String(s))).join('.');
  const keys = Array.isArray(issue.keys) ? `[${[...issue.keys].sort().join(',')}]` : '';
  return `${label}|${issue.code}|${path}${keys}`;
}

/**
 * Judge one item against its resolved target: `{ issues, suppressed }`, issues
 * carrying absolute paths.
 */
/**
 * A component node's `properties` is an open record on the page schema, so a
 * parse of the page never judges it. Ported from `check-yaml-examples.ts`
 * (#13338): any node carrying a `type` string and a `properties` mapping whose
 * type has a `ComponentPropsMap` row is judged against that row; a type with no
 * row (SDUI blocks, `custom.*`) is skipped; a missing `object` prop a sibling
 * `dataSource.object` supplies is not reported. The verdict is the map's own.
 */
export function componentPropsIssues(value, componentProps, path = [], out = [], ancestors = new Set()) {
  if (!componentProps) return out;
  if (Array.isArray(value)) {
    value.forEach((el, i) => componentPropsIssues(el, componentProps, [...path, i], out, ancestors));
    return out;
  }
  if (!value || typeof value !== 'object' || ancestors.has(value)) return out;
  ancestors.add(value);
  const type = typeof value.type === 'string' && value.type ? value.type : null;
  const props = value.properties && typeof value.properties === 'object' && !Array.isArray(value.properties) ? value.properties : null;
  if (type && props && Object.hasOwn(componentProps, type)) {
    const r = componentProps[type].safeParse(props);
    if (!r.success) {
      for (const i of r.error.issues) {
        const suppliedByDataSource = i.path?.length === 1 && i.path[0] === 'object'
          && typeof value.dataSource?.object === 'string' && value.dataSource.object.length > 0;
        if (!suppliedByDataSource) out.push({ ...i, path: [...path, 'properties', ...(i.path ?? [])], component: type });
      }
    }
  }
  for (const [k, v] of Object.entries(value)) componentPropsIssues(v, componentProps, [...path, k], out, ancestors);
  ancestors.delete(value);
  return out;
}

/**
 * `defineStack` accepts a named collection as a MAP (key → item, the key
 * injected as `name`) and normalizes it to an array before it parses
 * (`normalizeStackInput`, `MAP_SUPPORTED_FIELDS`). The judge applies the same
 * normalization to a stack-shaped value, re-rooting the evaluation marks so a
 * forgiven path stays forgiven at its new index.
 */
export function normalizeStackMaps(value, marks, mapFields) {
  if (!mapFields || !value || typeof value !== 'object' || Array.isArray(value)) return value;
  const out = { ...value };
  for (const field of mapFields) {
    const v = out[field];
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
    if (marks.open.some((o) => samePath(o, [field]))) {
      marks.opaque.push([field]); // a spread map has an unknown member count
      continue;
    }
    const keys = Object.keys(v);
    out[field] = keys.map((k) => (v[k] && typeof v[k] === 'object' && !Array.isArray(v[k]) && !Object.hasOwn(v[k], 'name')
      ? { name: k, ...v[k] } : v[k]));
    for (const list of [marks.opaque, marks.open, marks.computed]) {
      for (let i = 0; i < list.length; i++) {
        const m = list[i];
        if (m.length >= 2 && m[0] === field && keys.includes(m[1])) list[i] = [field, keys.indexOf(m[1]), ...m.slice(2)];
      }
    }
  }
  return out;
}

export function judgeItem(item, target, componentProps = null, mapFields = null) {
  const marks = item.marks ?? newMarks();
  const stackShaped = target.label === 'ObjectStackDefinitionSchema' || target.label === 'stack(partial)';
  let value = stackShaped ? normalizeStackMaps(item.value, marks, mapFields) : item.value;
  const raw = [];
  if (target.kind === 'fragment') {
    for (const k of Object.keys(value)) {
      const member = target.owner.member(k);
      if (!member) continue;
      const r = member.safeParse(value[k]);
      if (!r.success) for (const i of r.error.issues) raw.push({ ...i, path: [k, ...(i.path ?? [])] });
    }
  } else {
    const spec = target.spec;
    if (spec && value && typeof value === 'object' && !Array.isArray(value)) {
      value = { ...value };
      for (const d of spec.drop ?? []) delete value[d];
      for (const inj of spec.inject ?? []) {
        if (!Object.hasOwn(value, inj)) {
          value[inj] = undefined;
          marks.opaque.push([inj]);
        }
      }
    }
    if (target.array) {
      if (!Array.isArray(value)) {
        raw.push({ code: 'invalid_type', expected: 'array', path: [], message: 'expected an array' });
      } else {
        value.forEach((el, i) => {
          const r = target.schema.safeParse(el);
          if (!r.success) for (const is of r.error.issues) raw.push({ ...is, path: [i, ...(is.path ?? [])] });
        });
      }
    } else {
      const r = target.schema.safeParse(value);
      if (!r.success) raw.push(...r.error.issues);
    }
  }
  raw.push(...componentPropsIssues(value, componentProps));
  const issues = [];
  let suppressed = 0;
  for (const i of raw) {
    if (isTrusted(i, [], marks, value)) issues.push({ ...i, label: i.component ? `${target.label}#${i.component}` : target.label });
    else suppressed++;
  }
  return { issues, suppressed };
}

/**
 * One fence, end to end: transform → map → judge. `verdict`, over the items
 * that are NOT counter-examples: `red` (a trusted structural issue), `green`
 * (every item read, mapped and accepted), `partial` (some part unread or
 * unmapped, nothing red) or `miss` (nothing judged); `counter` when the only
 * judged items are counter-examples. `counterRefused` / `counterAccepted`
 * count the counter-examples the schema does / does not refuse.
 */
export function probeFence(fence, deps, index) {
  const t = transformFence(fence, deps);
  const items = [];
  for (const item of t.items) {
    const target = resolveTarget(item, index);
    if (target.miss) {
      items.push({ shape: item.shape, mapKey: item.mapKey, counter: Boolean(item.counter), miss: target.miss, detail: target.detail });
      continue;
    }
    const j = judgeItem(item, target, index.componentProps ?? null, index.mapFields ?? null);
    items.push({
      shape: item.shape, mapKey: item.mapKey, counter: Boolean(item.counter), target: target.label, tier: target.tier ?? 0,
      issues: j.issues.map((i) => ({ code: i.code, path: i.path ?? [], keys: i.keys, message: i.message, label: i.label })),
      signatures: item.counter ? [] : j.issues.map((i) => issueSignature(i.label, i)),
      suppressed: j.suppressed,
    });
  }
  const judged = items.filter((i) => !i.miss && !i.counter);
  const counters = items.filter((i) => !i.miss && i.counter);
  const plain = items.filter((i) => !i.counter);
  let verdict;
  if (judged.some((i) => i.issues.length)) verdict = 'red';
  else if (judged.length === 0) verdict = counters.length ? 'counter' : 'miss';
  else if (t.status === 'read' && judged.length === plain.length) verdict = 'green';
  else verdict = 'partial';
  const firstMiss = items.find((i) => i.miss);
  const mapped = items.filter((i) => !i.miss).length;
  return {
    verdict,
    coverage: t.status === 'read' && items.length > 0 && mapped === items.length ? 'whole' : (mapped ? 'partial' : 'miss'),
    reason: verdict === 'miss' ? (t.status === 'miss' ? t.reason : firstMiss?.miss) : (verdict === 'partial' ? (firstMiss?.miss ?? t.reason) : undefined),
    detail: verdict === 'miss' || verdict === 'partial' ? (t.status !== 'read' ? t.detail : firstMiss?.detail) : undefined,
    counterRefused: counters.filter((i) => i.issues.length).length,
    counterAccepted: counters.filter((i) => !i.issues.length).length,
    items,
  };
}

// ── The replay ─────────────────────────────────────────────────────────────

/**
 * The cards premise 1 of #22059 counts, enumerated with the premise's own
 * listing (`domain:skills`, `state=all`, `since=2026-09-23T00:00Z`, title
 * matching `skills\(objectstack-|skills/objectstack-|finding\(skills`), each
 * paired with the squash commit of the PR that closed it — the merged PR whose
 * merge instant is the card's `closed` event (timeline), located on `main` by
 * its `(#PR)` subject suffix. `sha: null` = no fix has landed. `filedAfter`
 * marks a card created after #22059 was filed (2026-10-07T05:02Z): it matches
 * the listing today but could not have been among the "21".
 */
export const REPLAY_SET = Object.freeze([
  { card: 18964, pr: 19792, sha: '98d83361d9f443d26d91a6db769e78a9e6342545' },
  { card: 20090, pr: 20118, sha: '180ef90fb7875d994a42b12c9156522df554ef65' },
  { card: 20173, pr: 20257, sha: '8af914a30d1dab62fd7b73d1d847076b639cb2ab' },
  { card: 20196, pr: 20256, sha: '67047171881ad81c1fd9f4962b60d5bb33801fa6' },
  { card: 20275, pr: 20298, sha: '29720975b6775390d7c54cb3e51f0d70d36c6cd7' },
  { card: 20385, pr: 20410, sha: '789b2ae54f5dd78e4dc49ad4d40a4a10a1f16e63' },
  { card: 20500, pr: 20776, sha: '80dc9c0231016bcaf2ac7b4624a63efec96b2128' },
  { card: 20569, pr: 20796, sha: 'eac538c96d8796e7fc007c839354d2b3012780fc' },
  { card: 20657, pr: 20778, sha: '7a09eee1b12a010f5e2c1749ff4dc7d9376516ad' },
  { card: 20782, pr: 20811, sha: '1d2024538cb178c77c605d63a39de7ae3963700b' },
  { card: 20888, pr: 20902, sha: '4957ee5ef0e660fc9ee4525d83f13aa32ef8e969' },
  { card: 21211, pr: 21283, sha: '9fb9b253622723187d20cd0ba1a0989470ecd735' },
  { card: 21288, pr: 21302, sha: '125ce9f7182eb3c08ca825625987d80ef5a8bb70' },
  { card: 21392, pr: 21402, sha: 'a5139404d8677638c5656441f43e979c73f6d624' },
  { card: 21415, pr: 21652, sha: 'bff5aa2d982ddedd8b3849e9c8d34e017adba485' },
  { card: 21537, pr: 21651, sha: 'fea67065a3dfd972a40f95225077cd2e21443d58' },
  { card: 21567, pr: 21650, sha: '1a230548cf6d1771489fdaf796cc7a146a05ac1d' },
  { card: 21583, pr: 21656, sha: '506fb6dac38029f727a946d4d67611efefb1542e' },
  { card: 21588, pr: 21677, sha: 'eed2dee481126b6655cfb4a809099aa885c8e52b' },
  { card: 21627, pr: 21667, sha: '8ad9694fb7328f65881476b49dfd52df6964a128' },
  { card: 22120, pr: 22122, sha: '033e5c536db11e278182f321f0ae99cf10f4f630', filedAfter: true },
  { card: 22123, pr: null, sha: null, filedAfter: true },
]);

/** Every way a replayed card can miss, in the precedence `classifyReplay` applies. */
export const REPLAY_MISS_CLASSES = Object.freeze({
  'no-fix': 'no fix commit has landed for the card',
  'not-in-corpus': 'the fix touched no skills/objectstack-* markdown — not a published-catalog teaching error',
  prose: 'the fix touched no fence of the population — the error lived in prose, a table or a non-population fence',
  'comment-or-string': 'the touched fences differ only in comments or string contents — a semantic error written inside an example',
  both: 'the validator flags the touched fences on both sides with the same signature',
  transform: 'a touched fence could not be read or mapped on the BEFORE side',
  neither: 'the touched fences were read and mapped, and the validator flags neither side — not an error a schema can refuse',
});

/**
 * The code of a fence with comments dropped and string contents blanked — two
 * fences with one key differ only in what a reader is TOLD, not in what a
 * schema would see.
 */
export function codeKeyOf(ts, fence) {
  if (fence.family === 'yaml') {
    return fence.body.split('\n').map((l) => l.replace(/(^|\s)#.*$/, '').trimEnd()).filter((l) => l.trim()).join('\n')
      .replace(/(["'])(?:\\.|(?!\1).)*\1/g, '"S"').replace(/:\s+[^\s{[].*$/gm, ': S');
  }
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, fence.lang === 'tsx' ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard, fence.body);
  const out = [];
  const SK = ts.SyntaxKind;
  for (let tok = scanner.scan(); tok !== SK.EndOfFileToken; tok = scanner.scan()) {
    if (tok === SK.StringLiteral || tok === SK.NoSubstitutionTemplateLiteral || tok === SK.TemplateHead
      || tok === SK.TemplateMiddle || tok === SK.TemplateTail) out.push('"S"');
    else out.push(scanner.getTokenText());
  }
  return out.join(' ');
}

/**
 * Classify one replayed card. `before` / `after` are the population fences of
 * the fix's touched files at the parent and at the fix commit, each
 * `{ body, codeKey, result }` (`result` from `probeFence`).
 *
 * @returns {{hit:boolean, cls:string, touchedBefore:number, touchedAfter:number,
 *   removed:string[], residual:string[], beforeVerdicts:string[], afterVerdicts:string[]}}
 */
export function classifyReplay({ fixed, inCorpus, before = [], after = [] }) {
  const base = { touchedBefore: 0, touchedAfter: 0, removed: [], residual: [], beforeVerdicts: [], afterVerdicts: [] };
  if (!fixed) return { hit: false, cls: 'no-fix', ...base };
  if (!inCorpus) return { hit: false, cls: 'not-in-corpus', ...base };
  const afterBodies = new Set(after.map((f) => f.body));
  const beforeBodies = new Set(before.map((f) => f.body));
  const tb = before.filter((f) => !afterBodies.has(f.body));
  const ta = after.filter((f) => !beforeBodies.has(f.body));
  const sigs = (fs) => new Set(fs.flatMap((f) => f.result.items.flatMap((i) => i.signatures ?? [])));
  const bs = sigs(tb);
  const as = sigs(ta);
  const out = {
    ...base,
    touchedBefore: tb.length,
    touchedAfter: ta.length,
    removed: [...bs].filter((s) => !as.has(s)),
    residual: [...as],
    beforeVerdicts: tb.map((f) => f.result.verdict),
    afterVerdicts: ta.map((f) => f.result.verdict),
  };
  if (tb.length + ta.length === 0) return { hit: false, cls: 'prose', ...out };
  if (out.removed.length) return { hit: true, cls: 'HIT', ...out };
  const keysB = new Set(tb.map((f) => f.codeKey));
  const keysA = new Set(ta.map((f) => f.codeKey));
  if (keysB.size === keysA.size && [...keysB].every((k) => keysA.has(k))) return { hit: false, cls: 'comment-or-string', ...out };
  if (bs.size) return { hit: false, cls: 'both', ...out };
  const changed = tb.filter((f) => !keysA.has(f.codeKey));
  if (changed.some((f) => f.result.verdict === 'miss' || f.result.verdict === 'partial')) return { hit: false, cls: 'transform', ...out };
  return { hit: false, cls: 'neither', ...out };
}

// ── The runner (`check-corpus-claim-drift.mjs --probe-examples`) ───────────

/** The spec's category namespaces, in the order a bare name is looked up after the root entry. */
const SPEC_NAMESPACES = Object.freeze([
  'data', 'ui', 'automation', 'ai', 'system', 'security', 'api', 'kernel', 'identity',
  'integration', 'marketplace', 'qa', 'shared', 'studio', 'contracts',
]);
/** Kinds `getMetadataTypeSchema` binds without a `MetadataTypeSchema` member (#6245) — owners too. */
const UNREGISTERED_OWNER_KINDS = Object.freeze(['webhook', 'connector', 'sharing_rule', 'analytics_cube']);

function newestMtime(dir, ext) {
  let newest = 0;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) newest = Math.max(newest, newestMtime(p, ext));
    else if (p.endsWith(ext)) newest = Math.max(newest, st.mtimeMs);
  }
  return newest;
}

/**
 * Refuse rather than read a missing or stale build: a stale dist judges every
 * example against the PREVIOUS schemas and lies in both directions. The rule
 * is the spec's own (`packages/spec/scripts/lib/dist-freshness.ts`): source
 * newer than the built JS convicts. Only the runtime JS is read here, never a
 * `.d.ts`, so an `OS_SKIP_DTS` build is not a hole for this reader.
 */
export function specBuildProblem(repoRoot) {
  const dist = join(repoRoot, 'packages/spec/dist');
  const entries = ['index.mjs', ...SPEC_NAMESPACES.map((n) => `${n}/index.mjs`)];
  const absent = entries.filter((e) => !existsSync(join(dist, e)));
  if (absent.length) return `packages/spec/dist is missing ${absent.length} entr${absent.length === 1 ? 'y' : 'ies'} (${absent.slice(0, 3).join(', ')}…)`;
  const built = Math.min(...entries.map((e) => statSync(join(dist, e)).mtimeMs));
  const src = newestMtime(join(repoRoot, 'packages/spec/src'), '.ts');
  if (src > built) return `packages/spec/src has a .ts file newer than the built dist (${new Date(src).toISOString()} > ${new Date(built).toISOString()})`;
  return null;
}

function git(repoRoot, args) {
  const r = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, out: r.stdout ?? '', err: r.stderr ?? '' };
}

/** Load the built spec and build the mapping index the judge resolves against. */
export async function loadSpecIndex(repoRoot) {
  const dist = join(repoRoot, 'packages/spec/dist');
  const root = await import(pathToFileURL(join(dist, 'index.mjs')).href);
  const ns = {};
  for (const n of SPEC_NAMESPACES) ns[n] = await import(pathToFileURL(join(dist, n, 'index.mjs')).href);
  const kernel = ns.kernel;
  const registry = (t) => kernel.getMetadataTypeSchema(t);
  const byName = (name) => {
    for (const mod of [root, ...SPEC_NAMESPACES.map((n) => ns[n])]) {
      if (Object.hasOwn(mod, name)) {
        return isZodSchema(mod[name]) ? { schema: mod[name] } : { error: `\`${name}\` resolves, but is not a Zod schema` };
      }
    }
    return { error: `no @objectstack/spec entry exports \`${name}\`` };
  };
  const ownerNames = [...kernel.listMetadataTypeSchemaTypes(), ...UNREGISTERED_OWNER_KINDS];
  const owners = [];
  const shapeless = [];
  for (const name of ownerNames) {
    const shapes = objectShapesOf(registry(name));
    if (shapes.length === 0) {
      shapeless.push(name);
      continue;
    }
    // A union-typed kind (`view`: container | list | form) owns through each option separately.
    shapes.forEach((shape, i) => owners.push({
      name: shapes.length === 1 ? name : `${name}[option ${i}]`,
      keys: new Set(declaredKeys(shape)),
      member: (k) => shape[k],
    }));
  }
  const stackShape = objectShapeOf(byName('ObjectStackDefinitionSchema').schema);
  if (stackShape) owners.push({ name: 'stack', keys: new Set(declaredKeys(stackShape)), member: (k) => stackShape[k] });
  else shapeless.push('stack');
  const exported = new Set(Object.keys(root).filter((k) => FACTORY_RE.test(k)));
  for (const [k, v] of Object.entries(root)) {
    if (v && typeof v === 'object' && typeof v.create === 'function') exported.add(`${k}.create`);
  }
  const named = [];
  const seenNames = new Set();
  for (const mod of [root, ...SPEC_NAMESPACES.map((n) => ns[n])]) {
    for (const [name, v] of Object.entries(mod)) {
      if (!/Schema$/.test(name) || seenNames.has(name) || !isZodSchema(v)) continue;
      seenNames.add(name);
      let shape = null;
      try {
        shape = objectShapeOf(v);
      } catch {
        shape = null;
      }
      if (!shape) continue;
      const keys = new Set(declaredKeys(shape));
      const required = new Set([...keys].filter((k) => shape[k]?._zod?.optin !== 'optional'));
      named.push({ name, schema: v, keys, required });
    }
  }
  const helpers = { Field: root.Field ?? ns.data.Field };
  const componentProps = ns.ui.ComponentPropsMap ?? null;
  const mapFields = root.MAP_SUPPORTED_FIELDS ?? ns.shared.MAP_SUPPORTED_FIELDS ?? null;
  return {
    index: { registry, byName, owners, named, exported, componentProps, mapFields },
    helpers, shapeless, ownerCount: owners.length, namedCount: named.length,
  };
}

function fencesOfText(text) {
  return extractFences(text);
}

/** Judge every population fence of one text; also returns the non-population fences. */
function probeText(text, deps, index) {
  const pop = [];
  const other = [];
  for (const f of fencesOfText(text)) {
    if (!f.family) {
      other.push(f);
      continue;
    }
    pop.push({ ...f, codeKey: codeKeyOf(deps.ts, f), result: probeFence(f, deps, index) });
  }
  return { pop, other };
}

export function replayCard(row, repoRoot, deps, index) {
  if (!row.sha) return { ...row, files: [], ...classifyReplay({ fixed: false }) };
  const changed = git(repoRoot, ['diff-tree', '--no-commit-id', '--name-only', '-r', row.sha]).out.split('\n').filter(Boolean);
  const files = changed.filter(inPopulation);
  const before = [];
  const after = [];
  let otherTouched = 0;
  for (const rel of files) {
    const b = git(repoRoot, ['show', `${row.sha}^:${rel}`]);
    const a = git(repoRoot, ['show', `${row.sha}:${rel}`]);
    const pb = probeText(b.ok ? b.out : '', deps, index);
    const pa = probeText(a.ok ? a.out : '', deps, index);
    before.push(...pb.pop.map((f) => ({ ...f, file: rel })));
    after.push(...pa.pop.map((f) => ({ ...f, file: rel })));
    const ob = new Set(pb.other.map((f) => f.body));
    const oa = new Set(pa.other.map((f) => f.body));
    otherTouched += pb.other.filter((f) => !oa.has(f.body)).length + pa.other.filter((f) => !ob.has(f.body)).length;
  }
  const c = classifyReplay({ fixed: true, inCorpus: files.length > 0, before, after });
  const afterBodies = new Set(after.map((f) => f.body));
  const touchedBeforeFences = before.filter((f) => !afterBodies.has(f.body))
    .map((f) => ({ file: f.file, line: f.line, lang: f.lang, marker: f.marker?.kind ?? null, verdict: f.result.verdict, reason: f.result.reason, items: f.result.items }));
  return { ...row, files, otherTouched, ...c, touchedBeforeFences };
}

const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : 'n/a');

/**
 * The whole reading. Prints it; returns it; never fails on what it finds.
 * @returns {Promise<number>} exit code — 0 on any reading, 1 only when the instrument could not run
 */
export async function runProbe({ repoRoot, jsonOut = null, log = console.log, error = console.error } = {}) {
  const problem = specBuildProblem(repoRoot);
  if (problem) {
    error(`\n✗ skill-example-probe could not run: ${problem}.\n  Rebuild first: pnpm --filter @objectstack/spec build\n`);
    return 1;
  }
  const unheld = REPLAY_SET.filter((r) => r.sha && !git(repoRoot, ['cat-file', '-e', `${r.sha}^{commit}`]).ok
    || (r.sha && !git(repoRoot, ['cat-file', '-e', `${r.sha}^^{commit}`]).ok));
  if (unheld.length) {
    error(`\n✗ skill-example-probe could not run: this clone does not hold ${unheld.length} replay commit(s) or their parent `
      + `(${unheld.map((r) => `#${r.card} ${r.sha.slice(0, 10)}`).join(', ')}).\n  Deepen it: git fetch --deepen=3000 origin main\n`);
    return 1;
  }
  const { default: ts } = await import('typescript');
  const yaml = await import('yaml');
  const { index, helpers, shapeless, ownerCount, namedCount } = await loadSpecIndex(repoRoot);
  const deps = { ts, yaml, helpers };
  const head = git(repoRoot, ['rev-parse', '--short', 'HEAD']).out.trim();

  // Control: the current catalog.
  const files = probeCorpusFiles(repoRoot);
  const entries = [];
  const fences = [];
  for (const rel of files) {
    const text = readFileSync(join(repoRoot, rel), 'utf8');
    const fs = fencesOfText(text);
    entries.push({ rel, fences: fs });
    for (const f of fs) if (f.family) fences.push({ rel, skill: skillOf(rel), ...f, result: probeFence(f, deps, index) });
  }
  const census = fenceCensus(entries);
  const byVerdict = {};
  const byCoverage = {};
  const byReason = {};
  const byShape = {};
  const byFamilyCoverage = {};
  const codes = {};
  let suppressed = 0;
  let counterRefused = 0;
  const counterAccepted = [];
  for (const f of fences) {
    const v = f.result.verdict;
    const c = f.result.coverage;
    byVerdict[v] = (byVerdict[v] ?? 0) + 1;
    byCoverage[c] = (byCoverage[c] ?? 0) + 1;
    byFamilyCoverage[`${f.family}:${c}`] = (byFamilyCoverage[`${f.family}:${c}`] ?? 0) + 1;
    if (c !== 'whole') {
      const reason = f.result.reason ?? f.result.items.find((i) => i.miss)?.miss ?? 'unknown';
      byReason[`${c}:${reason}`] = (byReason[`${c}:${reason}`] ?? 0) + 1;
    }
    counterRefused += f.result.counterRefused;
    for (const it of f.result.items) {
      byShape[it.shape] = (byShape[it.shape] ?? 0) + 1;
      suppressed += it.suppressed ?? 0;
      if (!it.counter) for (const is of it.issues ?? []) codes[is.code] = (codes[is.code] ?? 0) + 1;
      if (it.counter && !it.miss && !it.issues.length) counterAccepted.push(`${f.rel}:${f.line} [${it.shape} → ${it.target}]`);
    }
  }
  const reds = fences.filter((f) => f.result.verdict === 'red');

  // Replay.
  const replay = REPLAY_SET.map((row) => replayCard(row, repoRoot, deps, index));

  log(`skill-example-probe (#22059 step ①) — objectstack @ ${head}; schemas: built packages/spec/dist of this tree`);
  log(`  mapping index: ${ownerCount} tier-1 key owners (registry types + stack), ${namedCount} tier-2 named object schemas; `
    + `component props judged via ComponentPropsMap (${index.componentProps ? Object.keys(index.componentProps).length : 0} rows); `
    + `shapeless, so never a tier-1 owner: ${shapeless.join(', ') || 'none'}`);
  log(`\nCENSUS — ${files.length} markdown file(s) under skills/objectstack-* (evals/ excluded): `
    + `${census.population} population fence(s), ${census.other} other fence(s)`);
  for (const [skill, row] of Object.entries(census.perSkill)) {
    log(`  ${skill.padEnd(24)} ${Object.entries(row).sort().map(([k, n]) => `${k}=${n}`).join('  ')}`);
  }
  log(`  totals: ${Object.entries(census.totals).sort().map(([k, n]) => `${k}=${n}`).join('  ')}`);
  log(`\nCOVERAGE over ${fences.length} population fence(s): read and mapped whole ${byCoverage.whole ?? 0} `
    + `(${pct(byCoverage.whole ?? 0, fences.length)}) · partly ${byCoverage.partial ?? 0} · coverage miss ${byCoverage.miss ?? 0} `
    + `(${pct(byCoverage.miss ?? 0, fences.length)})`);
  log(`  by family: ${Object.entries(byFamilyCoverage).sort().map(([k, n]) => `${k}=${n}`).join('  ')}`);
  log(`  not-whole, by reason: ${Object.entries(byReason).sort().map(([k, n]) => `${k}=${n}`).join('  ')}`);
  log(`  judgeable items by shape: ${Object.entries(byShape).sort().map(([k, n]) => `${k}=${n}`).join('  ')}`);
  log(`\nCONTROL — the current catalog, by fence: ${Object.entries(byVerdict).sort().map(([k, n]) => `${k}=${n}`).join('  ')}`);
  log(`  structural issues on teaching (non-counter) items, by Zod code: `
    + `${Object.entries(codes).sort().map(([k, n]) => `${k}=${n}`).join('  ') || 'none'} · suppressed (opaque/open) ${suppressed}`);
  log(`  counter-examples (❌): ${counterRefused} refused as the text says · ${counterAccepted.length} ACCEPTED by the schema`);
  for (const c of counterAccepted) log(`  COUNTER-ACCEPTED ${c}`);
  for (const f of fences) {
    for (const it of f.result.items.filter((i) => i.counter && i.issues?.length)) {
      log(`  COUNTER-REFUSED ${f.rel}:${f.line} [${it.shape} → ${it.target}] ${it.issues.map((is) => `${is.code} @ ${is.path.join('.') || '(root)'}`).join('; ')}`);
    }
  }
  for (const f of reds) {
    for (const it of f.result.items.filter((i) => !i.counter && i.issues?.length)) {
      for (const is of it.issues) {
        log(`  RED ${f.rel}:${f.line}${f.marker ? ` (${f.marker.kind})` : ''} [${it.shape} → ${it.target}] ${is.code} @ ${is.path.join('.') || '(root)'}`
          + `${is.keys ? ` keys=${is.keys.join(',')}` : ''} — ${String(is.message).split('\n')[0].slice(0, 160)}`);
      }
    }
  }
  log('\nREPLAY — fix commits read from the local object store, both sides judged by this tree\'s schemas');
  for (const r of replay) {
    log(`  #${r.card}${r.filedAfter ? '*' : ' '} ${r.sha ? r.sha.slice(0, 10) : '(no fix)  '} ${(r.cls).padEnd(18)} `
      + `files=${r.files.length} touched=${r.touchedBefore}/${r.touchedAfter} other-lang-touched=${r.otherTouched ?? 0}`
      + ` before=[${r.beforeVerdicts.join(',')}] after=[${r.afterVerdicts.join(',')}]`
      + `${r.hit ? ` markers=[${(r.touchedBeforeFences ?? []).map((f) => f.marker ?? 'none').join(',')}]` : ''}`
      + `${r.removed.length ? ` removed=${r.removed.join(' ; ')}` : ''}`);
  }
  const hits = replay.filter((r) => r.hit).length;
  const atFiling = replay.filter((r) => !r.filedAfter);
  const teaching = replay.filter((r) => r.cls !== 'no-fix' && r.cls !== 'not-in-corpus');
  const teachingAtFiling = teaching.filter((r) => !r.filedAfter);
  log(`\nHIT RATE: ${hits}/${replay.length} over every card the listing matches today (${pct(hits, replay.length)}) · `
    + `${atFiling.filter((r) => r.hit).length}/${atFiling.length} over those filed before #22059 · `
    + `${teachingAtFiling.filter((r) => r.hit).length}/${teachingAtFiling.length} over those with a landed published-catalog fix `
    + `(${pct(teachingAtFiling.filter((r) => r.hit).length, teachingAtFiling.length)}) — the ruling's bar is one half`);
  const missCounts = {};
  for (const r of replay.filter((x) => !x.hit)) missCounts[r.cls] = (missCounts[r.cls] ?? 0) + 1;
  log(`  misses by class: ${Object.entries(missCounts).map(([k, n]) => `${k}=${n}`).join('  ')}`);
  log('  (* = created after #22059 was filed; matches the listing today, could not have been among its "21")');
  log('\nReport-only: this mode exits 0 on any reading (#22059 step ①; the gate is step ②, conditional on the hit rate).');

  if (jsonOut) {
    writeFileSync(jsonOut, `${JSON.stringify({
      head, census, coverage: { byVerdict, byCoverage, byFamilyCoverage, byReason, byShape, codes, suppressed, counterRefused, counterAccepted, total: fences.length },
      fences: fences.map((f) => ({ rel: f.rel, line: f.line, lang: f.lang, heading: f.heading, marker: f.marker, ...f.result })),
      replay, hits, shapeless,
    }, null, 1)}\n`);
    log(`(readings written to ${jsonOut})`);
  }
  return 0;
}

// ── Self-test cases (registered into `check-corpus-claim-drift --self-test`) ─
//
// The battery NAMES and their floors live in that script's SELF_TEST_BATTERIES
// roster, beside its own; this function only registers cases against them, so
// one roster, one floor and one verdict handshake cover both (AGENTS.md
// "Writing a `--self-test`": copy the harness, never import one). Every schema
// below is SYNTHETIC — the cases pin the probe's own logic, and need no build.

/** The battery names this module registers cases under — the drift script declares them. */
export const PROBE_SELF_TEST_BATTERIES = Object.freeze({
  extractor: 'Probe extractor: fences, languages, markers, census (#22059)',
  transform: 'Probe transform: the supported shapes and the coverage miss (#22059)',
  judge: 'Probe mapping and judge, over synthetic schemas (#22059)',
  replay: 'Probe replay: the hit and every miss class (#22059)',
});

const ok = (v) => ({ success: true, data: v });
const fail = (issues) => ({ success: false, error: { issues } });
const fakeLeaf = (type, test) => ({ _zod: { def: { type } }, safeParse: (v) => (test(v) ? ok(v) : fail([{ code: 'invalid_type', expected: type, path: [], message: `expected ${type}` }])) });
const fakeOptional = (inner) => ({ _zod: { def: { type: 'optional', innerType: inner }, optin: 'optional' }, safeParse: (v) => (v === undefined ? ok(v) : inner.safeParse(v)) });
const fakeNever = () => fakeOptional({ _zod: { def: { type: 'never' } }, safeParse: () => fail([{ code: 'custom', path: [], message: 'retired' }]) });
function fakeObject(shape) {
  return {
    _zod: { def: { type: 'object', shape } },
    safeParse(v) {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return fail([{ code: 'invalid_type', expected: 'object', path: [], message: 'expected object' }]);
      const issues = [];
      const unknown = Object.keys(v).filter((k) => !Object.hasOwn(shape, k));
      if (unknown.length) issues.push({ code: 'unrecognized_keys', keys: unknown, path: [], message: `Unrecognized key(s): ${unknown.join(', ')}` });
      for (const [k, m] of Object.entries(shape)) {
        const r = m.safeParse(v[k]);
        if (!r.success) issues.push(...r.error.issues.map((i) => ({ ...i, path: [k, ...(i.path ?? [])] })));
      }
      return issues.length ? fail(issues) : ok(v);
    },
  };
}

/**
 * @param {{battery:(name:string)=>void, expect:(label:string, cond:boolean)=>void}} harness
 * @param {{ts:any, yaml:any}} deps
 */
export function registerProbeSelfTest({ battery, expect }, { ts, yaml }) {
  const B = PROBE_SELF_TEST_BATTERIES;
  const fence = (lang, body, extra = {}) => ({ line: 1, endLine: 1, indent: 0, info: lang, lang, family: LANG_FAMILY[lang] ?? null, body, heading: null, marker: null, unclosed: false, ...extra });
  const deps = { ts, yaml, helpers: { Field: { text: (c = {}) => ({ type: 'text', ...c }) } } };
  const T = '```';

  // ── extractor ──
  battery(B.extractor);
  {
    const md = ['# Title', '', `${T}ts`, 'const a = 1;', T, '', `${T}typescript title="x.ts"`, 'b', T, `${T}bash`, 'ls', T].join('\n');
    const fs = extractFences(md);
    expect('extractor: three fences found, in order', fs.length === 3);
    expect('extractor: `ts` is the TS family, body verbatim', fs[0].lang === 'ts' && fs[0].family === 'ts' && fs[0].body === 'const a = 1;');
    expect('extractor: an info string with attributes keys on its FIRST token', fs[1].lang === 'typescript' && fs[1].family === 'ts');
    expect('extractor: a non-population fence is extracted with family null', fs[2].lang === 'bash' && fs[2].family === null);
    expect('extractor: the enclosing heading is recorded', fs[0].heading === 'Title');
    const nested = extractFences([`${T}${'`'}md`, `${T}ts`, 'x', T, `${T}${'`'}`].join('\n'));
    expect('extractor: a ```ts shown inside a ````md illustration opens nothing', nested.length === 1 && nested[0].lang === 'md');
    const listed = extractFences(['1. item', '', `   ${T}json`, '   { "a": 1 }', `   ${T}`].join('\n'));
    expect('extractor: a fence in a list item is de-indented', listed.length === 1 && listed[0].body === '{ "a": 1 }' && listed[0].family === 'json');
    const tilde = extractFences(['~~~yml', 'a: 1', '~~~'].join('\n'));
    expect('extractor: a tilde fence and the `yml` spelling are read', tilde.length === 1 && tilde[0].family === 'yaml');
    const marked = extractFences(['<!-- os:check-yaml object -->', `${T}yaml`, 'name: x', T, '<!-- os:check -->', '', `${T}ts`, 'x', T].join('\n'));
    expect('extractor: an adjacent os:check-yaml marker carries its declaration', marked[0].marker?.kind === 'os:check-yaml' && marked[0].marker.decl === 'object');
    expect('extractor: a marker separated by a blank line marks nothing', marked[1].marker === null);
    const open = extractFences([`${T}ts`, 'never closed'].join('\n'));
    expect('extractor: an unclosed fence runs to the end and is flagged', open.length === 1 && open[0].unclosed === true);
    expect('population: evals/ is excluded', !inPopulation('skills/objectstack-ui/evals/a.md') && inPopulation('skills/objectstack-ui/rules/a.md'));
    expect('population: only objectstack-* skills, only .md', !inPopulation('skills/other/SKILL.md') && !inPopulation('skills/objectstack-ui/a.json'));
    const census = fenceCensus([{ rel: 'skills/objectstack-ui/SKILL.md', fences: fs }]);
    expect('census: per skill × language, population vs other', census.population === 2 && census.other === 1
      && census.perSkill['objectstack-ui'].ts === 1 && census.perSkill['objectstack-ui']['other:bash'] === 1);
  }

  // ── transform ──
  battery(B.transform);
  {
    const one = (body, lang = 'ts', extra) => transformFence(fence(lang, body, extra), deps);
    const fc = one("import { defineFlow } from '@objectstack/spec';\nexport const F = defineFlow({ name: 'x', nodes: [] });");
    expect('transform: a factory call is read, mapped by its factory name', fc.status === 'read' && fc.items.length === 1
      && fc.items[0].shape === 'factory-call' && fc.items[0].mapKey === 'defineFlow' && fc.items[0].value.name === 'x');
    const cc = one("ObjectSchema.create({ name: 'a' })");
    expect('transform: `X.create({...})` is a create-call', cc.items[0]?.shape === 'create-call' && cc.items[0].mapKey === 'ObjectSchema.create');
    const sp = one("const k = KnowledgeSourceSchema.parse({ id: 'k' });");
    expect('transform: `XSchema.parse({...})` maps to that schema', sp.items[0]?.mapKey === 'schema:KnowledgeSourceSchema');
    const tl = one("const w: DashboardWidget = { id: 'a' };\nconst v = { id: 'b' } satisfies ListView;\nconst xs: Foo[] = [];");
    expect('transform: typed literals — annotation, `satisfies`, array type', tl.items.map((i) => i.mapKey).join() === 'type:DashboardWidget,type:ListView,type:Foo[]');
    const pl = one("where: { status: 'active' }");
    expect('transform: a `key: value` fragment is a property-list', pl.status === 'read' && pl.items[0].shape === 'property-list'
      && pl.items[0].mapKey === 'owner' && pl.items[0].value.where.status === 'active');
    const bl = one("{ name: 'x', fields: {} }");
    expect('transform: a lone object literal is a bare-literal', bl.items[0]?.shape === 'bare-literal' && bl.items[0].value.name === 'x');
    const alt = one("// ✅ one\nwhere: { a: 1 }\n\n// ✅ two\nwhere: { b: 2 }");
    expect('transform: blank-line alternatives are read chunk by chunk', alt.status === 'read' && alt.items.length === 2);
    const syn = one('defineStack({ ... })');
    expect('transform: an ellipsis placeholder is a COVERAGE MISS of reason syntax', syn.status === 'miss' && syn.reason === 'syntax');
    const rt = one("const rows = await engine.find('task', {});\nconsole.log(rows.length);");
    expect('transform: runtime code with no metadata literal is a miss of reason no-candidate', rt.status === 'miss' && rt.reason === 'no-candidate');
    const bound = one("const data = { provider: 'object', object: 'case' };\ndefineView({ list: { data } });");
    expect('transform: a same-fence binding is followed', bound.items[0]?.value.list.data.object === 'case' && bound.items[0].marks.opaque.length === 0);
    const opq = one('defineFlow({ a: imported, b: () => 1, c: `t${x}`, d: other.call() })');
    expect('transform: unbound names, functions, substituted templates and calls are OPAQUE, by path',
      opq.items[0].marks.opaque.map((p) => p.join('.')).sort().join() === 'a,b,c,d');
    const spr = one('defineFlow({ ...base, a: 1 })');
    expect('transform: a spread of an unknown object marks the object OPEN', spr.items[0].marks.open.some((p) => p.length === 0));
    const outer = one("defineStack({ flows: [defineFlow({ name: 'f' })] })");
    expect('transform: only the OUTERMOST constructor is an item; the nested one is evaluated in place',
      outer.items.length === 1 && outer.items[0].value.flows[0].name === 'f');
    const fld = one("ObjectSchema.create({ fields: { t: Field.text({ label: 'T' }) } })");
    expect('transform: `Field.<kind>(…)` is evaluated by the helper itself', fld.items[0].value.fields.t.type === 'text' && fld.items[0].value.fields.t.label === 'T');
    const js = transformFence(fence('jsonc', '{\n  // a comment\n  "a": 1,\n}'), deps);
    expect('transform: a jsonc fence is read (comments, trailing comma)', js.status === 'read' && js.items[0].value.a === 1);
    const ym = transformFence(fence('yaml', 'name: x\nfields: [a]\n', { marker: { kind: 'os:check-yaml', decl: 'object' } }), deps);
    expect('transform: a YAML document is read; its os:check-yaml marker names the schema', ym.items[0]?.mapKey === 'decl:object' && ym.items[0].value.fields[0] === 'a');
    const neg = one("// ❌ refused\n{ fields: ['a'], unique: true }");
    const pol = one("{ condition: 'x',  // ❌ TRUE = invalid\n}");
    const hd = one("{ type: 'many_to_many' }", 'ts', { heading: '❌ Incorrect — Native Many-to-Many' });
    expect('transform: a leading ❌ comment or an Incorrect heading marks a COUNTER-example; a trailing ❌ does not',
      neg.items[0]?.counter === true && pol.items[0]?.counter === false && hd.items[0]?.counter === true);
    const fp = one("import type { Plugin } from '@objectstack/core';\nconst p: Plugin = { name: 'x' };");
    expect('transform: a type imported from outside the spec is marked foreign', fp.items[0]?.mapKey === 'foreign:Plugin from @objectstack/core');
  }

  // ── mapping + judge ──
  battery(B.judge);
  {
    const str = fakeLeaf('string', (v) => typeof v === 'string');
    const Flow = fakeObject({ name: str, label: fakeOptional(str), nodes: fakeOptional(fakeLeaf('array', Array.isArray)) });
    const Widget = fakeObject({ id: str, type: fakeOptional(str) });
    const Node = fakeObject({ id: str, kind: str, extra: fakeOptional(str) });
    const Tomb = fakeObject({ list: fakeNever(), id: str });
    const index = {
      registry: (t) => ({ flow: Flow }[t]),
      byName: (n) => ({ DashboardWidgetSchema: { schema: Widget } }[n] ?? { error: `no ${n}` }),
      owners: [
        { name: 'flow', keys: new Set(['name', 'label', 'nodes']), member: (k) => Flow._zod.def.shape[k] },
        { name: 'stack', keys: new Set(['flows', 'label']), member: () => null },
      ],
      named: [{ name: 'NodeSchema', schema: Node, keys: new Set(['id', 'kind', 'extra']), required: new Set(['id', 'kind']) }],
      exported: new Set(['defineFlow']),
      componentProps: { 'page:header': fakeObject({ actions: fakeOptional({ safeParse: (v) => (Array.isArray(v) && v.every((x) => typeof x === 'string') ? ok(v) : fail([{ code: 'invalid_type', path: [0], message: 'expected string' }])) }), object: str }) },
      mapFields: ['flows'],
    };
    const item = (mapKey, value, marks = newMarks()) => ({ mapKey, value, marks });
    expect('map: a factory maps to its registry type', resolveTarget(item('defineFlow', {}), index).label === 'flow');
    expect('map: a define* the spec does not export is factory-unknown, said so',
      /not exported/.test(resolveTarget(item('defineObject', {}), index).detail ?? '') && resolveTarget(item('defineObject', {}), index).miss === 'factory-unknown');
    expect('map: a type annotation maps to the exported `<T>Schema`', resolveTarget(item('type:DashboardWidget', {}), index).label === 'DashboardWidgetSchema');
    expect('map: `Plugin` is never mapped to PluginSchema', resolveTarget(item('type:Plugin', {}), index).miss === 'unmapped');
    expect('map: tier 1 — the one registry owner of every key, judged partially', resolveTarget(item('owner', { nodes: [] }), index).label === 'flow(partial)');
    expect('map: tier 1 — two owners of a key is ambiguous, and stops there', resolveTarget(item('owner', { label: 'x' }), index).miss === 'ambiguous-owner');
    expect('map: tier 2 — a complete instance of one named schema is inferred', resolveTarget(item('owner', { id: 'a', kind: 'k' }), index).label === 'NodeSchema(inferred)');
    expect('map: tier 2 — a fragment missing a required key is not inferred', resolveTarget(item('owner', { id: 'a' }), index).miss === 'unmapped');
    expect('map: a tombstone member declares no key', declaredKeys(Tomb._zod.def.shape).join() === 'id');
    const piped = { _zod: { def: { type: 'pipe', in: { _zod: { def: { type: 'transform' } } }, out: Flow } } };
    expect('map: a preprocess pipe yields its OUT side\'s shape', objectShapeOf(piped) === Flow._zod.def.shape);
    const judge = (value, marks, target = { kind: 'schema', schema: Flow, label: 'flow' }) => judgeItem({ value, marks }, target, index.componentProps, index.mapFields);
    const wrongKey = judge({ name: 'f', nam: 'x' }, newMarks());
    expect('judge: an unrecognized key is a trusted structural issue', wrongKey.issues.length === 1 && wrongKey.issues[0].code === 'unrecognized_keys');
    const m1 = newMarks();
    m1.opaque.push(['name']);
    expect('judge: an issue AT an opaque node is suppressed and counted', judge({ name: undefined }, m1).issues.length === 0 && judge({ name: undefined }, m1).suppressed === 1);
    const m2 = newMarks();
    m2.open.push([]);
    expect('judge: a missing key on a spread-open object is forgiven', judge({ label: 'x' }, m2).issues.length === 0);
    const m3 = newMarks();
    m3.opaque.push(['label']);
    expect('judge: an unrecognized key survives an opaque sibling', judge({ name: 'f', label: undefined, bad: 1 }, m3).issues.some((i) => i.code === 'unrecognized_keys'));
    const uTrusted = { code: 'invalid_union', path: [], errors: [[{ code: 'invalid_type', path: ['a'] }], [{ code: 'unrecognized_keys', keys: ['a'], path: [] }]] };
    const uOpaque = { code: 'invalid_union', path: [], errors: [[{ code: 'invalid_value', path: ['kind'] }], [{ code: 'unrecognized_keys', keys: ['a'], path: [] }]] };
    const m4 = newMarks();
    m4.opaque.push(['kind']);
    expect('judge: a union is trusted only when EVERY branch failed for a trusted reason',
      isTrusted(uTrusted, [], m4, { a: 1 }) === true && isTrusted(uOpaque, [], m4, { a: 1, kind: undefined }) === false);
    expect('judge: an issue ABOVE an opaque node is suppressed', isTrusted({ code: 'custom', path: [] }, [], m4, {}) === false);
    const page = { regions: [{ components: [{ type: 'page:header', properties: { actions: [{ name: 'x' }], object: 'a' } }, { type: 'custom.x', properties: { anything: 1 } }] }] };
    const props = componentPropsIssues(page, index.componentProps);
    expect('judge: a component\'s properties are judged by its ComponentPropsMap row; an unknown type is skipped',
      props.length === 1 && props[0].path.join('.') === 'regions.0.components.0.properties.actions.0' && props[0].component === 'page:header');
    const viaDs = componentPropsIssues({ type: 'page:header', dataSource: { object: 'a' }, properties: {} }, index.componentProps);
    expect('judge: a missing `object` prop a sibling dataSource.object supplies is not reported', viaDs.length === 0);
    const mm = newMarks();
    mm.opaque.push(['flows', 'b', 'x']);
    const norm = normalizeStackMaps({ flows: { a: { label: 'A' }, b: { name: 'keep' } } }, mm, ['flows']);
    expect('judge: a stack map is normalized to an array, key as `name`, marks re-rooted',
      norm.flows[0].name === 'a' && norm.flows[1].name === 'keep' && mm.opaque[0].join('.') === 'flows.1.x');
    expect('judge: a signature folds array indices', issueSignature('flow', { code: 'x', path: ['nodes', 3, 'id'] }) === 'flow|x|nodes.#.id');
    const counterFence = probeFence(fence('ts', "// ❌ wrong\ndefineFlow({ name: 'f', bad: 1 })"), deps, index);
    expect('judge: a refused counter-example is counted, carries no replay signature, and is not a red',
      counterFence.verdict === 'counter' && counterFence.counterRefused === 1 && counterFence.items[0].signatures.length === 0);
  }

  // ── replay ──
  battery(B.replay);
  {
    const F = (body, verdict, sigs = [], codeKey = body) => ({ body, codeKey, result: { verdict, items: [{ signatures: sigs }] } });
    const c = (args) => classifyReplay({ fixed: true, inCorpus: true, ...args });
    expect('replay: no fix commit → no-fix', classifyReplay({ fixed: false }).cls === 'no-fix');
    expect('replay: no published-catalog file → not-in-corpus', classifyReplay({ fixed: true, inCorpus: false }).cls === 'not-in-corpus');
    expect('replay: no fence touched → prose', c({ before: [F('a', 'green')], after: [F('a', 'green')] }).cls === 'prose');
    const hit = c({ before: [F('a', 'red', ['s1'])], after: [F('b', 'green')] });
    expect('replay: flagged BEFORE, signature gone AFTER → HIT', hit.hit === true && hit.cls === 'HIT' && hit.removed.join() === 's1');
    expect('replay: only comments or string contents changed → comment-or-string',
      c({ before: [F('a // x', 'green', [], 'K')], after: [F('a // y', 'green', [], 'K')] }).cls === 'comment-or-string');
    expect('replay: the same signature on both sides → both', c({ before: [F('a', 'red', ['s1'])], after: [F('b', 'red', ['s1'])] }).cls === 'both');
    expect('replay: an unreadable touched BEFORE fence → transform', c({ before: [F('a', 'miss')], after: [F('b', 'green')] }).cls === 'transform');
    expect('replay: read, mapped, green on both sides → neither', c({ before: [F('a', 'green')], after: [F('b', 'green')] }).cls === 'neither');
    expect('replay: the miss classes are an exact enumeration',
      Object.keys(REPLAY_MISS_CLASSES).join() === 'no-fix,not-in-corpus,prose,comment-or-string,both,transform,neither');
    const k1 = codeKeyOf(ts, fence('ts', "a({ b: 'one' }) // c1"));
    const k2 = codeKeyOf(ts, fence('ts', "a({ b: 'two' }) /* c2 */"));
    const k3 = codeKeyOf(ts, fence('ts', "a({ c: 'one' })"));
    expect('replay: the code key ignores comments and string contents, not keys', k1 === k2 && k1 !== k3);
    const named = [21537, 21567, 21415, 21583, 21627, 21588, 21211, 21288, 21392, 20196, 20173, 20090];
    expect('replay: REPLAY_SET holds the twelve ids premise 1 names', named.every((n) => REPLAY_SET.some((r) => r.card === n)));
    expect('replay: REPLAY_SET rows are unique cards with a 40-hex sha or none',
      new Set(REPLAY_SET.map((r) => r.card)).size === REPLAY_SET.length && REPLAY_SET.every((r) => r.sha === null || /^[0-9a-f]{40}$/.test(r.sha)));
  }
}
