// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7912] A navigation entry whose destination object cannot serve a `list` —
 * refused at authoring time, before it can be published and pruned in silence.
 *
 * ## The defect
 *
 * A `type: 'object'` nav entry names its destination in `objectName`. That
 * object's own `enable` block decides whether the external REST surface can
 * answer a `list` there at all:
 *
 *  - `enable.apiEnabled: false` → `OBJECT_API_DISABLED` (404);
 *  - an `enable.apiMethods` whitelist without `list` → `OBJECT_API_METHOD_NOT_ALLOWED` (405).
 *
 * Both are pure functions of `enable` — no user, no permissions, no request
 * context — so the destination is dead for EVERY persona, platform admin
 * included. #7544 shipped exactly such an entry for a year: it read as correct
 * to reviewers because the entry carried a `requiredPermissions` gate, and the
 * in-code comment claimed a non-admin "403s server-side", which implies an
 * admin could list. None could. The 404 precedes and ignores permissions
 * entirely, and no combination of permissions on the ENTRY can prune an entry
 * whose OBJECT is API-disabled — they are independent conditions.
 *
 * ## Why this rule exists even though the server now prunes
 *
 * The maintainer ruling of 2026-08-12 chose to DERIVE servability rather than
 * mint a new nav key: `filterAppForUser` (`@objectstack/rest`) drops these
 * entries from the `/meta` payload, so the user never sees a menu item that
 * cannot work. That fixes the user-facing half and opens an authoring-facing
 * one — the ruling names it and makes this rule a mandatory companion, not an
 * optional extra:
 *
 * > A prune the author cannot see is the same failure one layer over — no
 * > silent dead rows, and no silent repairs.
 *
 * An author whose object is accidentally API-disabled would otherwise watch the
 * entry vanish from a running app with no signal anywhere. This rule is the
 * signal, raised at the checkpoint that can still see the whole picture and
 * naming both halves: which entry, and the exact `enable` key that killed it.
 *
 * ## Severity: `error`, unlike its neighbours — and why that is not over-reach
 *
 * `validate-nav-access` (its closest sibling: "navigation exposes an object no
 * permission set grants") is advisory, because a grant can legitimately arrive
 * from a package this stack cannot see. Nothing analogous applies here.
 * `enable` is declared ON the object, in this stack, and this rule judges ONLY
 * objects this stack declares — so when it fires, it has read the whole of the
 * evidence and the entry is dead with certainty. There is no installed package
 * that can make an `apiEnabled: false` object listable.
 *
 * The exemption is therefore the same shape as the sibling's, drawn one axis
 * over: a target this stack does not declare is SKIPPED entirely rather than
 * guessed at, because its `enable` block is not visible from here.
 *
 * ## ⛔ What this rule deliberately does NOT judge
 *
 *  - **Whether the object exists at all.** An unresolvable nav target is
 *    `validate-object-references` / `defineStack`'s question, and on the
 *    serving side it is `requiresObject`'s — a key whose client-only evaluation
 *    the same ruling explicitly declined to re-mean. Silence here on an unknown
 *    name is that boundary, not an oversight.
 *  - **Permissions.** Ungranted-but-listable is `validate-nav-access`; the two
 *    conditions are independent and each needs its own finding, which is the
 *    load-bearing lesson of #7544.
 *  - **Non-`object` entries.** A `component` / `page` / `url` entry has no
 *    `objectName` destination to judge, even when it carries `requiresObject`.
 */

import { canServeApiOperation, type EnableLike } from '@objectstack/spec/data';

import type { ReferenceIntegrityFinding } from './reference-integrity-suite.js';

export type NavObjectServabilityFinding = ReferenceIntegrityFinding;

/** Emitted when a nav entry targets an object whose `enable` block cannot serve a list. */
export const NAV_OBJECT_UNSERVABLE = 'nav-object-unservable';

type AnyRec = Record<string, unknown>;

const isRec = (v: unknown): v is AnyRec => !!v && typeof v === 'object' && !Array.isArray(v);

/** Both authoring carriers: an array of documents, or a name-keyed map. */
function asArray(v: unknown): AnyRec[] {
  if (Array.isArray(v)) return v.filter(isRec);
  if (isRec(v)) return Object.entries(v).map(([name, def]) => (isRec(def) ? { name, ...def } : { name }));
  return [];
}

function strName(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * An interpolated target resolves at render time — the same conservative
 * exemption `validate-object-references` and `validate-nav-target-refs` use to
 * keep false positives near zero (ADR-0072 D1).
 */
const isInterpolated = (s: string): boolean => s.includes('${') || s.includes('{');

export function validateNavObjectServability(stack: unknown): NavObjectServabilityFinding[] {
  const findings: NavObjectServabilityFinding[] = [];
  if (!isRec(stack)) return findings;

  const apps = asArray(stack.apps);
  if (apps.length === 0) return findings;

  // Only objects THIS stack declares can be judged — see the header. The map
  // records where each one is declared so a finding can point at the `enable`
  // key that is actually editable, not merely at the nav entry that tripped on
  // it.
  const ownEnable = new Map<string, { enable: EnableLike | undefined; path: string }>();
  const objects = asArray(stack.objects);
  for (const [oi, obj] of objects.entries()) {
    const n = strName(obj.name);
    if (!n) continue;
    // These rules read UNTYPED authored documents, so the shape is asserted
    // rather than proved. `EnableLike` is deliberately loose (every key
    // optional, plus an index signature) and `canServeApiOperation` treats a
    // missing/garbage block as "declares nothing" — so a non-object `enable`
    // reaches the default-open answer instead of throwing.
    ownEnable.set(n, { enable: obj.enable as EnableLike | undefined, path: `objects[${oi}].enable` });
  }
  if (ownEnable.size === 0) return findings;

  for (const [ai, app] of apps.entries()) {
    const appName = strName(app.name) ?? `#${ai}`;

    const walk = (items: unknown, basePath: string): void => {
      if (!Array.isArray(items)) return;
      for (const [ni, raw] of items.entries()) {
        if (!isRec(raw)) continue;
        const nav = raw;
        const navPath = `${basePath}[${ni}]`;

        if (nav.type === 'object') {
          const target = strName(nav.objectName);
          const declared = target && !isInterpolated(target) ? ownEnable.get(target) : undefined;
          if (target && declared && !canServeApiOperation(declared.enable, 'list')) {
            const enable = isRec(declared.enable) ? declared.enable : {};
            // Which of the two conditions fired. `apiEnabled` is judged first
            // and independently — an API-disabled object refuses `list`
            // whatever its whitelist says — so the report follows the same
            // order rather than describing a whitelist the 404 never reaches.
            const apiDisabled = enable.apiEnabled === false;
            const condition = apiDisabled
              ? '`enable.apiEnabled: false`'
              : '`enable.apiMethods` does not grant `list`'
                + (Array.isArray(enable.apiMethods)
                  ? ` (declared: ${enable.apiMethods.length === 0 ? '[] — deny-all' : enable.apiMethods.map((m) => `\`${String(m)}\``).join(', ')})`
                  : '');
            const answer = apiDisabled
              ? '404 `OBJECT_API_DISABLED`'
              : '405 `OBJECT_API_METHOD_NOT_ALLOWED`';
            const offendingKey = apiDisabled
              ? `${declared.path}.apiEnabled`
              : `${declared.path}.apiMethods`;

            findings.push({
              severity: 'error',
              rule: NAV_OBJECT_UNSERVABLE,
              where: `app "${appName}" · nav "${strName(nav.id) ?? strName(nav.label) ?? `#${ni}`}"`,
              // The nav entry is where the dead row is authored; the `enable`
              // key that condemns it is named in the message, because the fix
              // may belong at either end.
              path: `${navPath}.objectName`,
              message:
                `Navigation targets object "${target}", which cannot serve a list: ${condition} `
                + `(\`${offendingKey}\`), so the list request answers ${answer} for EVERY user — `
                + `platform administrators included, since that gate reads only the object's \`enable\` `
                + `block and never the caller. The entry cannot be rescued with `
                + `\`requiredPermissions\`: they are independent conditions. The server prunes this `
                + `entry from the served \`/meta\` payload (#7912), so publishing it ships a menu row `
                + `that silently is not there.`,
              hint:
                `Remove the nav entry, or make "${target}" listable by setting \`enable.apiEnabled: true\` `
                + `and granting \`list\` in \`enable.apiMethods\`. ⛔ Do NOT open the API on an object that `
                + `is disabled on purpose — several platform objects hold credential material and are `
                + `API-disabled deliberately; for those the entry is the mistake, not the \`enable\` block.`,
            });
          }
        }

        // Recurse: an `object` nav item carries `children` too, not just a
        // `group` — the same reason `stack.zod.ts` does not gate its recursion
        // on the item type.
        if (Array.isArray(nav.children)) walk(nav.children, `${navPath}.children`);
      }
    };

    walk(app.navigation, `apps[${ai}].navigation`);
    // `areas[]` is the other nav container, and the server gates it through the
    // very same walk (#4722) — so this rule must see it too, or it would pass a
    // stack whose served payload the runtime prunes.
    for (const [ari, area] of asArray(app.areas).entries()) {
      walk(area.items, `apps[${ai}].areas[${ari}].items`);
      walk(area.navigation, `apps[${ai}].areas[${ari}].navigation`);
    }
  }

  return findings;
}
