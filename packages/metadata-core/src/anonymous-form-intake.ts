// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Which forms a `view` body opens to anonymous intake — the ONE rule.
 *
 * The anonymous form doors (`GET /forms/:slug`, `POST /forms/:slug/submit`,
 * `registerFormEndpoints` in `@objectstack/rest`) serve exactly the candidates
 * this module returns, and `@objectstack/metadata-protocol` judges an
 * organization-scoped `view` write by the slug set it projects. Both import it
 * from here so the doors and the write-time judgement can never disagree about
 * which forms are published.
 *
 * A form candidate is open to anonymous intake when its `sharing` (the spec's
 * `SharingConfigSchema`) declares all three of:
 *
 * - `enabled === true` — "Enable public sharing". The schema defaults it to
 *   `false`, and a parsed body carries that default, so an absent `enabled`
 *   reads as not shared here too: a raw body and its parsed form get the same
 *   answer.
 * - `allowAnonymous === true` — "Allow access without authentication".
 * - a non-empty `publicLink` naming the slug.
 *
 * Clearing either switch withdraws the form from every anonymous door.
 *
 * The candidates are the three shapes a view carries a form in: the nested
 * `form`, every `formViews` entry, and the flattened `config` of a
 * `viewKind: 'form'` item.
 */

/** A form candidate of a view that is open to anonymous intake. */
export interface AnonymousFormIntakeCandidate {
    /** The form view object (the nested `form`, a `formViews` entry, or the flattened `config`). */
    form: Record<string, any>;
    /** The `formViews` key, or the view name for a flattened `viewKind: 'form'` item. */
    key?: string;
    /** The slug its `publicLink` names, normalised (`/forms/x`, `forms/x` and `x` are one slug). */
    slug: string;
}

/** Normalise a `publicLink` to the slug the doors compare: `/forms/x`, `forms/x` and `x` are one slug. */
export function publicFormSlug(publicLink: string): string {
    return publicLink.replace(/^\/+/, '').replace(/^forms\//, '');
}

/** The slug a form's `sharing` opens to anonymous intake, or `null` when it opens none. */
export function anonymousFormIntakeSlug(sharing: unknown): string | null {
    if (!sharing || typeof sharing !== 'object') return null;
    const s = sharing as Record<string, unknown>;
    if (s.enabled !== true) return null;
    if (s.allowAnonymous !== true) return null;
    if (typeof s.publicLink !== 'string' || !s.publicLink) return null;
    return publicFormSlug(s.publicLink);
}

/** Every form candidate of a `view` body that is open to anonymous intake, in scan order. */
export function anonymousFormIntakeCandidates(view: unknown): AnonymousFormIntakeCandidate[] {
    if (!view || typeof view !== 'object') return [];
    const v = view as Record<string, any>;
    const forms: Array<{ form: unknown; key?: string }> = [];
    if (v.form && typeof v.form === 'object') forms.push({ form: v.form });
    if (v.formViews && typeof v.formViews === 'object') {
        for (const [key, fv] of Object.entries(v.formViews)) forms.push({ form: fv, key });
    }
    if (v.viewKind === 'form' && v.config && typeof v.config === 'object') {
        forms.push({ form: v.config, key: v.name });
    }
    const open: AnonymousFormIntakeCandidate[] = [];
    for (const { form, key } of forms) {
        if (!form || typeof form !== 'object') continue;
        const slug = anonymousFormIntakeSlug((form as Record<string, unknown>).sharing);
        if (slug === null) continue;
        open.push({ form: form as Record<string, any>, ...(key !== undefined ? { key } : {}), slug });
    }
    return open;
}

/**
 * The sorted, de-duplicated slug set a `view` body opens to anonymous intake.
 * Two bodies with the same set open exactly the same anonymous doors.
 */
export function anonymousFormIntakeSlugs(view: unknown): string[] {
    return [...new Set(anonymousFormIntakeCandidates(view).map((c) => c.slug))].sort();
}
