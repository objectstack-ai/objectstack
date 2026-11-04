// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `add-record-enabled-defaulted` conversion (`toMajor:
// 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `addRecordEnabledDefaulted` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapAddRecordBlocks } from '../shared.js';

/**
 * `addRecord` with `enabled` OMITTED → `enabled: true` (protocol 18, #24692 —
 * ADR-0049 enforce-or-remove, ruling letter B′; the data-at-rest half of making
 * `enabled` REQUIRED, the D3 semantic entry `add-record-enabled-required`).
 *
 * Ruling B′ made `AddRecordConfigSchema.enabled` required with no default, so
 * `addRecord: {}` is refused at authoring and at publish instead of drawing
 * nothing. Before it, the key carried `.default(true)`: the contract every
 * author and every AI read said an `addRecord` block without `enabled` SHOWS
 * the Add button, while the renderer drew it only for an explicit
 * `enabled: true`. Under the standing 18.x rule for breaking narrowings (a
 * narrowing an ADR-0087 conversion carries ships in an 18.x minor), this entry
 * is what carries it: a stored row, a built artifact inside its declared-floor
 * window and `os migrate meta --from 17` all get the old default written in,
 * so no body that parsed under 18.0 is refused by this narrowing.
 *
 * **Lossless against the contract, NOT in pixels — stated, not hidden.** The
 * value written is exactly the one the 18.0 parse produced for the same body
 * (`.default(true)`), so the converted row means what the published spec said
 * it meant. The renderer read the RAW stored body, though, so a row that
 * omitted `enabled` drew no Add button and now draws one. That is the author's
 * declared intent, and the measured population is zero: every in-tree
 * producer (the showcase's two blocks, the lint fixture) and objectui's Studio
 * design surface write `enabled` explicitly; production databases were not
 * measured.
 *
 * **Deliberately narrow.** Only a dict `addRecord` with no `enabled` key is
 * touched. An explicit value — `false`, `null`, a string — is the author's and
 * is left for the parse to judge. `position` is never written: its default
 * moved from `bottom` to `top`, where the renderer has always placed an absent
 * position, so an omitted position keeps the placement it rendered with.
 *
 * **Retired from the load path, from day one.** The authoring funnel does not
 * replay it, so a live author meets the parse's refusal and its prescription
 * (`addRecord.enabled` is required). Idempotent by construction: a converted
 * block carries `enabled`, which this transform never touches again.
 */
const addRecordEnabledDefaulted: MetadataConversion = {
  id: 'add-record-enabled-defaulted',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '18.0.0',
  surface: 'view.list.addRecord.enabled / object.listViews.*.addRecord.enabled / page.interfaceConfig.addRecord.enabled / page.component.list-view.addRecord.enabled — omitted',
  summary:
    "an `addRecord` block that omits `enabled` → `enabled: true` (ADR-0049 enforce-or-remove: `enabled` "
    + 'is now required with no default; `true` is the default the 18.0 spec declared, so the block means '
    + 'what it always declared — note the renderer drew no button for such a block and now draws one; '
    + 'an explicit value is never touched)',
  apply(stack, emit) {
    return mapAddRecordBlocks(stack, (block, path) => {
      if ('enabled' in block) return block;
      emit({ from: '(omitted)', to: 'true', path: `${path}.enabled` });
      return { ...block, enabled: true };
    });
  },
  fixture: {
    before: {
      views: [
        // A container: the default `list` omits `enabled` and converts; the
        // named entry declares it off and rides through untouched.
        {
          object: 'arx_ticket',
          list: { type: 'grid', columns: ['subject'], addRecord: {} },
          listViews: {
            closed: { type: 'grid', columns: ['subject'], addRecord: { enabled: false } },
          },
        },
        // A ViewItem record: the payload hangs off `config`; `position` survives.
        {
          name: 'arx_ticket.queue',
          object: 'arx_ticket',
          viewKind: 'list',
          config: { type: 'grid', columns: ['subject'], addRecord: { position: 'bottom' } },
        },
      ],
      objects: [
        { name: 'arx_ticket', label: 'Ticket', listViews: { mine: { type: 'grid', columns: ['subject'], addRecord: {} } } },
      ],
      pages: [
        { name: 'arx_desk', label: 'Desk', type: 'list', interfaceConfig: { source: 'arx_ticket', addRecord: { position: 'top' } } },
        {
          name: 'arx_home',
          label: 'Home',
          regions: [{ name: 'main', components: [{ type: 'list-view', properties: { addRecord: {} } }] }],
        },
      ],
    },
    after: {
      views: [
        {
          object: 'arx_ticket',
          list: { type: 'grid', columns: ['subject'], addRecord: { enabled: true } },
          listViews: {
            closed: { type: 'grid', columns: ['subject'], addRecord: { enabled: false } },
          },
        },
        {
          name: 'arx_ticket.queue',
          object: 'arx_ticket',
          viewKind: 'list',
          config: { type: 'grid', columns: ['subject'], addRecord: { position: 'bottom', enabled: true } },
        },
      ],
      objects: [
        { name: 'arx_ticket', label: 'Ticket', listViews: { mine: { type: 'grid', columns: ['subject'], addRecord: { enabled: true } } } },
      ],
      pages: [
        { name: 'arx_desk', label: 'Desk', type: 'list', interfaceConfig: { source: 'arx_ticket', addRecord: { position: 'top', enabled: true } } },
        {
          name: 'arx_home',
          label: 'Home',
          regions: [{ name: 'main', components: [{ type: 'list-view', properties: { addRecord: { enabled: true } } }] }],
        },
      ],
    },
    // One notice per block filled: the container's `list`, the record's
    // `config`, the object's `listViews.mine`, the page's `interfaceConfig`,
    // the page `list-view` node's `properties`.
    expectedNotices: 5,
  },
};

export { addRecordEnabledDefaulted };
