// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The authoring type admits the configuration its own widgets require —
 * objectui#5040.
 *
 * ## The defect
 *
 * `FormFieldSpec` is the authoring surface of a metadata-admin form layout: the
 * element type of `FormSectionSpec.fields[]`, what an author writes. It did not
 * declare `dependsOn`. `widgets.tsx` held a SECOND, inline description of the
 * same object as `WidgetProps.fieldSpec`, and that one did — because two
 * registered widgets read `dependsOn` as their primary configuration:
 *
 *     field-selector   dependsOn || reference || 'objectName'   → which object's
 *                                                                 field catalog
 *     dynamic-config   dependsOn → formData[dep] → context.dynamicSchemas[value]
 *
 * One value, one channel (`MetadataField` hands the same object down), two
 * descriptions — and they disagreed on the one key that decides what those
 * widgets show. So the only configuration that makes `field-selector` work,
 *
 *     { field: 'fields', widget: 'field-selector', dependsOn: 'objectName' }
 *
 * was `TS2353: 'dependsOn' does not exist in type 'FormFieldSpec'` for anyone
 * who typed their spec. Nothing was broken at runtime, and that is precisely why
 * it survived: in-repo specs reach the form through `as any` / loose types, so
 * the authoring type was never asked the question it answers wrongly.
 *
 * ## What is pinned, and by which tool
 *
 * Two halves that fail in different places, on purpose:
 *
 *   • **`tsc`** — {@link formFieldSpecDependsOnTypePins}. Type assertions are
 *     erased at runtime, so vitest proves nothing about them; the package's
 *     `type-check` script (`tsc -p tsconfig.test.json`, the only project that
 *     compiles this directory's tests) is what judges them. Each
 *     `@ts-expect-error` is a two-way pin: the directive is itself an error
 *     (TS2578) once the line below it starts compiling, so a LOOSENING turns
 *     this file red rather than quietly passing.
 *   • **vitest** — the render blocks. `dependsOn` is asserted to be
 *     load-bearing: the same widget, handed the same `formData`, renders
 *     different things depending on which sibling `dependsOn` names. A pin that
 *     only proved the key type-checks would go green against a key nothing
 *     reads.
 *
 * The negative controls are what stop this being "the type got looser": an
 * undeclared key is still rejected (so the fix is not an index signature), and
 * the `{ field, param }` object arm of `@object-ui/types`' canonical
 * `DependsOnInput` is still rejected (so the fix did not adopt a shape neither
 * reader can consume — both index `[0]` and use it as a field NAME).
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { WIDGETS, type WidgetContext, type WidgetProps, type WidgetRenderer } from './widgets';
import { type FormFieldSpec } from './SchemaForm';
import type { FormFieldSpec as FormFieldSpecFromLeaf } from './form-spec';

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;

/* ========================================================================== */
/* 1. tsc: the authoring type accepts it, and still refuses what it should     */
/* ========================================================================== */

/**
 * These never run. They are the half of this card a runtime test cannot express
 * — "a typed form spec can be written at all" is a statement about `tsc`.
 */
export function formFieldSpecDependsOnTypePins(): void {
  // ── PIN A — the exact literal from the card. This is the line that used to be
  // TS2353, and the one configuration that makes `field-selector` work.
  const fieldSelector: FormFieldSpec = {
    field: 'fields',
    widget: 'field-selector',
    dependsOn: 'objectName',
  };
  void fieldSelector;

  // ── PIN B — the array arm. Both readers take `[0]` of it, so the list form is
  // part of the contract, not an accident of the old inline copy.
  const dynamicConfig: FormFieldSpec = {
    field: 'config',
    widget: 'dynamic-config',
    dependsOn: ['driver'],
  };
  void dynamicConfig;

  // ── PIN C — negative control on the KEY. Excess-property checking is still
  // live, so PINs A and B mean "this key is declared", not "this type stopped
  // checking". Without it both would also pass against an index signature or
  // `any`, which is the failure mode a widening is most likely to reach for.
  const undeclaredKey: FormFieldSpec = {
    field: 'fields',
    // @ts-expect-error objectui#5040 — an undeclared key is still rejected
    thisKeyIsNotPartOfTheAuthoringSurface: 'objectName',
  };
  void undeclaredKey;

  // ── PIN D — negative control on the VALUE. `@object-ui/types` already has a
  // canonical `DependsOnInput` (`packages/types/src/form.ts`) that also admits
  // `{ field, param }` objects. It is the obvious thing to reach for and it is
  // wrong here: `widgets.tsx` indexes `[0]` and uses the result as a field name
  // to look up in `formData`, so an object arm would arrive where a string is
  // required and break both widgets silently. Converging the two shapes is its
  // own decision; until it is taken, this surface refuses the wider one.
  const canonicalObjectArm: FormFieldSpec = {
    field: 'config',
    // @ts-expect-error objectui#5040 — `DependsOnInput`'s object arm is not
    // consumable here: both readers use `[0]` as a field NAME
    dependsOn: [{ field: 'driver', param: 'x' }],
  };
  void canonicalObjectArm;

  // ── PIN E — the exact shape, so a later "helpful" widening to `DependsOnInput`
  // or to `unknown` fails here rather than at the two `[0]` reads.
  type _shape = Assert<Equal<FormFieldSpec['dependsOn'], string | string[] | undefined>>;

  // ── PIN F — ONE description of the contract. `WidgetProps.fieldSpec` is the
  // authoring type itself, not a second structural copy of it; a re-inlined copy
  // fails here even if it happens to agree on every key today.
  type _oneContract = Assert<Equal<NonNullable<WidgetProps['fieldSpec']>, FormFieldSpec>>;

  // ── PIN G — the leaf module and `SchemaForm`'s re-export are the same type, so
  // moving the declaration did not fork the surface importers already use.
  type _reexportIsTheSameType = Assert<Equal<FormFieldSpec, FormFieldSpecFromLeaf>>;
}

/* ========================================================================== */
/* 2. vitest: `dependsOn` decides what the widget offers                      */
/* ========================================================================== */

const FieldSelector = WIDGETS['field-selector'];
const DynamicConfig = WIDGETS['dynamic-config'];

const DYNAMIC_SCHEMAS: WidgetContext = {
  // objectui#8167 — required member; `'flattened'` is the pre-existing default,
  // so nothing this fixture asserts moves.
  conditionScope: 'flattened',
  dynamicSchemas: {
    postgres: { properties: { host: { type: 'string', title: 'Host' } } },
    sqlite: { properties: { filename: { type: 'string', title: 'Filename' } } },
  },
};

function renderWidget(Widget: WidgetRenderer, props: Partial<WidgetProps>) {
  const full: WidgetProps = {
    value: '',
    onChange: () => {},
    schema: { type: 'string' },
    ...props,
  };
  return render(<Widget {...full} />);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('objectui#5040 — a spec typed as `FormFieldSpec` configures its widget', () => {
  it('`field-selector` fetches the catalog of the object named by `dependsOn`', async () => {
    // Typed as the AUTHORING type, not as a loose literal: this const is the pin.
    // `formData` holds a decoy under the widget's default key, so a green here
    // cannot come from the `|| 'objectName'` fallback.
    const spec: FormFieldSpec = {
      field: 'fields',
      widget: 'field-selector',
      dependsOn: 'targetObject',
      multiple: true,
    };
    // Typed with the URL parameter on purpose: the assertion below reads the
    // ARGUMENT, and a zero-arg mock would type its call tuple as `[]` and make
    // `calls[0][0]` unreachable rather than merely unasserted.
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      void input;
      return {
        ok: true,
        status: 200,
        json: async () => ({ fields: [{ name: 'amount', label: 'Amount' }] }),
      } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWidget(FieldSelector, {
      fieldSpec: spec,
      formData: { targetObject: 'showcase_opportunity', objectName: 'the_fallback_object' },
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual([
      '/api/v1/objects/showcase_opportunity/fields',
    ]);
  });

  it('`dynamic-config` selects the sub-schema through the sibling `dependsOn` names', () => {
    const spec: FormFieldSpec = { field: 'config', widget: 'dynamic-config', dependsOn: 'driver' };
    renderWidget(DynamicConfig, {
      value: {},
      schema: { type: 'object' },
      fieldSpec: spec,
      formData: { driver: 'postgres', otherField: 'sqlite' },
      context: DYNAMIC_SCHEMAS,
    });
    expect(screen.getByLabelText('Host')).toBeInTheDocument();
    expect(screen.queryByLabelText('Filename')).not.toBeInTheDocument();
  });

  it('naming a DIFFERENT sibling renders a different sub-schema — the key is load-bearing', () => {
    // Same widget, same `formData`; only `dependsOn` moves. Without this the
    // assertion above would also pass for a widget that ignored the key and read
    // `driver` by hard-coded name.
    const spec: FormFieldSpec = { field: 'config', widget: 'dynamic-config', dependsOn: 'otherField' };
    renderWidget(DynamicConfig, {
      value: {},
      schema: { type: 'object' },
      fieldSpec: spec,
      formData: { driver: 'postgres', otherField: 'sqlite' },
      context: DYNAMIC_SCHEMAS,
    });
    expect(screen.getByLabelText('Filename')).toBeInTheDocument();
    expect(screen.queryByLabelText('Host')).not.toBeInTheDocument();
  });

  it('the array arm resolves through its first entry', () => {
    const spec: FormFieldSpec = { field: 'config', widget: 'dynamic-config', dependsOn: ['otherField'] };
    renderWidget(DynamicConfig, {
      value: {},
      schema: { type: 'object' },
      fieldSpec: spec,
      formData: { driver: 'postgres', otherField: 'sqlite' },
      context: DYNAMIC_SCHEMAS,
    });
    expect(screen.getByLabelText('Filename')).toBeInTheDocument();
  });
});
