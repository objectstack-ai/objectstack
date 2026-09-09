// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  validateObjectReferences,
  OBJECT_REFERENCE_UNKNOWN,
  OBJECT_REFERENCE_UNREGISTERED_PLATFORM,
} from './validate-object-references.js';

/** Minimal stack with one own object, mirroring the HotCRM shape. */
const baseStack = () => ({
  objects: [
    { name: 'crm_lead', fields: { name: { type: 'text' }, status: { type: 'text' } } },
    { name: 'crm_account', fields: { name: { type: 'text' } } },
  ],
});

describe('validateObjectReferences — action params', () => {
  // The literal HotCRM instance: a bulk-action lookup pointing at `user`
  // instead of the platform object `sys_user`.
  it('errors on a bulk-action lookup param referencing `user`', () => {
    const findings = validateObjectReferences({
      ...baseStack(),
      actions: [
        {
          name: 'mass_reassign',
          params: [{ name: 'owner', type: 'lookup', reference: 'user' }],
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].rule).toBe(OBJECT_REFERENCE_UNKNOWN);
    expect(findings[0].path).toBe('actions[0].params[0].reference');
    expect(findings[0].message).toContain('"user"');
    // The fix-it must name the real platform object, since that is the actual mistake.
    expect(findings[0].hint).toContain('sys_user');
  });

  it('accepts a lookup param referencing a real platform object', () => {
    const findings = validateObjectReferences({
      ...baseStack(),
      actions: [
        { name: 'mass_reassign', params: [{ name: 'owner', type: 'lookup', reference: 'sys_user' }] },
      ],
    });
    expect(findings).toEqual([]);
  });

  it('accepts a lookup param referencing an own object', () => {
    const findings = validateObjectReferences({
      ...baseStack(),
      actions: [
        { name: 'link', params: [{ name: 'account', type: 'lookup', reference: 'crm_account' }] },
      ],
    });
    expect(findings).toEqual([]);
  });

  it('errors on an unknown objectOverride', () => {
    const findings = validateObjectReferences({
      ...baseStack(),
      actions: [{ name: 'a', params: [{ field: 'role', objectOverride: 'member' }] }],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('actions[0].params[0].objectOverride');
  });

  it('checks object-embedded actions too', () => {
    const stack = baseStack();
    (stack.objects[0] as Record<string, unknown>).actions = [
      { name: 'convert', params: [{ name: 'target', type: 'lookup', reference: 'accounts' }] },
    ];
    const findings = validateObjectReferences(stack);
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('objects[0].actions[0].params[0].reference');
    // `accounts` is one edit away from `crm_account`? No — but the suggester
    // should stay quiet rather than offer a bad guess.
    expect(findings[0].severity).toBe('error');
  });
});

describe('validateObjectReferences — field relationship targets (#16611)', () => {
  // The card's control probe, verbatim: on 17.3.0 `os validate`, `os lint` and
  // `os build` all exited 0 on it, with no diagnostic of any severity.
  it('errors on a lookup whose reference names an object declared nowhere', () => {
    const stack = baseStack();
    (stack.objects[0].fields as Record<string, unknown>).zzz_probe = {
      type: 'lookup',
      label: 'Control probe',
      reference: 'zzz_object_that_does_not_exist',
    };
    const findings = validateObjectReferences(stack);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].rule).toBe(OBJECT_REFERENCE_UNKNOWN);
    expect(findings[0].where).toBe('object "crm_lead" · field "zzz_probe"');
    expect(findings[0].path).toBe('objects[0].fields.zzz_probe.reference');
    expect(findings[0].message).toContain('lookup target "zzz_object_that_does_not_exist"');
    // The hint says what the miss costs at runtime, not just that it is a miss.
    expect(findings[0].hint).toContain('record picker');
  });

  it('errors on a master_detail whose reference names an object declared nowhere', () => {
    const stack = baseStack();
    (stack.objects[0].fields as Record<string, unknown>).parent = {
      type: 'master_detail',
      required: true,
      reference: 'crm_led',
    };
    const findings = validateObjectReferences(stack);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].path).toBe('objects[0].fields.parent.reference');
    expect(findings[0].message).toContain('master_detail target "crm_led"');
    // One edit away from an own object: the suggester names it.
    expect(findings[0].message).toContain('Did you mean "crm_lead"?');
  });

  it('accepts a lookup into an own object and the `Field.user()` shape (rungs ① and ③)', () => {
    const stack = baseStack();
    Object.assign(stack.objects[0].fields as Record<string, unknown>, {
      account: { type: 'lookup', reference: 'crm_account' },
      owner: { type: 'user', reference: 'sys_user' },
      watchers: { type: 'lookup', reference: 'sys_user', multiple: true },
    });
    expect(validateObjectReferences(stack)).toEqual([]);
  });

  it('warns (not errors) on a platform-shaped target no package registers (rung ④)', () => {
    const stack = baseStack();
    (stack.objects[0].fields as Record<string, unknown>).approval = {
      type: 'lookup',
      reference: 'sys_approval_process',
    };
    const findings = validateObjectReferences(stack);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].rule).toBe(OBJECT_REFERENCE_UNREGISTERED_PLATFORM);
    expect(findings[0].path).toBe('objects[0].fields.approval.reference');
    expect(findings[0].hint).toContain('sys_approval_request');
  });

  it('leaves the `reference` key alone on `tree` and on non-relationship types', () => {
    // `tree`: the schema already refuses any target but the own name
    // (`refuseForeignTreeReference`), so a survivor always resolves.
    // `text`: the key is inert there; a finding would be about the wrong thing.
    const stack = baseStack();
    Object.assign(stack.objects[0].fields as Record<string, unknown>, {
      parent: { type: 'tree', reference: 'crm_lead' },
      note: { type: 'text', reference: 'zzz_object_that_does_not_exist' },
    });
    expect(validateObjectReferences(stack)).toEqual([]);
  });

  it('does not walk objectExtensions[].fields — cross-package by construction', () => {
    // An extension adds fields to an object ANOTHER package owns; its targets
    // are the cross-package case this ladder has no rung for, and the declared
    // escape is its own card. Pinned so the boundary is a decision, not a gap.
    const findings = validateObjectReferences({
      ...baseStack(),
      objectExtensions: [
        {
          object: 'crm_contract',
          fields: { clause: { type: 'lookup', reference: 'zzz_object_that_does_not_exist' } },
        },
      ],
    });
    expect(findings).toEqual([]);
  });

  it('walks array-shaped and map-shaped field collections alike', () => {
    const findings = validateObjectReferences({
      objects: [
        { name: 'crm_lead', fields: [{ name: 'owner', type: 'lookup', reference: 'user' }] },
        { name: 'crm_account', fields: { rep: { type: 'lookup', reference: 'user' } } },
      ],
    });
    expect(findings.map((f) => f.path)).toEqual([
      'objects[0].fields.owner.reference',
      'objects[1].fields.rep.reference',
    ]);
    for (const f of findings) {
      expect(f.severity).toBe('error');
      expect(f.hint).toContain('sys_user');
    }
  });

  it('reports the field site before the sites that hang off the same object', () => {
    const stack = baseStack();
    (stack.objects[0].fields as Record<string, unknown>).zzz_probe = {
      type: 'lookup',
      reference: 'zzz_object_that_does_not_exist',
    };
    (stack.objects[0] as Record<string, unknown>).actions = [
      { name: 'convert', params: [{ name: 'target', type: 'lookup', reference: 'accounts' }] },
    ];
    expect(validateObjectReferences(stack).map((f) => f.path)).toEqual([
      'objects[0].fields.zzz_probe.reference',
      'objects[0].actions[0].params[0].reference',
    ]);
  });
});

describe('validateObjectReferences — artifact packages[] as resolution context (#16611)', () => {
  /**
   * The shape `compile.ts`'s per-package leg hands the rules (ADR-0130 D4): ONE
   * package's collections at the top level, and the whole artifact's
   * `packages[]` beside them as context. Modelled on
   * `examples/app-multi-package`, whose `orders` package reads `crm_account`
   * out of its `core` sibling.
   */
  const ORDERS_BODY = {
    id: 'com.example.multi.orders',
    objects: [
      {
        name: 'crm_order',
        fields: {
          number: { type: 'text' },
          account: { type: 'lookup', reference: 'crm_account' },
        },
      },
    ],
  };
  const CORE_BODY = {
    id: 'com.example.multi.core',
    objects: [{ name: 'crm_account', fields: { name: { type: 'text' } } }],
  };
  const perPackageStack = (body: Record<string, unknown>, packages: unknown) => ({
    ...body,
    manifest: body,
    packages,
  });

  it('CONTROL — the same package judged ALONE still errors, so the context is what does the work', () => {
    // Without this leg "green" is indistinguishable from the rung having been
    // switched off: this is the exact finding that reds `Build Core` on
    // `examples/app-multi-package` when the ladder lands by itself.
    const findings = validateObjectReferences(perPackageStack(ORDERS_BODY, undefined));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].rule).toBe(OBJECT_REFERENCE_UNKNOWN);
    expect(findings[0].path).toBe('objects[0].fields.account.reference');
    expect(findings[0].message).toContain('lookup target "crm_account"');
  });

  it('resolves a lookup into an object a SIBLING package of the same artifact provides', () => {
    const artifact = [{ manifest: ORDERS_BODY }, { manifest: CORE_BODY }];
    expect(validateObjectReferences(perPackageStack(ORDERS_BODY, artifact))).toEqual([]);
    // …and the sibling, judged from its own side, is unaffected.
    expect(validateObjectReferences(perPackageStack(CORE_BODY, artifact))).toEqual([]);
  });

  it('NON-DEGENERACY — a name NO package in the artifact provides still errors', () => {
    // The whole distinction between the ruled fix and "skip the field site per
    // package": the site is still judged, against a wider set. `crm_contract`
    // is the card's cross-REPO spelling — no entry here ships it.
    const dangling = {
      ...ORDERS_BODY,
      objects: [
        { name: 'crm_order', fields: { contract: { type: 'lookup', reference: 'crm_contract' } } },
      ],
    };
    const findings = validateObjectReferences(
      perPackageStack(dangling, [{ manifest: dangling }, { manifest: CORE_BODY }]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].rule).toBe(OBJECT_REFERENCE_UNKNOWN);
    expect(findings[0].path).toBe('objects[0].fields.contract.reference');
    // The remedy lists what the ARTIFACT provides, not only this package's own
    // objects — that is the list the author actually has to choose from.
    expect(findings[0].hint).toContain('Defined objects: crm_account, crm_order.');
  });

  it('carries the context to every site on the rule, not only the field one', () => {
    const withNav = {
      ...ORDERS_BODY,
      navigation: [{ name: 'accounts', objectName: 'crm_account', requiresObject: 'crm_account' }],
      actions: [{ name: 'link', params: [{ name: 'a', type: 'lookup', reference: 'crm_account' }] }],
    };
    expect(
      validateObjectReferences(
        perPackageStack(withNav, [{ manifest: withNav }, { manifest: CORE_BODY }]),
      ),
    ).toEqual([]);
  });

  it('reads only names a package REALLY declares — an entry with no body contributes none', () => {
    // A future `{ ref, integrity }` external segment carries no manifest
    // content (ADR-0130 D4). Inventing a name for such an entry would silence
    // the ladder, which is the one mistake this context must not make.
    const findings = validateObjectReferences(
      perPackageStack(ORDERS_BODY, [{ ref: 'sha256-x' }, { manifest: { id: 'x' } }, 'not-an-entry']),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('objects[0].fields.account.reference');
  });

  it('ignores a `packages` value that is not a list of entries', () => {
    for (const packages of [null, 42, 'core']) {
      const findings = validateObjectReferences(perPackageStack(ORDERS_BODY, packages));
      expect(findings.map((f) => f.path)).toEqual(['objects[0].fields.account.reference']);
    }
  });
});

describe('validateObjectReferences — dashboard global filters', () => {
  // The other HotCRM `object: 'user'` instance.
  it('errors on optionsFrom.object naming a nonexistent object', () => {
    const findings = validateObjectReferences({
      ...baseStack(),
      dashboards: [
        {
          name: 'sales_overview',
          globalFilters: [
            { name: 'owner', optionsFrom: { object: 'user', valueField: 'id', labelField: 'name' } },
          ],
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].path).toBe('dashboards[0].globalFilters[0].optionsFrom.object');
  });

  it('accepts optionsFrom.object naming an own object', () => {
    const findings = validateObjectReferences({
      ...baseStack(),
      dashboards: [
        { name: 'd', globalFilters: [{ name: 'acct', optionsFrom: { object: 'crm_account' } }] },
      ],
    });
    expect(findings).toEqual([]);
  });
});

describe('validateObjectReferences — ADR-0021 dataset base object (#14105)', () => {
  // The measured row 6: `object: 'duly_tsk'` where the object is `duly_task`.
  // On published 17.2.0 this exited 0 with "Validation passed", and `build`
  // wrote the dangling dataset into `dist/objectstack.json`.
  it('errors on a dataset over an object that does not exist', () => {
    const findings = validateObjectReferences({
      ...baseStack(),
      datasets: [
        {
          name: 'lead_metrics',
          object: 'crm_led',
          dimensions: [{ name: 'status', field: 'status' }],
          measures: [{ name: 'n', aggregate: 'count' }],
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].rule).toBe(OBJECT_REFERENCE_UNKNOWN);
    expect(findings[0].path).toBe('datasets[0].object');
    expect(findings[0].where).toBe('dataset "lead_metrics"');
    expect(findings[0].message).toContain('Did you mean "crm_lead"?');
  });

  it('accepts a dataset over an own object', () => {
    expect(
      validateObjectReferences({
        ...baseStack(),
        datasets: [{ name: 'lead_metrics', object: 'crm_lead', dimensions: [], measures: [] }],
      }),
    ).toEqual([]);
  });

  it('accepts the platform datasets this stack cannot see (rung ③)', () => {
    // `system.datasets.ts` ships five of these. A local "not in this stack ⇒
    // error" check would have reported every one; the curated registry is the
    // whole reason this site lives on this rule.
    expect(
      validateObjectReferences({
        ...baseStack(),
        datasets: [
          { name: 'sys_user_metrics', object: 'sys_user', dimensions: [], measures: [] },
          { name: 'sys_organization_metrics', object: 'sys_organization', dimensions: [], measures: [] },
          { name: 'sys_session_metrics', object: 'sys_session', dimensions: [], measures: [] },
          { name: 'sys_audit_log_metrics', object: 'sys_audit_log', dimensions: [], measures: [] },
          {
            name: 'sys_package_installation_metrics',
            object: 'sys_package_installation',
            dimensions: [],
            measures: [],
          },
        ],
      }),
    ).toEqual([]);
  });

  it('warns rather than errors on a platform-shaped base object nothing registers', () => {
    const findings = validateObjectReferences({
      ...baseStack(),
      datasets: [{ name: 'm', object: 'sys_approval_process', dimensions: [], measures: [] }],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].rule).toBe(OBJECT_REFERENCE_UNREGISTERED_PLATFORM);
  });
});

describe('validateObjectReferences — the severity ladder', () => {
  // The `sys_approval_process` case: platform-shaped but registered by nothing.
  // ADR-0019 removed the process object when approval became a flow node.
  it('warns (not errors) on a platform-prefixed name no package registers', () => {
    const findings = validateObjectReferences({
      ...baseStack(),
      apps: [
        {
          name: 'crm',
          navigation: [
            { id: 'nav_approvals', type: 'object', label: 'Approvals', objectName: 'sys_approval_process', requiresObject: 'sys_approval_process' },
          ],
        },
      ],
    });
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.severity).toBe('warning');
      expect(f.rule).toBe(OBJECT_REFERENCE_UNREGISTERED_PLATFORM);
    }
    // Both the gate and the (gate-exempted) target are reported.
    expect(findings.map((f) => f.path)).toEqual([
      'apps[0].navigation[0].requiresObject',
      'apps[0].navigation[0].objectName',
    ]);
    expect(findings[0].hint).toContain('sys_approval_request');
  });

  it('accepts a requiresObject naming a real plugin object', () => {
    const findings = validateObjectReferences({
      ...baseStack(),
      apps: [
        {
          name: 'crm',
          navigation: [
            { id: 'nav_approvals', type: 'object', label: 'Approvals', objectName: 'sys_approval_request', requiresObject: 'sys_approval_request' },
          ],
        },
      ],
    });
    expect(findings).toEqual([]);
  });

  it('accepts a cloud-only object name', () => {
    const findings = validateObjectReferences({
      ...baseStack(),
      apps: [
        {
          name: 'admin',
          navigation: [
            { id: 'nav_apps', type: 'object', label: 'Apps', objectName: 'sys_app', requiresObject: 'sys_app' },
          ],
        },
      ],
    });
    expect(findings).toEqual([]);
  });

  it('walks area navigation and nested children', () => {
    const findings = validateObjectReferences({
      ...baseStack(),
      apps: [
        {
          name: 'crm',
          areas: [
            {
              id: 'area_sales',
              label: 'Sales',
              navigation: [
                {
                  id: 'nav_group',
                  type: 'group',
                  label: 'Group',
                  children: [{ id: 'nav_x', type: 'object', label: 'X', requiresObject: 'nope_object' }],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('apps[0].areas[0].navigation[0].children[0].requiresObject');
  });
});

describe('validateObjectReferences — exemptions (false-positive floor)', () => {
  it('skips interpolated targets', () => {
    const findings = validateObjectReferences({
      ...baseStack(),
      actions: [
        { name: 'a', params: [{ name: 'p', reference: '${objectName}' }] },
        { name: 'b', params: [{ name: 'p', reference: '{current_object}' }] },
      ],
    });
    expect(findings).toEqual([]);
  });

  it('is silent on a clean stack', () => {
    expect(validateObjectReferences(baseStack())).toEqual([]);
  });

  it('tolerates a non-object / empty input', () => {
    expect(validateObjectReferences({} as Record<string, unknown>)).toEqual([]);
    expect(validateObjectReferences(null as unknown as Record<string, unknown>)).toEqual([]);
  });

  it('accepts the map-shaped (normalized) stack form', () => {
    const findings = validateObjectReferences({
      objects: { crm_lead: { fields: {} } },
      actions: { link: { params: [{ name: 'p', reference: 'crm_lead' }] } },
    });
    expect(findings).toEqual([]);
  });
});
