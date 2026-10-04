// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { validateActionNameRefs, ACTION_NAME_UNDEFINED } from './validate-action-name-refs.js';

const withActions = () => ({
  objects: [{ name: 'crm_lead', fields: { name: { type: 'text' } } }],
  actions: [{ name: 'crm_convert_lead', label: 'Convert', type: 'script' }],
});

describe('validateActionNameRefs — list view bulk/row actions', () => {
  // The literal HotCRM instance: three bulk actions, none of them defined.
  it('errors on every undefined bulkAction', () => {
    const findings = validateActionNameRefs({
      ...withActions(),
      views: [
        {
          name: 'crm_lead',
          list: { bulkActions: ['mass_update', 'mass_delete', 'assign_owner'] },
        },
      ],
    });
    expect(findings).toHaveLength(3);
    expect(findings.every((f) => f.severity === 'error')).toBe(true);
    expect(findings.every((f) => f.rule === ACTION_NAME_UNDEFINED)).toBe(true);
    expect(findings.map((f) => f.path)).toEqual([
      'views[0].list.bulkActions[0]',
      'views[0].list.bulkActions[1]',
      'views[0].list.bulkActions[2]',
    ]);
    expect(findings[0].message).toContain('does nothing when clicked');
  });

  it('errors on an undefined rowAction', () => {
    const findings = validateActionNameRefs({
      ...withActions(),
      views: [{ name: 'crm_lead', list: { rowActions: ['complete_task'] } }],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('views[0].list.rowActions[0]');
  });

  it('accepts a defined action, global or object-embedded', () => {
    const stack = {
      objects: [
        {
          name: 'crm_lead',
          fields: {},
          actions: [{ name: 'crm_mark_hot', label: 'Mark hot', type: 'script' }],
        },
      ],
      actions: [{ name: 'crm_convert_lead', label: 'Convert', type: 'script' }],
      views: [
        { name: 'crm_lead', list: { rowActions: ['crm_convert_lead'], bulkActions: ['crm_mark_hot'] } },
      ],
    };
    expect(validateActionNameRefs(stack)).toEqual([]);
  });

  it('checks each named listViews entry', () => {
    const findings = validateActionNameRefs({
      ...withActions(),
      views: [
        {
          name: 'crm_lead',
          listViews: {
            all: { bulkActions: ['crm_convert_lead'] },
            hot: { bulkActions: ['ghost_action'] },
          },
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('views[0].listViews.hot.bulkActions[0]');
  });

  it('offers a did-you-mean for a near-miss', () => {
    const findings = validateActionNameRefs({
      ...withActions(),
      views: [{ name: 'crm_lead', list: { bulkActions: ['crm_convert_leads'] } }],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('Did you mean "crm_convert_lead"?');
  });

  // #14577 — this rule used to carry a private Levenshtein-only `suggest`,
  // which gave NO hint here: `archive` → `archive_completed_deals` is 17 edits
  // apart, far outside the `max(2, floor(len/3))` budget. Now delegating to
  // the shared `suggestName` (#14268), the containment pre-pass catches it —
  // the same class of drift as the issue's `amount` → `sum_amount` example.
  it('offers a did-you-mean via containment where edit distance alone would not', () => {
    const findings = validateActionNameRefs({
      objects: [{ name: 'crm_lead', fields: { name: { type: 'text' } } }],
      actions: [{ name: 'archive_completed_deals', label: 'Archive', type: 'script' }],
      views: [{ name: 'crm_lead', list: { bulkActions: ['archive'] } }],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('Did you mean "archive_completed_deals"?');
  });
});

// These fixtures use the REAL page shape. An earlier version of this suite
// invented a top-level `page.components` array with `children` nesting — a
// shape `PageSchema` does not have (components live under
// `regions[].components[]` / `slots`, and `PageComponentSchema` is `.strict()`
// so it carries no `children`). The rule passed those tests while visiting
// nothing at all on a real stack.
describe('validateActionNameRefs — page quick actions', () => {
  it('errors on an undefined actionNames entry in a region', () => {
    const findings = validateActionNameRefs({
      ...withActions(),
      pages: [
        {
          name: 'lead_record',
          regions: [
            {
              name: 'main',
              components: [
                {
                  type: 'record:quick_actions',
                  properties: { location: 'record_section', actionNames: ['showcase_mark_done'] },
                },
              ],
            },
          ],
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('pages[0].regions[0].components[0].properties.actionNames[0]');
  });

  it('walks a slotted page', () => {
    const findings = validateActionNameRefs({
      ...withActions(),
      pages: [
        {
          name: 'p',
          kind: 'slotted',
          slots: {
            actions: { type: 'record:quick_actions', properties: { actionNames: ['nope'] } },
          },
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('pages[0].slots.actions.properties.actionNames[0]');
  });

  it('recurses into tab children nested in the properties bag', () => {
    const findings = validateActionNameRefs({
      ...withActions(),
      pages: [
        {
          name: 'p',
          regions: [
            {
              name: 'main',
              components: [
                {
                  type: 'page:tabs',
                  properties: {
                    items: [
                      {
                        label: 'Overview',
                        children: [
                          { type: 'record:quick_actions', properties: { actionNames: ['nope'] } },
                        ],
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe(
      'pages[0].regions[0].components[0].properties.items[0].children[0].properties.actionNames[0]',
    );
  });

  it('skips a source-authored page (its regions are a derived cache)', () => {
    const findings = validateActionNameRefs({
      ...withActions(),
      pages: [
        {
          name: 'p',
          kind: 'jsx',
          source: '<div />',
          regions: [
            {
              name: 'main',
              components: [{ type: 'record:quick_actions', properties: { actionNames: ['nope'] } }],
            },
          ],
        },
      ],
    });
    expect(findings).toEqual([]);
  });
});

// The two page surfaces that name an action by id OUTSIDE `actionNames`. Both
// renderers resolve the id against the object's declared actions and draw
// nothing for an id that resolves nowhere — the alert keeps its banner and
// loses its button, the header renders one button fewer — so a typo here is
// the same dead reference as on the quick-actions bar, one key over.
describe('validateActionNameRefs — record:alert call-to-action', () => {
  const alertPage = (actionName: string) => ({
    name: 'user_record',
    kind: 'slotted',
    object: 'sys_user',
    slots: {
      alerts: [
        {
          type: 'record:alert',
          properties: { severity: 'warning', title: 'Email not verified', action: { actionName } },
        },
      ],
    },
  });
  const withUserAction = () => ({
    objects: [
      {
        name: 'sys_user',
        fields: { email: { type: 'text' } },
        actions: [{ name: 'resend_verification_email', label: 'Resend', type: 'script' }],
      },
    ],
  });

  it('errors on an action.actionName naming no defined action', () => {
    const findings = validateActionNameRefs({
      ...withUserAction(),
      pages: [alertPage('resend_verifcation_email')],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(ACTION_NAME_UNDEFINED);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].path).toBe('pages[0].slots.alerts[0].properties.action.actionName');
    expect(findings[0].message).toContain('"resend_verifcation_email"');
  });

  it('accepts an action.actionName that resolves to a declared action', () => {
    expect(
      validateActionNameRefs({ ...withUserAction(), pages: [alertPage('resend_verification_email')] }),
    ).toEqual([]);
  });
});

describe('validateActionNameRefs — page:header actions', () => {
  const headerPage = (actions: unknown[]) => ({
    name: 'lead_record',
    object: 'crm_lead',
    regions: [
      {
        name: 'header',
        components: [{ type: 'page:header', properties: { title: 'Lead', actions } }],
      },
    ],
  });

  it('errors on an actions id naming no defined action, at its own index', () => {
    const findings = validateActionNameRefs({
      ...withActions(),
      pages: [headerPage(['crm_convert_lead', 'covert_lead'])],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(ACTION_NAME_UNDEFINED);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].path).toBe('pages[0].regions[0].components[0].properties.actions[1]');
    expect(findings[0].message).toContain('"covert_lead"');
  });

  it('accepts actions ids that all resolve to declared actions', () => {
    expect(
      validateActionNameRefs({ ...withActions(), pages: [headerPage(['crm_convert_lead'])] }),
    ).toEqual([]);
  });

  // The spec's contract is ids (`z.array(z.string())`), and it refuses an
  // inline object element on its own; an object here is a definition, not a
  // reference, so there is nothing for THIS rule to resolve — but the ids
  // around it are still references, reported at their real index.
  it('resolves only the id elements, reporting each at its authored index', () => {
    const findings = validateActionNameRefs({
      ...withActions(),
      pages: [headerPage([{ name: 'inline_def', type: 'script' }, 'nope'])],
    });
    expect(findings.map((f) => f.path)).toEqual([
      'pages[0].regions[0].components[0].properties.actions[1]',
    ]);
  });
});

// The related list resolves its `actions` ids against the RELATED (child)
// object's own actions — never the page's object — and places each by that
// action's own `locations`; an id that misses either draws no button, only a
// refusal notice. So this walk, unlike the stack-wide ones above, answers from
// the child object, and only when this stack defines it.
describe('validateActionNameRefs — record:related_list actions', () => {
  const stackWith = (component: Record<string, unknown>) => ({
    objects: [
      {
        name: 'crm_account',
        fields: { name: { type: 'text' } },
        actions: [{ name: 'crm_merge_accounts', type: 'script', locations: ['record_header'] }],
      },
      {
        name: 'crm_contact',
        fields: { name: { type: 'text' } },
        actions: [
          { name: 'crm_log_call', type: 'script', locations: ['record_related'] },
          { name: 'crm_new_contact', type: 'script', locations: ['list_toolbar'] },
          { name: 'crm_email_contact', type: 'script', locations: ['list_item'] },
          { name: 'crm_pin_contact', type: 'script', locations: ['record_header'] },
          { name: 'crm_sync_contact', type: 'script', locations: [] },
          { name: 'crm_score_contact', type: 'script' },
        ],
      },
    ],
    actions: [
      { name: 'crm_tag_contact', objectName: 'crm_contact', type: 'script', locations: ['list_item'] },
      { name: 'crm_export_all', type: 'script', locations: ['list_toolbar'] },
    ],
    pages: [
      {
        name: 'account_record',
        object: 'crm_account',
        regions: [{ name: 'main', components: [{ type: 'record:related_list', ...component }] }],
      },
    ],
  });
  const relatedList = (actions: unknown[], objectName = 'crm_contact') =>
    stackWith({ properties: { objectName, relationshipField: 'account_id', actions } });
  const at = (i: number) => `pages[0].regions[0].components[0].properties.actions[${i}]`;

  it('accepts ids that resolve on the child object at every location a related list draws', () => {
    expect(
      validateActionNameRefs(
        relatedList(['crm_log_call', 'crm_new_contact', 'crm_email_contact', 'crm_tag_contact']),
      ),
    ).toEqual([]);
  });

  it('errors on an id that resolves nowhere, naming the child object', () => {
    const findings = validateActionNameRefs(relatedList(['crm_log_call', 'crm_lgo_call']));
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(ACTION_NAME_UNDEFINED);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].path).toBe(at(1));
    expect(findings[0].message).toContain('"crm_lgo_call"');
    expect(findings[0].hint).toContain('"crm_contact"');
  });

  // The decision the direction fixes: the list never reads the page's object
  // (or a global action), so an id defined only there is as dead as a typo.
  it('errors on an id defined only on the page object or as a global action', () => {
    const findings = validateActionNameRefs(relatedList(['crm_merge_accounts', 'crm_export_all']));
    expect(findings.map((f) => f.path)).toEqual([at(0), at(1)]);
    expect(findings.every((f) => f.rule === ACTION_NAME_UNDEFINED && f.severity === 'error')).toBe(true);
    expect(findings[0].message).toContain('"crm_contact"');
  });

  it('errors on a child action placed at no location a related list draws', () => {
    const findings = validateActionNameRefs(
      relatedList(['crm_pin_contact', 'crm_log_call', 'crm_sync_contact', 'crm_score_contact']),
    );
    expect(findings.map((f) => f.path)).toEqual([at(0), at(2), at(3)]);
    expect(findings.every((f) => f.rule === ACTION_NAME_UNDEFINED && f.severity === 'error')).toBe(true);
  });

  it('resolves against a bound dataSource object, which the renderer writes over objectName', () => {
    const findings = validateActionNameRefs(
      stackWith({
        dataSource: { object: 'crm_contact' },
        properties: { objectName: 'crm_account', relationshipField: 'account_id', actions: ['crm_log_call', 'crm_merge_accounts'] },
      }),
    );
    expect(findings.map((f) => f.path)).toEqual([at(1)]);
  });

  it('says nothing about a child object this stack does not define', () => {
    expect(validateActionNameRefs(relatedList(['invite_user', 'nope'], 'sys_member'))).toEqual([]);
  });
});

describe('validateActionNameRefs — navigation action items', () => {
  it('errors on an undefined nav actionName', () => {
    const findings = validateActionNameRefs({
      ...withActions(),
      apps: [
        {
          name: 'crm',
          navigation: [
            { id: 'nav_new', type: 'action', label: 'New', actionDef: { actionName: 'ghost_action' } },
          ],
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('apps[0].navigation[0].actionDef.actionName');
  });

  it('accepts a defined nav actionName and walks areas', () => {
    const findings = validateActionNameRefs({
      ...withActions(),
      apps: [
        {
          name: 'crm',
          areas: [
            {
              id: 'a',
              label: 'A',
              navigation: [
                { id: 'nav_c', type: 'action', label: 'Convert', actionDef: { actionName: 'crm_convert_lead' } },
              ],
            },
          ],
        },
      ],
    });
    expect(findings).toEqual([]);
  });
});

// Deep-link auto-run (#4848): `{ type: 'object', runAction }` is the declared
// form of the `?runAction=<name>` URL contract (cloud#844) — an action name
// bound by reference, dead like every other surface here when it resolves to
// nothing: the entry navigates and the auto-run silently never fires.
describe('validateActionNameRefs — navigation deep-link runAction (#4848)', () => {
  it('errors on a runAction naming no defined action', () => {
    const findings = validateActionNameRefs({
      ...withActions(),
      apps: [
        {
          name: 'crm',
          navigation: [
            { id: 'nav_leads', type: 'object', label: 'Leads', objectName: 'crm_lead', runAction: 'ghost_action' },
          ],
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].rule).toBe(ACTION_NAME_UNDEFINED);
    expect(findings[0].path).toBe('apps[0].navigation[0].runAction');
    expect(findings[0].where).toContain('nav "nav_leads"');
  });

  it('offers a did-you-mean for a near-miss and accepts a resolving name', () => {
    const near = validateActionNameRefs({
      ...withActions(),
      apps: [
        {
          name: 'crm',
          navigation: [
            { id: 'nav_leads', type: 'object', label: 'Leads', objectName: 'crm_lead', runAction: 'crm_convert_leads' },
          ],
        },
      ],
    });
    expect(near).toHaveLength(1);
    expect(near[0].message).toContain('Did you mean "crm_convert_lead"?');

    const clean = validateActionNameRefs({
      ...withActions(),
      apps: [
        {
          name: 'crm',
          areas: [
            {
              id: 'a',
              label: 'A',
              navigation: [
                { id: 'nav_leads', type: 'object', label: 'Leads', objectName: 'crm_lead', runAction: 'crm_convert_lead' },
              ],
            },
          ],
        },
      ],
    });
    expect(clean).toEqual([]);
  });

  it('ignores runAction on a non-object nav item — the slot is the object branch\'s', () => {
    const findings = validateActionNameRefs({
      ...withActions(),
      apps: [
        {
          name: 'crm',
          navigation: [
            { id: 'nav_odd', type: 'url', label: 'Odd', url: 'https://example.com', runAction: 'ghost_action' },
          ],
        },
      ],
    });
    expect(findings).toEqual([]);
  });
});

describe('validateActionNameRefs — bulkActionDefs (#4457)', () => {
  it('errors on an aggregate def naming nothing', () => {
    // `resolveBulkActions` resolves an aggregate def's `name` against the
    // object's actions to get the dispatcher it calls once for the selection.
    // No match → no dispatcher → the dialog opens and the run reports "has no
    // dispatcher wired". Same dead affordance as a bulkActions name.
    const findings = validateActionNameRefs({
      ...withActions(),
      views: [
        {
          name: 'crm_lead',
          list: { bulkActionDefs: [{ name: 'export_zip', operation: 'custom', execution: 'aggregate' }] },
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].path).toBe('views[0].list.bulkActionDefs[0].name');
    expect(findings[0].where).toContain('bulkActionDefs[0]');
  });

  it('accepts an aggregate def that resolves', () => {
    const findings = validateActionNameRefs({
      ...withActions(),
      views: [
        {
          name: 'crm_lead',
          list: { bulkActionDefs: [{ name: 'crm_convert_lead', operation: 'custom', execution: 'aggregate' }] },
        },
      ],
    });
    expect(findings).toEqual([]);
  });

  it("leaves an update/delete def alone — its `name` is a button id, not a reference", () => {
    // Resolving `archive` against `stack.actions` would be nonsense: the
    // executor writes fields through the data API and never looks the name up.
    const findings = validateActionNameRefs({
      ...withActions(),
      views: [
        {
          name: 'crm_lead',
          list: {
            bulkActionDefs: [
              { name: 'archive', operation: 'update', patch: { archived: true } },
              { name: 'purge', operation: 'delete' },
            ],
          },
        },
      ],
    });
    expect(findings).toEqual([]);
  });

  it('skips a def carrying an inlined `actionDef` — it brings its own dispatcher', () => {
    const findings = validateActionNameRefs({
      ...withActions(),
      views: [
        {
          name: 'crm_lead',
          list: {
            bulkActionDefs: [
              { name: 'export_zip', operation: 'custom', execution: 'aggregate', actionDef: { type: 'api' } },
            ],
          },
        },
      ],
    });
    expect(findings).toEqual([]);
  });

  it('tells the author no `locations` entry is needed for a selection-bar action', () => {
    // The selection bar is the ONE surface that does not filter on
    // `locations` — the generic "with the location this surface needs" hint
    // would send an author to add a placement that changes nothing.
    const findings = validateActionNameRefs({
      ...withActions(),
      views: [{ name: 'crm_lead', list: { bulkActions: ['mass_update'] } }],
    });
    expect(findings[0].hint).toContain('the selection bar places it by name');
    expect(findings[0].hint).not.toContain('the location this surface needs');
  });

  it('still says "location" for a row-action menu, which DOES filter', () => {
    const findings = validateActionNameRefs({
      ...withActions(),
      views: [{ name: 'crm_lead', list: { rowActions: ['complete_task'] } }],
    });
    expect(findings[0].hint).toContain('the location this surface needs');
  });
});

describe('validateActionNameRefs — object-embedded list views (#4457)', () => {
  it('walks an object’s own listViews, which have no top-level `list`', () => {
    const findings = validateActionNameRefs({
      objects: [
        {
          name: 'crm_lead',
          listViews: {
            all: {
              rowActions: ['ghost_row'],
              bulkActionDefs: [{ name: 'ghost_zip', operation: 'custom', execution: 'aggregate' }],
            },
          },
        },
      ],
      actions: [{ name: 'crm_convert_lead', type: 'script' }],
    });
    expect(findings.map((f) => f.path)).toEqual([
      'objects[0].listViews.all.rowActions[0]',
      'objects[0].listViews.all.bulkActionDefs[0].name',
    ]);
    expect(findings[0].where).toContain('object "crm_lead"');
  });

  it('resolves against the object’s OWN actions, not just stack.actions', () => {
    const findings = validateActionNameRefs({
      objects: [
        {
          name: 'crm_lead',
          actions: [{ name: 'crm_score', type: 'script' }],
          listViews: { all: { bulkActions: ['crm_score'] } },
        },
      ],
    });
    expect(findings).toEqual([]);
  });
});

describe('validateActionNameRefs — floor', () => {
  it('is silent on a clean stack and tolerates empty input', () => {
    expect(validateActionNameRefs(withActions())).toEqual([]);
    expect(validateActionNameRefs({})).toEqual([]);
    expect(validateActionNameRefs(null as unknown as Record<string, unknown>)).toEqual([]);
  });

  it('ignores a non-action nav item that happens to carry an actionDef', () => {
    const findings = validateActionNameRefs({
      ...withActions(),
      apps: [
        {
          name: 'crm',
          navigation: [
            { id: 'nav_o', type: 'object', label: 'Leads', objectName: 'crm_lead', actionDef: { actionName: 'ghost' } },
          ],
        },
      ],
    });
    expect(findings).toEqual([]);
  });
});
