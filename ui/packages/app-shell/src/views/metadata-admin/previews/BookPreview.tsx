// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * BookPreview — visualises a `book` metadata record's navigation spine
 * (ADR-0046 §6). A book is the *spine* of a table of contents: an ordered
 * set of groups (sections) plus identity and access. It deliberately does
 * NOT store its members — membership is **derived** at render time from a
 * rule on each group (`include` glob/tag) plus per-doc `order`/`group`.
 *
 * Because the derived doc set isn't present in the draft (it's resolved
 * server-side from the current doc set via `GET /meta/book/:name/tree`),
 * this preview renders the *authored spine*: each group, its membership
 * rule, and any explicit `pages` override (the curated-order escape hatch,
 * incl. `---` separators, `...` rest, and external links). A toolbar link
 * opens the live-resolved tree so authors can verify which docs land where.
 *
 * Drafts can be incomplete or invalid (validation may be in progress), so
 * every field is read defensively and we degrade to a hint rather than throw.
 */

import * as React from 'react';
import {
  BookOpen,
  FolderTree,
  FileText,
  ExternalLink,
  Globe,
  Lock,
  Building2,
  Tag,
  Minus,
  MoreHorizontal,
  Package,
} from 'lucide-react';
import type { MetadataPreviewProps } from '../preview-registry.js';
import { t as tr, tFormat } from '../i18n.js';
import { PreviewShell, PreviewErrorBoundary, PreviewEmptyState } from './PreviewShell.js';
import { withNodes } from './row-nodes.js';

type Audience = 'org' | 'public' | { permissionSet: string } | undefined;
type Include = string | { tag: string } | undefined;

interface PageNode {
  /** A bare doc name, the `---` separator, or the `...` rest marker. */
  literal?: string;
  doc?: string;
  href?: string;
  label?: string;
  badge?: string;
  icon?: string;
}

interface Group {
  key: string;
  label: string;
  order?: number;
  include?: Include;
  package?: string;
  pages?: PageNode[];
}

/**
 * Normalise an untrusted `groups` array into a defensively-typed shape.
 * `noKey` is the designer's word for a group authored with a label and no key
 * (`engine.bookPreview.noKey`, in the preview's locale — objectui#10862).
 */
function normalizeGroups(raw: unknown, noKey: string): Group[] {
  if (!Array.isArray(raw)) return [];
  const groups = raw
    .map((g: any, i: number): { g: Group; i: number } | null => {
      if (!g || typeof g !== 'object') return null;
      const key = String(g.key ?? '').trim();
      const label = String(g.label ?? key ?? '').trim();
      if (!key && !label) return null;
      return {
        g: {
          key: key || noKey,
          label: label || key || '(unnamed)',
          order: typeof g.order === 'number' ? g.order : undefined,
          include: normalizeInclude(g.include),
          package: typeof g.package === 'string' ? g.package : undefined,
          pages: normalizePages(g.pages),
        },
        i,
      };
    })
    .filter((x): x is { g: Group; i: number } => x !== null);
  // Mirror the resolver's ordering: by `order` then authored index (stable).
  return groups
    .sort((a, b) => (a.g.order ?? 0) - (b.g.order ?? 0) || a.i - b.i)
    .map((x) => x.g);
}

function normalizeInclude(raw: unknown): Include {
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object' && typeof (raw as any).tag === 'string') {
    return { tag: (raw as any).tag };
  }
  return undefined;
}

function normalizePages(raw: unknown): PageNode[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw
    .map((n: any): PageNode | null => {
      if (typeof n === 'string') return { literal: n };
      if (n && typeof n === 'object') {
        return {
          doc: typeof n.doc === 'string' ? n.doc : undefined,
          href: typeof n.href === 'string' ? n.href : undefined,
          label: typeof n.label === 'string' ? n.label : undefined,
          badge: typeof n.badge === 'string' ? n.badge : undefined,
          icon: typeof n.icon === 'string' ? n.icon : undefined,
        };
      }
      return null;
    })
    .filter((x): x is PageNode => x !== null);
}

function audienceChip(
  audience: Audience,
  locale: string | undefined,
): { icon: React.ReactNode; label: string; tone: string } {
  if (audience === 'public') {
    return {
      icon: <Globe className="h-3 w-3" />,
      label: tr('engine.bookPreview.audience.public', locale),
      tone: 'text-emerald-700 bg-emerald-50 border-emerald-200',
    };
  }
  if (audience && typeof audience === 'object' && typeof audience.permissionSet === 'string') {
    return {
      icon: <Lock className="h-3 w-3" />,
      label: tFormat('engine.bookPreview.audience.permissionSet', locale, { name: audience.permissionSet }),
      tone: 'text-amber-800 bg-amber-50 border-amber-200',
    };
  }
  // 'org' (default) or absent — inherits the package grant.
  return {
    icon: <Building2 className="h-3 w-3" />,
    label: tr('engine.bookPreview.audience.org', locale),
    tone: 'text-muted-foreground bg-muted/40 border-muted',
  };
}

export function BookPreview({ name, draft, locale }: MetadataPreviewProps) {
  const d = draft as any;
  const bookName = String(d.name ?? name ?? '').trim();
  const label = String(d.label ?? bookName);
  const description = typeof d.description === 'string' ? d.description : '';
  const slug = typeof d.slug === 'string' ? d.slug : '';
  const noKey = tr('engine.bookPreview.noKey', locale);
  const groups = React.useMemo(() => normalizeGroups(d.groups, noKey), [d.groups, noKey]);
  const aud = audienceChip(d.audience as Audience, locale);

  if (!bookName) {
    return (
      <PreviewShell hint="book">
        <PreviewEmptyState
          icon={<BookOpen className="h-8 w-8 opacity-50" />}
          title={tr('engine.bookPreview.nameTitle', locale)}
          description={tr('engine.bookPreview.nameDescription', locale)}
        />
      </PreviewShell>
    );
  }

  // The live-resolved tree (actual docs per group) is server-derived. Offer a
  // link so authors can verify membership against the current doc set.
  const treeUrl = `/meta/book/${encodeURIComponent(bookName)}/tree`;

  return (
    <PreviewShell
      hint="book · spine"
      toolbar={
        <a
          href={treeUrl}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          title={tr('engine.bookPreview.treeTitle', locale)}
        >
          {tr('engine.bookPreview.tree', locale)} <ExternalLink className="h-3 w-3" />
        </a>
      }
    >
      <PreviewErrorBoundary>
        <div className="p-3 space-y-3">
          {/* Identity / access header */}
          <div className="rounded border bg-muted/30 p-3">
            <div className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-sm font-medium text-foreground truncate">{label}</span>
              <span
                className={`ml-auto inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${aud.tone}`}
              >
                {aud.icon}
                {aud.label}
              </span>
            </div>
            <div className="text-xs text-muted-foreground font-mono mt-0.5">{bookName}</div>
            {slug && (
              <div className="text-xs text-muted-foreground mt-1">
                {withNodes(tr('engine.bookPreview.slug', locale), { slug: <code className="font-mono">{slug}</code> })}
              </div>
            )}
            {description && <div className="text-xs text-muted-foreground mt-1.5">{description}</div>}
          </div>

          {/* The spine */}
          {groups.length === 0 ? (
            <PreviewEmptyState
              icon={<FolderTree className="h-8 w-8 opacity-50" />}
              title={tr('engine.bookPreview.noGroups', locale)}
              tone="warn"
              description={withNodes(tr('engine.bookPreview.noGroupsDescription', locale), {
                groups: <code>groups</code>,
                include: <code>include</code>,
                glob: <code>crm_guide_*</code>,
                tag: <code>{'{ tag }'}</code>,
              })}
            />
          ) : (
            <div className="space-y-2">
              {groups.map((g, i) => (
                <GroupCard key={`${g.key}-${i}`} group={g} locale={locale} />
              ))}
            </div>
          )}
        </div>
      </PreviewErrorBoundary>
    </PreviewShell>
  );
}

function GroupCard({ group, locale }: { group: Group; locale?: string }) {
  return (
    <div className="rounded border bg-background">
      <div className="flex items-center gap-2 border-b bg-muted/20 px-3 py-2">
        <FolderTree className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs font-medium text-foreground truncate">{group.label}</span>
        <span className="font-mono text-[10px] text-muted-foreground">{group.key}</span>
        {typeof group.order === 'number' && (
          <span className="text-[10px] text-muted-foreground" title={tr('engine.bookPreview.orderTitle', locale)}>
            #{group.order}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {group.package && (
            <span
              className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground"
              title={tr('engine.bookPreview.packageTitle', locale)}
            >
              <Package className="h-3 w-3" />
              {group.package}
            </span>
          )}
          <IncludeChip include={group.include} hasOverride={!!group.pages?.length} locale={locale} />
        </div>
      </div>

      <div className="px-3 py-2">
        {group.pages?.length ? (
          <ol className="space-y-1">
            {group.pages.map((node, i) => (
              <PageRow key={i} node={node} locale={locale} />
            ))}
          </ol>
        ) : group.include != null ? (
          <div className="text-[11px] text-muted-foreground italic">{tr('engine.bookPreview.derived', locale)}</div>
        ) : (
          <div className="text-[11px] text-amber-700 italic">
            {withNodes(tr('engine.bookPreview.noRule', locale), {
              include: <code>include</code>,
              pages: <code>pages</code>,
              group: <code>{`group: "${group.key}"`}</code>,
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function IncludeChip({
  include,
  hasOverride,
  locale,
}: {
  include: Include;
  hasOverride: boolean;
  locale?: string;
}) {
  if (include == null) {
    return hasOverride ? (
      <span className="text-[10px] text-muted-foreground" title={tr('engine.bookPreview.curatedTitle', locale)}>
        {tr('engine.bookPreview.curated', locale)}
      </span>
    ) : null;
  }
  if (typeof include === 'string') {
    return (
      <span
        className="inline-flex items-center gap-1 rounded border border-primary/30 bg-primary/5 px-1.5 py-0.5 font-mono text-[10px] text-foreground"
        title={tr('engine.bookPreview.globTitle', locale)}
      >
        {include}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 rounded border border-primary/30 bg-primary/5 px-1.5 py-0.5 text-[10px] text-foreground"
      title={tr('engine.bookPreview.tagTitle', locale)}
    >
      <Tag className="h-3 w-3" />
      {include.tag}
    </span>
  );
}

function PageRow({ node, locale }: { node: PageNode; locale?: string }) {
  // Separator (`---`).
  if (node.literal === '---') {
    return (
      <li className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground/60">
        <Minus className="h-3 w-3" />
        {tr('engine.bookPreview.separator', locale)}
      </li>
    );
  }
  // Rest marker (`...`) — expands to the group's unpinned members at resolve time.
  if (node.literal === '...') {
    return (
      <li className="flex items-center gap-2 text-[11px] italic text-muted-foreground">
        <MoreHorizontal className="h-3.5 w-3.5" />
        {tr('engine.bookPreview.rest', locale)}
      </li>
    );
  }

  const isExternal = !!node.href;
  const docName = node.literal ?? node.doc;
  const display = node.label ?? docName ?? node.href ?? tr('engine.bookPreview.emptyPage', locale);

  return (
    <li className="flex items-center gap-2 text-xs">
      {isExternal ? (
        <ExternalLink className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      ) : (
        <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      )}
      <span className="truncate">{display}</span>
      {!isExternal && docName && node.label && (
        <span className="font-mono text-[10px] text-muted-foreground">{docName}</span>
      )}
      {node.badge && (
        <span className="rounded-full border border-primary/30 bg-primary/5 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-foreground">
          {node.badge}
        </span>
      )}
      {isExternal && (
        <a
          href={node.href}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="ml-auto font-mono text-[10px] text-muted-foreground hover:text-foreground truncate max-w-[40%]"
          title={node.href}
        >
          {node.href}
        </a>
      )}
    </li>
  );
}
