#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #20590 position 5 — EXPOSURE SCAN, measurement only (never a gate).
 *
 * Counts, per corpus of this repository at HEAD, the flow `http` nodes whose
 * `config.headers` carry a credential-shaped value, and the `connector_action`
 * nodes whose `connectorConfig.input` does — split into LITERAL, platform
 * TEMPLATE (`{var}`), and COMPUTED (a JS expression evaluated when the stack
 * loads, which lands in the stored definition as a literal).
 *
 * ## The credential-shape rule applied
 *
 *   R1 (name) — the key, lower-cased with `_` read as `-`, is `authorization`,
 *      `proxy-authorization` or `cookie`, or one of its `-`-separated segments
 *      (or the whole key) is one of: auth, token, secret, password, passwd,
 *      credential, credentials, apikey, api-key (as two segments `api` `key`),
 *      bearer, jwt, session, private-key, access-key, client-secret.
 *   R2 (value) — a string value that opens with an auth scheme and a
 *      credential: /^\s*(bearer|basic|token|digest|apikey)\s+\S/i — whatever
 *      the key is called.
 *
 *   An entry is credential-shaped when R1 or R2 holds. Its value is then:
 *     literal   — a string with no `{…}` platform template in it;
 *     template  — a string carrying a `{…}` template (resolved per run from
 *                 flow variables — NOT a literal credential);
 *     computed  — any non-string expression (identifier, `process.env.X`,
 *                 call, `${}` interpolation): evaluated when the stack
 *                 module loads, so what is stored and served is whatever it
 *                 evaluated to.
 *
 * ## Anchoring
 *
 *   anchored http    — an object literal with `type: 'http'` whose `config`
 *                      object literal has a `headers` object literal.
 *   anchored input   — an object literal with `connectorConfig` whose object
 *                      literal has an `input` object literal (walked
 *                      recursively: a nested object's keys are entries too).
 *   unanchored       — an object literal with BOTH `url` and `headers` keys that
 *                      is not an anchored http config (fetch options, webhook
 *                      and connector definitions, helpers) — listed for manual
 *                      classification, never counted as a flow node.
 *
 * Markdown / MDX files are scanned through their fenced ts/js/json blocks.
 *
 * Usage: node scan-open-map-credentials.mjs [--json <out>]
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');
const SELF_DIR = 'packages/qa/dogfood/probe-20590-p5/';

const CODE_EXT = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;
const DOC_EXT = /\.(md|mdx)$/;
const JSON_EXT = /\.json$/;

function corpusOf(file) {
  if (file.startsWith('examples/app-showcase/')) return 'showcase';
  if (file.startsWith('examples/')) return 'examples (other)';
  if (file.startsWith('packages/qa/')) return 'dogfood / qa fixtures';
  if (/^packages\/(create-objectstack|cli)\/(templates?|template-[^/]+)\//.test(file) || /\/templates?\//.test(file) && file.startsWith('packages/')) return 'packages templates';
  if (file.startsWith('packages/')) {
    return /(\.test\.|\.spec\.|\/test\/|\/tests\/|\/__tests__\/|\/fixtures?\/|\.fixture\.)/.test(file)
      ? 'packages test fixtures' : 'packages source';
  }
  if (file.startsWith('content/docs/')) return 'guidance: content/docs';
  if (file.startsWith('skills/')) return 'guidance: skills';
  return 'other';
}

const NAME_SEGMENTS = new Set([
  'auth', 'token', 'secret', 'password', 'passwd', 'credential', 'credentials', 'apikey',
  'bearer', 'jwt', 'session',
]);
const NAME_PAIRS = ['api-key', 'private-key', 'access-key', 'client-secret'];

function r1(key) {
  if (typeof key !== 'string') return false;
  const k = key.toLowerCase().replace(/_/g, '-');
  if (k === 'authorization' || k === 'proxy-authorization' || k === 'cookie') return true;
  if (NAME_PAIRS.some((p) => k === p || k.includes(p))) return true;
  // camelCase keys (`apiKey`, `clientSecret`) are split into segments too.
  const segs = key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase().replace(/_/g, '-').split('-');
  if (segs.some((s) => NAME_SEGMENTS.has(s))) return true;
  for (let i = 0; i + 1 < segs.length; i++) if (NAME_PAIRS.includes(`${segs[i]}-${segs[i + 1]}`)) return true;
  return false;
}
const R2 = /^\s*(bearer|basic|token|digest|apikey)\s+\S/i;
/**
 * A URL that is itself the credential: userinfo (`//user:pass@`), a query
 * parameter named like a key or token, or an incoming-webhook URL whose path is
 * the secret (Slack `hooks.slack.com/services/…`, Discord `…/api/webhooks/…`).
 * Reported beside the open-map counts, never folded into them.
 */
const URL_SHAPE = /\/\/[^/\s'"]+:[^/\s'"]+@|[?&](api[_-]?key|key|token|access[_-]?token|secret|sig|signature|code)=|hooks\.slack\.com\/services\/|discord(app)?\.com\/api\/webhooks\//i;
const TEMPLATE = /\{[^{}]+\}/;

function propName(p) {
  const n = p.name;
  if (!n) return undefined;
  if (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNumericLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  return '<computed-key>';
}
function prop(obj, name) {
  for (const p of obj.properties) {
    if ((ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && propName(p) === name) return p;
  }
  return undefined;
}
function objInit(p) {
  if (p && ts.isPropertyAssignment(p) && ts.isObjectLiteralExpression(p.initializer)) return p.initializer;
  return undefined;
}
function strInit(p) {
  if (!p || !ts.isPropertyAssignment(p)) return undefined;
  let i = p.initializer;
  // `type: 'http' as const` / `satisfies …` — the literal is one layer down.
  while (ts.isAsExpression(i) || ts.isSatisfiesExpression(i) || ts.isParenthesizedExpression(i)) i = i.expression;
  if (ts.isStringLiteral(i) || ts.isNoSubstitutionTemplateLiteral(i)) return i.text;
  return undefined;
}

/** Classify one entry of an open map. */
function entry(p, sf, file, where) {
  const key = propName(p);
  const out = { file, line: sf.getLineAndCharacterOfPosition(p.getStart(sf)).line + 1, where, key };
  if (ts.isShorthandPropertyAssignment(p)) return { ...out, kind: 'computed', text: key, shaped: r1(key) };
  if (!ts.isPropertyAssignment(p)) return { ...out, kind: 'spread-or-method', text: p.getText(sf).slice(0, 80), shaped: false };
  const i = p.initializer;
  if (ts.isStringLiteral(i) || ts.isNoSubstitutionTemplateLiteral(i)) {
    const v = i.text;
    const shaped = r1(key) || R2.test(v);
    return { ...out, kind: TEMPLATE.test(v) ? 'template' : 'literal', text: v, shaped, rule: r1(key) ? (R2.test(v) ? 'R1+R2' : 'R1') : (R2.test(v) ? 'R2' : '-') };
  }
  if (ts.isObjectLiteralExpression(i)) return { ...out, kind: 'object', text: '{…}', shaped: false, nested: i };
  const text = i.getText(sf);
  const shaped = r1(key) || R2.test(text.replace(/^[`'"]/, ''));
  return { ...out, kind: 'computed', text: text.slice(0, 120), shaped, rule: r1(key) ? 'R1' : (shaped ? 'R2' : '-') };
}

function scanSource(file, text, kind, findings, lineOffset = 0) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const anchoredConfigs = new Set();
  const visit = (node) => {
    if (ts.isObjectLiteralExpression(node)) {
      // anchored http node
      const t = strInit(prop(node, 'type'));
      // A flow node carries an `id` or a `config`; `{ type: 'http' }` alone is
      // an OpenAPI security scheme, an MCP transport or a metrics exporter.
      if (t === 'http' && (prop(node, 'id') || prop(node, 'config'))) {
        const cfg = objInit(prop(node, 'config'));
        findings.httpNodes.push({ file, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 + lineOffset });
        if (cfg) {
          anchoredConfigs.add(cfg);
          const url = prop(cfg, 'url');
          if (url && ts.isPropertyAssignment(url)) {
            const text = url.initializer.getText(sf).slice(0, 160);
            findings.urls.push({ file, line: sf.getLineAndCharacterOfPosition(url.getStart(sf)).line + 1 + lineOffset, text, credentialBearing: URL_SHAPE.test(text) });
          }
          const hp = prop(cfg, 'headers');
          const h = objInit(hp);
          if (hp && !h) findings.httpHeaderNonLiteral.push({ file, line: sf.getLineAndCharacterOfPosition(hp.getStart(sf)).line + 1 + lineOffset, text: hp.getText(sf).slice(0, 120) });
          if (h) {
            findings.httpNodesWithHeaders.push({ file, line: sf.getLineAndCharacterOfPosition(h.getStart(sf)).line + 1 + lineOffset });
            for (const p of h.properties) {
              const e = entry(p, sf, file, 'http.config.headers');
              e.line += lineOffset;
              findings.headerEntries.push(e);
            }
          }
        }
      }
      // anchored connector input
      const cc = objInit(prop(node, 'connectorConfig'));
      if (cc) {
        findings.connectorNodes.push({ file, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 + lineOffset });
        const input = objInit(prop(cc, 'input'));
        const ip = prop(cc, 'input');
        if (ip && !input) findings.inputNonLiteral.push({ file, line: sf.getLineAndCharacterOfPosition(ip.getStart(sf)).line + 1 + lineOffset, text: ip.getText(sf).slice(0, 120) });
        if (input) {
          findings.connectorNodesWithInput.push({ file, line: sf.getLineAndCharacterOfPosition(input.getStart(sf)).line + 1 + lineOffset });
          const walk = (obj, path) => {
            for (const p of obj.properties) {
              const e = entry(p, sf, file, path);
              e.line += lineOffset;
              if (e.kind === 'object') { walk(e.nested, `${path}.${e.key}`); continue; }
              findings.inputEntries.push(e);
            }
          };
          walk(input, 'connectorConfig.input');
        }
      }
      // unanchored url+headers
      if (!anchoredConfigs.has(node) && prop(node, 'url') && objInit(prop(node, 'headers'))) {
        const h = objInit(prop(node, 'headers'));
        const entries = h.properties.map((p) => entry(p, sf, file, 'unanchored.headers'));
        findings.unanchored.push({
          file, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 + lineOffset,
          shaped: entries.filter((e) => e.shaped).map((e) => ({ key: e.key, kind: e.kind, text: e.text })),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

function scanJson(file, text, findings) {
  let doc;
  try { doc = JSON.parse(text); } catch { return; }
  const walk = (v, path) => {
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i}]`)); return; }
    if (!v || typeof v !== 'object') return;
    if (v.type === 'http' && v.config && typeof v.config === 'object') {
      findings.httpNodes.push({ file, line: path });
      if (v.config.headers && typeof v.config.headers === 'object') {
        findings.httpNodesWithHeaders.push({ file, line: path });
        for (const [k, val] of Object.entries(v.config.headers)) {
          const s = typeof val === 'string' ? val : JSON.stringify(val);
          findings.headerEntries.push({ file, line: path, where: 'http.config.headers', key: k, kind: typeof val === 'string' ? (TEMPLATE.test(s) ? 'template' : 'literal') : 'computed', text: s, shaped: r1(k) || R2.test(s) });
        }
      }
    }
    if (v.connectorConfig && typeof v.connectorConfig === 'object') {
      findings.connectorNodes.push({ file, line: path });
      const inp = v.connectorConfig.input;
      if (inp && typeof inp === 'object') {
        findings.connectorNodesWithInput.push({ file, line: path });
        const w = (o, p) => {
          for (const [k, val] of Object.entries(o)) {
            if (val && typeof val === 'object' && !Array.isArray(val)) { w(val, `${p}.${k}`); continue; }
            const s = typeof val === 'string' ? val : JSON.stringify(val);
            findings.inputEntries.push({ file, line: path, where: p, key: k, kind: typeof val === 'string' ? (TEMPLATE.test(s) ? 'template' : 'literal') : 'computed', text: s, shaped: r1(k) || R2.test(s) });
          }
        };
        w(inp, 'connectorConfig.input');
      }
    }
    for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
  };
  walk(doc, '$');
}

const FENCE = /^([ \t]*)(`{3,}|~{3,})[ \t]*([\w-]*)[^\n]*\n([\s\S]*?)^\1\2[ \t]*$/gm;

function scanDoc(file, text, findings) {
  let m;
  FENCE.lastIndex = 0;
  while ((m = FENCE.exec(text))) {
    const lang = (m[3] || '').toLowerCase();
    const body = m[4];
    const lineOffset = text.slice(0, m.index).split('\n').length; // fence line
    if (['ts', 'tsx', 'typescript', 'js', 'jsx', 'javascript', 'mjs'].includes(lang)) {
      findings.docBlocks++;
      // A snippet that opens with a bare `{ … }` parses as a BLOCK statement, so
      // its object literal is invisible; read it as an expression instead (one
      // added line, so the offset moves back by one).
      const bare = body.trimStart().startsWith('{');
      scanSource(file, bare ? `(\n${body}\n)` : body, lang.includes('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS, findings, bare ? lineOffset - 1 : lineOffset);
    } else if (['json', 'jsonc'].includes(lang)) {
      findings.docBlocks++;
      scanJson(file, body, findings);
    }
  }
}

function newFindings() {
  return {
    files: 0, docBlocks: 0,
    httpNodes: [], httpNodesWithHeaders: [], httpHeaderNonLiteral: [], headerEntries: [], urls: [],
    connectorNodes: [], connectorNodesWithInput: [], inputNonLiteral: [], inputEntries: [],
    unanchored: [],
  };
}

const CONTROL = process.argv.includes('--control');
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();
const files = execFileSync('git', ['ls-files'], { cwd: REPO, encoding: 'utf8' }).split('\n').filter(Boolean)
  // Normal run: this directory's probe flows are excluded. `--control`: ONLY
  // this directory, whose expected counts are pinned below.
  .filter((f) => (CONTROL ? f.startsWith(SELF_DIR) : !f.startsWith(SELF_DIR)))
  .filter((f) => !/(^|\/)CHANGELOG\.md$/.test(f))
  .filter((f) => CODE_EXT.test(f) || DOC_EXT.test(f) || JSON_EXT.test(f));

const byCorpus = new Map();
for (const f of files) {
  const c = corpusOf(f);
  if (!byCorpus.has(c)) byCorpus.set(c, newFindings());
  const fx = byCorpus.get(c);
  let text;
  try { text = readFileSync(resolve(REPO, f), 'utf8'); } catch { continue; }
  fx.files++;
  if (CODE_EXT.test(f)) scanSource(f, text, f.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS, fx);
  else if (DOC_EXT.test(f)) scanDoc(f, text, fx);
  else if (JSON_EXT.test(f) && text.includes('"http"') || JSON_EXT.test(f) && text.includes('connectorConfig')) scanJson(f, text, fx);
}

const summary = { repo: 'objectstack-ai/objectstack', head, rule: 'R1 (name) or R2 (auth-scheme value); literal = string without {…}', corpora: {} };
for (const [c, fx] of [...byCorpus.entries()].sort()) {
  const hShaped = fx.headerEntries.filter((e) => e.shaped);
  const iShaped = fx.inputEntries.filter((e) => e.shaped);
  const count = (arr, kind) => arr.filter((e) => e.kind === kind).length;
  const nodesWith = (arr, kind) => new Set(arr.filter((e) => e.kind === kind).map((e) => `${e.file}`)).size;
  summary.corpora[c] = {
    filesScanned: fx.files,
    docCodeBlocks: fx.docBlocks,
    httpNodes: fx.httpNodes.length,
    httpNodesWithHeaders: fx.httpNodesWithHeaders.length,
    headerEntries: fx.headerEntries.length,
    headerEntriesCredentialShaped: { literal: count(hShaped, 'literal'), template: count(hShaped, 'template'), computed: count(hShaped, 'computed') },
    httpHeadersNotAnObjectLiteral: fx.httpHeaderNonLiteral.length,
    connectorNodes: fx.connectorNodes.length,
    connectorNodesWithInput: fx.connectorNodesWithInput.length,
    inputEntries: fx.inputEntries.length,
    inputEntriesCredentialShaped: { literal: count(iShaped, 'literal'), template: count(iShaped, 'template'), computed: count(iShaped, 'computed') },
    connectorInputNotAnObjectLiteral: fx.inputNonLiteral.length,
    unanchoredUrlPlusHeaders: fx.unanchored.length,
    unanchoredWithCredentialShapedHeader: fx.unanchored.filter((u) => u.shaped.length).length,
    httpNodeUrlsCredentialBearing: fx.urls.filter((u) => u.credentialBearing).length,
    filesWithShapedLiteral: nodesWith([...hShaped, ...iShaped], 'literal'),
  };
  summary.corpora[c].detail = {
    shapedHeaderEntries: hShaped.map(({ file, line, key, kind, rule, text }) => ({ file, line, key, kind, rule, text })),
    shapedInputEntries: iShaped.map(({ file, line, where, key, kind, rule, text }) => ({ file, line, where, key, kind, rule, text })),
    allHeaderEntries: fx.headerEntries.map(({ file, line, key, kind, text }) => ({ file, line, key, kind, text })),
    httpHeadersNotAnObjectLiteral: fx.httpHeaderNonLiteral,
    connectorInputNotAnObjectLiteral: fx.inputNonLiteral,
    unanchoredWithShaped: fx.unanchored.filter((u) => u.shaped.length),
    httpNodeUrls: fx.urls,
    httpNodes: fx.httpNodes,
    connectorNodes: fx.connectorNodes,
  };
}

const outIdx = process.argv.indexOf('--json');
if (outIdx > 0) writeFileSync(process.argv[outIdx + 1], JSON.stringify(summary, null, 2));
const table = Object.entries(summary.corpora).map(([c, s]) => ({
  corpus: c, files: s.filesScanned, 'doc blocks': s.docCodeBlocks, http: s.httpNodes, 'http+headers': s.httpNodesWithHeaders,
  'hdr shaped L/T/C': `${s.headerEntriesCredentialShaped.literal}/${s.headerEntriesCredentialShaped.template}/${s.headerEntriesCredentialShaped.computed}`,
  connector: s.connectorNodes, 'conn+input': s.connectorNodesWithInput,
  'input shaped L/T/C': `${s.inputEntriesCredentialShaped.literal}/${s.inputEntriesCredentialShaped.template}/${s.inputEntriesCredentialShaped.computed}`,
  'unanchored url+hdr (shaped)': `${s.unanchoredUrlPlusHeaders} (${s.unanchoredWithCredentialShapedHeader})`,
  'cred-URL': s.httpNodeUrlsCredentialBearing,
}));
console.log(`scan-open-map-credentials at ${head} (${files.length} files)`);
console.table(table);

if (CONTROL) {
  // Expected over this directory: probe-flow.ts (template-literal and
  // identifier values -> computed), scan-control.fixture.ts (plain literals),
  // scan-control.fixture.md (a bare-object doc block).
  const c = summary.corpora['dogfood / qa fixtures'];
  const want = {
    httpNodes: 4,
    'header literal': 3, 'header template': 1, 'header computed': 4,
    connectorNodes: 2, 'input literal': 2, 'input computed': 2,
    'cred-URL': 1,
  };
  const got = c && {
    httpNodes: c.httpNodes,
    'header literal': c.headerEntriesCredentialShaped.literal,
    'header template': c.headerEntriesCredentialShaped.template,
    'header computed': c.headerEntriesCredentialShaped.computed,
    connectorNodes: c.connectorNodes,
    'input literal': c.inputEntriesCredentialShaped.literal,
    'input computed': c.inputEntriesCredentialShaped.computed,
    'cred-URL': c.httpNodeUrlsCredentialBearing,
  };
  const bad = Object.entries(want).filter(([k, v]) => !got || got[k] !== v);
  console.log(bad.length === 0
    ? `CONTROL PASS: every arm fired as expected ${JSON.stringify(got)}`
    : `CONTROL FAIL: ${JSON.stringify(bad.map(([k, v]) => ({ k, want: v, got: got?.[k] })))}`);
  process.exitCode = bad.length === 0 ? 0 : 1;
}
