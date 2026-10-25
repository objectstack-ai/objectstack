/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `coerceToSafeValue` — the one answer this package has to "what text does a
 * string-typed cell draw for a value that is not a string?".
 *
 * ## Why this is its own module (objectui#8580)
 *
 * It used to be defined in `./index.tsx`, the barrel, and every text-like cell
 * renderer there reaches it. The rich-content renderers in
 * `./widgets/richTextDisplay.tsx` need the SAME answer — `@objectstack/spec`
 * places `markdown` / `html` / `richtext` in the same value class as `text` /
 * `textarea` / `code` (`STRING_VALUE_TYPES`, "Value is a plain string"), and
 * before objectui#8580 they had a private one: `String(value)`, which drew a
 * childless container for `[]` and the literal `[object Object]` for `{}`
 * where `text` draws the No-value affordance and `[Object]`. That module is
 * imported BY the barrel (`4bb940b6e` extracted it so `RichTextField` could
 * reach the display pipelines without importing the barrel back), so it
 * cannot import the barrel to borrow this helper without re-creating exactly
 * the cycle that extraction removed. The helper therefore lives below both
 * consumers. The barrel re-exports it unchanged; it is part of this package's
 * published surface and nothing about its contract moved.
 */

/**
 * Coerce a value to a safe primitive for rendering.
 * Handles MongoDB wrapper types ($numberDecimal, $oid, $date), expanded
 * reference objects, and arrays so that no raw object is ever passed as
 * a React child — preventing React error #310.
 *
 * A STRING is returned verbatim, whatever its shape. This helper is reached by
 * every text-like cell (`text`, `textarea`, `code`, `time`, `auto_number`,
 * `qrcode` all register to `TextCellRenderer`), so it may not classify a value
 * by looking at its characters. It used to: any string starting `{`/`[` and
 * ending `}`/`]` was `JSON.parse`d and the result run through the
 * reference-label extraction below, which answers `[Object]` for an object
 * carrying no name/label/externalId/id. That turned the showcase Field Zoo's
 * `code` value `{"ok": true}` into the literal `[Object]`, and `[1, 2, 3]` in a
 * text field into `1, 2, 3` (objectui#7246).
 *
 * Shape is not a type. The reference case the parse was written for
 * (objectui#1426 — an unresolved external-id ref arriving as
 * '{"externalId":"Website Relaunch"}') belongs to reference-TYPED columns and
 * is handled there: `LookupCellRenderer` carries its own JSON-string branch,
 * which resolves the label through the referenced object's schema and links to
 * the record — neither of which this type-blind helper could ever do. Scoped,
 * not dropped; both halves are pinned in
 * `__tests__/textCellJsonText-7246.test.tsx`.
 */
export function coerceToSafeValue(value: unknown): string | number | boolean | null | undefined {
  if (value == null) return value as null | undefined;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.map((v) => {
      if (v != null && typeof v === 'object') {
        const obj = v as Record<string, unknown>;
        return String(obj.name || obj.label || obj.externalId || obj.id || obj._id || '[Object]');
      }
      return String(v);
    }).join(', ');
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    // MongoDB numeric wrapper: { $numberDecimal: "250000" }
    if ('$numberDecimal' in obj) return Number(obj.$numberDecimal);
    // MongoDB ObjectId wrapper: { $oid: "abc123" }
    if ('$oid' in obj) return String(obj.$oid);
    // MongoDB date wrapper: { $date: "2024-01-01T00:00:00Z" }
    if ('$date' in obj) return String(obj.$date);
    // Expanded reference / general object: extract name/label/externalId/id
    return String(obj.name || obj.label || obj.externalId || obj.id || obj._id || '[Object]');
  }
  return String(value);
}
