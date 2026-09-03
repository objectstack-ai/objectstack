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
 *
 * The second `describe` is #14518 and is deliberately NOT wizard-scoped: the
 * per-object translation pin that used to live in the first one is replaced by
 * a bundle-wide one, because an instance-scoped pin is what left eight authored
 * messages behind when #14311 fixed four.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';

import stack from '../objectstack.config.js';
import { Account, Project } from '../src/data/objects/index.js';
import { NewProjectWizardPage } from '../src/ui/pages/new-project-wizard.page.js';

type Rule = {
  type?: string;
  name?: string;
  field?: string;
  initialStates?: string[];
  message?: string;
  then?: Rule;
  otherwise?: Rule;
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

/**
 * [#14518] EVERY authored `validations[].message` the showcase declares is on
 * the #14253 translation channel, in every locale the app claims to support.
 *
 * Bundle-wide on purpose. #14311 put `showcase_project`'s four rules on the
 * channel and stopped there, because its scope was one wizard — which left
 * eight (seven on `showcase_account`, one on `showcase_task`) refusing in
 * English inside an otherwise zh-CN error envelope. A pin scoped to one object
 * polices that object; the NEXT rule to be declared rots the same way. This
 * asks the question of the whole registered surface instead, so a new rule
 * without a translation fails here rather than shipping.
 *
 * Read on the COMPOSED stack — `stack.objects`, `stack.objectExtensions`,
 * `stack.translations`, `stack.i18n` — the reachability principle `seed.test.ts`
 * documents: what the resolver and the lint gates see is the composed stack,
 * not the imported modules. The locale list is the app's OWN claim
 * (`i18n.supportedLocales`) rather than a literal, so adding a locale to the
 * config puts every authored sentence in scope for it instead of silently
 * declaring coverage nobody wrote.
 */
describe('#14518 — every authored validation message in the showcase is translated', () => {
  interface AuthoredRule { object: string; name: string; message: string }

  /**
   * Every named rule an object declares, DESCENDING into `conditional`
   * branches.
   *
   * A `then` / `otherwise` branch is a full rule carrying its own `name`, and
   * `checkConditional` renders THAT branch's message — the wrapping rule's
   * sentence never reaches a caller. So a flat walk of `validations[]` misses
   * exactly the messages a user actually reads, which is what the premise test
   * below pins by name.
   */
  function authoredRules(objectName: string, validations: unknown): AuthoredRule[] {
    const out: AuthoredRule[] = [];
    const visit = (rule: Rule | undefined): void => {
      if (!rule || typeof rule !== 'object') return;
      if (typeof rule.name === 'string' && typeof rule.message === 'string' && rule.message !== '') {
        out.push({ object: objectName, name: rule.name, message: rule.message });
      }
      visit(rule.then);
      visit(rule.otherwise);
    };
    for (const rule of Array.isArray(validations) ? validations : []) visit(rule as Rule);
    return out;
  }

  const declaredRules: AuthoredRule[] = [
    ...((stack.objects ?? []) as Array<{ name?: string; validations?: unknown }>)
      .flatMap((o) => (typeof o?.name === 'string' ? authoredRules(o.name, o.validations) : [])),
    // An extension's `validations` MERGE into the target object at
    // registration (`ObjectExtensionSchema` carries them), so such a rule is
    // addressed under `extend` — not under the extension. None declares one
    // today; the walk is here so the first one is not a silent hole.
    ...((stack.objectExtensions ?? []) as Array<{ extend?: string; validations?: unknown }>)
      .flatMap((e) => (typeof e?.extend === 'string' ? authoredRules(e.extend, e.validations) : [])),
  ];

  const locales = (stack.i18n?.supportedLocales ?? []) as string[];
  const defaultLocale = (stack.i18n?.defaultLocale ?? 'en') as string;

  /** What the resolver would find at `objects.<o>._validations.<rule>.message`. */
  function bundleMessage(locale: string, objectName: string, ruleName: string): unknown {
    for (const bundle of (stack.translations ?? []) as Array<Record<string, any>>) {
      const found = bundle?.[locale]?.objects?.[objectName]?._validations?.[ruleName]?.message;
      if (found !== undefined) return found;
    }
    return undefined;
  }

  it('the premise: the walk sees the registered surface, nested branches included', () => {
    // Without these the assertions below pass vacuously — over no locales, no
    // objects, or a rule set that stops at the top level of `validations[]`.
    expect(locales).toContain(defaultLocale);
    expect(locales.filter((l) => l !== defaultLocale).length).toBeGreaterThan(0);
    expect(new Set(declaredRules.map((r) => r.object)).size).toBeGreaterThanOrEqual(3);
    expect(declaredRules.map((r) => r.name)).toContain('churn_reason_present');
  });

  it('every authored rule message has a bundle entry in every supported locale', () => {
    // Reported as a LIST rather than one failing assertion per rule: the whole
    // population is the finding, and #14311 stopping at four is precisely the
    // shape a first-failure-only report encourages.
    const missing: string[] = [];
    for (const rule of declaredRules) {
      for (const locale of locales) {
        const message = bundleMessage(locale, rule.object, rule.name);
        if (typeof message !== 'string' || message.length === 0) {
          missing.push(`${locale}: objects.${rule.object}._validations.${rule.name}.message`);
        }
      }
    }
    expect(missing, 'authored messages with no bundle entry refuse in the source language').toEqual([]);
  });

  it('the default-locale entry is the authored sentence verbatim', () => {
    // The bundle WINS over `rule.message` in every locale, `en` included, so an
    // entry that has drifted from the object turns the sentence authored beside
    // the rule into text no reader ever sees — the object file then documents a
    // refusal the app does not give.
    for (const rule of declaredRules) {
      expect(
        bundleMessage(defaultLocale, rule.object, rule.name),
        `objects.${rule.object}._validations.${rule.name} (${defaultLocale}) has drifted from the authored message`,
      ).toBe(rule.message);
    }
  });

  it('a non-default locale is actually translated, not a copy of the source', () => {
    for (const locale of locales.filter((l) => l !== defaultLocale)) {
      for (const rule of declaredRules) {
        const message = bundleMessage(locale, rule.object, rule.name) as string;
        // A copy of the English satisfies "a key exists" while reproducing the
        // defect exactly — which is the failure mode this whole file is about.
        expect(message, `${rule.object}.${rule.name} in ${locale} is a copy of the source`)
          .not.toBe(rule.message);
        if (locale.startsWith('zh')) {
          expect(message, `${rule.object}.${rule.name} in ${locale} is not Chinese`).toMatch(/[一-龥]/);
        }
      }
    }
  });
});
