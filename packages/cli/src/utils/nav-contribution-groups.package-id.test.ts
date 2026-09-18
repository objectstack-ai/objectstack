// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #18490 — the artifact package-id rule has ONE owner again, and importing it
 * DECIDED the one input the two copies disagreed on.
 *
 * ## What this file measures, and against what
 *
 * `packages/cli/src/utils/artifact-packages.ts` declares itself the sole owner
 * of "which package is this". `nav-contribution-groups.ts` carried a second
 * implementation, `artifactPackagesOf`, differing from the owner in a single
 * guard — a non-empty check on `manifest.name`. For a package whose
 * `manifest.id` AND `manifest.name` are both `''` the owner answered `''` and
 * the copy answered `packages[<index>]`.
 *
 * Deleting the copy chose `''`. What this file pins is not that string but the
 * REASON it is the right one: `''` is what the RUNTIME fold names that package,
 * and `packages[<index>]` is a spelling the runtime cannot produce at all
 * (`ObjectQL.registerApp` derives `manifest.id || manifest.name`, with no
 * positional fallback). `nav-contribution-groups.ts`'s own header says the id
 * it carries is "the string the runtime registers a contribution under, so a
 * command names a package the same way the fold does" — this is that sentence,
 * measured.
 *
 * ⛔ NEITHER side's rule is re-spelled here. The build's answer comes out of
 * the shipped `findNavGroupDiagnostics`, the runtime's out of a real
 * `ObjectQL`, and the assertion is that the two STRINGS match — so the day
 * either rule moves, this reds instead of agreeing with itself.
 *
 * ## Why this is a file of its own, and why it is INTEGRATION tier
 *
 * The cross-door half constructs `new ObjectQL(`, which is a KERNEL signal in
 * `vitest-tiers.ts`'s predicate — so a file carrying it is integration tier by
 * derivation, not by naming. Folding these cases into the unit-tier
 * `nav-contribution-groups.test.ts` would have moved that whole file, and its
 * nine existing #14553 pins with it, out of the tier they were written for.
 * Splitting keeps the tier change confined to the cases that actually boot a
 * registry. ⛔ Do not merge this file back into that one.
 */

import { describe, it, expect } from 'vitest';
import { composeStacks, normalizeStackInput, ObjectStackDefinitionSchema } from '@objectstack/spec';
import { ObjectQL } from '@objectstack/objectql/core';
import { findNavGroupDiagnostics } from './nav-contribution-groups.js';
import { artifactPackages } from './artifact-packages.js';

type AnyRec = Record<string, unknown>;

const APP = 'multi_crm';
const GROUP = 'sales_group';
const TYPO = 'sales_grp';
const CORE_ID = 'com.example.multi.core';

/** The App package — owns the app and the group container the module aims at. */
const coreStack = () => ({
  manifest: {
    id: CORE_ID,
    name: 'Multi-Package Core',
    namespace: 'crm',
    version: '1.0.0',
    type: 'app' as const,
  },
  objects: [{
    name: 'crm_account',
    label: 'Account',
    sharingModel: 'private' as const,
    fields: { name: { name: 'name', type: 'text' as const, label: 'Account Name', required: true } },
  }],
  apps: [{
    name: APP,
    label: 'Multi-Package CRM',
    navigation: [{
      id: GROUP,
      type: 'group' as const,
      label: 'Sales',
      children: [{ id: 'nav_accounts', type: 'object' as const, objectName: 'crm_account', label: 'Accounts' }],
    }],
  }],
});

/**
 * The contributing package, carrying the divergent identity: both id keys `''`.
 *
 * ⚠️ Its own namespace, not the app package's. The composed-artifact leg does
 * not care, but the runtime leg INSTALLS both packages into one registry and
 * ADR-0048 refuses a second package under a namespace another already owns —
 * a conflict that would make this file red for a reason that has nothing to do
 * with what it measures.
 */
const emptyIdOrdersStack = (group: string) => ({
  manifest: {
    id: '',
    name: '',
    namespace: 'ord',
    version: '1.0.0',
    type: 'module' as const,
    navigationContributions: [{
      app: APP,
      group,
      items: [{ id: 'nav_orders', type: 'object' as const, objectName: 'ord_order', label: 'Orders' }],
    }],
  },
  objects: [{
    name: 'ord_order',
    label: 'Order',
    sharingModel: 'private' as const,
    fields: { name: { name: 'name', type: 'text' as const, label: 'Order Number', required: true } },
  }],
});

/** The artifact as the commands actually hand it down — through their own parse. */
const parsedEmptyIdArtifact = (group: string): AnyRec => {
  const composed = composeStacks(
    [emptyIdOrdersStack(group), coreStack()],
    { manifest: 'preserve' },
  ) as unknown as Record<string, unknown>;
  const normalized = normalizeStackInput(composed, { onConversionNotice: () => {} });
  const result = ObjectStackDefinitionSchema.safeParse(normalized);
  if (!result.success) {
    throw new Error(`fixture does not parse: ${JSON.stringify(result.error.issues.slice(0, 3))}`);
  }
  return result.data as unknown as AnyRec;
};

describe('#18490 — one package, two doors, one name', () => {
  it('an empty `manifest.id` AND `manifest.name` REACHES this check — the divergence is not hypothetical', () => {
    // The floor under everything below. `ManifestSchema` requires both keys as
    // strings and constrains NEITHER to be non-empty, so `''` parses — which is
    // the only reason the two rules could ever disagree on a stack `os build`
    // or `os validate` would actually accept. If a spec change starts refusing
    // it, this reds FIRST and says the pins under it now measure nothing.
    const parsed = parsedEmptyIdArtifact(GROUP);
    expect(artifactPackages(parsed).map((pkg) => pkg.id).sort()).toEqual(['', CORE_ID]);
  });

  it('the build names that package EXACTLY as the runtime fold does', async () => {
    // The build door: the shipped derivation, reached the way both commands
    // reach it — `findNavGroupDiagnostics(result.data)`, one argument.
    const built = await findNavGroupDiagnostics(parsedEmptyIdArtifact(TYPO));
    expect(built).toHaveLength(1);

    // The runtime door: the same two packages installed into a real registry.
    // `registerApp` derives the id it registers the contribution under, the
    // read-time fold relocates the mis-aimed items, and recording that
    // relocation is what produces the diagnostic.
    const engine = new ObjectQL();
    const core = coreStack();
    engine.registerApp({ ...core.manifest, apps: core.apps });
    engine.registerApp({ ...emptyIdOrdersStack(TYPO).manifest });
    engine.registry.getApp(APP);
    const folded = engine.registry.getAppNavDiagnostics(APP);
    expect(folded).toHaveLength(1);

    // The card, in two lines: the `packageId` field a consumer reads, and the
    // sentence an author reads.
    expect(built[0].packageId).toBe(folded[0].packageId);
    expect(built[0].message).toBe(folded[0].message);
  });

  it('⛔ and that shared name is NOT the deleted copy\'s positional spelling', async () => {
    // Its own assertion, because the pin above would also pass if BOTH doors
    // moved to `packages[0]`. The runtime has no positional fallback, so a
    // build printing one is a build naming a package the runtime never will.
    const built = await findNavGroupDiagnostics(parsedEmptyIdArtifact(TYPO));
    expect(built[0].packageId).toBe('');
    expect(built[0].packageId).not.toBe('packages[0]');
    expect(built[0].message).not.toContain('packages[0]');
  });

  it('two packages that both resolve to the empty id still produce TWO findings', async () => {
    // The id is CARRIED and PRINTED on this path — never a map key, a dedupe
    // key or a sort key. Pinned because "both collapse into one finding" is the
    // failure an empty id would cause if it ever became one, and it would
    // present as the report going QUIET rather than as an error.
    const second = {
      manifest: {
        id: '',
        name: '',
        navigationContributions: [{
          app: APP,
          group: TYPO,
          items: [{ id: 'nav_second', type: 'object' as const, objectName: 'ord_order', label: 'Second' }],
        }],
      },
    };
    const parsed = parsedEmptyIdArtifact(TYPO);
    const widened: AnyRec = {
      ...parsed,
      packages: [...((parsed.packages ?? []) as unknown[]), second],
    };
    const found = await findNavGroupDiagnostics(widened);
    expect(found).toHaveLength(2);
    expect(found.map((d) => d.packageId)).toEqual(['', '']);
  });
});
