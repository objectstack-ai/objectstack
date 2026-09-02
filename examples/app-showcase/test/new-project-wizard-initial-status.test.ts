// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14311] The New Project wizard may not offer a status the state machine
 * refuses on create.
 *
 * The wizard's second step listed `status`, and a `select` renders its whole
 * option list — all five project statuses. `project_status_flow` declares
 * `initialStates: ['planned']`, so four of those five were dead ends: the
 * wizard accepted the pick, walked the author through a third step, and only
 * then answered `400 VALIDATION_FAILED` from the create. A demo of
 * "state machine + wizard" that demos a dead end teaches the wrong thing.
 *
 * These tests read the REAL page and the REAL object rather than a copy of
 * either, so the invariant is checked against what the app actually ships:
 * widening `initialStates`, re-adding the field, or adding a status option
 * re-opens the question here instead of rotting silently.
 *
 * The last test is the end-to-end half, on the production harness (real
 * `ObjectQL`, real `SqlDriver`, the app's REAL object): the create the wizard
 * now performs succeeds, the one it used to allow is refused, and the refusal
 * carries the field location and the legal initial states a form needs to act
 * on it. Asserting only "it throws" would pass against a rejection for any
 * other reason — including the `required` check, which is what a naive "just
 * drop the field" fix would have tripped.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';

import { Account, Project } from '../src/data/objects/index.js';
import { NewProjectWizardPage } from '../src/ui/pages/new-project-wizard.page.js';
import { ShowcaseTranslationBundle } from '../src/system/translations/index.js';

type Rule = {
  type?: string;
  name?: string;
  field?: string;
  initialStates?: string[];
  message?: string;
};

const APP_ID = 'com.objectstack.showcase';
const PACKAGE_ID = `app:${APP_ID}`;
const ctx = { context: { userId: 'u_showcase', isSystem: true } };

const openEngines: ObjectQL[] = [];
afterEach(async () => {
  while (openEngines.length) {
    try { await openEngines.pop()?.destroy(); } catch { /* noop */ }
  }
});

/**
 * The showcase's real objects on a real engine — same wiring as
 * `hook-body-persisted-writes.test.ts`. `showcase_project.account` is a
 * REQUIRED lookup, so `Account` is registered too and a real row is created:
 * a rejection for a dangling reference would otherwise be indistinguishable
 * from the state-machine refusal this test is about.
 */
async function bootShowcase(): Promise<ObjectQL> {
  const driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  await driver.connect();

  const engine = new ObjectQL();
  openEngines.push(engine);
  engine.registerDriver(driver as never, true);
  await engine.init();
  for (const def of [Account, Project]) {
    engine.registry.registerObject(def as never, PACKAGE_ID, 'showcase');
  }
  await engine.syncSchemas();
  return engine;
}

/** The `project_status_flow` state machine, read off the real object. */
const statusRule = ((Project as unknown as { validations?: Rule[] }).validations ?? []).find(
  (r) => r?.type === 'state_machine' && r?.field === 'status',
)!;

/** Every field the wizard's create form exposes, across all of its steps. */
function wizardFields(): string[] {
  const regions = (NewProjectWizardPage as unknown as {
    regions?: Array<{ components?: Array<{ type?: string; properties?: Record<string, unknown> }> }>;
  }).regions ?? [];
  const out: string[] = [];
  for (const region of regions) {
    for (const component of region.components ?? []) {
      if (component?.type !== 'object-form') continue;
      const sections = (component.properties?.sections ?? []) as Array<{ fields?: string[] }>;
      for (const section of sections) out.push(...(section.fields ?? []));
    }
  }
  return out;
}

/** The declared option values of a select field on the real object. */
function optionValues(field: string): string[] {
  const def = (Project as unknown as {
    fields?: Record<string, { options?: Array<{ value?: string } | string> }>;
  }).fields?.[field];
  return (def?.options ?? []).map((o) => (typeof o === 'object' && o !== null ? String(o.value) : String(o)));
}

describe('#14311 — the New Project wizard and the status state machine', () => {
  it('the premise: the object still constrains which status a project may be created in', () => {
    // If this ever stops holding, the rest of this file is asserting nothing.
    expect(statusRule?.name).toBe('project_status_flow');
    expect(statusRule?.initialStates).toEqual(['planned']);
    expect((statusRule as { events?: string[] }).events).toContain('insert');
  });

  it('the wizard does not offer a status the machine refuses on create', () => {
    const offered = wizardFields();
    const initial = statusRule.initialStates ?? [];
    const refusable = optionValues('status').filter((v) => !initial.includes(v));

    // More than one legal initial state would make a narrowed select the right
    // shape; with exactly one, the field must simply not be asked.
    expect(refusable.length).toBeGreaterThan(0);
    expect(initial).toHaveLength(1);
    expect(offered).not.toContain('status');
  });

  it('the value the wizard relies on is the machine entry point (a default, not a copy of it)', () => {
    // Omitting the field only works because the object DEFAULTS it, and only
    // stays correct because the default IS the declared initial state.
    const def = (Project as unknown as {
      fields?: Record<string, { options?: Array<{ value?: string; default?: boolean }> }>;
    }).fields?.status;
    const defaulted = (def?.options ?? []).filter((o) => o?.default).map((o) => String(o.value));
    expect(defaulted).toEqual(statusRule.initialStates);
  });

  it("the rule's refusal is on the translation channel in both shipped locales", () => {
    // An authored `validations[].message` is emitted VERBATIM unless the bundle
    // carries `objects.<o>._validations.<rule>.message` (#14253). This was the
    // only English sentence on an otherwise zh-CN form.
    const name = statusRule.name!;
    for (const locale of ['en', 'zh-CN'] as const) {
      const entry = (ShowcaseTranslationBundle as any)[locale]
        ?.objects?.showcase_project?._validations?.[name];
      expect(entry?.message, `${locale} is missing a message for ${name}`).toBeTruthy();
    }
    // The zh-CN entry must actually be Chinese — an English copy would satisfy
    // "a key exists" while reproducing the defect exactly.
    const zh = (ShowcaseTranslationBundle as any)['zh-CN']
      .objects.showcase_project._validations[name].message as string;
    expect(zh).toMatch(/[一-龥]/);
    expect(zh).not.toBe(statusRule.message);
  });

  it('creates with the wizard payload and refuses the status it used to offer', async () => {
    const engine = await bootShowcase();
    const account: any = await engine.insert(
      'showcase_account', { name: 'Northwind' }, ctx as never,
    );

    // What the wizard now sends: no `status` at all.
    const created: any = await engine.insert(
      'showcase_project',
      { name: 'Wizard smoke', account: String(account.id), health: 'green' },
      ctx as never,
    );
    expect(created.status).toBe('planned');

    // What it used to let an author send from step 2.
    let thrown: any;
    try {
      await engine.insert(
        'showcase_project',
        { name: 'Born active', account: String(account.id), status: 'active' },
        ctx as never,
      );
    } catch (e) { thrown = e; }

    expect(thrown, 'expected the create to be refused').toBeDefined();
    // ADR-0112 envelope — REST maps this to `400 VALIDATION_FAILED` verbatim.
    expect(thrown.code).toBe('VALIDATION_FAILED');
    const field = thrown.fields?.find((f: any) => f.field === 'status');
    // Field-located, so a multi-step form can jump to the step that owns it.
    expect(field, 'the refusal must name the field it is about').toBeDefined();
    expect(field.code).toBe('invalid_initial_state');
    // #14311 — the facts ride along with the AUTHORED message, so a form can
    // name the legal entry points without parsing the sentence.
    expect(field.constraint).toEqual({ allowed: 'planned' });
    expect(field.value).toBe('active');
  }, 30000);
});
