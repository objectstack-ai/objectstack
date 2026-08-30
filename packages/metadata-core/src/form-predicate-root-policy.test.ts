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
import { FormFieldSchema, FormSectionSchema } from '@objectstack/spec/ui';
import {
  BOUND_FORM_VIEW_PREDICATE_ROOTS,
  BOUND_FORM_FIELD_PREDICATE_ROOTS,
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

/** The same artifact with the predicate on the SECTION rather than on a field. */
function definitionWithSectionPredicate(predicate: unknown, object = 'crm_lead'): unknown {
  return {
    manifest: { id: 'app.test', engines: { protocol: '^17.0.0-rc.1' } },
    views: [
      {
        form: {
          type: 'simple',
          data: { object },
          sections: [
            { name: 'main', visibleWhen: predicate, fields: [{ field: 'name' }] },
          ],
        },
      },
    ],
  };
}

const CEL = (source: string) => ({ dialect: 'cel', source });

/**
 * The `current_user` family as ROOT identifiers — `current_user` plus the
 * ADR-0068 D1 aliases, whose two-segment spellings (`ctx.user`, `os.user`) put
 * `ctx` and `os` in root position.
 *
 * Spelled out here rather than imported: this list used to BE an export
 * (`FIELD_ONLY_BOUND_PREDICATE_ROOTS`), and asserting the module against its
 * own constant would have made the cases below agree with any value it took.
 */
const CURRENT_USER_FAMILY_ROOTS = ['current_user', 'user', 'ctx', 'os'] as const;

/**
 * The `visibleWhen` contract sentence for one form-view surface, read LIVE out
 * of `@objectstack/spec` instead of copied into a comment in this file.
 *
 * `FormFieldSchema` / `FormSectionSchema` are `strictObject(...).transform(...)`
 * pipes (ADR-0089 D3a), so the authored `.describe()` text hangs off the pipe's
 * INPUT shape, reached through zod 4's public `.in`. The guard is the point of
 * the helper: if that accessor path ever moves, this file must go RED rather
 * than hand every assertion below an `undefined` that quietly matches nothing.
 */
function visibleWhenContract(schema: unknown, label: string): string {
  const shape = (schema as { in?: { shape?: Record<string, unknown> } }).in?.shape;
  const slot = shape?.visibleWhen as { description?: unknown } | undefined;
  const prose = slot?.description;
  expect(
    typeof prose === 'string' && prose.length > 0,
    `${label}.visibleWhen description unreadable — the accessor this pin depends `
      + 'on has moved. Fix the accessor; do not delete the pin.',
  ).toBe(true);
  return prose as string;
}

describe('the bound vocabulary is checked against the LIVE contract, not a copy of it', () => {
  /**
   * ⚠️ This block used to CARRY the section contract sentence as a comment:
   *
   *     "Root: `record` (+ `previous`, `parent`) in runtime forms, or `data` in
   *      metadata forms. No `current_user` at section level — it is unbound
   *      here and the predicate would fault open."
   *
   * #12914 replaced that sentence — objectui#6110 threads the host scope into
   * `isSectionVisible`, objectui#6111 evaluates the section predicate on the
   * `section-divider` pseudo-field with that scope bound — and the copy above
   * went stale HERE in total silence, because no gate reads a comment. It is
   * kept as history, the record of how this file failed, and replaced as a
   * MECHANISM by the reads below: the sentence is now fetched from the schema
   * at run time, so the next re-measurement of it fails this file instead of
   * outliving it.
   */
  it('both surfaces bind the current_user family, and the live contract still says so', () => {
    for (const [label, schema] of [
      ['FormFieldSchema', FormFieldSchema],
      ['FormSectionSchema', FormSectionSchema],
    ] as const) {
      const prose = visibleWhenContract(schema, label);
      expect(prose, label).toMatch(/`current_user`[\s\S]{0,160}resolves here/);
      for (const alias of ['`user`', '`ctx.user`', '`os.user`']) {
        expect(prose, `${label} / ${alias}`).toContain(alias);
      }
    }

    expect([...BOUND_FORM_VIEW_PREDICATE_ROOTS]).toEqual([
      'record', 'previous', 'parent', 'data',
      'current_user', 'user', 'ctx', 'os',
    ]);
    for (const root of CURRENT_USER_FAMILY_ROOTS) {
      expect(BOUND_FORM_VIEW_PREDICATE_ROOTS, root).toContain(root);
    }
  });

  it('the FIELD and SECTION vocabularies are ONE list, not two that happen to match', () => {
    // By identity, not by value: while these were two constants they could
    // drift apart silently, which is precisely what happened to the section
    // half. Nothing can now update one surface and leave the other behind.
    expect(BOUND_FORM_FIELD_PREDICATE_ROOTS).toBe(BOUND_FORM_VIEW_PREDICATE_ROOTS);
  });

  it('judges the SAME predicate identically on both surfaces — the split is empty', () => {
    // ⚠️ INVERTED IN PLACE. Was "judges the SAME predicate differently per
    // surface — the whole point of the split", expecting `['current_user']`
    // from the section vocabulary. The section binds the root since
    // objectui#6110 + #6111 (contract landed by #12914), so the section answer
    // is now `[]` too, and a finding there would be a boot notice about a
    // predicate that resolves.
    const source = 'current_user.id == record.owner';
    expect(unboundRootsInCelSource(source, BOUND_FORM_FIELD_PREDICATE_ROOTS)).toEqual([]);
    expect(unboundRootsInCelSource(source, BOUND_FORM_VIEW_PREDICATE_ROOTS)).toEqual([]);
  });

  it('defaults to the whole vocabulary — the verdict the traversal itself gives', () => {
    // ⚠️ INVERTED IN PLACE. Was "defaults to the stricter (section)
    // vocabulary, so a forgetful caller fails loudly", expecting
    // `['current_user']`. There is no stricter vocabulary left to default to,
    // and narrowing one purely to preserve that property would manufacture the
    // false positive this module exists to avoid.
    expect(unboundRootsInCelSource('current_user.id == record.owner')).toEqual([]);
    // Non-vacuity: the default still judges — a genuinely unbound root is
    // still reported without the caller naming a vocabulary.
    expect(unboundRootsInCelSource('status == "unqualified"')).toEqual(['status']);
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

  it('stays SILENT on a current_user-family predicate on EITHER surface', () => {
    // Both regressions in one loop. Each of these resolves at FIELD level
    // (objectui#6010) and at SECTION level (objectui#6110 + #6111), so
    // flagging one is crying wolf on a legitimate, correctly-authored
    // predicate — the failure the module doc forbids, once per surface.
    for (const root of CURRENT_USER_FAMILY_ROOTS) {
      const source = root === 'ctx' || root === 'os'
        ? `${root}.user.role == "admin"`
        : `${root}.role == "admin"`;
      expect(
        detectUnboundFormViewPredicateRoots(definitionWithFieldPredicate(CEL(source))),
        `field / ${source}`,
      ).toEqual([]);
      expect(
        detectUnboundFormViewPredicateRoots(definitionWithSectionPredicate(CEL(source))),
        `section / ${source}`,
      ).toEqual([]);
    }
  });

  it('says NOTHING about the same root at SECTION level either — it binds there now', () => {
    // ⚠️ INVERTED IN PLACE. This case asserted exactly ONE finding — the
    // section slot — "where the contract says it is unbound", while the
    // identical field predicate stayed silent. #12914 replaced that contract
    // sentence, so the two slots now answer alike and the artifact below is
    // healthy on both. A finding here would be a boot notice about a predicate
    // that resolves, which the module doc names as worse than no notice.
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
    expect(findings).toEqual([]);
  });

  it('still flags a genuinely unbound SECTION root — the silence above is not blanket', () => {
    // The control the inversion above needs: the section arm of the traversal
    // still reports, so "no finding" there is a verdict about `current_user`
    // and not a section scan that stopped running.
    const findings = detectUnboundFormViewPredicateRoots(
      definitionWithSectionPredicate(CEL('stage == "closed"')),
    );
    expect(findings).toEqual([
      {
        path: 'views[0].form.sections[0].visibleWhen',
        view: 'crm_lead',
        root: 'stage',
        source: 'stage == "closed"',
        surface: 'section',
      },
    ]);
  });

  it('tags every finding with the slot it sits in', () => {
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
