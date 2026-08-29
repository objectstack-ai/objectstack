// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Unit pins for the unbound form-view predicate root detector (#12915 scope C).
 *
 * The detector's product requirement is asymmetric, and so is this suite: a
 * MISSED exotic predicate costs one un-warned artifact, while a FALSE POSITIVE
 * on a healthy current artifact trains operators to ignore the channel. So the
 * negative cases below (string literals, calls, member access, comprehension
 * macros, every bound root) carry as much weight as the positive one, and each
 * exists because a naive "identifier not in the vocabulary" scan gets it wrong.
 */

import { describe, it, expect } from 'vitest';
import {
  BOUND_FORM_VIEW_PREDICATE_ROOTS,
  BOUND_FORM_FIELD_PREDICATE_ROOTS,
  FIELD_ONLY_BOUND_PREDICATE_ROOTS,
  detectUnboundFormViewPredicateRoots,
  unboundRootsInCelSource,
} from './form-predicate-root-policy.js';

/** The repro artifact's shape: one form view, one section, one gated field. */
function definitionWithFieldPredicate(predicate: unknown, object = 'crm_lead'): unknown {
  return {
    manifest: { id: 'app.test', engines: { protocol: '^17.0.0-rc.1' } },
    views: [
      {
        form: {
          type: 'simple',
          data: { object },
          sections: [
            {
              name: 'main',
              fields: [
                { field: 'name', required: true },
                { field: 'disqualification_reason', required: true, visibleWhen: predicate },
              ],
            },
          ],
        },
      },
    ],
  };
}

const CEL = (source: string) => ({ dialect: 'cel', source });

describe('the bound vocabulary comes from the contract, not from this module', () => {
  it('the shared base — and therefore the SECTION vocabulary — is record / previous / parent / data', () => {
    // `packages/spec/src/ui/view.zod.ts`, `FormSectionSchema.visibleWhen`:
    // "Root: `record` (+ `previous`, `parent`) in runtime forms, or `data` in
    // metadata forms. No `current_user` at section level — it is unbound here
    // and the predicate would fault open."
    expect([...BOUND_FORM_VIEW_PREDICATE_ROOTS]).toEqual(['record', 'previous', 'parent', 'data']);
    expect(BOUND_FORM_VIEW_PREDICATE_ROOTS).not.toContain('current_user');
  });

  it('the FIELD vocabulary adds the current_user family (objectui#6010, re-measured by #12930)', () => {
    // `FormFieldSchema.visibleWhen`: "`current_user` (and the ADR-0068 aliases
    // `user` / `ctx.user` / `os.user`) resolves here since objectui#6010".
    // This is the correction: the first version of this policy judged a field
    // by the section vocabulary and false-flagged a legitimate predicate.
    expect([...BOUND_FORM_FIELD_PREDICATE_ROOTS]).toEqual([
      'record', 'previous', 'parent', 'data',
      'current_user', 'user', 'ctx', 'os',
    ]);
    // The field vocabulary is a strict superset — the base can never drift out
    // from under it.
    for (const root of BOUND_FORM_VIEW_PREDICATE_ROOTS) {
      expect(BOUND_FORM_FIELD_PREDICATE_ROOTS, root).toContain(root);
    }
  });

  it('judges the SAME predicate differently per surface — the whole point of the split', () => {
    const source = 'current_user.id == record.owner';
    expect(unboundRootsInCelSource(source, BOUND_FORM_FIELD_PREDICATE_ROOTS)).toEqual([]);
    expect(unboundRootsInCelSource(source, BOUND_FORM_VIEW_PREDICATE_ROOTS)).toEqual(['current_user']);
  });

  it('defaults to the stricter (section) vocabulary, so a forgetful caller fails loudly', () => {
    // A missed detection is silent; a false positive is findable. The default
    // is chosen to fail in the findable direction — the traversal never uses it.
    expect(unboundRootsInCelSource('current_user.id == record.owner')).toEqual(['current_user']);
  });
});

describe('unboundRootsInCelSource — the judgement under the traversal', () => {
  it('flags the era spelling from the real incident', () => {
    expect(unboundRootsInCelSource('status == "unqualified"')).toEqual(['status']);
  });

  it('says nothing about a predicate rooted at any bound identifier', () => {
    for (const root of BOUND_FORM_VIEW_PREDICATE_ROOTS) {
      expect(unboundRootsInCelSource(`${root}.status == "unqualified"`), root).toEqual([]);
    }
  });

  it('does not mistake a MEMBER named like a root for a root', () => {
    // A record field that happens to be called `status`, `data` or `features`
    // is member access, not a scope root.
    expect(unboundRootsInCelSource('record.status == "unqualified"')).toEqual([]);
    expect(unboundRootsInCelSource('record.data.parent.previous != null')).toEqual([]);
    expect(unboundRootsInCelSource('record.features.beta')).toEqual([]);
  });

  it('does not read identifier-shaped text inside string literals', () => {
    // The load-bearing false-positive case: quoted prose mentioning a field.
    expect(unboundRootsInCelSource('record.note == "status unqualified"')).toEqual([]);
    expect(unboundRootsInCelSource("record.note == 'company == acme'")).toEqual([]);
    expect(unboundRootsInCelSource('record.note == "it\'s status"')).toEqual([]);
    // A literal is not a hiding place either way round: a real bare root
    // beside a decoy literal is still reported, exactly once.
    expect(unboundRootsInCelSource('status == "status"')).toEqual(['status']);
  });

  it('does not treat a call target as a scope root', () => {
    expect(unboundRootsInCelSource('has(record.owner)')).toEqual([]);
    expect(unboundRootsInCelSource('size(record.tags) > 0')).toEqual([]);
    expect(unboundRootsInCelSource('has (record.owner)')).toEqual([]);
    expect(unboundRootsInCelSource('int(record.amount) > 100')).toEqual([]);
    // …but an unbound root INSIDE a call argument is still a fault-open root.
    expect(unboundRootsInCelSource('has(status)')).toEqual(['status']);
  });

  it('declines to judge a comprehension macro at all (its variable is locally bound)', () => {
    // `t` is bound by the macro. A tokenizer cannot tell that from an unbound
    // root, so the whole predicate is skipped — silence over a wrong accusation.
    expect(unboundRootsInCelSource("record.tags.exists(t, t == 'vip')")).toEqual([]);
    expect(unboundRootsInCelSource('record.lines.all(l, l.qty > 0)')).toEqual([]);
    expect(unboundRootsInCelSource('record.lines.map(l, l.qty).size() > 0')).toEqual([]);
    expect(unboundRootsInCelSource('record.lines.filter(l, l.ok).size() > 0')).toEqual([]);
    expect(unboundRootsInCelSource('record.tags.exists_one(t, t == 1)')).toEqual([]);
  });

  it('does not report CEL literals or reserved words as roots', () => {
    expect(unboundRootsInCelSource('true')).toEqual([]);
    expect(unboundRootsInCelSource('record.owner != null && true')).toEqual([]);
    expect(unboundRootsInCelSource("'vip' in record.tags")).toEqual([]);
  });

  it('does not read a number as an identifier', () => {
    expect(unboundRootsInCelSource('record.amount > 1e5')).toEqual([]);
    expect(unboundRootsInCelSource('record.amount > 100')).toEqual([]);
  });

  it('reports each distinct unbound root once, in source order', () => {
    expect(unboundRootsInCelSource('status == "x" && company != "" && status != "y"'))
      .toEqual(['status', 'company']);
  });

  it('answers identically on a second call (no leaked regex state)', () => {
    const source = 'status == "unqualified"';
    expect(unboundRootsInCelSource(source)).toEqual(unboundRootsInCelSource(source));
  });
});

describe('detectUnboundFormViewPredicateRoots — traversal', () => {
  it('reports the field predicate with its path, view identity and source', () => {
    const findings = detectUnboundFormViewPredicateRoots(
      definitionWithFieldPredicate(CEL('status == "unqualified"')),
    );
    expect(findings).toEqual([
      {
        path: 'views[0].form.sections[0].fields[1].visibleWhen',
        view: 'crm_lead',
        root: 'status',
        source: 'status == "unqualified"',
        surface: 'field',
      },
    ]);
  });

  it('stays SILENT on a field predicate rooted at the current_user family', () => {
    // The regression this patch exists for: each of these resolves at field
    // level (objectui#6010), so flagging one is crying wolf on a legitimate,
    // correctly-authored predicate.
    for (const root of FIELD_ONLY_BOUND_PREDICATE_ROOTS) {
      const source = root === 'ctx' || root === 'os'
        ? `${root}.user.role == "admin"`
        : `${root}.role == "admin"`;
      expect(
        detectUnboundFormViewPredicateRoots(definitionWithFieldPredicate(CEL(source))),
        source,
      ).toEqual([]);
    }
  });

  it('still FLAGS the same root at SECTION level, where the contract says it is unbound', () => {
    const findings = detectUnboundFormViewPredicateRoots({
      views: [
        {
          form: {
            data: { object: 'crm_lead' },
            sections: [
              {
                visibleWhen: CEL('current_user.role == "admin"'),
                fields: [{ field: 'a', visibleWhen: CEL('current_user.role == "admin"') }],
              },
            ],
          },
        },
      ],
    });
    // Exactly one: the section slot. The identical field predicate is silent.
    expect(findings).toHaveLength(1);
    expect(findings[0]!.surface).toBe('section');
    expect(findings[0]!.root).toBe('current_user');
    expect(findings[0]!.path).toBe('views[0].form.sections[0].visibleWhen');
  });

  it('tags every finding with the surface that decided its vocabulary', () => {
    const findings = detectUnboundFormViewPredicateRoots({
      views: [
        {
          form: {
            data: { object: 'crm_lead' },
            sections: [
              {
                visibleWhen: CEL('stage == "closed"'),
                fields: [{ field: 'a', visibleWhen: CEL('status == "x"') }],
              },
            ],
          },
        },
      ],
    });
    expect(findings.map((f) => f.surface)).toEqual(['section', 'field']);
  });

  it('reports nothing for the same artifact spelled with the `record.` root', () => {
    expect(
      detectUnboundFormViewPredicateRoots(
        definitionWithFieldPredicate(CEL('record.status == "unqualified"')),
      ),
    ).toEqual([]);
  });

  it('reads the bare-string shorthand and the deprecated `visibleOn` alias', () => {
    // Both reach this scan because it runs BEFORE the parse that normalizes them.
    expect(detectUnboundFormViewPredicateRoots(
      definitionWithFieldPredicate('status == "unqualified"'),
    )).toHaveLength(1);

    const withAlias: any = definitionWithFieldPredicate(CEL('record.x'));
    const field = withAlias.views[0].form.sections[0].fields[1];
    delete field.visibleWhen;
    field.visibleOn = CEL('status == "unqualified"');
    const findings = detectUnboundFormViewPredicateRoots(withAlias);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.path).toBe('views[0].form.sections[0].fields[1].visibleOn');
  });

  it('passes an opaque predicate: AST-only, and any non-CEL dialect', () => {
    expect(detectUnboundFormViewPredicateRoots(
      definitionWithFieldPredicate({ dialect: 'cel', ast: { kind: 'binary' } }),
    )).toEqual([]);
    expect(detectUnboundFormViewPredicateRoots(
      definitionWithFieldPredicate({ dialect: 'template', source: 'status' }),
    )).toEqual([]);
  });

  it('walks section predicates, the legacy `groups` bucket, and sub-fields at depth', () => {
    const findings = detectUnboundFormViewPredicateRoots({
      views: [
        {
          form: {
            data: { object: 'crm_lead' },
            groups: [
              {
                visibleWhen: CEL('stage == "closed"'),
                fields: [
                  {
                    field: 'lines',
                    type: 'repeater',
                    fields: [
                      { field: 'note', visibleWhen: CEL('type == "formula"') },
                      { field: 'ok', visibleWhen: CEL('data.type == "formula"') },
                    ],
                  },
                ],
              },
            ],
          },
        },
      ],
    });
    expect(findings.map((f) => f.path)).toEqual([
      'views[0].form.groups[0].visibleWhen',
      'views[0].form.groups[0].fields[0].fields[0].visibleWhen',
    ]);
    expect(findings.map((f) => f.root)).toEqual(['stage', 'type']);
  });

  it('walks the keyed `formViews` map as well as the default `form` arm', () => {
    const findings = detectUnboundFormViewPredicateRoots({
      views: [
        {
          list: { data: { object: 'crm_lead' } },
          formViews: {
            edit: {
              data: { object: 'crm_lead' },
              sections: [{ fields: [{ field: 'a', visibleWhen: CEL('status == "x"') }] }],
            },
          },
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.path).toBe('views[0].formViews.edit.sections[0].fields[0].visibleWhen');
    expect(findings[0]!.view).toBe('crm_lead');
  });

  it('reads an independent form ViewItem, and skips a list ViewItem', () => {
    const formItem = {
      views: [
        {
          name: 'crm_lead.edit',
          object: 'crm_lead',
          viewKind: 'form',
          config: { sections: [{ fields: [{ field: 'a', visibleWhen: CEL('status == "x"') }] }] },
        },
      ],
    };
    const findings = detectUnboundFormViewPredicateRoots(formItem);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.view).toBe('crm_lead.edit');
    expect(findings[0]!.path).toBe('views[0].config.sections[0].fields[0].visibleWhen');

    const listItem = { views: [{ ...formItem.views[0], viewKind: 'list' }] };
    expect(detectUnboundFormViewPredicateRoots(listItem)).toEqual([]);
  });

  it('is silent — never throwing — on shapes it cannot read', () => {
    expect(detectUnboundFormViewPredicateRoots(undefined)).toEqual([]);
    expect(detectUnboundFormViewPredicateRoots(null)).toEqual([]);
    expect(detectUnboundFormViewPredicateRoots('not a definition')).toEqual([]);
    expect(detectUnboundFormViewPredicateRoots([])).toEqual([]);
    expect(detectUnboundFormViewPredicateRoots({ manifest: {} })).toEqual([]);
    expect(detectUnboundFormViewPredicateRoots({ views: 'nope' })).toEqual([]);
    expect(detectUnboundFormViewPredicateRoots({ views: [null, 7, 'x'] })).toEqual([]);
    // Legacy bare-string field entries name a field and carry no predicate.
    expect(detectUnboundFormViewPredicateRoots({
      views: [{ form: { sections: [{ fields: ['title', 'status', null] }] } }],
    })).toEqual([]);
  });

  it('does not mutate the definition it reads', () => {
    const definition = definitionWithFieldPredicate(CEL('status == "unqualified"'));
    const before = JSON.stringify(definition);
    detectUnboundFormViewPredicateRoots(definition);
    expect(JSON.stringify(definition)).toBe(before);
  });
});
