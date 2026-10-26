/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The app document does not carry the mobile navigation mode (objectui#11363).
 *
 * `AppSchemaRenderer` (`@object-ui/layout`) reads the mode from two channels:
 * its own `mobileNavMode` prop, and the `mobileNavMode` key of an
 * `app-schema-renderer` node, which `SchemaRenderer` hands to it as that prop.
 * It never reads `schema.mobileNavMode`. `@objectstack/spec`'s strict
 * `AppSchema` refuses the key (`unrecognized_keys`). objectui's mirror kept it
 * through `BaseSchema`'s `.passthrough()`, misspelt values included, so an app
 * document carrying it parsed clean and the shell drew no bottom bar.
 *
 * Pinned here:
 *   (a) the zod mirror refuses `mobileNavMode` by name, at its own path, for
 *       both legal values and a misspelt one;
 *   (b) the refusal opens with the sentence the spec answers the key with
 *       (read from the spec at run time, not copied) and names both read
 *       channels;
 *   (c) the tolerant validator (`safeValidateSchema`) and the strict authoring
 *       face, which `objectui validate` runs, refuse it at the same path;
 *   (d) the TypeScript face refuses it at the authoring site;
 *   (e) the refusal does not reach an `app-schema-renderer` node: a legal
 *       value adds no issue there, on either face, so the node channel is not
 *       judged by this schema. Since objectui#11440 the node has an arm of its
 *       own, which declares the key as the registration's two-value enum, so a
 *       misspelt value is refused there by THAT enum (`invalid_value`), never by
 *       this document's tombstone (`invalid_type`);
 *   (f) CONTROLS: the same document without the key parses on every face, and
 *       the spec refuses the key, so (a) to (c) are judged by schemas that can
 *       fail, and they match a refusal the platform already gives.
 *
 * The node key's own vocabulary (`'drawer'` | `'bottom_nav'`, `invalid-enum` on
 * a misspelling) is pinned in `@object-ui/layout`, in
 * `appSchemaRendererMobileNavMode.test.tsx`.
 *
 * ## Which program checks this file
 *
 * `packages/types`' `type-check` runs THREE programs; this file is in the third
 * (`tsconfig.test.json`). The `@ts-expect-error` row in (d) is pinned by `tsc`,
 * ⛔ NOT by vitest, which strips types and would pass it vacuously.
 */

import { describe, it, expect } from 'vitest';
import { AppSchema as SpecAppSchema } from '@objectstack/spec/ui';
import type { AppComponentSchema } from '../index';
import { AppComponentSchema as AppComponentZod } from '../zod/app.zod';
import { safeValidateSchema, StrictAnyComponentSchema } from '../zod/index.zod';

type Issue = { code: string; path: string; message: string };
type Parser = { safeParse: (input: unknown) => { success: boolean; error?: { issues: Array<{ code: string; path: PropertyKey[]; message: string }> } } };

const issuesFrom = (r: ReturnType<Parser['safeParse']>): Issue[] | null =>
  r.success ? null : r.error!.issues.map((i) => ({ code: i.code, path: i.path.join('.'), message: i.message }));

/** `null` when the document parses; its issues otherwise. */
const mirrorIssues = (input: unknown) => issuesFrom(AppComponentZod.safeParse(input));
const validatorIssues = (input: unknown) => issuesFrom(safeValidateSchema(input) as ReturnType<Parser['safeParse']>);
const strictIssues = (input: unknown) => issuesFrom((StrictAnyComponentSchema as unknown as Parser).safeParse(input));

const DOC = { type: 'app', name: 'acme_crm', title: 'Acme CRM' } as const;
const SPEC_DOC = { name: 'acme_crm', label: 'Acme CRM' } as const;
const VALUES = ['bottom_nav', 'drawer', 'bottom-nav'] as const;

describe('objectui#11363 — the zod mirror refuses `mobileNavMode` on the app document', () => {
  it.each(VALUES)('refuses %j with one issue, `invalid_type` at `mobileNavMode`', (value) => {
    const issues = mirrorIssues({ ...DOC, mobileNavMode: value });
    expect(issues).toHaveLength(1);
    expect(issues![0]).toMatchObject({ code: 'invalid_type', path: 'mobileNavMode' });
  });

  it('opens with the sentence the spec answers the key with, and names both read channels', () => {
    const spec = SpecAppSchema.safeParse({ ...SPEC_DOC, mobileNavMode: 'bottom_nav' });
    const specMessage = spec.error?.issues[0]?.message ?? '';
    const specLead = specMessage.slice(0, specMessage.indexOf('. ') + 1);
    // The lead has to name the key, or the comparison below proves nothing.
    expect(specLead).toContain('`mobileNavMode`');
    const [issue] = mirrorIssues({ ...DOC, mobileNavMode: 'bottom_nav' })!;
    expect(issue.message.startsWith(specLead)).toBe(true);
    expect(issue.message).toContain('`AppSchemaRenderer`');
    expect(issue.message).toContain('`app-schema-renderer`');
  });

  it('CONTROL — the same document without the key parses green', () => {
    expect(mirrorIssues(DOC)).toBeNull();
  });
});

describe('objectui#11363 — the validator and the strict face refuse it at the same path', () => {
  it.each(VALUES)('`safeValidateSchema` (the tolerant face) refuses %j at `mobileNavMode`', (value) => {
    const issues = validatorIssues({ ...DOC, mobileNavMode: value });
    expect(issues?.map((i) => [i.code, i.path])).toEqual([['invalid_type', 'mobileNavMode']]);
  });

  it.each(VALUES)('the strict authoring face refuses %j at `mobileNavMode`', (value) => {
    const issues = strictIssues({ ...DOC, mobileNavMode: value });
    expect(issues?.map((i) => [i.code, i.path])).toEqual([['invalid_type', 'mobileNavMode']]);
  });

  it('CONTROL — both parse the document without the key', () => {
    expect(validatorIssues(DOC)).toBeNull();
    expect(strictIssues(DOC)).toBeNull();
  });
});

describe('objectui#11363 — the TypeScript face refuses `mobileNavMode` on the app document', () => {
  it('`mobileNavMode` on an `AppComponentSchema` literal is a compile error; the document without it is not', () => {
    // @ts-expect-error — `mobileNavMode` is `never` on the app document: set the
    // `AppSchemaRenderer` prop or the `app-schema-renderer` node key.
    const refused: AppComponentSchema = { type: 'app', name: 'acme_crm', mobileNavMode: 'bottom_nav' };
    const accepted: AppComponentSchema = { type: 'app', name: 'acme_crm' };
    expect(refused.type).toBe(accepted.type);
  });
});

describe('objectui#11363 — the refusal does not reach an `app-schema-renderer` node', () => {
  // The app document is nested under `schema`, its one spelling on this node
  // since objectui#11494; written flat, its keys are unrecognized on the strict
  // face, which would make every comparison below one against a red baseline.
  const NODE = {
    type: 'app-schema-renderer',
    schema: {
      type: 'app',
      title: 'Acme CRM',
      navigation: [{ id: 'accounts', type: 'url', label: 'Accounts', url: '/accounts' }],
    },
  };
  const verdict = (issues: Issue[] | null) => issues?.map((i) => [i.code, i.path]) ?? null;
  const LEGAL = VALUES.filter((value) => value !== 'bottom-nav');

  it.each(LEGAL)('the key (%j) adds no issue to the node on the validator face', (value) => {
    expect(verdict(validatorIssues({ ...NODE, mobileNavMode: value }))).toEqual(verdict(validatorIssues(NODE)));
  });

  it.each(LEGAL)('the key (%j) adds no issue to the node on the strict face', (value) => {
    expect(verdict(strictIssues({ ...NODE, mobileNavMode: value }))).toEqual(verdict(strictIssues(NODE)));
  });

  it('a misspelt value is refused by the node\'s own enum (objectui#11440), never by the app document\'s tombstone', () => {
    for (const issues of [validatorIssues({ ...NODE, mobileNavMode: 'bottom-nav' }), strictIssues({ ...NODE, mobileNavMode: 'bottom-nav' })]) {
      const atKey = (issues ?? []).filter((i) => i.path === 'mobileNavMode');
      expect(atKey.map((i) => i.code)).toEqual(['invalid_value']);
      expect(atKey[0].message).not.toContain('not a key of the app document');
    }
  });

  it('no issue on the node names `mobileNavMode`', () => {
    const all = [...(validatorIssues({ ...NODE, mobileNavMode: 'bottom_nav' }) ?? []), ...(strictIssues({ ...NODE, mobileNavMode: 'bottom_nav' }) ?? [])];
    expect(all.filter((i) => i.path.includes('mobileNavMode') || i.message.includes('mobileNavMode'))).toEqual([]);
  });
});

describe('objectui#11363 — CONTROL: the spec refuses the key, and accepts the document without it', () => {
  it.each(VALUES)('spec `AppSchema` answers %j with `unrecognized_keys` naming `mobileNavMode`', (value) => {
    const r = SpecAppSchema.safeParse({ ...SPEC_DOC, mobileNavMode: value });
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => [i.code, (i as { keys?: string[] }).keys])).toEqual([['unrecognized_keys', ['mobileNavMode']]]);
  });

  it('spec `AppSchema` accepts the document without it', () => {
    expect(SpecAppSchema.safeParse(SPEC_DOC).success).toBe(true);
  });
});
