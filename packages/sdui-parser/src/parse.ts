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

/**
 * The envelope's own discriminator, which on THIS tier the tag name sets.
 *
 * An authored `type=` attribute is a NAME COLLISION with it, and the parser
 * refuses it at parse time (maintainer ruling 2026-09-01, recorded as an
 * amendment on ADR-0080 — 「响亮拒绝」, quoted verbatim there). One diagnostic
 * naming BOTH the tag and the attribute replaces two bad outcomes:
 *
 *  - the value named another REGISTERED type (`<flex type="grid">`) — the tree
 *    carried `type:'grid'`, `validateTree` found `grid` in the manifest, every
 *    check passed, and the page rendered a grid where the author wrote a flex.
 *    ZERO diagnostics. On the one tier whose whole premise is that unreviewed
 *    and AI-authored source is safe to accept.
 *  - the value named NOTHING registered (`<object-chart type="bar">`, the shape
 *    a react-tier author carries across) — loud, but `unknown-component`
 *    naming `"bar"` reads as a missing plugin, never as a bad prop.
 *
 * ⛔ NOT rescued as `specType` the way the react tier rescues it (objectui#2880):
 * that is consumer-side tolerance, and it would spread an alias concept to a
 * second tier. ⛔ NOT a warning grace period either — the same ruling declined
 * a staged rollout. ⛔ And NOT fixable at the warning layer: `type` is in
 * `validate.ts`'s `BASE_PROPS` deliberately (it is correct for every other
 * member), so removing it there would make every legitimate node warn. The
 * refusal belongs here, at parse.
 *
 * ⚠️ The code is the EXISTING `forbidden-attr`, not a new one, and that is
 * load-bearing rather than lazy: `scripts/check-sdui-lockstep.mjs` holds this
 * copy's diagnostic-code set equal to objectui's at the pinned revision, so a
 * code minted on one side only IS the dialect split that gate exists to catch
 * (#12719). `forbidden-attr` already carries this shape — an attribute this
 * tier refuses, named beside its element — and both copies stamp it.
 */
const DISCRIMINATOR_ATTR = 'type';

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
      // `drop` is set only for the refused discriminator attribute, and only so
      // that ONE diagnostic is what the author gets. The `__forbidden_<name>`
      // sentinel the other refusals park in `props` reaches `validateTree`,
      // which knows no such prop and adds `unknown-prop` naming a key nobody
      // wrote — loud, and pointing at the wrong thing, which is the species of
      // diagnostic this whole change exists to remove. The existing sentinel
      // behaviour is left exactly as it was for the attributes that already had
      // it (`ref`, `key`, `dangerouslySetInnerHTML`, `on*`).
      if (!attr.drop) props[attr.name] = attr.value;
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

    // DEFENSE IN DEPTH (ruled together with the refusal above). `props` used to
    // be spread AFTER `type: tag`, so an authored `type` attribute overwrote the
    // discriminator the tag established and nothing downstream restored it —
    // `compile()` returns this tree as-is and `validateTree` then looks up
    // `manifest.components[node.type]`, i.e. the value the author wrote, not the
    // tag they wrote. The refusal makes that overwrite unreachable; the order
    // here makes it impossible. ⚠️ Reversing the order ALONE would have been a
    // regression of its own — the authored value would then be dropped in
    // silence, trading one silence for another. It is correct only BECAUSE the
    // attribute is refused loudly one function up.
    const node: SchemaElement = { ...props, type: tag };
    if (children && children.length) node.children = children;
    return node;
  }

  private parseAttr(elStart: number, tag: string): { name: string; value: unknown; drop?: boolean } | null {
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
    if (name === DISCRIMINATOR_ATTR) {
      // ONE diagnostic naming both the tag and the attribute — see
      // DISCRIMINATOR_ATTR above for why it replaces both prior outcomes.
      this.error(
        'forbidden-attr',
        `Attribute "${DISCRIMINATOR_ATTR}" is not allowed on <${tag}> — on this tier the tag name IS the `
        + `component, so <${tag}> already means type "${tag}". Delete the attribute, or write the tag of the `
        + 'component you meant.',
        elStart,
        tag,
      );
      return { name, value: undefined, drop: true };
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
 *
 * Strict-JSON values are materialized by `JSON.parse`, exactly as they always
 * were. Beyond that, the JS **literal subset** below is materialized too
 * (objectui#6614 Q1-A, maintainer ruling 2026-08-28). Anything left over — a
 * genuine expression — is kept as the deferred marker `{ $expr }`: typed and
 * validated later, drawing `inert-expression`, and NEVER evaluated here.
 *
 * ORDER IS LOAD-BEARING. `JSON.parse` runs FIRST and is untouched, so every
 * input JSON accepts takes byte-identically the path it took before the literal
 * subset existed. The reader below only ever sees strings `JSON.parse` has
 * already thrown on, which makes strict-JSON invariance a property of the
 * structure rather than of a test.
 *
 * LOCKSTEP: this grammar is the port of objectui's `packages/sdui-parser` copy
 * (objectui#6614). The two copies must agree on the accepted grammar AND on
 * diagnostic codes — if they drift, the save gate and the renderer speak
 * different dialects and a page can save clean and render inert
 * (objectstack#12719 states the invariant; #12977 carries this half of it).
 * Change this block only together with the objectui copy.
 */
export function interpretBrace(raw: string): unknown {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const literal = readLiteral(trimmed);
    return literal === NOT_LITERAL ? { $expr: trimmed } : literal;
  }
}

/* ---------------------- the JS literal subset (#6614) ---------------------- */

/**
 * EXACTLY TWO widenings over JSON, and nothing else:
 *
 *   1. **single-quoted strings** — `{'name'}`, `{['name','amount']}`, and in
 *      key position `{{'pageSize': 25}}`;
 *   2. **unquoted identifier object keys** — `{{pageSize: 25}}`.
 *
 * Everything else JSON refuses is still refused and still becomes `{ $expr }`:
 * trailing commas, comments, array holes, spreads, `undefined` / `NaN` /
 * `Infinity`, `+1` / `.5` / `1.` / `0x1f`, template literals, and every genuine
 * expression — identifiers, member access, calls, operators, ternaries.
 *
 * That list is deliberately short. This is a VALUE grammar, not an evaluator:
 * it contains no identifier lookup and no operator, so there is nothing here to
 * execute (ADR-0080 — this tier parses, never executes). The widening moves the
 * spellings an author writes by habit onto the materialized side; it does not
 * move the boundary between data and code.
 */
const NOT_LITERAL = Symbol('not-a-literal');

/** JSON's whitespace set, not JS's — narrower, and one less thing to diverge. */
const LITERAL_WS = /[ \t\n\r]/;
const IDENT_START = /[A-Za-z_$]/;
const IDENT_CHAR = /[A-Za-z0-9_$]/;
/** JSON's number grammar verbatim: no leading `+`, no `.5`, no `1.`, no hex. */
const NUMBER = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/;
/** JSON's escape set. `\'` is added for single-quoted strings only. */
const SIMPLE_ESCAPE: Record<string, string> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
};

function readLiteral(src: string): unknown {
  const reader = new LiteralReader(src);
  const value = reader.value();
  if (value === NOT_LITERAL) return NOT_LITERAL;
  reader.ws();
  // Trailing anything means the input was an expression that merely STARTS with
  // a literal (`['a'] + x`, `1 + 2`). Refuse the whole input.
  return reader.done() ? value : NOT_LITERAL;
}

class LiteralReader {
  private pos = 0;

  constructor(private readonly src: string) {}

  done(): boolean {
    return this.pos >= this.src.length;
  }

  ws(): void {
    while (this.pos < this.src.length && LITERAL_WS.test(this.src[this.pos])) this.pos++;
  }

  value(): unknown {
    this.ws();
    const c = this.src[this.pos];
    if (c === undefined) return NOT_LITERAL;
    if (c === '"' || c === "'") return this.string(c);
    if (c === '[') return this.array();
    if (c === '{') return this.object();
    if (this.keyword('true')) return true;
    if (this.keyword('false')) return false;
    if (this.keyword('null')) return null;
    return this.number();
  }

  /** A keyword only when it is not the prefix of a longer identifier. */
  private keyword(word: string): boolean {
    if (!this.src.startsWith(word, this.pos)) return false;
    const after = this.src[this.pos + word.length];
    if (after !== undefined && IDENT_CHAR.test(after)) return false;
    this.pos += word.length;
    return true;
  }

  private number(): unknown {
    const m = NUMBER.exec(this.src.slice(this.pos));
    if (!m) return NOT_LITERAL;
    this.pos += m[0].length;
    return Number(m[0]);
  }

  private string(quote: string): unknown {
    this.pos++; // opening quote
    let out = '';
    for (;;) {
      const c = this.src[this.pos];
      if (c === undefined) return NOT_LITERAL; // unterminated
      if (c === quote) {
        this.pos++;
        return out;
      }
      if (c === '\\') {
        const esc = this.src[this.pos + 1];
        if (esc === undefined) return NOT_LITERAL;
        if (esc === 'u') {
          const hex = this.src.slice(this.pos + 2, this.pos + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) return NOT_LITERAL;
          out += String.fromCharCode(parseInt(hex, 16));
          this.pos += 6;
          continue;
        }
        // `\'` is legal inside a single-quoted string only — JSON's set otherwise.
        if (esc === "'" && quote === "'") {
          out += "'";
          this.pos += 2;
          continue;
        }
        const simple = SIMPLE_ESCAPE[esc];
        if (simple === undefined) return NOT_LITERAL; // `\x41`, `\0`, line continuation
        out += simple;
        this.pos += 2;
        continue;
      }
      // JSON forbids raw control characters inside a string; so does this.
      if (c < ' ') return NOT_LITERAL;
      out += c;
      this.pos++;
    }
  }

  private array(): unknown {
    this.pos++; // '['
    const out: unknown[] = [];
    this.ws();
    if (this.src[this.pos] === ']') {
      this.pos++;
      return out;
    }
    for (;;) {
      const item = this.value();
      if (item === NOT_LITERAL) return NOT_LITERAL;
      out.push(item);
      this.ws();
      const c = this.src[this.pos];
      // A trailing comma leaves `value()` facing `]`, which it refuses — so
      // `['a',]` is NOT in the subset. Only two widenings were ruled.
      if (c === ',') {
        this.pos++;
        continue;
      }
      if (c === ']') {
        this.pos++;
        return out;
      }
      return NOT_LITERAL;
    }
  }

  private object(): unknown {
    this.pos++; // '{'
    const out: Record<string, unknown> = {};
    this.ws();
    if (this.src[this.pos] === '}') {
      this.pos++;
      return out;
    }
    for (;;) {
      this.ws();
      const key = this.key();
      if (key === NOT_LITERAL) return NOT_LITERAL;
      this.ws();
      if (this.src[this.pos] !== ':') return NOT_LITERAL;
      this.pos++;
      const item = this.value();
      if (item === NOT_LITERAL) return NOT_LITERAL;
      // ⚠️ Plain `out[key] = item` would hand an authored `__proto__` key the
      // prototype SETTER. `JSON.parse` creates an ordinary own data property,
      // and this path must too: the whole point of this tier is that untrusted
      // source is safe to parse, so a widening must not open a
      // prototype-pollution lever the strict-JSON path never had.
      Object.defineProperty(out, key as string, {
        value: item,
        writable: true,
        enumerable: true,
        configurable: true,
      });
      this.ws();
      const c = this.src[this.pos];
      if (c === ',') {
        this.pos++;
        continue;
      }
      if (c === '}') {
        this.pos++;
        return out;
      }
      return NOT_LITERAL;
    }
  }

  /** A quoted string, or a bare identifier — the second ruled widening. */
  private key(): unknown {
    const c = this.src[this.pos];
    if (c === '"' || c === "'") return this.string(c);
    if (c !== undefined && IDENT_START.test(c)) {
      const start = this.pos;
      this.pos++;
      while (this.pos < this.src.length && IDENT_CHAR.test(this.src[this.pos])) this.pos++;
      return this.src.slice(start, this.pos);
    }
    return NOT_LITERAL;
  }
}
