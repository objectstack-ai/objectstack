// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An L2 action body that calls a write method of `ctx.api` without granting
 * itself `api.write` (#35143, Seeds and actions family).
 *
 * ## Why
 *
 * An action body runs in the QuickJS sandbox with exactly the capabilities its
 * `body.capabilities` grants (`HookBodyCapability`, `@objectstack/spec/data`).
 * The sandbox installs the six write leaves of `ctx.api.object(name)` —
 * `insert`, `update`, `delete`, `updateMany`, `deleteMany`, `upsert` — behind
 * the `api.write` token (`installCtx`, `packages/runtime/src/sandbox/
 * quickjs-runner.ts`), and a call the body was not granted throws at the call
 * site: the action answers `403 INSUFFICIENT_PRIVILEGES` on every click that
 * reaches it, and nothing is written. Until this rule nothing at authoring time
 * compared the calls with the grant; the save and `os validate` passed.
 *
 * The grant is the author's to write: Studio's action inspector draws the
 * capability list (`ScriptCapabilitiesField`), and a body `os build` lowers
 * from a handler gets the grant inferred from its calls.
 *
 * ## How the source is read
 *
 * Read, never parsed or run: this rule gates the runtime `action` and `object`
 * publish doors, where the source parsers may never load
 * (`runtime-lazy-deps.test.ts`, tier 1). Strings, template literals and
 * comments are blanked first, so a call spelled inside one is never read as
 * code. Then three shapes are recognised:
 *
 *   - a write called on `ctx.api.object(…)` itself (`?.` allowed);
 *   - the same on a local bound to `ctx.api` — `const api = ctx.api` or
 *     `const { api } = ctx` / `const { api: a } = ctx` — declared once and
 *     never reassigned;
 *   - a write called on a local bound to the handle —
 *     `const repo = ctx.api.object('x')` then `repo.update(…)` — declared once
 *     and never reassigned.
 *
 * Anything else is not judged (a dynamic method, `ctx.api['object']`, an alias
 * of an alias): a missed finding, never a false one. A regular-expression
 * literal is not blanked; one that spells a whole write call is the accepted
 * remainder.
 *
 * ## Severity
 *
 * `error`: the grant is a fact of the metadata and the refusal is a fact of
 * the sandbox, so a body that reaches the call fails every time. The one
 * reading under which the body works is that the call is never reached, and a
 * write the author wrote and never runs is no reason to publish it.
 */

import { collectActionBodies } from './validate-action-body-writes.js';

type AnyRec = Record<string, unknown>;

const ACTION_BODY_WRITE_CAPABILITY_UNDECLARED = 'action-body-write-capability-undeclared';

/**
 * The write leaves the sandbox installs on `ctx.api.object(name)` behind
 * `api.write` — `WRITE` in `installCtx`. Pinned equal to the runner's list by
 * this rule's test.
 */
export const SANDBOX_API_WRITE_METHODS: readonly string[] = [
  'insert',
  'update',
  'delete',
  'updateMany',
  'deleteMany',
  'upsert',
];

export interface ActionBodyCapabilityFinding {
  severity: 'error';
  rule: string;
  where: string;
  path: string;
  message: string;
  hint: string;
}

/** Blank string, template-literal and comment contents, keeping every offset. */
export function maskBodySource(source: string): string {
  const out = source.split('');
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '/' && source[i + 1] === '/') {
      const nl = source.indexOf('\n', i);
      const end = nl === -1 ? source.length : nl;
      blank(i, end);
      i = end;
    } else if (ch === '/' && source[i + 1] === '*') {
      const close = source.indexOf('*/', i + 2);
      const end = close === -1 ? source.length : close + 2;
      blank(i, end);
      i = end;
    } else if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1;
      while (j < source.length && source[j] !== ch) {
        if (source[j] === '\\') j++;
        else if (ch !== '`' && source[j] === '\n') break;
        j++;
      }
      blank(i + 1, Math.min(j, source.length));
      i = j + 1;
    } else {
      i++;
    }
  }
  return out.join('');
}

const IDENT = String.raw`[A-Za-z_$][\w$]*`;
const WRITE_ALT = [...SANDBOX_API_WRITE_METHODS].sort((a, b) => b.length - a.length).join('|');
/** `.update(` / `?.insert(` — a write leaf called on what precedes it. */
const WRITE_CALL = new RegExp(String.raw`^\s*\??\.\s*(${WRITE_ALT})(?![\w$])\s*\(`);

function escapeIdentifier(name: string): string {
  return name.replace(/\$/g, '\\$');
}

/** The index just past the `)` that closes the `(` at `open`, or -1. */
function closeParen(masked: string, open: number): number {
  let depth = 0;
  for (let k = open; k < masked.length; k++) {
    const c = masked[k];
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return k + 1;
    }
  }
  return -1;
}

/** `name` is declared exactly once (`const|let|var`) and never assigned again. */
function boundOnce(masked: string, name: string, declarations: number): boolean {
  const id = escapeIdentifier(name);
  const declared = masked.match(new RegExp(String.raw`\b(?:const|let|var)\s+${id}(?![\w$])`, 'g'))?.length ?? 0;
  const inPattern = masked.match(new RegExp(String.raw`\b(?:const|let|var)\s*\{[^}]*(?<![\w$])${id}(?![\w$])[^}]*\}`, 'g'))?.length ?? 0;
  if (declared + inPattern !== 1) return false;
  const assigned =
    masked.match(new RegExp(String.raw`(?<![\w$.])${id}\s*(?:[-+*/%&|^]|\*\*|<<|>>>?|&&|\|\||\?\?)?=(?![=>])`, 'g'))?.length ?? 0;
  const stepped = masked.match(new RegExp(String.raw`(?:\+\+|--)\s*${id}(?![\w$])|(?<![\w$.])${id}\s*(?:\+\+|--)`, 'g'))?.length ?? 0;
  return assigned === declarations && stepped === 0;
}

/**
 * The write methods a body calls through `ctx.api` (see the header for the
 * three shapes), in first-seen order.
 */
export function bodyApiWriteCalls(source: string): string[] {
  if (!/\bapi\b/.test(source)) return [];
  const masked = maskBodySource(source);

  // Receivers that are `ctx.api`: the expression itself, and locals bound to it.
  const receivers: string[] = [String.raw`(?<![\w$.])ctx\s*\??\.\s*api(?![\w$])`];
  for (const m of masked.matchAll(new RegExp(String.raw`\b(?:const|let|var)\s+(${IDENT})\s*=\s*ctx\s*\.\s*api(?![\w$])(?!\s*(?:\?|\.|\[|\())`, 'g'))) {
    if (boundOnce(masked, m[1], 1)) receivers.push(String.raw`(?<![\w$.])${escapeIdentifier(m[1])}(?![\w$])`);
  }
  for (const m of masked.matchAll(new RegExp(String.raw`\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*ctx(?![\w$])(?!\s*(?:\?|\.|\[|\())`, 'g'))) {
    for (const part of m[1].split(',')) {
      const member = /^\s*api\s*(?::\s*([A-Za-z_$][\w$]*)\s*)?$/.exec(part);
      if (!member) continue;
      const local = member[1] ?? 'api';
      if (boundOnce(masked, local, 0)) receivers.push(String.raw`(?<![\w$.])${escapeIdentifier(local)}(?![\w$])`);
    }
  }

  const calls: string[] = [];
  const handles: string[] = [];
  for (const receiver of receivers) {
    const handle = new RegExp(receiver + String.raw`\s*\??\.\s*object\s*\(`, 'g');
    for (const m of masked.matchAll(handle)) {
      const open = (m.index ?? 0) + m[0].length - 1;
      const close = closeParen(masked, open);
      if (close < 0) continue;
      const write = WRITE_CALL.exec(masked.slice(close));
      if (write) {
        calls.push(write[1]);
        continue;
      }
      // `const repo = <receiver>.object(…)` with nothing chained after it.
      const before = masked.slice(0, m.index ?? 0);
      const bound = new RegExp(String.raw`\b(?:const|let|var)\s+(${IDENT})\s*=\s*$`).exec(before);
      if (bound && /^\s*(?:;|\n|$)/.test(masked.slice(close)) && boundOnce(masked, bound[1], 1)) handles.push(bound[1]);
    }
  }
  for (const name of handles) {
    const call = new RegExp(String.raw`(?<![\w$.])${escapeIdentifier(name)}\s*\??\.\s*(${WRITE_ALT})(?![\w$])\s*\(`, 'g');
    for (const m of masked.matchAll(call)) calls.push(m[1]);
  }
  return [...new Set(calls)];
}

/** Every L2 action body that calls a `ctx.api` write without granting `api.write`. */
export function validateActionBodyCapabilities(stack: AnyRec): ActionBodyCapabilityFinding[] {
  const findings: ActionBodyCapabilityFinding[] = [];
  if (!stack || typeof stack !== 'object') return findings;
  for (const site of collectActionBodies(stack)) {
    if (site.capabilities.includes('api.write')) continue;
    const calls = bodyApiWriteCalls(site.source);
    if (calls.length === 0) continue;
    const listed = calls.map((c) => `${c}(…)`).join(', ');
    findings.push({
      severity: 'error',
      rule: ACTION_BODY_WRITE_CAPABILITY_UNDECLARED,
      where: `action "${site.name}" › body`,
      path: site.path.replace(/\.source$/, '.capabilities'),
      message:
        `body calls ctx.api.object(…).${listed} but its capabilities do not grant 'api.write', so the sandbox ` +
        'refuses the call (403 INSUFFICIENT_PRIVILEGES) every time the action reaches it, and nothing is written.',
      hint: "Add 'api.write' to the action's body.capabilities, or remove the write.",
    });
  }
  return findings;
}
