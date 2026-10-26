/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Retirement pin — the legacy `ActionSchema`'s Phase-2 `onSuccess` / `onFailure`
 * callback keys are REFUSED on both published faces, and the `ActionCallback` /
 * `ActionCallbackSchema` names are GONE (objectui#7068, ADR-0049 enforce-or-remove;
 * maintainer ruling option 1, 2026-09-05, immediate, no deprecation window).
 *
 * ## What was measured before the retirement (on `900f8d99`)
 *
 * `crud.ts` declared `ActionCallback` (`{ type: 'toast' | 'message' | 'redirect' |
 * 'reload' | 'custom' | 'ajax' | 'dialog', message?, url?, api?, method?, dialog?,
 * handler? }`) and the legacy `ActionSchema` carried it on `onSuccess?` /
 * `onFailure?`; `zod/crud.zod.ts` mirrored both. Producers: this package's own
 * `phase2-schemas.test.ts` fixture and three `ts` fences in
 * `content/docs/core/enhanced-actions.mdx` — nothing else (`git grep -l
 * ActionCallback` over `packages content skills` hit the five `packages/types`
 * files; positive control `SchemaNodeSchema` hit 22). Readers: none —
 * `ActionRunner` imports `UIActionSchema`, never this interface, and its own
 * `ActionDef.onFailure` is the SECOND meaning of the key (objectui#5934 retired the
 * runner's callback meaning of `onSuccess` and converged it on the spec block).
 * This was the THIRD meaning.
 *
 * ## Why a tombstone on the keys, and a deletion of the type
 *
 * `BaseSchema` is `.passthrough()` on the mirror and carried `[key: string]: any`
 * on the interface until objectui#8347, so DELETING the two keys would have
 * ADMITTED an authored callback unchecked on both faces — kept, inert, and green
 * (the interface refuses it on a fresh literal now, as the base control shows). The keys therefore stay
 * declared as `?: never` / `retirementTombstone()` (the PR #7761 / #7769 shape),
 * and the base-vs-extended contrast is measured below on both faces. The
 * standalone `ActionCallback` type and its mirror have no such escape hatch and
 * are DELETED outright — the route objectui#7664 / PR #7743 took for the
 * `DeclarativeKanban*` trio — and their absence is pinned.
 *
 * ## The comparison pin — the two doors agree
 *
 * `@objectstack/spec`'s `ActionSchema` (through the installed pin) refuses the same
 * callback shape at `onSuccess.navigate` + `unrecognized_keys`, refuses `onFailure`
 * as an unrecognized key, and ACCEPTS `{ navigate, openIn }`. An author now meets
 * the same answer at the authoring site and at publish.
 *
 * The `@ts-expect-error` directives are REAL enforcement: this package type-checks
 * its tests through `tsconfig.test.json`, so re-widening a key fails the build on
 * the unused directive. A green `vitest` run is NOT evidence about them — type
 * assertions are erased before it runs.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { ActionSchema as SpecActionSchema } from '@objectstack/spec/ui';
import * as crudZod from '../zod/crud.zod.js';
import * as zodBarrel from '../zod/index.zod.js';
import { ActionSchema, DetailSchema } from '../zod/crud.zod.js';
import { BaseSchema } from '../zod/base.zod.js';
import { safeValidateSchema } from '../zod/index.zod.js';
import type { ActionSchema as ActionSchemaTS } from '../crud.js';
import type { BaseSchema as BaseSchemaTS } from '../base.js';

const ROOT = resolve(__dirname, '../../../..');
const CRUD_TS = resolve(__dirname, '../crud.ts');

/**
 * The FULL guidance strings, pinned as literals so the derived assertions below
 * cannot all drift together. The first sentence of each is the contract an author
 * acts on: the retired key, and where the live meaning lives.
 */
const ON_SUCCESS_GUIDANCE =
  'RETIRED (ADR-0049) — `onSuccess` is no longer part of this legacy ActionSchema; nothing reads '
  + 'it. It carried a Phase-2 `ActionCallback` object (`{ type: \'toast\' | \'message\' | \'redirect\' | '
  + '\'reload\' | \'custom\' | \'ajax\' | \'dialog\', message?, url?, api?, method?, dialog?, handler? }`) that '
  + 'no renderer or runner ever consumed — the THIRD meaning of this key — and that `@objectstack/spec`\'s '
  + 'ActionSchema refuses at publish (`invalid_type` at `onSuccess.navigate` plus `unrecognized_keys`). '
  + 'Post-success navigation is the spec\'s `onSuccess` block, `{ navigate, openIn }`, declared on '
  + 'UIActionSchema (objectui#5934); a success notice is `successMessage`. Retired under ADR-0049 '
  + 'enforce-or-remove with no deprecation window (maintainer ruling option 1, 2026-09-05).';
const ON_FAILURE_GUIDANCE =
  'RETIRED (ADR-0049) — `onFailure` is no longer part of this legacy ActionSchema; nothing reads '
  + 'it. It carried the same Phase-2 `ActionCallback` object `onSuccess` carried, and '
  + '`@objectstack/spec`\'s ActionSchema declares no `onFailure` at all (an authored one is refused at '
  + 'publish as an unrecognized key). A failure notice is `errorMessage`. Retired under ADR-0049 '
  + 'enforce-or-remove with no deprecation window (maintainer ruling option 1, 2026-09-05).';

/** The values an author would plausibly have written on the retired keys. */
const CALLBACKS: readonly [string, unknown][] = [
  ['toast', { type: 'toast', message: 'Data loaded successfully' }],
  ['message', { type: 'message', message: 'Failed to load data' }],
  ['dialog', { type: 'dialog', dialog: { type: 'dialog', title: 'Failed', content: { type: 'text', content: 'Try again' } } }],
  ['redirect', { type: 'redirect', url: '/done' }],
  ['empty object', {}],
];

const LEGACY_ACTION = { type: 'action', label: 'Load Data', actionType: 'ajax', api: '/api/data', method: 'GET' };

type Issue = { code: string; path: PropertyKey[]; message: string; expected?: string; errors?: Issue[][] };
/** Flatten a union refusal so the arm-level issues are addressable by path. */
const flatIssues = (issues: Issue[]): Issue[] =>
  issues.flatMap((i) => (i.code === 'invalid_union' && i.errors ? i.errors.flat().flatMap((e) => flatIssues([e])) : [i]));

/** The lazy mirror's object shape — `ActionSchema` is `z.lazy(() => BaseSchema.extend(…))`. */
const actionShape = (): Record<string, { description?: string }> =>
  (ActionSchema as unknown as { _def: { getter: () => { shape: Record<string, { description?: string }> } } })._def.getter().shape;

/* ── the Zod half: refused BY NAME, with the guidance in the message ─────── */

describe.each([
  ['onSuccess', ON_SUCCESS_GUIDANCE],
  ['onFailure', ON_FAILURE_GUIDANCE],
] as const)('legacy ActionSchema.%s is RETIRED — the Zod half of the tombstone (objectui#7068)', (key, guidance) => {
  it.each(CALLBACKS)('REFUSES a `%s` callback, naming the retired key in the path and carrying the guidance', (_label, value) => {
    // The pin. Before the retirement this document parsed GREEN (`ActionCallbackSchema
    // .optional()`). Asserting the ENVELOPE — code, path, expected and the exact
    // message — so the pin cannot be satisfied by an unrelated rejection, and a
    // WELL-FORMED callback so it is the KEY that is refused, not its members.
    const result = ActionSchema.safeParse({ ...LEGACY_ACTION, [key]: value });
    expect(result.success, `an authored \`${key}\` was ACCEPTED`).toBe(false);
    if (result.success) return;

    const issue = result.error.issues.find((i) => i.path[0] === key);
    expect(issue, `parse failed, but not on the \`${key}\` path`).toBeTruthy();
    expect(issue?.code).toBe('invalid_type');
    expect((issue as { expected?: string } | undefined)?.expected).toBe('never');
    expect(issue?.path).toEqual([key]);
    expect(issue?.message).toBe(guidance);
    expect(issue?.message).not.toContain('Invalid input: expected never');
  });

  it('is refused at the nested path through a parent that embeds an action — `DetailSchema.actions`', () => {
    const result = DetailSchema.safeParse({ type: 'detail', actions: [{ ...LEGACY_ACTION, [key]: CALLBACKS[0][1] }] });
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find((i) => i.path.join('.') === `actions.0.${key}`);
    expect(issue, `no issue at \`actions.0.${key}\`: ${JSON.stringify(result.error.issues.map((i) => i.path))}`).toBeTruthy();
    expect(issue?.code).toBe('invalid_type');
    expect(issue?.message).toBe(guidance);
  });

  it('is refused through `safeValidateSchema` too — the `AnyComponentSchema` union arm carries the tombstone', () => {
    const result = safeValidateSchema({ ...LEGACY_ACTION, [key]: CALLBACKS[0][1] });
    expect(result.success).toBe(false);
    if (result.success) return;
    const hits = flatIssues(result.error.issues as Issue[]).filter((i) => i.path.length === 1 && i.path[0] === key);
    expect(hits.length, 'the union door did not surface the tombstone').toBeGreaterThan(0);
    for (const hit of hits) expect(hit.message).toBe(guidance);
  });

  it('BASE CONTROL: `BaseSchema` alone ACCEPTS the same document — the extended tombstone shadows the passthrough', () => {
    // The trap this pin keeps visible: a DELETION would have fallen through to
    // exactly this acceptance, kept the callback unvalidated, and stayed green.
    const doc = { ...LEGACY_ACTION, [key]: CALLBACKS[0][1] };
    expect(BaseSchema.safeParse(doc).success).toBe(true);
    expect(ActionSchema.safeParse(doc).success).toBe(false);
  });

  it('keeps the key DECLARED, with the same guidance on `.describe()` — one string, both channels', () => {
    const shape = actionShape();
    expect(Object.keys(shape)).toContain(key);
    expect(shape[key]?.description).toBe(guidance);
  });
});

/* ── the retirement narrows exactly the two keys — the neighbours stay legal ── */

describe('the retirement narrows exactly `onSuccess` / `onFailure` (objectui#7068)', () => {
  it('a legacy action WITHOUT the two keys still parses, and its values survive', () => {
    const result = ActionSchema.safeParse(LEGACY_ACTION);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.api).toBe('/api/data');
  });

  it('control: the adjacent `successMessage` / `errorMessage` — NOT retired — still parse and survive', () => {
    const result = ActionSchema.safeParse({ ...LEGACY_ACTION, successMessage: 'Loaded', errorMessage: 'Failed' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.successMessage).toBe('Loaded');
    expect(result.data.errorMessage).toBe('Failed');
  });

  it('control: the mirror did not stop validating — a wrong-typed `successMessage` is still refused', () => {
    const result = ActionSchema.safeParse({ ...LEGACY_ACTION, successMessage: 42 });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((i) => i.path.join('.'))).toContain('successMessage');
  });

  it('control: `chain` and `redirect` — the declared follow-up and post-action keys — still parse', () => {
    const result = ActionSchema.safeParse({ ...LEGACY_ACTION, chain: [{ type: 'action', label: 'Next' }], redirect: '/done' });
    expect(result.success).toBe(true);
  });

  it('an UNDECLARED key still rides `.passthrough()` — the contrast the tombstones exist for, measured live', () => {
    const result = ActionSchema.safeParse({ ...LEGACY_ACTION, notAKeyAtAll: 'anything' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect((result.data as unknown as Record<string, unknown>).notAKeyAtAll).toBe('anything');
  });
});

/* ── the standalone names are GONE — deletion, not a tombstone (the #7664 route) ── */

describe('`ActionCallback` / `ActionCallbackSchema` are DELETED, not tombstoned (objectui#7068, the objectui#7664 route)', () => {
  it('`ActionCallbackSchema` is exported from neither `crud.zod.ts` nor the `@object-ui/types/zod` barrel', () => {
    expect('ActionCallbackSchema' in crudZod).toBe(false);
    expect('ActionCallbackSchema' in zodBarrel).toBe(false);
    // Non-vacuity: the neighbours the barrel still carries.
    expect('ActionSchema' in crudZod).toBe(true);
    expect('ActionExecutionModeSchema' in zodBarrel).toBe(true);
  });

  function topLevelTypeNames(file: string): string[] {
    const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ESNext, false, ts.ScriptKind.TS);
    return sf.statements
      .filter((s): s is ts.InterfaceDeclaration | ts.TypeAliasDeclaration => ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s))
      .map((s) => s.name.text);
  }

  it('`crud.ts` declares no `ActionCallback` interface or alias any more — read off the AST, so the docblocks that tell the story do not count', () => {
    const names = topLevelTypeNames(CRUD_TS);
    expect(names).not.toContain('ActionCallback');
    // Non-vacuity: the reader sees the declarations that ARE there.
    expect(names).toContain('ActionSchema');
    expect(names).toContain('ActionExecutionMode');
  });

  it('neither barrel names it — `index.ts` and `zod/index.zod.ts` carry zero `ActionCallback` tokens', () => {
    for (const file of ['../index.ts', '../zod/index.zod.ts']) {
      const src = readFileSync(resolve(__dirname, file), 'utf8');
      expect(src.match(/\bActionCallback(Schema)?\b/g) ?? [], `${file} still exports the retired name`).toEqual([]);
      expect(src).toMatch(/\bActionExecutionMode(Schema)?\b/); // the neighbour survives
    }
  });

  it('the two legacy keys are `?: never` on the interface — tombstones, not deletions (the AST reading #7664 established)', () => {
    const sf = ts.createSourceFile(CRUD_TS, readFileSync(CRUD_TS, 'utf8'), ts.ScriptTarget.ESNext, false, ts.ScriptKind.TS);
    const decl = sf.statements.find(
      (s): s is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(s) && s.name.text === 'ActionSchema',
    );
    if (!decl) throw new Error(`no top-level interface ActionSchema in ${CRUD_TS}`);
    const members = decl.members.filter(ts.isPropertySignature).map((m) => ({
      name: ts.isIdentifier(m.name) || ts.isStringLiteral(m.name) ? m.name.text : m.name.getText(sf),
      never: m.type?.kind === ts.SyntaxKind.NeverKeyword,
    }));
    const byName = Object.fromEntries(members.map((m) => [m.name, m.never]));
    expect(byName.onSuccess).toBe(true);
    expect(byName.onFailure).toBe(true);
    expect(byName.confirm).toBe(true); // the tombstone that established the convention (objectui#4314)
    expect(byName.successMessage).toBe(false);
    expect(byName.errorMessage).toBe(false);
  });
});

/* ── comparison pin: the spec door agrees ───────────────────────────────── */

describe('comparison pin — `@objectstack/spec` ActionSchema refuses the same callback shape (objectui#7068)', () => {
  const SPEC_ACTION = { name: 'load', label: 'Load', type: 'script', target: 'loadFn' };

  it('refuses `onSuccess: { type, message }` at `onSuccess.navigate` and as unrecognized keys on the block', () => {
    const result = SpecActionSchema.safeParse({ ...SPEC_ACTION, onSuccess: { type: 'toast', message: 'x' } });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = result.error.issues.map((i) => `${i.code}@${i.path.join('.')}`);
    expect(paths).toContain('invalid_type@onSuccess.navigate');
    expect(paths).toContain('unrecognized_keys@onSuccess');
  });

  it('refuses `onFailure` as an unrecognized key — the spec declares no such key', () => {
    const result = SpecActionSchema.safeParse({ ...SPEC_ACTION, onFailure: { type: 'message', message: 'x' } });
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find((i) => i.code === 'unrecognized_keys' && i.path.length === 0);
    expect(issue?.message).toContain('`onFailure`');
  });

  it('ACCEPTS the live meaning — the `{ navigate, openIn }` block (the shape objectui#5934 converged the runner on)', () => {
    const result = SpecActionSchema.safeParse({ ...SPEC_ACTION, onSuccess: { navigate: '/done', openIn: 'self' } });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect((result.data as { onSuccess?: unknown }).onSuccess).toEqual({ navigate: '/done', openIn: 'self' });
  });
});

/* ── the docs no longer teach the shape ─────────────────────────────────── */

describe('no docs fence authors the retired callback shape any more (objectui#7068)', () => {
  const DOCS = resolve(ROOT, 'content/docs');
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      return statSync(p).isDirectory() ? walk(p) : /\.mdx?$/.test(name) ? [p] : [];
    });
  const CALLBACK_SHAPE = /\bon(Success|Failure):\s*\{\s*(\r?\n\s*)?type\s*:/;

  it('no `onSuccess: { type: … }` / `onFailure: { type: … }` under content/docs — the three fences and the fragment are gone', () => {
    const offenders = walk(DOCS).filter((f) => CALLBACK_SHAPE.test(readFileSync(f, 'utf8'))).map((f) => relative(ROOT, f));
    expect(offenders).toEqual([]);
  });

  it('the scan can see the corpus and the pattern can match (non-vacuity)', () => {
    expect(walk(DOCS).length).toBeGreaterThan(100);
    expect(CALLBACK_SHAPE.test("onSuccess: {\n    type: 'toast',")).toBe(true);
    expect(CALLBACK_SHAPE.test('onSuccess: { navigate: "/done" }')).toBe(false);
  });
});

/* ── the TS half ────────────────────────────────────────────────────────── */

describe('legacy ActionSchema.onSuccess / onFailure are RETIRED — the TS half of the tombstone (objectui#7068)', () => {
  it('refuses both retired keys at compile time, in the form authors actually write — by name, as `never` tombstones, not as undeclared keys', () => {
    // On the pre-fix tree both assignments were LEGAL (`ActionCallback | undefined`),
    // so each directive would be unused and `tsc -p tsconfig.test.json` fails the
    // build with TS2578 naming the line — red before the fix in `type-check`, not
    // in vitest. `BaseSchema` carried `[key: string]: any` when this was written;
    // a declared `never` member wins over it, which is why this is a tombstone and
    // not a deletion (since objectui#8347 a deletion is refused on a fresh literal
    // too, unnamed).
    const retired: ActionSchemaTS = {
      type: 'action',
      label: 'Load',
      // @ts-expect-error — `onSuccess` is RETIRED (objectui#7068): declared `?: never`, so no callback object is authorable.
      onSuccess: { type: 'toast', message: 'ok' },
      // @ts-expect-error — `onFailure` is RETIRED (objectui#7068): declared `?: never`.
      onFailure: { type: 'message', message: 'no' },
    };

    // The migrated document — notices as strings, follow-ups as `chain` — still type-checks.
    const migrated: ActionSchemaTS = {
      type: 'action',
      label: 'Load',
      successMessage: 'ok',
      errorMessage: 'no',
      chain: [{ type: 'action', label: 'Next' }],
      redirect: '/done',
    };

    // BASE CONTROL on the TS face: the same literal WAS a legal `BaseSchema` — the
    // acceptance a deleted member would have fallen through to — until
    // objectui#8347 removed `BaseSchema`'s index signature. The base refuses it
    // now too, so a deleted member is no longer silently acceptable here.
    // @ts-expect-error — `BaseSchema` declares no `onSuccess` and no index signature (objectui#8347).
    const base: BaseSchemaTS = { type: 'action', onSuccess: { type: 'toast', message: 'ok' } };

    expect([retired, migrated, base]).toHaveLength(3);
  });

  it('refuses them through the indexed member type and through a WIDENED value too', () => {
    // @ts-expect-error — `onSuccess` is RETIRED (objectui#7068): the member type is `undefined`, never a callback.
    const viaKey: ActionSchemaTS['onSuccess'] = { type: 'toast' };

    // Excess-property checking only reaches a FRESH literal; the declared `never`
    // makes the assignment itself ill-typed, so freshness stops mattering.
    const raw = { type: 'action' as const, label: 'Load', onFailure: { type: 'message' as const } };
    // @ts-expect-error — `onFailure` is RETIRED (objectui#7068), reached through a non-fresh value.
    const widened: ActionSchemaTS = raw;

    expect([viaKey, widened.type]).toHaveLength(2);
  });
});
