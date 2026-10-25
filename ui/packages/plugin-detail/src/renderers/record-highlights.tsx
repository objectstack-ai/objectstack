/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `record:highlights` — top-of-page key fact strip (Salesforce-style
 * Highlights Panel). Adapts the spec's `fields: string[]` to the legacy
 * HeaderHighlight component which expects `HighlightField[]`.
 */

import React from 'react';
import { useRecordContext, useRegisterHighlightFields } from '@object-ui/react';
import { useFieldPermissions, usePermissions } from '@object-ui/permissions';
import type { RecordHighlightsComponentProps } from '@object-ui/types';
import { HeaderHighlight } from '../HeaderHighlight';
import { useRecordAriaProps } from './recordComponentAria';
import { recordBindingBlock } from './recordBinding';

const splitDesigner = (props: Record<string, any>) => {
  const { 'data-obj-id': id, 'data-obj-type': type, style, ...rest } = props || {};
  return { designer: { 'data-obj-id': id, 'data-obj-type': type, style }, rest };
};

export interface RecordHighlightsRendererProps {
  schema?: RecordHighlightsComponentProps & Record<string, any>;
  className?: string;
  [k: string]: any;
}

const RecordHighlightsBody: React.FC<RecordHighlightsRendererProps> = ({
  // ⛔ NOT `{} as any` — the annotation-erasing default objectui#8649 repaired.
  // The mechanism and why the spelling tracks the annotation are written once,
  // at the same site in `record-details.tsx`.
  schema = {} as NonNullable<RecordHighlightsRendererProps['schema']>,
  className,
  ...props
}) => {
  const ctx = useRecordContext();
  const { designer } = splitDesigner(props);
  /**
   * The block's authored `aria` bag, honoured through the family's ONE read
   * point (objectui#9556). Called here, with the other hooks, because every
   * renderer below it has early returns.
   *
   * ⛔ No `defaultRole`: with nothing authored this container stays the bare
   * `div` it has always been, so a page that never wrote `aria` renders
   * byte-identical DOM. An author who does write one gets a `region` to carry
   * it — see `recordComponentAria.ts` for why the attribute alone would reach
   * nobody.
   */
  const ariaProps = useRecordAriaProps(schema.aria);
  const objectName = ctx?.objectName || '';
  const perms = usePermissions();
  const { readableFields } = useFieldPermissions(objectName);

  /**
   * Block-level ADR-0066 CAPABILITY gate, read fail-closed (objectui#10155 —
   * the sibling family of objectui#10058, ruling batch #192 item 5 letter B).
   *
   * `requiredPermissions` on a record block is a **system capability set** —
   * the one meaning the word carries on `action`, `app`, `field` and
   * `bulkAction` — so it is read through the permission context's capability
   * path (`hasCapabilities` over the reported `systemPermissions`). An unheld
   * or unrecognised capability withholds the strip's content, and an
   * insufficient-permissions notice (`role="status"`) renders in its place:
   * the block is not hidden. That is what the contract's describe on
   * `RecordHighlightsProps.requiredPermissions` says ("an
   * insufficient-permissions notice takes its place").
   *
   * ⛔ NOT `perms.can(objectName, name)`. That call's second argument is the
   * closed object-action enum, and the stock `/me/permissions` provider maps
   * only eight verbs (`read`, `view`, `create`, `update`, `edit`, `delete`,
   * `import`, `export`) before its `?? 'allowRead'` tail sends everything else
   * to the object's read bit — so a capability nobody holds passed for every
   * reader of the object, with no refusal, no warning and no log. The full
   * reproduction behind that sentence is written once, at the same gate in
   * `record-quick-actions.tsx`, and is not restated here.
   *
   * ⛔ The object name is deliberately ABSENT from the verdict. A system
   * capability is not object-scoped, and the old `&& objectName` conjunct was
   * a second silent fail-open: a block rendered with no `objectName` in its
   * record context skipped its declared gate entirely.   *
   * ⚠️ A provider that never REPORTS capabilities (`systemPermissions`
   * `undefined` — the role-based `PermissionProvider`, a backend predating
   * ADR-0066, or no provider at all) still opens this gate. That is
   * `hasCapabilities`'s own ruled unreported-vs-empty doctrine
   * (objectui#4656), shared with every other capability gate in the tree; a
   * REPORTED empty array (`[]`, "holds nothing") is a real answer and gates
   * strictly.
   *
   * Read UN-CAST (objectui#8649), like `enforceFieldSecurity` and
   * `redactFields` below: the mirror declares the triple since
   * `@objectstack/spec` 17.5.0 declared it on this block. The mechanism is
   * written once, at the same read in `record-details.tsx`.
   */
  const required: string[] = Array.isArray(schema.requiredPermissions)
    ? schema.requiredPermissions
    : [];
  // Evaluated up-front but enforced AFTER the hooks below (useId /
  // useRegisterHighlightFields) so hook order stays stable across renders.
  const highlightsAllowed = required.length === 0 || perms.hasCapabilities(required);

  const rawFields: any[] = Array.isArray(schema.fields) ? schema.fields : [];
  // Normalize: accepts either bare strings or { name, label?, type?, readonly? }
  // — the four keys the contract's object arm declares, and no fifth.
  //
  // `readonly` is copied through deliberately: HeaderHighlight's editability
  // gate has always consulted `field.readonly`, but this map used to rebuild
  // each entry from a fixed four-key list, so an authored `readonly: true` was
  // dropped one layer BEFORE the check that would honour it and the gate could
  // never fire from authored metadata (objectstack#5077). Rebuilding key-by-key
  // rather than spreading keeps the entry shape closed — an undeclared key is
  // still not silently forwarded to the strip.
  //
  // `icon` was copied through here until objectui#9280 and that read was
  // UNREACHABLE, not merely unused: `@objectstack/spec`
  // `RecordHighlightsProps.fields[]`'s object arm is `$strict` (a `never`
  // catchall over `name`/`label`/`type`/`readonly`), so a document carrying
  // `icon` is refused WHOLE at publish and no author could ever feed this
  // branch. `HeaderHighlight` renders no `.icon` either, so the copy also had
  // no consumer on the far side. Retired in both directions rather than left
  // standing as a read for a key nothing can author.
  const normalized = rawFields.map((f) =>
    typeof f === 'string'
      ? { name: f }
      : {
          name: f?.name,
          label: f?.label,
          type: f?.type,
          readonly: f?.readonly === true,
        },
  ).filter((f) => typeof f.name === 'string' && f.name.length > 0);

  const enforceFLS = schema.enforceFieldSecurity === true;
  const redact: string[] = Array.isArray(schema.redactFields)
    ? schema.redactFields
    : [];
  const allowedNames = enforceFLS && objectName
    ? new Set(readableFields(normalized.map((f) => f.name)))
    : null;
  const highlightFields = normalized.filter((f) => {
    if (redact.includes(f.name)) return false;
    if (allowedNames && !allowedNames.has(f.name)) return false;
    return true;
  });

  // Phase N.4b: register the rendered highlight field names into the
  // shared HighlightFieldsContext so RecordDetailsRenderer can drop the
  // same fields from its body grid even for hand-authored Lightning
  // pages (where the synth-time `hideFields` plumbing doesn't apply).
  const instanceId = React.useId();
  // Register [] when not allowed — equivalent to not registering, so
  // RecordDetailsRenderer never hides body fields for highlights we don't show.
  useRegisterHighlightFields(
    instanceId,
    highlightsAllowed ? highlightFields.map((f) => f.name) : [],
  );

  if (!highlightsAllowed) {
    return (
      <div
        className={className}
        {...designer}
        role="status"
        aria-live="polite"
      >
        <p className="text-sm text-muted-foreground italic">
          Insufficient permissions to view highlights.
        </p>
      </div>
    );
  }

  return (
    <div className={className} {...designer} {...ariaProps}>
      <HeaderHighlight
        fields={highlightFields as any}
        data={ctx?.data}
        objectName={ctx?.objectName}
        objectSchema={ctx?.objectSchema as any}
        dataSource={ctx?.dataSource}
      />
    </div>
  );
};

/**
 * `record:highlights` with the spec's per-element `dataSource` binding honoured
 * (objectui#12294). Unbound, the body reads the record page's record exactly as
 * before; bound, it reads the FIRST row of the bound set. `recordBindingBlock`
 * (`./recordBinding`, which states the semantics) wraps the body in the gate and
 * the one-record scope, and passes the result through the declaration seam.
 *
 * Wraps the EXPORTED name, as `record:related_list` does, so a host that
 * imports this renderer directly gets the binding too.
 */
export const RecordHighlightsRenderer: React.FC<RecordHighlightsRendererProps> = recordBindingBlock(RecordHighlightsBody, 'record:highlights');

export default RecordHighlightsRenderer;
