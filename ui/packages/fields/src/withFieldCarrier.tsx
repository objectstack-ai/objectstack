/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';

/**
 * Adapt `SchemaRenderer`'s SDUI carrier onto the field-widget contract —
 * objectui#3233, the producer-side half of retiring `schema` from
 * {@link import('./widgets/types').FieldWidgetComponentProps}.
 *
 * ## Why this exists
 *
 * Two kinds of host render a registered field widget, and they name the
 * metadata differently *for good reason*:
 *
 *  - the **form renderer** (`renderFieldComponent` in
 *    `@object-ui/components`), the inline-edit hosts (`FieldEditWidget`) and
 *    the action dialogs pass **`field`** — the field metadata they already
 *    hold;
 *  - **`SchemaRenderer`** (`@object-ui/react`) passes **`schema`** — the
 *    authored node. That key is the UNIVERSAL SDUI contract *every* registered
 *    component receives (`element:*`, `page:*`, `object-grid`,
 *    `ReportRenderer` …). It is not being retired and must not be: it is what
 *    the renderer means by "the node you were rendered from".
 *
 * What WAS wrong is that both keys reached the widget, so ~30 widgets resolved
 * their config as `field || schema` — one concept under two spellings, a second
 * de-facto contract on the widget side (AGENTS.md #0.1) and precisely the shape
 * that lets an AI-written widget pick one spelling and appear to work under one
 * host while reading `undefined` under the other.
 *
 * The translation belongs at the seam, exactly once: here. Downstream `field`
 * is the only carrier, and a widget reading `props.schema` no longer compiles.
 *
 * ## Guarantee
 *
 * Payload-preserving by construction: the node is forwarded **by reference**,
 * so a widget's `field` is the very object it used to read through `schema`.
 * `field` wins when a host supplies both (the form path always does, and it
 * holds the resolved metadata rather than the raw node).
 *
 * `schema` is *consumed* here rather than forwarded — with the key gone from
 * the contract, passing it on would only reach the DOM as a stray attribute
 * through a widget's `...props` spread.
 *
 * ## For widget authors outside this repo
 *
 * Registering a widget raw means `SchemaRenderer` hands it `schema` and no
 * `field`. Wrap it once at registration and the widget only ever implements
 * `FieldWidgetComponentProps`:
 *
 * ```tsx
 * import { withFieldCarrier } from '@object-ui/fields';
 *
 * ComponentRegistry.register('color', withFieldCarrier(ColorPickerField), {
 *   namespace: 'field',
 * });
 * ```
 */
export function withFieldCarrier<P extends object>(
  FieldWidget: React.ComponentType<P>,
): React.FC<Record<string, any>> {
  const FieldCarrierAdapter: React.FC<Record<string, any>> = ({ schema, field, ...props }) => (
    <FieldWidget {...(props as unknown as P)} field={field ?? schema} />
  );
  FieldCarrierAdapter.displayName = `FieldCarrier(${
    (FieldWidget as any).displayName || (FieldWidget as any).name || 'Component'
  })`;
  return FieldCarrierAdapter;
}
