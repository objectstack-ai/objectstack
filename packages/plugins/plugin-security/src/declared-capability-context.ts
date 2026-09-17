// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#18535, ADR-0090 D5 / ADR-0066 D1] The {@link AnchorBindingContext} the
 * audience-anchor predicates need, read from the stack's `capabilities:`
 * declarations.
 *
 * `describeHighPrivilegeBits` / `describeAnchorForbiddenBits`
 * (`@objectstack/spec/security`) are pure and synchronous: they read one
 * permission-set definition and cannot discover which capability names THIS
 * stack declared. That fact belongs to the caller, and until this module
 * existed no runtime caller passed it — so a `systemPermissions` token an app
 * had DECLARED was judged exactly like `manage_users`, and the app's own
 * `isDefault` set was refused at the `everyone` anchor. ADR-0090 D5 rules the
 * opposite: 「平台系统权限;带 package provenance 的应用声明 capability 令牌不计」.
 *
 * ## Why the METADATA declarations and not the `sys_capability` rows
 *
 * The predicate's docblock names two sources — the `sys_capability` rows
 * carrying `managed_by:'package'` at boot, the stack's own `capabilities`
 * array at authoring time. At the boot moment the anchor binding runs, the
 * rows DO NOT EXIST YET: `runBootstrap` binds the baseline to `everyone`
 * before it calls `bootstrapDeclaredCapabilities`, and that order is fixed by
 * two other constraints (the binding must follow `bootstrapBuiltinRoles`,
 * which seeds the anchor, and precede the suggestion reconciliation). Reading
 * the rows there would read an empty table on a first boot and refuse every
 * declared token — the defect this module removes, reintroduced one layer in.
 *
 * So all three runtime consumers read the DECLARATIONS, through the same
 * two-step the seeder itself reads them by (registry first, metadata service
 * as the fallback). One source for the three verdicts is not a convenience:
 * `confirmAudienceBindingSuggestion` is the friendly early rendition of the
 * gate the engine middleware re-enforces on the insert, so a second source
 * there would let a confirm pass its own check and then be refused by the
 * write it performs.
 *
 * ⛔ Never derive this list from the set under test — the predicate's own
 * docblock says why: a "declared" list read off `systemPermissions` excuses
 * every token by construction and turns the gate off. And nothing here filters
 * by platform-ness: {@link describeHighPrivilegeBits} applies the platform
 * floor itself, so a capability declared under a curated platform name is
 * still high-privilege however it reaches this list.
 *
 * Fails CLOSED at every step: an unreadable registry, an unreadable metadata
 * service, a declaration with no `name` and an empty stack all yield
 * `undefined`, which is the pre-#17811 verdict verbatim (「omission refuses」).
 */

import type { AnchorBindingContext } from '@objectstack/spec/security';
import { readDeclared } from './bootstrap-declared-permissions.js';

/**
 * Read this stack's declared authorization capabilities as an
 * {@link AnchorBindingContext}, or `undefined` when it declares none.
 *
 * The declarations are handed over as they are — the predicate reads `name`
 * off each entry and ignores every other field, so nothing is transcribed and
 * a shape change in `CapabilityDeclarationSchema` cannot desynchronize a copy.
 *
 * @param ql The ObjectQL engine handle (its registry is the primary source).
 * @param metadataService The metadata service, read only when the registry
 *   lists nothing — the same fallback `bootstrapDeclaredCapabilities` uses.
 */
export async function readDeclaredCapabilityContext(
  ql: any,
  metadataService?: any,
): Promise<AnchorBindingContext | undefined> {
  let caps: any[] = readDeclared(ql, 'capability');
  if (caps.length === 0) {
    try {
      const listed = metadataService?.list?.('capability');
      caps = typeof (listed as any)?.then === 'function' ? await listed : (listed ?? []);
    } catch { caps = []; }
  }
  if (!Array.isArray(caps)) return undefined;
  const declared = caps.filter(
    (c) => c && typeof c === 'object' && typeof (c as { name?: unknown }).name === 'string'
      && (c as { name: string }).name.length > 0,
  );
  return declared.length > 0 ? { declaredCapabilities: declared } : undefined;
}
