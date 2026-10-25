import { ShieldAlert, Settings2, Lock, Archive } from 'lucide-react';
import {
  Badge,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
  cn,
} from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import { type ManagedByBucket } from '../utils/crudAffordances.js';
import { useCanAuthorMetadata } from '../hooks/useCanAuthorMetadata.js';

/**
 * ManagedByBadge — replaces the verbose, full-width `ManagedByBanner` with
 * a compact badge that sits next to the page title.
 *
 * Rationale (see internal RFC, "platform-managed UX"):
 *   - Salesforce / ServiceNow / Workday / SAP Fiori never plaster a banner
 *     explaining their internal architecture across every list/detail
 *     page. Instead they hide the affordance (the New button), and surface
 *     a short *contextual* hint only when the user might otherwise be
 *     confused (typically the empty state or a tooltip).
 *   - The previous banner exposed engine-internal terminology ("platform
 *     engine", "audit / monitoring surface") to every end user and repeated
 *     itself on three pages (list + detail + form) for the same record.
 *
 * The badge follows the same taxonomy declared by
 * `@objectstack/spec/data/object.zod.ts` → `ObjectSchemaBase.managedBy`:
 *   - `platform`     — User-owned business data. **Renders nothing.**
 *   - `config`       — Admin-authored configuration.
 *   - `system-data`  — Platform-defined schema whose DATA is admin/user-writable
 *                      (objectstack#3355; the writable half of the old `system`).
 *   - `engine-owned` — Runtime rows a platform service owns end to end (ADR-0103);
 *                      the explicit read-only monitoring surface, and the
 *                      engine-owned half of the old `system`.
 *   - `append-only`  — Immutable audit log.
 *   - `better-auth`  — Identity tables owned by better-auth driver.
 *
 * Forms still disable inputs and the toolbar still hides New/Import/Delete
 * via `resolveEffectiveCrudAffordances()`. This badge purely *labels* the bucket;
 * the detailed explanation lives in the tooltip.
 *
 * ## An authoring aid: it draws for an authoring caller only (objectui#12194)
 *
 * The bucket is a fact about how the object is BUILT, so the label speaks to
 * whoever can author it. To an end user it is an implementation word — the
 * `better-auth` variant reads 「身份」 / "Identity" on a workspace page a host
 * authored, with no meaning to them — and the record page draws it outside
 * the page tree, so no page could leave it out. Triage's ruling on
 * objectui#12194 (option a): the badge renders only for a caller who can
 * author metadata; no declared switch, no new spec key.
 *
 * "Can author" is `useCanAuthorMetadata()` — the server's `manage_metadata`
 * answer, the same one the Studio entry points (HomePage's builder CTAs, the
 * header's Studio bridge, PageView's edit pencil) read. The gate sits HERE
 * rather than at each call site, so the list header, the record page and the
 * form page follow one rule. The hook keeps its own doctrine: an UNREPORTED capability
 * set (a backend whose `/me/permissions` omits `systemPermissions`, or no
 * permission provider at all) fails open, and the badge draws as before.
 *
 * ## Setup record pages carry it on the header chip instead (objectui#13385)
 *
 * A record page inside the Setup app draws no badge: the header already names
 * the object (「组织」 / "Organization"), and a second chip floating outside the
 * page tree repeated it. That page hands `useManagedByNote()` — the badge's
 * tooltip title, under the same gate — to the header's object-label chip,
 * which shows it on hover and focus. The list header and every record page
 * outside Setup keep the badge unchanged (maintainer ruling on objectui#13385,
 * option B; it amends objectui#12194 option a for Setup record pages only).
 *
 * What an end user needs is said elsewhere, and none of it reads this badge:
 * the toolbar hides the affordances the bucket closes, a locked form names
 * the missing permission above its fields (plugin-form's
 * `ClosedAffordanceNotice`, objectui#11000), and the list's empty state for
 * the read-only buckets is rendered separately by `ObjectView` via
 * `resolveManagedByEmptyState()`.
 */

type Bucket = ManagedByBucket;

export interface ManagedByBadgeProps {
  /** The `managedBy` flag from the object schema. */
  managedBy?: string;
  /** Optional override for the human-readable system name shown in the tooltip. */
  label?: string;
  /** Optional extra classes. */
  className?: string;
}

interface Variant {
  icon: typeof ShieldAlert;
  /** Key under the `managedByBadge.*` locale namespace. */
  i18nKey: string;
  /** English fallbacks when the locale bundle misses a key. */
  short: string;
  title: string;
  body: (display: string) => string;
  /** Tailwind classes for the badge surface. */
  tone: string;
}

/**
 * Variant keys: every non-platform bucket. The extra `'system-writable'` key
 * ADR-0103 needed is gone — objectstack#3355 made the writable half a real
 * bucket (`system-data`), so the variant map is once again 1:1 with the union
 * and a new bucket is a compile error to miss.
 */
type VariantKey = Exclude<Bucket, 'platform'>;

const VARIANTS: Record<VariantKey, Variant> = {
  config: {
    icon: Settings2,
    i18nKey: 'config',
    short: 'Admin config',
    title: 'Administrator configuration',
    body: () =>
      'These rows define how the platform behaves at runtime. Author them here; the runtime data they produce lives in a separate table.',
    tone: 'border-sky-300/60 bg-sky-50 text-sky-900 hover:bg-sky-100 dark:border-sky-500/40 dark:bg-sky-950/40 dark:text-sky-100',
  },
  // ADR-0103 — the explicit engine-owned bucket: rows a platform service owns end
  // to end (jobs, automation runs, approval runtime rows, the metadata store, …).
  // Keeps the `system` i18n KEY (not the retired bucket value): the copy is
  // unchanged and every locale bundle already carries it, so objectstack#3355
  // costs zero translation churn. The vocabulary fix is at the schema level.
  'engine-owned': {
    icon: Lock,
    i18nKey: 'system',
    short: 'System-managed',
    title: 'Managed by the platform',
    body: () =>
      'Rows here are created automatically when actions run on the source record. The list below is a read-only monitoring surface — row-level actions (Approve, Recall, Resend, …) live on each row.',
    tone: 'border-slate-300/60 bg-slate-50 text-slate-900 hover:bg-slate-100 dark:border-slate-500/40 dark:bg-slate-950/40 dark:text-slate-100',
  },
  // objectstack#3355 — platform-defined schema, admin/user-writable DATA (e.g.
  // Notification Preferences, delegated RBAC assignments). Under ADR-0103 this
  // was a synthetic `'system-writable'` variant the component had to DERIVE from
  // `userActions`; it is now the plain `system-data` bucket. The `systemWritable`
  // i18n key is kept so no locale bundle has to change.
  'system-data': {
    icon: Settings2,
    i18nKey: 'systemWritable',
    short: 'Platform schema',
    title: 'Platform-defined, admin-writable',
    body: () =>
      "This object's schema is defined by the platform, but its rows are yours to create and edit here. Who may write is governed by delegated administration and record-level security, not by this badge.",
    tone: 'border-slate-300/60 bg-slate-50 text-slate-900 hover:bg-slate-100 dark:border-slate-500/40 dark:bg-slate-950/40 dark:text-slate-100',
  },
  'append-only': {
    icon: Archive,
    i18nKey: 'appendOnly',
    short: 'Read-only · Audit log',
    title: 'Read-only historical record',
    body: () =>
      "Immutable audit log. Rows cannot be created, edited, or deleted from the UI — they're written by the platform when events occur. Use Export to download for compliance review.",
    tone: 'border-zinc-300/60 bg-zinc-50 text-zinc-900 hover:bg-zinc-100 dark:border-zinc-500/40 dark:bg-zinc-950/40 dark:text-zinc-100',
  },
  'better-auth': {
    icon: ShieldAlert,
    i18nKey: 'betterAuth',
    short: 'Identity',
    title: 'Managed by the identity provider',
    body: (display) =>
      `This object's schema is owned by ${display}. Direct edits bypass password hashing, session validation, two-factor checks, and audit hooks. Manage these records through your authentication provider's sign-in, invitation, and security flows instead.`,
    tone: 'border-amber-300/60 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-100',
  },
};

/**
 * The variant a `managedBy` value draws, or `null` for none: no value,
 * `platform` (user-owned business data), or a value outside the union.
 * ADR-0103 / objectstack#3355 — the bucket IS the variant; nothing to derive.
 */
function variantOf(managedBy: string | undefined): Variant | null {
  if (!managedBy || managedBy === 'platform') return null;
  return VARIANTS[managedBy as VariantKey] ?? null;
}

/**
 * The badge's one-line note for a `managedBy` bucket — its tooltip TITLE,
 * from the same `managedByBadge.<key>.title` locale key — for a host that
 * carries the note somewhere other than the badge (objectui#13385: a Setup
 * record page puts it on the header's object-label chip and draws no badge).
 *
 * Same answer as the badge, under the same gate: `null` for a caller who
 * cannot author metadata (objectui#12194) and for every bucket the badge
 * draws nothing for (`platform`, no value, an unknown value).
 */
export function useManagedByNote(managedBy: string | undefined): string | null {
  const { t } = useObjectTranslation();
  const canAuthor = useCanAuthorMetadata();
  if (!canAuthor) return null;
  const variant = variantOf(managedBy);
  if (!variant) return null;
  return t(`managedByBadge.${variant.i18nKey}.title`, { defaultValue: variant.title });
}

export function ManagedByBadge({ managedBy, label, className }: ManagedByBadgeProps) {
  const { t } = useObjectTranslation();
  // objectui#12194 — an authoring aid: nothing for a caller who cannot author.
  const canAuthor = useCanAuthorMetadata();
  if (!canAuthor) return null;
  const variant = variantOf(managedBy);
  if (!variant) return null;
  const Icon = variant.icon;
  const display = label ?? 'better-auth';
  const short = t(`managedByBadge.${variant.i18nKey}.short`, { defaultValue: variant.short });
  const title = t(`managedByBadge.${variant.i18nKey}.title`, { defaultValue: variant.title });
  const body = t(`managedByBadge.${variant.i18nKey}.body`, {
    defaultValue: variant.body(display),
    provider: display,
  });
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            data-testid="managed-by-badge"
            data-bucket={managedBy}
            className={cn(
              'gap-1 font-normal text-[11px] leading-none py-0.5 px-1.5 cursor-help',
              variant.tone,
              className,
            )}
          >
            <Icon className="h-3 w-3" aria-hidden="true" />
            <span>{short}</span>
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="start" className="max-w-xs text-xs leading-relaxed">
          <p className="font-semibold mb-1">{title}</p>
          <p className="text-muted-foreground">{body}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default ManagedByBadge;
