// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The mail template hole grammar — ONE copy, read by every reader of a mail
 * template's holes:
 *
 * - `@objectstack/plugin-email`'s renderer (`template-engine.ts`), which
 *   substitutes the holes of every face (`subject`, `bodyText`, `bodyHtml`);
 * - this package's placement judge (`mail-html-hole-placement.ts`), which
 *   classifies where each hole of `bodyHtml` sits;
 * - `@objectstack/lint`'s `email-template-hole-grammar` authoring rule, which
 *   refuses a hole the grammar refuses at `os validate`, `os build`, `os lint`
 *   and the metadata publish door.
 *
 * A hole is `{{path}}`, `{{{path}}}` or either with one formatter from the
 * shared whitelist, `{{ path | formatter[:arg] }}`. The path is a dotted path
 * of word characters. Text between braces that is not a path is not a hole:
 * the renderer leaves it as written.
 *
 * What follows the first `|` is judged by `judgeHoleFormatter`
 * (`template-engine.ts`), the function the in-app template dialect judges its
 * holes with too, so the two dialects refuse the same formatter parts with the
 * same sentence. A refused hole is a hole — it is found, located and named —
 * and the renderer refuses to render it rather than print a wrong value.
 */

import { judgeHoleFormatter, type TemplateHoleGrammarRefusal } from './template-engine';

/** 1=open (`{{` or `{{{`), 2=brace-free inner body, 3=close (`}}` or `}}}`). */
const MAIL_HOLE_SOURCE = String.raw`(\{\{\{?)([^{}]*)(\}\}\}?)`;

/**
 * A fresh global matcher for mail template holes. Capturing the inner body
 * with `[^{}]*` (one star over a negated class, no nested quantifier) keeps
 * the match linear — no polynomial-ReDoS shape; the body is then parsed with
 * plain string operations ({@link parseMailHole}). A new instance per caller,
 * so no two scans share a `lastIndex`.
 */
export function mailHolePattern(): RegExp {
  return new RegExp(MAIL_HOLE_SOURCE, 'g');
}

// Validated against small, already-extracted strings (bounded input → no ReDoS).
const PATH_RE = /^[\w.]+$/;
const FILTER_RE = /^(\w+)(?::\s*'?([^']*?)'?)?$/;

/** A mail hole's inner body, parsed. */
export interface ParsedMailHole {
  path: string;
  formatter?: string;
  /** The formatter's argument, quotes removed; absent when none was written. */
  arg?: string;
  /** Set when the grammar refuses the hole: it is not rendered, and authoring refuses it. */
  refusal?: TemplateHoleGrammarRefusal;
}

/**
 * Parse a hole's inner body (the text between the braces). `null` when the
 * body is not a path with an optional formatter — text the renderer leaves
 * verbatim, and that no reader treats as a hole.
 */
export function parseMailHole(inner: string, hole = `{{${inner}}}`): ParsedMailHole | null {
  const pipe = inner.indexOf('|');
  if (pipe === -1) {
    const path = inner.trim();
    return PATH_RE.test(path) ? { path } : null;
  }
  const path = inner.slice(0, pipe).trim();
  if (!PATH_RE.test(path)) return null;
  const formatterPart = inner.slice(pipe + 1).trim();
  const m = FILTER_RE.exec(formatterPart);
  if (!m) return null;
  const formatter = m[1];
  const arg = m[2];
  const refusal = judgeHoleFormatter(hole, formatterPart, formatter, arg);
  return {
    path,
    formatter,
    ...(arg !== undefined ? { arg } : {}),
    ...(refusal ? { refusal } : {}),
  };
}

/** One hole of a mail template face that the grammar refuses. */
export interface MailHoleGrammarFinding {
  /** Offset of the hole's first brace in the face. */
  start: number;
  /** The hole as written, braces included. */
  text: string;
  refusal: TemplateHoleGrammarRefusal;
}

/** Every hole in one mail template face (`subject`, `bodyText` or `bodyHtml`) the grammar refuses, in order. */
export function judgeMailHoleGrammar(face: string): MailHoleGrammarFinding[] {
  if (typeof face !== 'string' || face === '') return [];
  const findings: MailHoleGrammarFinding[] = [];
  for (const m of face.matchAll(mailHolePattern())) {
    const parsed = parseMailHole(m[2], m[0]);
    if (parsed?.refusal) findings.push({ start: m.index ?? 0, text: m[0], refusal: parsed.refusal });
  }
  return findings;
}
