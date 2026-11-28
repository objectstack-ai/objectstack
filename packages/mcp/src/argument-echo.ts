// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * How a tool-argument refusal names what the CALLER sent: a key it wrote, or
 * a path through its arguments. Both MCP doors (HTTP and stdio) refuse a
 * `tools/call` whose arguments fail the tool's published JSON Schema, and the
 * refusal names the offending keys so the caller can fix the call. The names
 * are the caller's own text, so they are echoed BOUNDED and SANITISED:
 *
 *  - at most {@link MAX_ECHOED_KEYS} unknown keys are named per object, and
 *    the rest are counted, not listed;
 *  - each name is cut at {@link MAX_ECHOED_KEY_LENGTH} characters, marked
 *    with a trailing ellipsis;
 *  - every control character (C0, DEL, C1, and the two Unicode line
 *    separators) is written as its `\u` escape, never as the raw character:
 *    a raw newline or NUL in a key would otherwise reach the client's log
 *    and screen as it was sent.
 *
 * The caller sees only its own input, so this is not a disclosure guard; it
 * is the platform's refusal convention (a coded, bounded answer) holding on
 * the one path where the SDK used to answer by itself. The two halves that
 * apply it are `strictToolInput` in `mcp-http-tools.ts` (the platform's own
 * tools, whose unknown-key sentence keeps its rename advice) and the schema
 * refusal in `request-params.ts` (every tool, whoever registered it).
 */

/** Unknown keys named per rejected object; the rest are counted. */
export const MAX_ECHOED_KEYS = 5;

/** Characters of one echoed key (after escaping) before it is cut. */
export const MAX_ECHOED_KEY_LENGTH = 64;

/** C0, DEL, C1, LINE SEPARATOR and PARAGRAPH SEPARATOR. */
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

function escapedCharacter(character: string): string {
  return CONTROL_CHARACTER.test(character)
    ? `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`
    : character;
}

/**
 * One caller-written name as a refusal may echo it: control characters
 * escaped, cut at {@link MAX_ECHOED_KEY_LENGTH} characters with a trailing
 * `…`. The cut falls between whole characters, never inside an escape or a
 * surrogate pair. A name with nothing to escape or cut comes back unchanged,
 * so a plain misspelling (`sort`) is echoed exactly as written.
 */
export function echoedKey(key: string): string {
  let out = '';
  for (const character of key) {
    const next = escapedCharacter(character);
    if (out.length + next.length > MAX_ECHOED_KEY_LENGTH) return `${out}…`;
    out += next;
  }
  return out;
}

/**
 * Server-authored refusal prose with any control character it carries
 * escaped, except the newline and tab the prose itself is laid out with.
 * A backstop for messages this package did not render: a caller's raw
 * control character that reached one is written as its escape.
 */
export function withControlCharactersEscaped(text: string): string {
  let out = '';
  for (const character of text) {
    out += character === '\n' || character === '\t' ? character : escapedCharacter(character);
  }
  return out;
}
