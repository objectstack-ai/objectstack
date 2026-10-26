import React from 'react';
import { cn, LazyIcon, Button } from '@object-ui/components';
import { ArrowLeft } from 'lucide-react';
import { useRecordContext, SchemaRenderer } from '@object-ui/react';

/**
 * Props of this package's `<PageHeader>` React component.
 *
 * Named `PageHeaderComponentProps`, not `PageHeaderProps` (objectui#3161,
 * objectstack#4115 ledger batch 7). `@object-ui/app-shell` once used this
 * name for its own console header (objectui#3169). That header is a different
 * component, with rendered-node `title`, `subtitle` and `actions`, so since
 * objectui#6349 (batch 8) it is `ConsolePageHeaderProps`, and this package is
 * the one authority for this name.
 *
 * `@objectstack/spec/ui` owns `PageHeaderProps` for the AUTHORED `page:header`
 * node: a zod object of `title: string`, `subtitle`, an icon NAME, `breadcrumb`
 * and `actions: string[]` (action IDs). This interface is the rendered layer of
 * that same element — `icon` accepts a React node as well as a name, `actions`
 * is a list of action definitions the `record:quick_actions` widget renders,
 * `schema` carries the raw node, and it extends `HTMLAttributes` so every DOM
 * prop rides along. Authored layer vs rendered layer, which is exactly the
 * one-name-two-layers failure objectstack#4115 exists to end.
 *
 * Pinned by `__tests__/spec-symbol-batch7.test.ts`, which fails if the spec
 * stops owning `PageHeaderProps` (then this can take the plain name back) or
 * starts owning `PageHeaderComponentProps`.
 */
export interface PageHeaderComponentProps extends React.HTMLAttributes<HTMLDivElement> {
    title: string;
    /**
     * Optional secondary line under the title. `subtitle` is the only spelling:
     * it is the key `@objectstack/spec/ui`'s `PageHeaderProps` declares, and it
     * resolves {field.path} tokens against the current record context.
     *
     * The legacy `description` alias this component used to read alongside it
     * was retired in objectui#3789, once the ADR-0087 D2 conversion
     * `page-header-subtitle-alias` was measured to reach EVERY spec-valid header
     * position on the load path (regions, slots, and containers nested to any
     * depth — objectstack#6775 / objectstack-ai/objectstack#6776 / PR objectstack-ai/objectstack#7034). Stored metadata authored with
     * `description` is rewritten to `subtitle` before it ever reaches a renderer,
     * so the second line survives without this side holding a second dialect open.
     */
    subtitle?: string;
    /**
     * Optional icon for the header chip. Accepts either a string Lucide icon
     * name (resolved via `LazyIcon`, the standard ObjectUI helper) or a
     * pre-rendered React node.
     */
    icon?: React.ReactNode | string;
    action?: React.ReactNode;
    /**
     * Show a back arrow at the left of the header that navigates one level
     * up the URL (e.g. /apps/{app}/{obj}/record/{id} → /apps/{app}/{obj}).
     * Defaults to true on record pages and false otherwise — the inference
     * is based on whether a record context with a recordId is available.
     */
    showBack?: boolean;
    /**
     * Optional inline action list rendered into the header's right-aligned
     * slot. Accepts an array of `ActionDef` objects (or action ids) and
     * delegates rendering to the standard `record:quick_actions` widget
     * with `location: 'record_header'`. Authors no longer need to declare
     * a sibling `record:quick_actions` node + visual `-mt-12` hack.
     */
    actions?: unknown[];
    /**
     * When rendered from a schema, `SchemaRenderer` injects the full schema
     * node so we can render its `children` into the right-aligned action
     * slot (Salesforce Lightning-style header). React children passed at
     * the JSX call site take precedence over schema children.
     */
    schema?: { children?: unknown[]; actions?: unknown[]; properties?: { actions?: unknown[] } };
}

/**
 * Replace `{field.path}` tokens in a template string against record data.
 * Missing fields collapse to empty strings; consecutive whitespace is
 * collapsed so partial misses don't leave gaping holes in the header.
 * If no `{` is present, the template is returned as-is.
 */
// Extract a human display name from an expanded lookup-target object.
// Salesforce-style fallback chain: standard display fields → composite
// `salutation first_name last_name` → email.
const pickExpandedDisplayName = (v: any): string | null => {
    const direct = v?.name ?? v?.full_name ?? v?.display_name ?? v?.label ?? v?.title ?? v?.subject;
    if (direct != null && String(direct).trim()) return String(direct);
    const composite = [v?.salutation, v?.first_name, v?.last_name]
        .filter((p) => typeof p === 'string' && p.trim())
        .map((p: string) => p.trim())
        .join(' ');
    if (composite) return composite;
    if (typeof v?.email === 'string' && v.email.trim()) return v.email.trim();
    return null;
};

const interpolateTitle = (template: string | undefined, data: unknown): string => {
    if (!template || typeof template !== 'string') return template ?? '';
    if (!template.includes('{')) return template;
    const out = template.replace(/\{([a-zA-Z0-9_.]+)\}/g, (_m, path: string) => {
        const v = path
            .split('.')
            .reduce<any>((acc, seg) => (acc == null ? acc : acc[seg]), data);
        if (v == null) return '';
        if (typeof v === 'object') {
            const display = pickExpandedDisplayName(v);
            return display == null ? '' : display;
        }
        return String(v);
    });
    // Strip orphaned separators left behind by empty placeholders
    // (`Foo -  - Bar` → `Foo - Bar`) and trim trailing punctuation /
    // whitespace so the resulting label always renders cleanly.
    return out
        .replace(/\s*[-–—|/·,:]\s*(?=\s*[-–—|/·,:]|$)/g, '')
        .replace(/^\s*[-–—|/·,:]\s*/, '')
        .replace(/\s+/g, ' ')
        .trim();
};

export function PageHeader({
    title,
    subtitle,
    icon,
    action,
    actions,
    showBack,
    schema,
    className,
    children,
    ...props
}: PageHeaderComponentProps) {
    const ctx = useRecordContext();
    const titleHadPlaceholder =
        typeof title === 'string' && /\{[a-zA-Z0-9_.]+\}/.test(title);
    const interpolatedTitle = interpolateTitle(title, ctx?.data);
    // When the original template references record fields (e.g.
    // `{first_name} {last_name}`) and interpolation can't resolve any of
    // them (no data, all blanks), do NOT fall back to the raw template —
    // showing literal `{first_name}` to end-users is the worst outcome.
    // Prefer an empty title; the host can supply a friendlier fallback by
    // passing a non-templated `title` prop.
    const resolvedTitle = interpolatedTitle
        ? interpolatedTitle
        : titleHadPlaceholder
            ? ''
            : title;
    // One spelling only (objectui#3789): the `description` alias retired once
    // the load-path conversion was measured to rewrite it at every spec-valid
    // header position, so there is no second key left to fall back to.
    const secondaryRaw = subtitle;
    const secondaryHadPlaceholder =
        typeof secondaryRaw === 'string' && /\{[a-zA-Z0-9_.]+\}/.test(secondaryRaw);
    const interpolatedSecondary = interpolateTitle(secondaryRaw, ctx?.data);
    const resolvedSecondary = interpolatedSecondary
        ? interpolatedSecondary
        : secondaryHadPlaceholder
            ? ''
            : secondaryRaw;

    // Default-on for record pages (a recordId in scope is the cheapest tell
    // that the user navigated from a list view). The host can override with
    // `showBack={false}` for embedded contexts (drawers, modals). Embedded
    // contexts also auto-suppress because the overlay chrome already
    // provides Close / Expand controls — a duplicate back chevron there is
    // confusing and points to the wrong "back".
    const isRecordPage = !!ctx?.recordId;
    const isEmbedded = !!ctx?.embedded;
    const shouldShowBack = showBack ?? (isRecordPage && !isEmbedded);
    const handleBack = React.useCallback(() => {
        // Strip a trailing `/record/{id}` (or any one-segment leaf) to land
        // on the list view. If the URL doesn't match, fall back to browser
        // history so deep-linked users still get a usable affordance.
        if (typeof window === 'undefined') return;
        const path = window.location.pathname;
        const parent = path.replace(/\/record\/[^/]+\/?$/, '');
        if (parent !== path) {
            window.history.pushState({}, '', parent + window.location.search);
            // SPA routers listen on popstate, dispatch it so they re-render.
            window.dispatchEvent(new PopStateEvent('popstate'));
        } else if (window.history.length > 1) {
            window.history.back();
        }
    }, []);

    // Render schema-declared children into the action slot. `SchemaRenderer`
    // strips `children` from the React tree (treats them as metadata), so
    // we re-introduce them here for components like `record:quick_actions`
    // nested under `page:header.children`.
    const schemaChildren = Array.isArray(schema?.children)
        ? (schema!.children as any[])
              .filter(Boolean)
              .map((child, idx) => (
                  <SchemaRenderer key={(child?.id as string) || `pgh-child-${idx}`} schema={child} />
              ))
        : null;
    // First-class `actions` property: render as an inline record:quick_actions
    // node so authors get the same toolbar (icons, overflow, permissions,
    // confirm dialogs) without a sibling component + visual hack.
    const resolvedActions =
        (Array.isArray(actions) && actions.length > 0 && actions) ||
        (Array.isArray(schema?.actions) && (schema!.actions as unknown[]).length > 0 && schema!.actions) ||
        (Array.isArray(schema?.properties?.actions) && (schema!.properties!.actions as unknown[]).length > 0 && schema!.properties!.actions) ||
        null;
    const actionsSlot = resolvedActions
        ? (
            <SchemaRenderer
                schema={{
                    type: 'record:quick_actions',
                    properties: { actions: resolvedActions, location: 'record_header', align: 'end', inline: true },
                } as any}
            />
        )
        : null;
    const slot = action || children || actionsSlot || schemaChildren;

    return (
        <div className={cn('flex flex-col gap-3 pb-4 border-b', className)} {...props}>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                {shouldShowBack && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={handleBack}
                        aria-label="Back to list"
                        className="flex-shrink-0 -ml-2"
                    >
                        <ArrowLeft className="size-4" />
                    </Button>
                )}
                {icon && (resolvedTitle || resolvedSecondary) && (
                    <div className="flex-shrink-0 grid place-items-center size-10 rounded-md bg-primary/10 text-primary">
                        {typeof icon === 'string' ? <LazyIcon name={icon} className="size-5" /> : icon}
                    </div>
                )}
                <div className="flex flex-col min-w-48 flex-1">
                    {resolvedTitle ? (
                        <h1 className="text-2xl font-bold tracking-tight md:text-3xl truncate">{resolvedTitle}</h1>
                    ) : null}
                    {resolvedSecondary && <p className="text-sm text-muted-foreground truncate">{resolvedSecondary}</p>}
                </div>
                {slot && <div className="flex items-center gap-2 ml-auto">{slot}</div>}
            </div>
        </div>
    );
}
