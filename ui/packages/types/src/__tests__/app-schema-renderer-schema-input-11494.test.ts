/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11494 — `AppSchemaRendererNodeSchema` declares the registration's
 * `schema` input as the app document, BY REFERENCE (triage ruling A, comment
 * `5958227972`).
 *
 * objectui#11440 armed the node with the two inputs that were true then,
 * `basePath` and `mobileNavMode`, and left `schema` undeclared because no node
 * delivered it. `@object-ui/layout` now registers the node through an adapter
 * that hands `node.schema` to `AppSchemaRenderer` (its render rows are
 * `app-schema-renderer-schema-input-11494.test.tsx` in that package), so the
 * input is true and the arm declares it. Pinned here, on both faces:
 *   - the member IS `AppComponentSchema`, the same schema object, so there is
 *     no second copy of the document's members to drift;
 *   - a node carrying its document under `schema` validates, beside the node's
 *     own `basePath` and `mobileNavMode`, which are unchanged;
 *   - one spelling: the same document keys written flat on the node are refused
 *     at the strict face as unrecognized keys;
 *   - the document keeps its own refusals: `mobileNavMode` inside `schema` is
 *     refused by the app document's tombstone (objectui#11363), while the same
 *     value on the node is clean;
 *   - the nested document is the `app` document, its `type` included.
 * Each refusal has a lit control, so no row passes for the wrong reason.
 */

import { describe, expect, it } from 'vitest';
import {
  AppComponentSchema,
  AppSchemaRendererNodeSchema,
  StrictAnyComponentSchema,
  safeValidateSchema,
} from '../zod/index.zod';

type Issue = { code: string; path: PropertyKey[]; message: string; keys?: string[]; errors?: Issue[][] };
type Result = { success: boolean; error?: { issues: unknown[] } };

const FACES: ReadonlyArray<readonly [string, (document: unknown) => Result]> = [
  ['tolerant', (document) => safeValidateSchema(document)],
  ['strict', (document) => StrictAnyComponentSchema.safeParse(document)],
];
const strict = (document: unknown): Result => StrictAnyComponentSchema.safeParse(document);

/** Every issue, union branches unfolded and paths made absolute. */
const allIssues = (issues: Issue[] | undefined, prefix: PropertyKey[] = []): Issue[] =>
  (issues ?? []).flatMap((issue) => {
    const path = [...prefix, ...issue.path];
    return [{ ...issue, path }, ...(issue.errors ?? []).flatMap((branch) => allIssues(branch, path))];
  });
const issuesOf = (result: Result): Issue[] => allIssues(result.error?.issues as Issue[] | undefined);
const at = (result: Result, path: string): Issue[] => issuesOf(result).filter((issue) => issue.path.join('.') === path);
const show = (result: Result): string => JSON.stringify(result.error?.issues ?? []);

const NAVIGATION = [{ id: 'accounts', type: 'object', objectName: 'account', label: 'Accounts' }];
const DOCUMENT = { type: 'app', name: 'acme_crm', title: 'Acme CRM', navigation: NAVIGATION };
const NODE = { type: 'app-schema-renderer', basePath: '/apps/crm', mobileNavMode: 'bottom_nav', schema: DOCUMENT };

describe('`app-schema-renderer` declares `schema` as the app document (objectui#11494)', () => {
  it('the member is `AppComponentSchema` itself, by reference, and optional', () => {
    const member = AppSchemaRendererNodeSchema.shape.schema as unknown as { unwrap: () => unknown; safeParse: (v: unknown) => { success: boolean } };
    expect(member.unwrap()).toBe(AppComponentSchema);
    expect(member.safeParse(undefined).success).toBe(true);
  });

  it.each(FACES)('%s face: a node with its document under `schema` validates, beside `basePath` and `mobileNavMode`', (face, judge) => {
    const result = judge(NODE);
    expect(result.success, `${face}: ${show(result)}`).toBe(true);
  });

  it.each(FACES)('%s face: a node without `schema` still validates (the node the mobile guide teaches)', (face, judge) => {
    const result = judge({ type: 'app-schema-renderer', mobileNavMode: 'bottom_nav' });
    expect(result.success, `${face}: ${show(result)}`).toBe(true);
  });

  it('one spelling: the document\'s keys written flat on the node are refused at the strict face, by name', () => {
    const flat = { type: 'app-schema-renderer', title: 'Acme CRM', navigation: NAVIGATION };
    const keys = at(strict(flat), '').filter((issue) => issue.code === 'unrecognized_keys').flatMap((issue) => issue.keys ?? []);
    expect(keys.sort()).toEqual(['navigation', 'title']);
    // Lit control: the same keys under `schema` are judged by the document, and pass.
    expect(strict({ type: 'app-schema-renderer', schema: { type: 'app', title: 'Acme CRM', navigation: NAVIGATION } }).success).toBe(true);
  });

  it.each(FACES)('%s face: the document keeps its own refusals: `mobileNavMode` inside `schema` is the tombstone', (face, judge) => {
    const issues = at(judge({ type: 'app-schema-renderer', schema: { ...DOCUMENT, mobileNavMode: 'bottom_nav' } }), 'schema.mobileNavMode');
    expect(issues.map((issue) => issue.code), face).toEqual(['invalid_type']);
    expect(issues[0].message).toContain('not a key of the app document');
    // Lit control: the same value on the node, where the mode is read, is clean.
    expect(judge(NODE).success, face).toBe(true);
  });

  it.each(FACES)('%s face: the nested document is the `app` document, its `type` included', (face, judge) => {
    const { type: _type, ...untyped } = DOCUMENT;
    expect(at(judge({ type: 'app-schema-renderer', schema: untyped }), 'schema.type').map((issue) => issue.code), face).toEqual([
      'invalid_value',
    ]);
    expect(at(judge({ type: 'app-schema-renderer', schema: 'acme_crm' }), 'schema').map((issue) => issue.code), face).toEqual([
      'invalid_type',
    ]);
  });

  it('the strict face closes the nested document too: an unknown key inside `schema` is refused by name', () => {
    const keys = at(strict({ type: 'app-schema-renderer', schema: { ...DOCUMENT, brading: {} } }), 'schema')
      .filter((issue) => issue.code === 'unrecognized_keys')
      .flatMap((issue) => issue.keys ?? []);
    expect(keys).toEqual(['brading']);
    // Lit control: the tolerant face keeps the document's passthrough.
    expect(safeValidateSchema({ type: 'app-schema-renderer', schema: { ...DOCUMENT, brading: {} } }).success).toBe(true);
  });
});
