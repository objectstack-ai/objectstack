// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Which public-form slugs a `view` body opens to anonymous intake.
 *
 * The anonymous form doors (`GET /forms/:slug`, `POST /forms/:slug/submit`,
 * `registerFormEndpoints` in `@objectstack/rest`) serve a form when one of a
 * view's form candidates carries `sharing.allowAnonymous === true` and a
 * `sharing.publicLink` that names the slug. The candidates are the same three
 * shapes those doors scan: the nested `form`, every `formViews` entry, and the
 * flattened `config` of a `viewKind: 'form'` item.
 *
 * Returns the sorted, de-duplicated slug set, normalised the way the doors
 * compare it (`/forms/x`, `forms/x` and `x` are one slug). Two bodies with the
 * same set open exactly the same anonymous doors.
 */
export function anonymousFormIntakeSlugs(view: unknown): string[] {
    if (!view || typeof view !== 'object') return [];
    const v = view as Record<string, any>;
    const sharings: unknown[] = [];
    if (v.form && typeof v.form === 'object') sharings.push(v.form.sharing);
    if (v.formViews && typeof v.formViews === 'object') {
        for (const fv of Object.values(v.formViews)) {
            if (fv && typeof fv === 'object') sharings.push((fv as any).sharing);
        }
    }
    if (v.viewKind === 'form' && v.config && typeof v.config === 'object') sharings.push(v.config.sharing);
    const slugs = new Set<string>();
    for (const s of sharings) {
        if (!s || typeof s !== 'object') continue;
        const sharing = s as Record<string, unknown>;
        if (sharing.allowAnonymous !== true) continue;
        if (typeof sharing.publicLink !== 'string' || !sharing.publicLink) continue;
        slugs.add(sharing.publicLink.replace(/^\/+/, '').replace(/^forms\//, ''));
    }
    return [...slugs].sort();
}
