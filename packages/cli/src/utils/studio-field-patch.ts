// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Studio field-patch — ts-morph powered surgery on a single field
 * inside an `ObjectSchema.create({...})` or `defineObject({...})` call.
 *
 * Supported field shapes:
 *   account_number: Field.autonumber({ ...props })          // CallExpression
 *   owner:          Field.lookup('user', { ...props })      // CallExpression with second-arg object
 *   custom:         { ...props }                            // bare ObjectLiteral
 *
 * Properties we know how to update: `label`, `description`, `required`.
 * Falsy values (`null`, `''`, `false`) are interpreted as "remove this
 * property" so the source stays minimal.
 */
import {
  Project,
  SyntaxKind,
  type SourceFile,
  type ObjectLiteralExpression,
  type CallExpression,
  type PropertyAssignment,
} from 'ts-morph';

export interface FieldPatch {
  label?: string | null;
  description?: string | null;
  required?: boolean | null;
}

export type PatchResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Locate the field's inner object-literal and apply the patch.
 * Writes the file in place when successful.
 */
export async function patchObjectFieldFile(
  absPath: string,
  fieldKey: string,
  patch: FieldPatch,
): Promise<PatchResult> {
  return withFieldsObj(absPath, async (fieldsObj) => {
    const fieldProp = fieldsObj.getProperty(fieldKey);
    if (!fieldProp || !fieldProp.isKind(SyntaxKind.PropertyAssignment)) {
      return { ok: false, error: `field \`${fieldKey}\` not found in fields` };
    }
    const innerObj = resolveInnerObjectLiteral((fieldProp as PropertyAssignment).getInitializer());
    if (!innerObj) {
      return { ok: false, error: `field \`${fieldKey}\` initializer has no editable object literal` };
    }

    if ('label' in patch) applyStringProp(innerObj, 'label', patch.label);
    if ('description' in patch) applyStringProp(innerObj, 'description', patch.description);
    if ('required' in patch) applyBooleanProp(innerObj, 'required', patch.required);
    return { ok: true };
  });
}

/**
 * Append a new field to the `fields: { ... }` object literal. The
 * `initializer` is the raw TS source that goes on the right-hand side
 * of `<fieldName>: …` — typically an object literal but may be any
 * expression (e.g. `Field.text({ ... })`).
 *
 * Refuses to overwrite an existing field — callers must surface a
 * conflict to the user.
 */
export async function addObjectField(
  absPath: string,
  fieldName: string,
  initializer: string,
): Promise<PatchResult> {
  if (!/^[a-z_][a-z0-9_]*$/.test(fieldName)) {
    return { ok: false, error: `invalid field name \`${fieldName}\` (must be snake_case)` };
  }
  return withFieldsObj(absPath, async (fieldsObj) => {
    if (fieldsObj.getProperty(fieldName)) {
      return { ok: false, error: `field \`${fieldName}\` already exists` };
    }
    try {
      // Append by raw-text insertion so we match the file's existing
      // indentation / line-break conventions instead of forcing ts-morph
      // defaults (which produced 6-space indent and a flush-left closing
      // brace inside a 4-space-indented body).
      const openBrace = fieldsObj.getFirstChildByKind(SyntaxKind.OpenBraceToken);
      const closeBrace = fieldsObj.getLastChildByKind(SyntaxKind.CloseBraceToken);
      if (!openBrace || !closeBrace) {
        return { ok: false, error: 'malformed object literal (missing braces)' };
      }
      const sf = fieldsObj.getSourceFile();
      const fullText = sf.getFullText();
      const bodyStart = openBrace.getEnd();
      const bodyEnd = closeBrace.getStart();

      // Detect existing indentation by sniffing the original source:
      //   propIndent  — leading whitespace before the first existing prop
      //   closeIndent — leading whitespace before the existing close brace
      // Both are read verbatim so the new prop and the close brace land at
      // the exact columns the file already uses (handles 2-space, 4-space,
      // tabs, or anything else without guessing the indent step).
      const sniffIndent = (pos: number): string => {
        let i = pos - 1;
        while (i >= 0 && (fullText[i] === ' ' || fullText[i] === '\t')) i--;
        return fullText.slice(i + 1, pos);
      };
      const firstProp = fieldsObj.getProperties()[0];
      const closeIndent = sniffIndent(closeBrace.getStart());
      let propIndent: string;
      if (firstProp && firstProp.isKind(SyntaxKind.PropertyAssignment)) {
        propIndent = sniffIndent(firstProp.getStart());
      } else {
        // Empty `{}` — give the new prop one step beyond the close brace.
        // Default to two spaces; if the close-brace indent looks tab-based,
        // use a tab.
        propIndent = closeIndent + (closeIndent.includes('\t') ? '\t' : '  ');
      }

      // Body region between braces; rebuild with the new prop appended,
      // ensuring trailing comma + newline + indent before the new prop and
      // a newline + closing indent before the close brace.
      const body = fullText.slice(bodyStart, bodyEnd);
      let trimmed = body.replace(/\s+$/, '');
      if (trimmed && !trimmed.endsWith(',')) trimmed += ',';
      const isEmpty = trimmed.length === 0;
      const newBody = isEmpty
        ? `\n${propIndent}${fieldName}: ${initializer},\n${closeIndent}`
        : `${trimmed}\n${propIndent}${fieldName}: ${initializer},\n${closeIndent}`;
      // Use raw SourceFile.replaceText to avoid ts-morph auto-reindenting
      // every line inside the literal (replaceWithText on an ObjectLiteral
      // re-indents by manipulation settings, shifting unchanged lines).
      sf.replaceText([bodyStart, bodyEnd], newBody);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: `add failed: ${err?.message ?? String(err)}` };
    }
  });
}

/**
 * Re-order the properties inside the `fields: { ... }` object literal
 * to match `order[]`. Field names absent from `order` are appended at
 * the end in their existing relative order — keeps the operation safe
 * if the UI has a stale snapshot.
 *
 * Implementation: slice each property's source range out of the file
 * (including any leading whitespace / blank-line / comment trivia and
 * the trailing `,`), then concatenate the slices in the new order. By
 * working on the raw source, indentation, trailing commas, blank-line
 * separators and inline comments are all preserved verbatim. The only
 * cost: a hanging blank line that previously sat *between* two props
 * follows whichever property it precedes after the reorder, which is
 * the natural and least-surprising behaviour.
 */
export async function reorderObjectFields(
  absPath: string,
  order: readonly string[],
): Promise<PatchResult> {
  if (!Array.isArray(order)) {
    return { ok: false, error: 'order must be an array of field names' };
  }
  return withFieldsObj(absPath, async (fieldsObj) => {
    const props = fieldsObj.getProperties();
    const openBrace = fieldsObj.getFirstChildByKind(SyntaxKind.OpenBraceToken);
    const closeBrace = fieldsObj.getLastChildByKind(SyntaxKind.CloseBraceToken);
    if (!openBrace || !closeBrace) {
      return { ok: false, error: 'malformed object literal (missing braces)' };
    }
    const sf = fieldsObj.getSourceFile();
    const fullText = sf.getFullText();
    const bodyStart = openBrace.getEnd();
    const bodyEnd = closeBrace.getStart();

    // For each property: capture the slice from "just after previous prop's
    // trailing comma" (or bodyStart for the first prop) up to and including
    // this prop's own trailing comma (skipping inline whitespace up to it).
    // Leading whitespace / blank lines / comments that precede a prop stay
    // with that prop, so they travel together when reordered.
    const slices = new Map<string, string>();
    let cursor = bodyStart;
    for (let i = 0; i < props.length; i++) {
      const p = props[i];
      if (!p.isKind(SyntaxKind.PropertyAssignment) && !p.isKind(SyntaxKind.ShorthandPropertyAssignment)) {
        continue;
      }
      const name = (p as any).getName();
      // Find end-of-slice: skip whitespace after the prop, swallow one comma if present.
      let end = p.getEnd();
      while (end < bodyEnd && /[ \t]/.test(fullText[end])) end++;
      if (fullText[end] === ',') end++;
      slices.set(name, fullText.slice(cursor, end));
      cursor = end;
    }
    // Anything between the last prop's comma and the close brace (typically
    // a trailing newline + indentation) becomes the new "tail".
    const tail = fullText.slice(cursor, bodyEnd);

    if (slices.size === 0) {
      return { ok: false, error: '`fields` is empty — nothing to reorder' };
    }

    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const name of order) {
      const slice = slices.get(name);
      if (slice !== undefined) { ordered.push(slice); seen.add(name); }
    }
    // Append anything the UI didn't know about so we never drop fields.
    for (const [name, slice] of slices) {
      if (!seen.has(name)) ordered.push(slice);
    }

    const newBody = ordered.join('') + tail;
    try {
      // sf.replaceText avoids re-indenting unchanged lines, which is what
      // makes fieldsObj.replaceWithText destroy formatting.
      sf.replaceText([bodyStart, bodyEnd], newBody);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: `reorder failed: ${err?.message ?? String(err)}` };
    }
  });
}

/**
 * Shared entry: open the file, drill into the `fields` literal, run
 * `mutate(...)`, persist on success. Centralizes the schema-call /
 * fields-literal lookup that every operation needs.
 */
async function withFieldsObj(
  absPath: string,
  mutate: (fieldsObj: ObjectLiteralExpression) => Promise<PatchResult>,
): Promise<PatchResult> {
  const project = new Project({ useInMemoryFileSystem: false, skipAddingFilesFromTsConfig: true });
  let sf: SourceFile;
  try {
    sf = project.addSourceFileAtPath(absPath);
  } catch (err: any) {
    return { ok: false, error: `parse failed: ${err?.message ?? String(err)}` };
  }
  const schemaCall = findSchemaCall(sf);
  if (!schemaCall) {
    return { ok: false, error: 'no ObjectSchema.create / defineObject call found in file' };
  }
  const schemaArg = schemaCall.getArguments()[0];
  if (!schemaArg || !schemaArg.isKind(SyntaxKind.ObjectLiteralExpression)) {
    return { ok: false, error: 'schema call argument is not an object literal' };
  }
  const fieldsProp = (schemaArg as ObjectLiteralExpression).getProperty('fields');
  if (!fieldsProp || !fieldsProp.isKind(SyntaxKind.PropertyAssignment)) {
    return { ok: false, error: 'schema object has no `fields` property' };
  }
  const fieldsInit = (fieldsProp as PropertyAssignment).getInitializer();
  if (!fieldsInit || !fieldsInit.isKind(SyntaxKind.ObjectLiteralExpression)) {
    return { ok: false, error: '`fields` initializer is not an object literal' };
  }
  const result = await mutate(fieldsInit as ObjectLiteralExpression);
  if (!result.ok) return result;
  try {
    await sf.save();
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: `write failed: ${err?.message ?? String(err)}` };
  }
}

// ─── helpers ────────────────────────────────────────────────────────

function findSchemaCall(sf: SourceFile): CallExpression | null {
  const calls = sf.getDescendantsOfKind(SyntaxKind.CallExpression);
  for (const call of calls) {
    const expr = call.getExpression().getText();
    if (expr === 'ObjectSchema.create' || expr === 'defineObject') {
      return call;
    }
  }
  return null;
}

/**
 * Given a property initializer, return the inner ObjectLiteralExpression
 * we should patch.
 *   - `{ ... }`                       → that literal
 *   - `Field.X({ ... })`              → first arg if object literal
 *   - `Field.X('rel', { ... })`       → second arg
 *   - `Field.X({ ... }, { ... })`     → first arg (defensive)
 */
function resolveInnerObjectLiteral(init: any): ObjectLiteralExpression | null {
  if (!init) return null;
  if (init.isKind(SyntaxKind.ObjectLiteralExpression)) {
    return init as ObjectLiteralExpression;
  }
  if (init.isKind(SyntaxKind.CallExpression)) {
    const args = (init as CallExpression).getArguments();
    for (const arg of args) {
      if (arg.isKind(SyntaxKind.ObjectLiteralExpression)) {
        return arg as ObjectLiteralExpression;
      }
    }
  }
  return null;
}

function applyStringProp(obj: ObjectLiteralExpression, key: string, value: string | null | undefined) {
  const existing = obj.getProperty(key);
  if (value == null || value === '') {
    if (existing) existing.remove();
    return;
  }
  const literal = renderStringLiteral(obj, value);
  if (existing && existing.isKind(SyntaxKind.PropertyAssignment)) {
    (existing as PropertyAssignment).setInitializer(literal);
  } else {
    obj.addPropertyAssignment({ name: key, initializer: literal });
  }
}

/**
 * Render `value` as a TS string literal, preferring whichever quote
 * style (single vs double) the surrounding object already uses for
 * existing string props. Falls back to single quotes — the dominant
 * convention across the codebase — when there's no signal.
 */
function renderStringLiteral(obj: ObjectLiteralExpression, value: string): string {
  let single = 0;
  let double = 0;
  for (const p of obj.getProperties()) {
    if (!p.isKind(SyntaxKind.PropertyAssignment)) continue;
    const init = (p as PropertyAssignment).getInitializer();
    if (!init || !init.isKind(SyntaxKind.StringLiteral)) continue;
    const raw = init.getText();
    if (raw.startsWith("'")) single++;
    else if (raw.startsWith('"')) double++;
  }
  const useDouble = double > single;
  if (useDouble || value.includes("'")) {
    // JSON.stringify gives us proper escaping for `"` and control chars.
    return JSON.stringify(value);
  }
  // Single-quoted: escape only single quotes and backslashes.
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function applyBooleanProp(obj: ObjectLiteralExpression, key: string, value: boolean | null | undefined) {
  const existing = obj.getProperty(key);
  // Default for `required` is false, so we omit the property when false
  // to keep the source minimal — matches what authors hand-write.
  if (value !== true) {
    if (existing) existing.remove();
    return;
  }
  if (existing && existing.isKind(SyntaxKind.PropertyAssignment)) {
    (existing as PropertyAssignment).setInitializer('true');
  } else {
    obj.addPropertyAssignment({ name: key, initializer: 'true' });
  }
}
