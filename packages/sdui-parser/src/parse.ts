/**
 * ObjectUI — SDUI JSX-source parser (ADR-0080)
 *
 * A small recursive-descent parser for a CONSTRAINED JSX subset. It is
 * deliberately not a full JS/JSX parser: a bounded grammar is the point
 * (Markdoc model) — it shrinks the attack surface and the expressible-but-wrong
 * space. Output is the existing SDUI `SchemaNode` tree. Nothing is executed.
 *
 * Grammar (informal):
 *   document := element                       (exactly one root)
 *   element  := openTag child-star closeTag, or a self-closing tag
 *   attr     := name '=' (string | braced), or a bare name meaning true
 *   child    := element | text | jsx-block-comment
 *   tag      := [A-Za-z][A-Za-z0-9:_-]star      (matches registry keys)
 */

import type { Diagnostic, ParseOptions, ParseResult, SchemaElement, SchemaNode } from './types.js';

/** Event handlers and raw-HTML injection are never allowed (parse ≠ execute). */
const EVENT_ATTR = /^on[A-Z]/;
const FORBIDDEN_ATTRS = new Set(['dangerouslySetInnerHTML', 'ref', 'key']);

export function parseJsx(source: string, options: ParseOptions = {}): ParseResult {
  return new Parser(source, options).parseDocument();
}

const isNameStart = (c: string) => /[A-Za-z]/.test(c);
const isNameChar = (c: string) => /[A-Za-z0-9:_-]/.test(c);

class Parser {
  private pos = 0;
  private readonly diagnostics: Diagnostic[] = [];

  constructor(private readonly src: string, private readonly opts: ParseOptions) {}

  parseDocument(): ParseResult {
    this.skipTrivia();
    if (this.peek() !== '<') {
      this.error('no-root', 'Expected a single root element');
      return { tree: null, diagnostics: this.diagnostics };
    }
    const tree = this.parseElement();
    this.skipTrivia();
    if (tree && this.pos < this.src.length) {
      this.error('multiple-roots', 'A page must have exactly one root element', this.pos);
    }
    return { tree, diagnostics: this.diagnostics };
  }

  private parseElement(): SchemaElement | null {
    const start = this.pos;
    if (!this.eat('<')) {
      this.error('expected-element', 'Expected "<"', start);
      return null;
    }
    const tag = this.readName();
    if (!tag) {
      this.error('bad-tag', 'Expected a tag name after "<"', start);
      return null;
    }
    if (this.opts.allowedTags && !this.opts.allowedTags.has(tag)) {
      this.error('forbidden-tag', `<${tag}> is not an allowed component`, start, tag);
    }

    const props: Record<string, unknown> = {};
    for (;;) {
      this.skipWs();
      const c = this.peek();
      if (c === '' || c === '>' || c === '/') break;
      const attr = this.parseAttr(start, tag);
      if (!attr) break;
      props[attr.name] = attr.value;
    }

    this.skipWs();
    let children: SchemaNode[] | undefined;
    if (this.eat('/')) {
      if (!this.eat('>')) this.error('bad-self-close', `Malformed self-closing <${tag}>`, this.pos, tag);
    } else if (this.eat('>')) {
      children = this.parseChildren(tag);
    } else {
      this.error('unterminated-open-tag', `Unterminated <${tag}> open tag`, start, tag);
    }

    const node: SchemaElement = { type: tag, ...props };
    if (children && children.length) node.children = children;
    return node;
  }

  private parseAttr(elStart: number, tag: string): { name: string; value: unknown } | null {
    const name = this.readName();
    if (!name) {
      this.error('bad-attr', `Malformed attribute on <${tag}>`, this.pos, tag);
      // skip one char to avoid an infinite loop on garbage
      this.pos++;
      return null;
    }
    this.skipWs();
    let value: unknown = true; // bare attribute => boolean true
    if (this.eat('=')) {
      this.skipWs();
      value = this.parseAttrValue(tag);
    }
    if (EVENT_ATTR.test(name) || FORBIDDEN_ATTRS.has(name)) {
      this.error('forbidden-attr', `Attribute "${name}" is not allowed on <${tag}>`, elStart, tag);
      return { name: `__forbidden_${name}`, value: undefined };
    }
    return { name, value };
  }

  private parseAttrValue(tag: string): unknown {
    const c = this.peek();
    if (c === '"' || c === "'") return this.readString(c);
    if (c === '{') return interpretBrace(this.readBraced());
    this.error('bad-attr-value', `Expected an attribute value on <${tag}>`, this.pos, tag);
    return undefined;
  }

  private parseChildren(parentTag: string): SchemaNode[] {
    const children: SchemaNode[] = [];
    for (;;) {
      if (this.pos >= this.src.length) {
        this.error('unclosed-element', `Unclosed <${parentTag}>`, this.pos, parentTag);
        break;
      }
      // closing tag
      if (this.src.startsWith('</', this.pos)) {
        this.pos += 2;
        this.skipWs();
        const close = this.readName();
        this.skipWs();
        this.eat('>');
        if (close !== parentTag) {
          this.error('mismatched-tag', `Expected </${parentTag}> but found </${close}>`, this.pos, parentTag);
        }
        break;
      }
      // JSX comment {/* ... */}
      if (this.src.startsWith('{/*', this.pos)) {
        const end = this.src.indexOf('*/}', this.pos);
        if (end === -1) {
          this.error('unclosed-comment', 'Unclosed comment', this.pos);
          this.pos = this.src.length;
        } else {
          this.pos = end + 3;
        }
        continue;
      }
      // nested element
      if (this.peek() === '<') {
        const el = this.parseElement();
        if (el) children.push(el);
        continue;
      }
      // expression child {expr} — out of grammar for v1: skip with a warning
      if (this.peek() === '{') {
        const start = this.pos;
        this.readBraced();
        this.error(
          'expression-child',
          'Inline {expression} children are not supported yet — bind via a component prop',
          start,
        );
        continue;
      }
      // text
      //
      // HTML collapses a whitespace run to ONE space; it does not delete it. A
      // bare `.trim()` here deleted the space that separates a text run from an
      // adjacent sibling element, so `A <strong>x</strong> page` compiled to
      // `A`/`page` and the words ran together wherever the tree is rendered.
      // The rule (triage option (b), shared verbatim with the downstream copy
      // of this parser so the two agree): collapse the run, then keep a single
      // leading space only when a sibling precedes the run, and a single
      // trailing space only when a sibling element follows it. At the parent's
      // own start/end the edge space is still dropped, so `<p>  hi  </p>` stays
      // `hi`. A whitespace-only run survives as one space only when it sits
      // BETWEEN siblings — that is the bounded over-generosity of this rule
      // inside block containers like `<ul>`, pinned in the tests.
      const text = this.readTextRun();
      const collapsed = text.replace(/\s+/g, ' ');
      const core = collapsed.trim();
      const afterSibling = children.length > 0;
      const beforeElement = this.peek() === '<' && !this.src.startsWith('</', this.pos);
      if (core) {
        const lead = afterSibling && collapsed.startsWith(' ') ? ' ' : '';
        const trail = beforeElement && collapsed.endsWith(' ') ? ' ' : '';
        children.push(`${lead}${core}${trail}`);
      } else if (collapsed && afterSibling && beforeElement) {
        children.push(' ');
      }
    }
    return children;
  }

  /* ----------------------------- lexing ----------------------------- */

  private peek(): string {
    return this.pos < this.src.length ? this.src[this.pos] : '';
  }

  private eat(ch: string): boolean {
    if (this.src[this.pos] === ch) {
      this.pos++;
      return true;
    }
    return false;
  }

  private readName(): string {
    if (!isNameStart(this.peek())) return '';
    const start = this.pos;
    this.pos++;
    while (this.pos < this.src.length && isNameChar(this.src[this.pos])) this.pos++;
    return this.src.slice(start, this.pos);
  }

  private readString(quote: string): string {
    this.pos++; // opening quote
    const start = this.pos;
    while (this.pos < this.src.length && this.src[this.pos] !== quote) this.pos++;
    const value = this.src.slice(start, this.pos);
    if (!this.eat(quote)) this.error('unterminated-string', 'Unterminated string literal', start);
    return value;
  }

  /** Reads a balanced `{ ... }` run and returns the inner text (no outer braces). */
  private readBraced(): string {
    const start = this.pos;
    let depth = 0;
    let inStr: string | null = null;
    for (; this.pos < this.src.length; this.pos++) {
      const ch = this.src[this.pos];
      if (inStr) {
        if (ch === inStr && this.src[this.pos - 1] !== '\\') inStr = null;
        continue;
      }
      if (ch === '"' || ch === "'") inStr = ch;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          const inner = this.src.slice(start + 1, this.pos);
          this.pos++; // consume closing brace
          return inner;
        }
      }
    }
    this.error('unterminated-brace', 'Unterminated "{"', start);
    return this.src.slice(start + 1);
  }

  private readTextRun(): string {
    const start = this.pos;
    while (this.pos < this.src.length && this.src[this.pos] !== '<' && this.src[this.pos] !== '{') this.pos++;
    return this.src.slice(start, this.pos);
  }

  private skipWs(): void {
    while (this.pos < this.src.length && /\s/.test(this.src[this.pos])) this.pos++;
  }

  /** whitespace + top-level JSX comments */
  private skipTrivia(): void {
    for (;;) {
      this.skipWs();
      if (this.src.startsWith('{/*', this.pos)) {
        const end = this.src.indexOf('*/}', this.pos);
        this.pos = end === -1 ? this.src.length : end + 3;
        continue;
      }
      break;
    }
  }

  private error(code: string, message: string, start?: number, tag?: string): void {
    this.diagnostics.push({ severity: 'error', code, message, start: start ?? this.pos, tag });
  }
}

/**
 * Interpret a braced attribute value `{...}`.
 * JSON-literal values (numbers, booleans, null, strings, arrays, objects with
 * quoted keys) are materialized. Anything else is kept as a deferred expression
 * marker `{ $expr }` — typed and validated later, NEVER evaluated here.
 */
export function interpretBrace(raw: string): unknown {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    return { $expr: trimmed };
  }
}
