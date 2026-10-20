// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { SysRecordShare } from './sys-record-share.object.js';
import { SysSharingRule } from './sys-sharing-rule.object.js';

/**
 * [#24701] A record share's Recipient column names the recipient through the
 * console's `recipient-picker` face, by a display declaration alone.
 *
 * The face (objectui#12613, at this repository's `.objectui-sha`) reads the
 * row's `recipient_type` from the field's declared siblings, names a `user` id
 * by an exact-id `sys_user` read, and draws the stored text when the row
 * carries no kind. It reads `object_name` only for the `field` recipient kind.
 *
 * Pinned here:
 *  1. the declaration, read off the object, is the sibling object's widget;
 *  2. `dependsOn` names exactly the siblings the face reads for the kinds this
 *     object's select can store;
 *  3. the declaration opens no write path: the column keeps its stored shape,
 *     the data API stays read-only, so no form draws the picker as an editor;
 *  4. `grant()` stays the one insert of a share row in this package, so every
 *     stored recipient is the `user` id it writes (ADR-0111 D7).
 */

type FieldDef = Record<string, unknown>;

const shareFields = SysRecordShare.fields as Record<string, FieldDef>;
const ruleFields = SysSharingRule.fields as Record<string, FieldDef>;

/** The stored values a select field offers. */
function selectValues(field: FieldDef): string[] {
  const options = (field.options as unknown[] | undefined) ?? [];
  return options.map((o) => String(typeof o === 'object' && o !== null ? (o as { value: unknown }).value : o));
}

/**
 * The siblings the `recipient-picker` face reads for an object whose
 * `recipient_type` offers `kinds`: the kind itself always, and the shared
 * object's name only when the `field` kind can be stored.
 */
function siblingsTheFaceReads(kinds: readonly string[]): string[] {
  return ['recipient_type', ...(kinds.includes('field') ? ['object_name'] : [])];
}

describe('sys_record_share.recipient_id — drawn through the recipient-picker face (#24701)', () => {
  it('declares the recipient-picker widget, the one sys_sharing_rule.recipient_id declares', () => {
    expect(shareFields.recipient_id.widget).toBe('recipient-picker');
    expect(shareFields.recipient_id.widget).toBe(ruleFields.recipient_id.widget);
  });

  it('dependsOn names exactly the siblings the face reads for the kinds this object stores', () => {
    const kinds = selectValues(shareFields.recipient_type);
    expect(kinds).not.toContain('field');
    expect(shareFields.recipient_id.dependsOn).toEqual(siblingsTheFaceReads(kinds));
    for (const sibling of shareFields.recipient_id.dependsOn as string[]) {
      expect(shareFields[sibling], `dependsOn names '${sibling}', a field this object does not declare`).toBeDefined();
    }
  });

  it('control: the same rule gives sys_sharing_rule its object_name sibling, because it stores the field kind', () => {
    const kinds = selectValues(ruleFields.recipient_type);
    expect(kinds).toContain('field');
    expect(ruleFields.recipient_id.dependsOn).toEqual(siblingsTheFaceReads(kinds));
  });

  it('the declaration opens no write path: the stored column is unchanged and the data API stays read-only', () => {
    const recipient = shareFields.recipient_id;
    expect({
      type: recipient.type,
      required: recipient.required,
      maxLength: recipient.maxLength,
      reference: recipient.reference,
      referenceVia: recipient.referenceVia,
    }).toEqual({ type: 'text', required: true, maxLength: 100, reference: undefined, referenceVia: undefined });
    const object = SysRecordShare as unknown as {
      managedBy?: unknown;
      enable?: { apiMethods?: unknown };
      userActions?: unknown;
    };
    expect(object.managedBy).toBe('engine-owned');
    expect(object.enable?.apiMethods).toEqual(['get', 'list']);
    expect(object.userActions).toBeUndefined();
  });
});

/**
 * Every `<receiver>.insert(<table>, …)` call in this package's non-test
 * sources, with the table it names and the function it sits in. A table given
 * as an identifier is resolved through a same-file string constant; anything
 * else is reported as unresolved, so the census cannot be passed by spelling a
 * table some other way. Scoped to this package's `src/` on purpose: the share
 * rows are this plugin's, and outside it the only measured writer (the CLI's
 * organization-ownership apply) updates `source_id` and inserts nothing.
 */
describe('sys_record_share — grant() stays the one insert of a share row (#24701)', () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const SRC = resolve(HERE, '..');

  type InsertSite = { file: string; fn: string; table: string };

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
    });
  }

  function enclosingFunction(node: ts.Node): string {
    for (let at: ts.Node | undefined = node.parent; at; at = at.parent) {
      if ((ts.isMethodDeclaration(at) || ts.isFunctionDeclaration(at)) && at.name) return at.name.getText();
    }
    return '(module)';
  }

  function insertSites(): InsertSite[] {
    const sites: InsertSite[] = [];
    for (const path of sourceFiles(SRC)) {
      const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
      const constants = new Map<string, string>();
      const calls: ts.CallExpression[] = [];
      const visit = (node: ts.Node): void => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer
          && ts.isStringLiteralLike(node.initializer)) {
          constants.set(node.name.text, node.initializer.text);
        }
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
          && node.expression.name.text === 'insert' && node.arguments.length > 0) {
          calls.push(node);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
      for (const call of calls) {
        const arg = call.arguments[0]!;
        const table = ts.isStringLiteralLike(arg)
          ? arg.text
          : (ts.isIdentifier(arg) && constants.get(arg.text)) || `(unresolved: ${arg.getText(source)})`;
        sites.push({ file: relative(SRC, path), fn: enclosingFunction(call), table });
      }
    }
    return sites;
  }

  const sites = insertSites();

  it('control: the census reads this package\'s other inserts, so the case below cannot pass on an empty set', () => {
    expect(sites.map((s) => s.table)).toEqual(expect.arrayContaining(['sys_share_link', 'sys_sharing_rule']));
  });

  it('every insert names its table in a form the census reads', () => {
    expect(sites.filter((s) => s.table.startsWith('(unresolved')).map((s) => `${s.file}#${s.fn}: ${s.table}`)).toEqual([]);
  });

  it('the only insert of a sys_record_share row is grant() in sharing-service.ts', () => {
    expect(sites.filter((s) => s.table === 'sys_record_share').map((s) => `${s.file}#${s.fn}`))
      .toEqual(['sharing-service.ts#grant']);
  });
});
