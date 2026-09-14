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
