// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #18202 — the cross-reference gate resolves the two ARTIFACT-SCOPED classes
 * against the ARTIFACT, and keeps refusing everything else against the stack.
 *
 * ## The defect
 *
 * ADR-0130 D1 lets one release artifact carry N packages co-owning one
 * namespace; its 2026-09-02 addendum (#14487) rules that **permission sets stay
 * whole in the `type: app` package**. Those two records cannot both hold once
 * the app package owns objects of its own: `defineStack` validates
 * cross-references PER STACK, so an app-owned permission set granting on an
 * object a MODULE owns is refused — measured downstream on
 * `objectstack-ai/hotcrm` `claude/issue-1907-sales-app-service-module`
 * (`be11c07`) as "18 grants across 7 sets". `data[].object` is refused the same
 * way, which is why that branch had to move its seed rows into the module.
 *
 * The addendum's own measurement (hotcrm#1449) never saw it because it measured
 * an app package declaring NO objects — exactly the case
 * `validateCrossReferences` early-returns on (`objectNames.size === 0`). The
 * `ObjectLessPackage` block at the bottom pins that leniency as untouched.
 *
 * ## What is fixed, and what deliberately is not
 *
 * `DefineStackOptions.artifactObjects` widens `permissions[].objects` and
 * `data[].object` — and NOTHING else. `hooks[].object` and an app's own
 * `navigation` `objectName` stay refused even when the name is listed, because
 * ADR-0130 §1.5 measured both refusals and recorded them as the SHAPE of the
 * seam: *"navigation crosses only through contributions, and the split must
 * follow hook ownership."* Those two blocks below are the fence on that.
 *
 * ## The refusal MOVED; it did not disappear
 *
 * A name `artifactObjects` claims and no package in the artifact defines is
 * refused by `composeStacks` — the ARTIFACT pass — with the same
 * `STACK_CROSS_REFERENCE_INVALID` envelope, the same 422, and a per-finding
 * message byte-identical to the per-stack pass's. Only the HEADER differs,
 * because only the pass differs. `ArtifactPass` is that fixture, and it is an
 * acceptance criterion of #18202 rather than a nicety.
 *
 * ## What the artifact pass DOES newly refuse, and what it must never do
 *
 * The compatibility statement that holds is not "nothing can newly fail". It
 * is two statements:
 *
 * - an input that passed the strict `defineStack` parse cannot newly fail at
 *   composition — its references already resolved against its own objects, a
 *   subset of the composed set;
 * - an input that BYPASSED the strict parse (`strict: false`, a hand-built
 *   stack object) is checked for these two rules at composition for the FIRST
 *   time, and a dangling reference in it is refused where it previously
 *   composed.
 *
 * The second is a narrowing, it is deliberate, and the three blocks at the
 * bottom of this file pin it as declared behaviour: the refusals themselves,
 * the shape guards that keep an unparsed malformed collection a warning rather
 * than a bare `TypeError` outside the ADR-0112 envelope, and the one-input
 * boundary that makes "in a composition of two or more packages" the only
 * correct way to state the guarantee to an author.
 *
 * ## Fixture shape
 *
 * The two-package shape measured downstream, reproduced at its smallest: the
 * `type: app` package owns `crm_account` and carries the permission set; the
 * `type: module` package owns `crm_case` and declares the dependency edge. Note
 * the edge runs MODULE → APP — the app cannot declare its own modules as
 * dependencies without inverting ADR-0116's topological order — which is why
 * the resolution scope is the ARTIFACT and not the referencing package's
 * declared dependency closure.
 */
import { describe, it, expect } from 'vitest';
import { composeStacks, defineStack } from './stack.zod';

/** The `type: app` package — owns objects AND every permission set. */
const appManifest = {
  id: 'app.objectstack.hotcrm',
  name: 'HotCRM',
  version: '3.1.0',
  type: 'app' as const,
  namespace: 'crm',
};

/**
 * The `type: module` package. `dependencies` names the APP, which is the only
 * direction ADR-0116's topological order admits: the module registers after the
 * package it extends.
 */
const moduleManifest = {
  id: 'app.objectstack.hotcrm.service',
  name: 'HotCRM Support',
  version: '3.1.0',
  type: 'module' as const,
  namespace: 'crm',
  dependencies: { 'app.objectstack.hotcrm': '^3.1.0' },
};

/** Owned by the app package. */
const account = { name: 'crm_account', label: 'Account', fields: { title: { type: 'text' as const } } };
/** Owned by the module package — the object every cross-package reference names. */
const supportCase = { name: 'crm_case', label: 'Case', fields: { subject: { type: 'text' as const } } };

/** The name NO package in the artifact defines. */
const NOWHERE = 'crm_nowhere';

type Envelope = Error & { code?: string; status?: number; issues?: readonly string[] };

/** The thrown value, or `null` when the call is accepted. */
function refusalOf(run: () => unknown): Envelope | null {
  try {
    run();
    return null;
  } catch (e) {
    return e as Envelope;
  }
}

const anyStack = (config: Record<string, unknown>) => config as unknown as Parameters<typeof defineStack>[0];

/** The module package, always identical. */
const serviceStack = () => defineStack(anyStack({ manifest: moduleManifest, objects: [supportCase] }));

/** The app package: owns `crm_account`, grants on `crm_case`, seeds `crm_case`. */
const appConfig = (grantObject: string, seedObject: string) => anyStack({
  manifest: appManifest,
  objects: [account],
  permissions: [
    {
      name: 'sales_rep',
      label: 'Sales Rep',
      objects: { crm_account: { allowRead: true }, [grantObject]: { allowRead: true } },
    },
  ],
  data: [{ object: seedObject, records: [] }],
});

const GRANT_ON_CASE = "Permission 'sales_rep' grants on object 'crm_case' which is not defined in objects.";
const SEED_ON_CASE = "Seed data references object 'crm_case' which is not defined in objects.";
const GRANT_ON_NOWHERE = `Permission 'sales_rep' grants on object '${NOWHERE}' which is not defined in objects.`;
const SEED_ON_NOWHERE = `Seed data references object '${NOWHERE}' which is not defined in objects.`;

describe('#18202 — the per-stack pass, without the opt-in', () => {
  it('REFUSES an app-owned grant and seed on a module-owned object — the reported defect', () => {
    const refused = refusalOf(() => defineStack(appConfig('crm_case', 'crm_case')));
    expect(refused?.code).toBe('STACK_CROSS_REFERENCE_INVALID');
    expect(refused?.status).toBe(422);
    expect(refused?.issues).toContain(GRANT_ON_CASE);
    expect(refused?.issues).toContain(SEED_ON_CASE);
  });

  it('keeps refusing a name nothing anywhere defines — unchanged', () => {
    const refused = refusalOf(() => defineStack(appConfig(NOWHERE, NOWHERE)));
    expect(refused?.code).toBe('STACK_CROSS_REFERENCE_INVALID');
    expect(refused?.issues).toContain(GRANT_ON_NOWHERE);
    expect(refused?.issues).toContain(SEED_ON_NOWHERE);
  });
});

describe('#18202 — `artifactObjects` widens exactly the two ARTIFACT-SCOPED classes', () => {
  it('ACCEPTS the app package once the artifact’s other objects are declared', () => {
    const service = serviceStack();
    const accepted = refusalOf(() =>
      defineStack(appConfig('crm_case', 'crm_case'), {
        artifactObjects: (service.objects ?? []).map((o) => o.name),
      }),
    );
    expect(accepted).toBeNull();
  });

  it('composes both packages into ONE artifact carrying TWO manifests', () => {
    const service = serviceStack();
    const app = defineStack(appConfig('crm_case', 'crm_case'), { artifactObjects: ['crm_case'] });
    const artifact = composeStacks([service, app], { manifest: 'preserve' });

    expect((artifact as { packages?: unknown[] }).packages).toHaveLength(2);
    expect((artifact.objects ?? []).map((o) => o.name).sort()).toEqual(['crm_account', 'crm_case']);
  });

  it('does NOT widen `hooks[].object` — ADR-0130 §1.5, the split follows hook ownership', () => {
    const refused = refusalOf(() =>
      defineStack(
        anyStack({
          manifest: appManifest,
          objects: [account],
          hooks: [{ name: 'case_hook', object: 'crm_case', events: ['afterInsert'], handler: 'noop' }],
        }),
        { artifactObjects: ['crm_case'] },
      ),
    );
    expect(refused?.code).toBe('STACK_CROSS_REFERENCE_INVALID');
    expect(refused?.issues).toContain(
      "Hook 'case_hook' references object 'crm_case' which is not defined in objects.",
    );
  });

  it('does NOT widen an app’s own navigation — ADR-0130 §1.5, navigation crosses through contributions', () => {
    const refused = refusalOf(() =>
      defineStack(
        anyStack({
          manifest: appManifest,
          objects: [account],
          apps: [
            {
              name: 'crm_enterprise',
              label: 'CRM',
              navigation: [{ id: 'nav_case', type: 'object', label: 'Cases', objectName: 'crm_case' }],
            },
          ],
        }),
        { artifactObjects: ['crm_case'] },
      ),
    );
    expect(refused?.code).toBe('STACK_CROSS_REFERENCE_INVALID');
    expect(refused?.issues).toContain(
      "App 'crm_enterprise' navigation references object 'crm_case' which is not defined in objects.",
    );
  });
});

describe('#18202 — the ARTIFACT pass: the refusal MOVED, it did not disappear', () => {
  /** The opt-in is a promise about a composition; this is the composition calling it in. */
  const composeClaiming = (name: string) => {
    const service = serviceStack();
    const app = defineStack(appConfig(name, name), { artifactObjects: [name] });
    return refusalOf(() => composeStacks([service, app], { manifest: 'preserve' }));
  };

  it('REFUSES a grant naming an object NO package in the artifact defines', () => {
    const refused = composeClaiming(NOWHERE);
    expect(refused).toBeInstanceOf(Error);
    expect(refused?.issues).toContain(GRANT_ON_NOWHERE);
  });

  it('REFUSES the seed-data twin in the same aggregate', () => {
    const refused = composeClaiming(NOWHERE);
    expect(refused?.issues).toContain(SEED_ON_NOWHERE);
  });

  it('carries the SAME ADR-0112 envelope as the per-stack pass', () => {
    const refused = composeClaiming(NOWHERE);
    expect(refused?.code).toBe('STACK_CROSS_REFERENCE_INVALID');
    expect(refused?.status).toBe(422);
  });

  it('NAMES the pass in the header, and only the header differs', () => {
    const refused = composeClaiming(NOWHERE);
    expect(refused?.message).toContain('composeStacks artifact cross-reference validation failed');
    // The per-finding line is byte-identical to the per-stack pass's, so a
    // reader greps one string whichever pass refused them.
    expect(refused?.message).toContain(GRANT_ON_NOWHERE);
  });

  it('ACCEPTS the artifact when the claimed object IS defined by a sibling — the control', () => {
    const service = serviceStack();
    const app = defineStack(appConfig('crm_case', 'crm_case'), { artifactObjects: ['crm_case'] });
    expect(refusalOf(() => composeStacks([service, app], { manifest: 'preserve' }))).toBeNull();
  });
});

describe('#18202 — #14122 §6 compatibility: a stack that does not opt in is untouched', () => {
  it('a single-package stack still refuses its own dangling grant', () => {
    const refused = refusalOf(() =>
      defineStack(anyStack({
        manifest: appManifest,
        objects: [account],
        permissions: [{ name: 'sales_rep', label: 'Sales Rep', objects: { [NOWHERE]: { allowRead: true } } }],
      })),
    );
    expect(refused?.code).toBe('STACK_CROSS_REFERENCE_INVALID');
    expect(refused?.issues).toContain(GRANT_ON_NOWHERE);
  });

  it('a single-package stack granting on its OWN object is accepted', () => {
    const accepted = refusalOf(() =>
      defineStack(anyStack({
        manifest: appManifest,
        objects: [account],
        permissions: [{ name: 'sales_rep', label: 'Sales Rep', objects: { crm_account: { allowRead: true } } }],
        data: [{ object: 'crm_account', records: [] }],
      })),
    );
    expect(accepted).toBeNull();
  });

  it('composing two ordinary single-package stacks still throws nothing new', () => {
    const a = defineStack(anyStack({
      manifest: appManifest,
      objects: [account],
      permissions: [{ name: 'sales_rep', label: 'Sales Rep', objects: { crm_account: { allowRead: true } } }],
    }));
    const b = serviceStack();
    expect(refusalOf(() => composeStacks([b, a], { manifest: 'preserve' }))).toBeNull();
  });
});

describe('#18202 — the object-less leniency the ARTIFACT pass inherits verbatim', () => {
  /**
   * hotcrm#1449's shape: the app package declares NO objects, so
   * `validateCrossReferences` early-returns and the ARTIFACT pass skips it for
   * the same reason — its references may be served by a plugin that is not in
   * this composition at all. Pinned as UNCHANGED, in both directions.
   */
  const objectLessApp = (grantObject: string) => defineStack(anyStack({
    manifest: { ...appManifest, namespace: undefined },
    permissions: [{ name: 'sales_rep', label: 'Sales Rep', objects: { [grantObject]: { allowRead: true } } }],
  }));

  it('accepts an object-less package granting on a sibling’s object, composed', () => {
    expect(refusalOf(() => composeStacks([serviceStack(), objectLessApp('crm_case')], { manifest: 'preserve' })))
      .toBeNull();
  });

  it('still accepts an object-less package granting on a name nobody defines — unchanged leniency', () => {
    expect(refusalOf(() => composeStacks([serviceStack(), objectLessApp(NOWHERE)], { manifest: 'preserve' })))
      .toBeNull();
  });
});

/**
 * The ARTIFACT pass runs over EVERY input, not only the ones that opted in —
 * and for an input that never went through the strict `defineStack` parse that
 * is not a no-op. `defineStack(config, { strict: false })` returns before
 * `validateCrossReferences` runs at all, and a hand-built stack object never
 * enters it, so these two rules have never been applied to such an input. The
 * artifact pass is the first place they are.
 *
 * That is a real narrowing of what `composeStacks` accepts, in the Prime
 * Directive #12 direction. It is pinned here as DECLARED behaviour so the next
 * reader meets it as a decision rather than as a regression: the changeset says
 * it, `collectArtifactCrossReferenceErrors`'s docstring says it, and these
 * fixtures hold it.
 */
describe('#18202 — an input that bypassed the strict parse IS checked at composition', () => {
  /** The app package as an unparsed stack: `strict: false` skips every validation. */
  const unparsedApp = (grantObject: string, seedObject: string) =>
    defineStack(appConfig(grantObject, seedObject), { strict: false });

  /** The same config as a hand-built object — it never enters `defineStack` at all. */
  const handBuiltApp = (grantObject: string, seedObject: string) =>
    appConfig(grantObject, seedObject) as unknown as ReturnType<typeof defineStack>;

  it('`strict: false` alone still composes — the parse it skipped is not reinstated here', () => {
    // The control for the two refusals below: same construction, a name the
    // artifact DOES define. If this went red the refusals would prove nothing.
    expect(
      refusalOf(() => composeStacks([serviceStack(), unparsedApp('crm_case', 'crm_case')], { manifest: 'preserve' })),
    ).toBeNull();
  });

  it('REFUSES a `strict: false` input whose grant names an object NO package defines', () => {
    const refused = refusalOf(() =>
      composeStacks([serviceStack(), unparsedApp(NOWHERE, 'crm_case')], { manifest: 'preserve' }),
    );
    expect(refused?.code).toBe('STACK_CROSS_REFERENCE_INVALID');
    expect(refused?.status).toBe(422);
    expect(refused?.issues).toContain(GRANT_ON_NOWHERE);
  });

  it('REFUSES the seed-data twin on a `strict: false` input', () => {
    const refused = refusalOf(() =>
      composeStacks([serviceStack(), unparsedApp('crm_case', NOWHERE)], { manifest: 'preserve' }),
    );
    expect(refused?.code).toBe('STACK_CROSS_REFERENCE_INVALID');
    expect(refused?.issues).toContain(SEED_ON_NOWHERE);
  });

  it('REFUSES a hand-built stack object on the same two rules', () => {
    const refused = refusalOf(() =>
      composeStacks([serviceStack(), handBuiltApp(NOWHERE, NOWHERE)], { manifest: 'preserve' }),
    );
    expect(refused?.code).toBe('STACK_CROSS_REFERENCE_INVALID');
    expect(refused?.issues).toContain(GRANT_ON_NOWHERE);
    expect(refused?.issues).toContain(SEED_ON_NOWHERE);
  });

  it('leaves every OTHER rule un-applied to an unparsed input — only these two cross', () => {
    // A hook on an object nobody defines is refused by the PER-STACK pass only.
    // The artifact pass re-raises the two ARTIFACT-SCOPED rules and nothing
    // else, so an unparsed input carrying a dangling hook still composes.
    const unparsedHook = defineStack(
      anyStack({
        manifest: appManifest,
        objects: [account],
        hooks: [{ name: 'nowhere_hook', object: NOWHERE, events: ['afterInsert'], handler: 'noop' }],
      }),
      { strict: false },
    );
    expect(refusalOf(() => composeStacks([serviceStack(), unparsedHook], { manifest: 'preserve' }))).toBeNull();
  });
});

/**
 * The shape guard the two collectors carry (#18202 rework).
 *
 * Because the artifact pass reads `permissions` / `data` off inputs the strict
 * parse never saw, those keys can be a non-array, and an entry can be `null` or
 * a scalar. `composeStacks`'s step-3 concat pass already refuses to drop such a
 * key without a word (#5005); the two collectors must not turn the same input
 * into a bare `TypeError` with no `code` and no `status`, which is exactly what
 * this pass did before the guards existed. Every case below composes on
 * `origin/main`, so a throw here is a regression, not a stricter contract.
 *
 * ⚠️ `warnMalformedCollectionKey` deduplicates per key for the lifetime of the
 * module, so each key is asserted in exactly ONE test and the count assertion
 * (`toBe(1)`) is what proves the two passes do not both speak.
 */
describe('#18202 — a malformed collection on an unparsed input is skipped, never a bare TypeError', () => {
  /** Collect `console.warn` for one call, restoring the real one afterwards. */
  function warningsDuring(run: () => unknown): { warnings: string[]; thrown: Envelope | null } {
    const warnings: string[] = [];
    const real = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    };
    try {
      return { warnings, thrown: refusalOf(run) };
    } finally {
      console.warn = real;
    }
  }

  const malformed = (overrides: Record<string, unknown>) =>
    anyStack({ manifest: appManifest, objects: [account], ...overrides }) as unknown as ReturnType<typeof defineStack>;

  const composeWith = (stack: ReturnType<typeof defineStack>) => () =>
    composeStacks([serviceStack(), stack], { manifest: 'preserve' });

  it('a non-array `permissions` composes, and the key is warned about exactly once', () => {
    // Map format, which `permissions` does not support — the shape a
    // hand-built stack most plausibly carries. It is NOT iterable, which is
    // what makes this the case that distinguishes the guard: a string value
    // would iterate its characters and never throw either way.
    const mapShaped = { sales_rep: { label: 'Sales Rep', objects: { [NOWHERE]: { allowRead: true } } } };
    const { warnings, thrown } = warningsDuring(composeWith(malformed({ permissions: mapShaped })));
    expect(thrown).toBeNull();
    expect(warnings.filter((w) => w.includes("top-level key 'permissions'"))).toHaveLength(1);
  });

  it('a non-array `data` composes, and the key is warned about exactly once', () => {
    const { warnings, thrown } = warningsDuring(composeWith(malformed({ data: 42 })));
    expect(thrown).toBeNull();
    expect(warnings.filter((w) => w.includes("top-level key 'data'"))).toHaveLength(1);
  });

  it('a null entry inside `permissions` is skipped, not dereferenced', () => {
    expect(refusalOf(composeWith(malformed({ permissions: [null] })))).toBeNull();
  });

  it('a null entry inside `data` is skipped, not dereferenced', () => {
    expect(refusalOf(composeWith(malformed({ data: [null] })))).toBeNull();
  });

  it('a scalar entry, and a non-string `object`, carry no reference for the rule to resolve', () => {
    expect(
      refusalOf(composeWith(malformed({ data: ['crm_case', { object: 7 }], permissions: ['sales_rep'] }))),
    ).toBeNull();
  });

  it('a malformed `objects` grant map is skipped while the rest of the set is still read', () => {
    const refused = refusalOf(
      composeWith(
        malformed({
          permissions: [
            { name: 'broken', label: 'Broken', objects: null },
            { name: 'sales_rep', label: 'Sales Rep', objects: { [NOWHERE]: { allowRead: true } } },
          ],
        }),
      ),
    );
    expect(refused?.code).toBe('STACK_CROSS_REFERENCE_INVALID');
    expect(refused?.issues).toContain(GRANT_ON_NOWHERE);
  });
});

/**
 * The declared boundary of the artifact pass (#18202 rework).
 *
 * `composeStacks` returns `stacks[0]` untouched for a single input, so a
 * one-package composition never reaches the pass at all. That is why every
 * reader-facing statement of the guarantee — the option's docstring and the
 * multi-package docs bullet — says "in a composition of two or more packages".
 * This block is the fence on that qualifier: if the early return is ever
 * removed, the qualifier becomes wrong and these tests say so.
 */
describe('#18202 — a composition of ONE package never reaches the artifact pass', () => {
  const claiming = () => defineStack(appConfig(NOWHERE, NOWHERE), { artifactObjects: [NOWHERE] });

  it('accepts a one-input composition whose claim names an object nothing defines', () => {
    expect(refusalOf(() => composeStacks([claiming()], { manifest: 'preserve' }))).toBeNull();
  });

  it('accepts it with no options either — the early return precedes the option parse', () => {
    expect(refusalOf(() => composeStacks([claiming()]))).toBeNull();
  });

  it('and REFUSES the identical claim as soon as a second package joins — the contrast', () => {
    const refused = refusalOf(() => composeStacks([serviceStack(), claiming()], { manifest: 'preserve' }));
    expect(refused?.code).toBe('STACK_CROSS_REFERENCE_INVALID');
    expect(refused?.issues).toContain(GRANT_ON_NOWHERE);
  });
});
