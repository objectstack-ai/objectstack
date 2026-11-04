// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `sharing-rule-access-level-full-to-edit` conversion
// (`toMajor: 17`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `sharingRuleAccessLevelFullToEdit` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapCollection } from '../../walk.js';

/*
 * ABSORBED — `agent-knowledge-topics-to-sources` (protocol 17, #3855). The
 * rename lived inside the same unreleased major that now REMOVES the whole
 * `agent.knowledge` block (`agent-knowledge-removed` below): composed, its
 * effect is unobservable — any pre-17 `knowledge` ends deleted regardless of
 * its inner spelling — and two notices for one dead block would only confuse
 * the author. Folded pre-release per the ADR-0090 discipline; the removal's
 * prescription covers the historical `topics` spelling.
 */

/**
 * Sharing-rule `accessLevel: 'full'` → `'edit'` (protocol 17, #3865).
 *
 * `full` was documented as "Full Access (Transfer, Share, Delete)" but no code
 * path ever granted transfer, re-share, or delete because of it: both
 * enforcement sites matched `access_level in ('edit','full')`, so it behaved as
 * `edit` while telling admins it granted more (ADR-0078 declared-but-unenforced;
 * ADR-0049). It was removed from `SharingLevel`, which makes this rewrite
 * strictly **lossless** — unlike the OWD `sharingModel: 'full'` alias, which had
 * no equivalent target and was delegated to a step-13 semantic TODO. Here the
 * old and new shapes are already behaviourally identical, so the loader can
 * convert with zero consumer action.
 *
 * It shipped as a **live window**, deliberately unlike its three step-17
 * siblings, which were `retiredFromLoadPath` from the start because each was an
 * already-deprecated key whose schema tombstones it with a fix-it error. `full`
 * carried no prior deprecation and a removed enum VALUE yields only a generic
 * zod message, so it got the ADR-0087 D2 default instead: the protocol-17
 * loader accepted it for one major (this entry ran at `normalizeStackInput`,
 * *before* the enum rejects it). The runtime counterpart for already-persisted
 * rows lives in `plugin-sharing` (grant-time normalisation + a boot backfill
 * over `sys_sharing_rule` / `sys_record_share`).
 *
 * **Retired from the load path at 18** — that window has run (#23487). The
 * generic message is gone with it: `SharingLevel` is an
 * `enumWithRetiredValues` whose `full` prescription names `edit` and this
 * release, so that refusal is what an author meets at every door that judges
 * a sharing rule (`os validate` / `os build` / `os lint`). Stored rows keep
 * healing: stored-row rehydration (`applyConversionsToStoredItem`) replays the
 * full chain, this entry included, and so do the artifact-ingestion door
 * (inside its window) and `os migrate meta --from 16`.
 */
const sharingRuleAccessLevelFullToEdit: MetadataConversion = {
  id: 'sharing-rule-access-level-full-to-edit',
  toMajor: 17,
  retiredFromLoadPath: true,
  retiredAfter: '17.7.0',
  surface: 'sharingRule.accessLevel',
  summary: "sharing-rule accessLevel 'full' → 'edit' (`full` never granted more than `edit`; a sharing rule grants read or edit, while delete and transfer come from object permissions and ownership)",
  apply(stack, emit) {
    return mapCollection(stack, 'sharingRules', (rule, path) => {
      if (rule.accessLevel !== 'full') return rule;
      emit({ from: 'full', to: 'edit', path: `${path}.accessLevel` });
      return { ...rule, accessLevel: 'edit' };
    });
  },
  fixture: {
    before: {
      sharingRules: [
        {
          name: 'share_open_deals',
          type: 'criteria',
          object: 'crm_deal',
          accessLevel: 'full',
          condition: 'record.status == "open"',
          sharedWith: { type: 'business_unit', value: 'bu_sales' },
        },
      ],
    },
    after: {
      sharingRules: [
        {
          name: 'share_open_deals',
          type: 'criteria',
          object: 'crm_deal',
          accessLevel: 'edit',
          condition: 'record.status == "open"',
          sharedWith: { type: 'business_unit', value: 'bu_sales' },
        },
      ],
    },
    expectedNotices: 1,
  },
};

export { sharingRuleAccessLevelFullToEdit };
