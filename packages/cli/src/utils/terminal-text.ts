// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Text another party wrote, made safe to print as one line of a terminal.
 *
 * The rule: a string a server supplied (an environment's name or id, an error
 * text, a sign-in address, a user code) reaches the terminal only as one line
 * of printable characters, so it can neither start a line of its own nor move
 * the cursor, recolour, retitle or write the clipboard through the terminal.
 * `os mcp connect` and the device-flow sign-ins (`os login`, `os cloud
 * login`) print every such string through {@link terminalText};
 * `packages/cli/test/server-text-reaches-the-terminal-as-one-line.test.ts`
 * holds every print site in those flows to it.
 *
 * What changes: every C0 control (CR, LF and TAB included), DEL, every C1
 * control, the Unicode line and paragraph separators and the bidirectional
 * controls are written as a visible escape (`\x1b`, `\u202e`), so an escape
 * sequence (CSI, OSC and the rest) loses its introducer and prints as plain
 * text. The result is capped at {@link TERMINAL_TEXT_MAX} characters. Text
 * already made of printable characters comes back unchanged, so a value that
 * is printed twice through this function prints the same.
 */

/** The longest text {@link terminalText} returns, in characters, the ellipsis included. */
export const TERMINAL_TEXT_MAX = 512;

/** C0, DEL, C1; the line and paragraph separators; the bidirectional controls. */
const UNPRINTABLE = /[\p{Cc}\u2028\u2029\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;

function escapeFor(character: string): string {
  const code = character.codePointAt(0)!;
  return code <= 0xff ? `\\x${code.toString(16).padStart(2, '0')}` : `\\u${code.toString(16).padStart(4, '0')}`;
}

/** `value` as one line of printable characters, at most `max` characters long. */
export function terminalText(value: unknown, max: number = TERMINAL_TEXT_MAX): string {
  const escaped = String(value).replace(UNPRINTABLE, escapeFor);
  const characters = Array.from(escaped);
  return characters.length <= max ? escaped : `${characters.slice(0, Math.max(0, max - 1)).join('')}\u2026`;
}
