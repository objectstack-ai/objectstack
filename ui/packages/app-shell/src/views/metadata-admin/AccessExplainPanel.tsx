// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * AccessExplainPanel — "why can this user access?" (ADR-0090 D6).
 *
 * Right-side sheet in the Studio Access pillar that asks the backend explain
 * engine (`GET/POST /api/v1/security/explain`) why a principal can — or cannot
 * — perform an operation on an object, and renders the `ExplainDecision`
 * trace: the resolved principal (position → permission-set binding chain) and
 * the evaluation-pipeline layers with their verdicts (required capabilities,
 * object CRUD, FLS, OWD baseline, depth, sharing, VAMA bypass, RLS). The report
 * is produced by the SAME code paths enforcement runs, so what this panel shows
 * is what the middleware does.
 *
 * [C2 / ADR-0095] Optionally scoped to ONE record: supply a record id and the
 * report gains the row-level story — the always-first `tenant_isolation` Layer 0,
 * each layer tagged with its kernel tier (tenant wall vs. business RLS), the
 * principal's posture rung, a per-layer `record` attribution (permission set →
 * position → share → row rule → effective row filter), and a top-level verdict
 * pinning why THAT record is (in)visible and which layer decided it. Without a
 * record id the report is object-level and unchanged.
 *
 * Explaining ANOTHER user is authorized server-side: `manage_users` or a
 * delegated adminScope covering that user (D12) — a 403 here renders as a
 * friendly localized message, not a raw error.
 */

import * as React from 'react';
import {
  Badge,
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@object-ui/components';
import { RecordPickerDialog } from '@object-ui/fields';
import { useAdapter } from '@object-ui/react';
import { createAuthenticatedFetch } from '@object-ui/auth';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronsUpDown,
  HelpCircle,
  Loader2,
  ShieldQuestion,
  User as UserIcon,
  X,
  XCircle,
} from 'lucide-react';
import { t, tFormat, useMetadataLocale } from './i18n.js';
import { useMetadataClient } from './useMetadata.js';

/**
 * The explain-report vocabulary is OWNED by `@objectstack/spec/security` and
 * imported here, not re-described (objectstack#4115).
 *
 * The report this panel renders is produced by the framework's explain engine
 * parsing with these very schemas, so a local copy can only ever be a lagging
 * transcription of them. The copies that used to live here had already drifted
 * in three places, each of which silently degraded the panel:
 *
 *   - `ExplainRecordAttribution.rules` was optional here but is REQUIRED in the
 *     spec — the "which rule decided this row" list is always sent, so the
 *     optional spelling pushed every reader through a needless nullish branch.
 *   - `ExplainLayer.contributors[].state` (`'active' | 'expired'`) was missing
 *     outright, so an EXPIRED position/permission-set contribution rendered
 *     identically to a live one.
 *   - `ExplainDecision.principal.positions` / `.permissionSets` were optional
 *     here and required in the spec, and `principalKind` was a bare `string`
 *     rather than the closed `'human' | 'agent' | 'service' | 'system' |
 *     'guest'` enum.
 */
export type {
  ExplainDecision,
  ExplainLayer,
  ExplainMatchedRule,
  ExplainRecordAttribution,
} from '@objectstack/spec/security';

import type {
  ExplainDecision,
  ExplainLayer,
  ExplainMatchedRule,
  ExplainRecordAttribution,
} from '@objectstack/spec/security';

/** Operation vocabulary, derived from the spec's own report type. */
type ExplainOperation = ExplainDecision['operation'];
const OPERATIONS = ['read', 'create', 'update', 'delete', 'transfer', 'restore', 'purge'] as const satisfies readonly ExplainOperation[];

/** The item a value none of a picker's options carries is shown by. */
const OUTSIDE_OPTIONS = 'outside';

/**
 * objectui#11865 — the request form's two pickers (object, operation), drawn
 * with the shared `Select`, the control the validation rule editor's pickers
 * (`RulePicker`) pick with. Both used to be browser-native `<select>`s. What a
 * pick sets is unchanged:
 * `onPick` receives the picked option's own `value`, the string the native
 * control's `change` carried, and re-picking the current option sets nothing,
 * as it did there.
 *
 * - Items carry their option's INDEX, not its value. The object picker opens
 *   on "select an object", whose value is `''`, which `SelectItem` refuses; an
 *   index cannot collide with an object's name, as a stand-in string could.
 * - A value none of the options carries gets an item of its own, labelled
 *   with the value, so the trigger shows what Explain will ask about. The
 *   native control showed its first option ("select an object") there.
 *   Picking that item sets nothing.
 * - `id` lands on the trigger, so the caller's `<label htmlFor>` names it as
 *   it named the native control.
 *
 * `Select` and not the shared `Combobox` for the object list, although the
 * list is open-ended: inside this panel's `Sheet`, the `Combobox`'s list did
 * not scroll under the mouse wheel, where the `Select`'s did, and the
 * `Select` jumps to an object by its typed leading letters. That is a
 * one-time Chromium reading taken for objectui#11865 (a package of 25
 * objects); no test re-derives it, because the test DOM does not scroll. The
 * `Combobox` also reports a re-pick of its current option as `''`.
 */
function ExplainPicker({
  id,
  value,
  options,
  onPick,
  className,
}: {
  id: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onPick: (value: string) => void;
  className: string;
}) {
  const at = options.findIndex((o) => o.value === value);
  return (
    <Select
      value={at !== -1 ? String(at) : OUTSIDE_OPTIONS}
      onValueChange={(token) => {
        // `undefined` for the outside item: it is the current value, so there is nothing to set.
        const picked = options[Number(token)];
        if (picked) onPick(picked.value);
      }}
    >
      <SelectTrigger id={id} className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {at === -1 && <SelectItem value={OUTSIDE_OPTIONS}>{value}</SelectItem>}
        {options.map((o, i) => (
          <SelectItem key={`${i}:${o.value}`} value={String(i)}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** The classes a picker takes, to sit at the height of the form's inputs. */
const PICKER_CLASS = 'h-8 px-2 text-xs';

/** Pipeline layer ids, derived from the spec's `ExplainLayer` (C2 adds `tenant_isolation`). */
export type ExplainLayerId = ExplainLayer['layer'];

const VERDICT_BADGE: Record<ExplainLayer['verdict'], string> = {
  grants: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  denies: 'border-destructive/40 bg-destructive/10 text-destructive',
  narrows: 'border-amber-400/50 bg-amber-400/10 text-amber-700 dark:text-amber-300',
  widens: 'border-sky-400/50 bg-sky-400/10 text-sky-700 dark:text-sky-300',
  neutral: 'border-border bg-muted/40 text-muted-foreground',
  not_applicable: 'border-border bg-transparent text-muted-foreground/60',
};

/** [C2] Row-level outcome badge styling (record attribution). */
const OUTCOME_BADGE: Record<NonNullable<ExplainRecordAttribution['outcome']>, string> = {
  admitted: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  excluded: 'border-destructive/40 bg-destructive/10 text-destructive',
  not_evaluated: 'border-border bg-transparent text-muted-foreground/60',
};

/** [C2] Rule-effect dot styling. */
const EFFECT_DOT: Record<ExplainMatchedRule['effect'], string> = {
  admits: 'bg-emerald-500',
  excludes: 'bg-destructive',
  neutral: 'bg-muted-foreground/40',
};

const personLabel = (u: unknown): string => {
  const r = (u ?? {}) as Record<string, unknown>;
  return String(r.full_name || r.name || r.display_name || r.email || r.id || '');
};

/** A person as the principal line names one (objectui#11862): a name and an email, either may be `''`. */
interface PersonName {
  name: string;
  email: string;
}

/**
 * The name and the email of a `sys_user` row — the row the user picker hands
 * back, or one the same lookup answers. The name reads the columns
 * {@link personLabel} tries before the email, so the two never disagree about
 * who a row is.
 */
const personOf = (u: unknown): PersonName => {
  const r = (u ?? {}) as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  return { name: text(r.full_name) || text(r.name) || text(r.display_name), email: text(r.email) };
};

/**
 * One person on the principal line (objectui#11862): the name and the email as
 * the primary text, the user id beneath it as secondary text. A user id the
 * lookup could not answer shows the id alone, as the line always did.
 */
function PrincipalPerson({ id, person }: { id: string; person?: PersonName }): React.ReactElement {
  const primary = person?.name || person?.email || '';
  if (!primary) return <span className="min-w-0 truncate font-mono text-foreground">{id}</span>;
  return (
    <span className="flex min-w-0 flex-col">
      <span className="truncate text-foreground">
        <span className="font-medium">{primary}</span>
        {person?.name && person.email ? <span className="text-muted-foreground"> {person.email}</span> : null}
      </span>
      <span className="truncate font-mono text-[10px] text-muted-foreground">{id}</span>
    </span>
  );
}

/** The metadata types a decision's principal cites by name (objectui#12693). */
const CITED_ITEM_TYPES = ['position', 'permission'] as const;
type CitedItemType = (typeof CITED_ITEM_TYPES)[number];

/**
 * A position or permission-set chip on the Principal card (objectui#12693) and
 * a layer's "Contributed by" line (objectui#13056): the item's label as the
 * text, with its name on the chip's `title`; with no label the name alone is
 * the text, as the chip read before. `detail` — a contributor's kind and how
 * it reached the principal — follows the name on the `title`.
 */
function CitedItemChip({
  name,
  label,
  variant,
  detail,
}: {
  name: string;
  label?: string;
  variant: 'outline' | 'secondary';
  detail?: string;
}): React.ReactElement {
  const text = label && label.trim() ? label : name;
  const title = [text !== name ? name : undefined, detail].filter(Boolean).join(' · ');
  return (
    <Badge
      variant={variant}
      className="px-1.5 py-0 text-[10px] font-normal"
      title={title || undefined}
    >
      {text}
    </Badge>
  );
}

export interface AccessExplainPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional prefill for the object input (e.g. from the matrix). */
  defaultObject?: string;
  /**
   * objectui#2600 B2 — the package this panel is scoped to. When set, the
   * object field becomes a dropdown of the package's objects (only ~20 exist)
   * instead of a free-text api-name input whose example never resolves.
   */
  packageId?: string;
}

export function AccessExplainPanel({ open, onOpenChange, defaultObject, packageId }: AccessExplainPanelProps): React.ReactElement {
  const locale = useMetadataLocale();
  // objectui#12510 — the visible "User" label names the picker, and the picked
  // principal follows it: the name reads "User Me (calling principal)".
  const userLabelId = React.useId();
  const userValueId = React.useId();
  const adapter = useAdapter() as any;
  const client = useMetadataClient();
  const authFetch = React.useMemo(() => createAuthenticatedFetch(), []);

  // objectui#2600 B2 — package object list backing the object dropdown. `null`
  // until loaded (or when unscoped / load fails), which keeps the free-text
  // input as a graceful fallback.
  const [objectOptions, setObjectOptions] = React.useState<Array<{ name: string; label?: string }> | null>(null);
  React.useEffect(() => {
    if (!open || !packageId) {
      setObjectOptions(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const rows = (await client.list<any>('object', { packageId })) as any[];
        const opts = (rows ?? [])
          .map((row) => {
            const item = row?.item ?? row;
            return { name: String(item?.name ?? ''), label: item?.label as string | undefined };
          })
          .filter((o) => !!o.name)
          .sort((a, b) => a.name.localeCompare(b.name));
        if (!cancelled) setObjectOptions(opts);
      } catch {
        if (!cancelled) setObjectOptions(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, packageId, client]);

  const [objectName, setObjectName] = React.useState(defaultObject ?? '');
  const [operation, setOperation] = React.useState<ExplainOperation>('read');
  const [user, setUser] = React.useState<{ id: string; label: string } | null>(null);
  const [recordId, setRecordId] = React.useState('');
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [recordPickerOpen, setRecordPickerOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [decision, setDecision] = React.useState<ExplainDecision | null>(null);
  // objectui#11862 — the people this panel can name, by user id: the row the
  // user picker handed back, and the rows the same lookup answered for a
  // decision's principal. An id with no entry renders as the id.
  const [people, setPeople] = React.useState<Record<string, PersonName>>({});
  // objectui#12693 — the labels this panel can draw for the positions and
  // permission sets a decision cites, by metadata type and name. A name with no
  // entry renders as the name.
  const [itemLabels, setItemLabels] = React.useState<Record<CitedItemType, Record<string, string>>>({
    position: {},
    permission: {},
  });

  React.useEffect(() => {
    if (defaultObject) setObjectName((v) => v || defaultObject);
  }, [defaultObject]);

  /**
   * Name the people a decision cites (objectui#11862). The ids the picker
   * already answered are known; the rest are asked, once per run, of the lookup
   * the user picker reads — `sys_user` through the data adapter. A lookup that
   * fails or finds no row leaves the id as the text, which is what the line
   * showed before.
   */
  const lookUpPeople = React.useCallback(
    async (d: ExplainDecision) => {
      const wanted = [
        ...new Set(
          [d.principal?.userId, d.principal?.onBehalfOf?.userId].filter(
            (id): id is string => typeof id === 'string' && id !== '' && !people[id],
          ),
        ),
      ];
      if (wanted.length === 0 || typeof adapter?.find !== 'function') return;
      try {
        const res = await adapter.find('sys_user', { $filter: { id: { $in: wanted } }, $top: wanted.length });
        const rows: unknown[] = Array.isArray(res) ? res : (res?.data ?? []);
        const found: Record<string, PersonName> = {};
        for (const row of rows) {
          const id = (row as { id?: unknown } | null)?.id;
          if (id == null) continue;
          const person = personOf(row);
          if (person.name || person.email) found[String(id)] = person;
        }
        if (Object.keys(found).length > 0) setPeople((prev) => ({ ...prev, ...found }));
      } catch {
        /* the id stays the text — the line's reading before objectui#11862 */
      }
    },
    [adapter, people],
  );

  /**
   * Label the positions and permission sets a decision cites (objectui#12693)
   * — on the Principal card and in each layer's "Contributed by" line
   * (objectui#13056). The explain answer carries their names only, so each
   * type the decision names an unlabelled item of is listed once per run — the read the Access
   * pillar's rail makes for permission sets — and its rows' labels kept. A list
   * that fails, or a row with no label, leaves the name as the text, which is
   * what the chip showed before.
   */
  const lookUpItemLabels = React.useCallback(
    async (d: ExplainDecision) => {
      const contributors = (d.layers ?? []).flatMap((l) => l.contributors ?? []);
      const contributed = (kind: string) => contributors.filter((c) => c.kind === kind).map((c) => c.name);
      const cited: Record<CitedItemType, readonly string[]> = {
        position: [...(d.principal?.positions ?? []), ...contributed('position')],
        permission: [...(d.principal?.permissionSets ?? []), ...contributed('permission_set')],
      };
      await Promise.all(
        CITED_ITEM_TYPES.map(async (type) => {
          if (!cited[type].some((name) => !itemLabels[type][name])) return;
          try {
            const rows = (await client.list<unknown>(type)) as unknown[];
            const found: Record<string, string> = {};
            for (const row of rows ?? []) {
              const item = ((row as { item?: unknown } | null)?.item ?? row) as { name?: unknown; label?: unknown } | null;
              if (typeof item?.name !== 'string' || typeof item.label !== 'string' || !item.label.trim()) continue;
              found[item.name] = item.label;
            }
            if (Object.keys(found).length > 0) {
              setItemLabels((prev) => ({ ...prev, [type]: { ...prev[type], ...found } }));
            }
          } catch {
            /* the name stays the text — the chip's reading before objectui#12693 */
          }
        }),
      );
    },
    [client, itemLabels],
  );

  const run = React.useCallback(async () => {
    const object = objectName.trim();
    if (!object) return;
    setBusy(true);
    setError(null);
    setDecision(null);
    try {
      // Split SPA + backend dev: promote `/api/...` to the backend origin so
      // the request (and its auth cookie) reaches :3000 — same convention as
      // MetadataTypeActions.
      const apiBase = ((import.meta as { env?: Record<string, string> }).env?.VITE_SERVER_URL || '').replace(/\/+$/, '');
      const res = await authFetch(`${apiBase}/api/v1/security/explain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          object,
          operation,
          ...(user ? { userId: user.id } : {}),
          // [C2 / ADR-0095] Record-grained explain — the row-level story for one
          // concrete record. Omitted → object-level (unchanged) request.
          ...(recordId.trim() ? { recordId: recordId.trim() } : {}),
        }),
      });
      let data: Record<string, unknown> | null = null;
      try {
        data = (await res.json()) as Record<string, unknown>;
      } catch {
        /* non-JSON body — fall through to the status check */
      }
      if (res.status === 403) {
        setError(t('engine.studio.access.explain.forbidden', locale));
        return;
      }
      if (!res.ok) {
        const detail =
          (data?.message as string) || (data?.error as string) || `HTTP ${res.status} ${res.statusText}`.trim();
        setError(detail);
        return;
      }
      const decided = data as unknown as ExplainDecision;
      setDecision(decided);
      void lookUpPeople(decided);
      void lookUpItemLabels(decided);
    } catch (err) {
      setError((err as Error)?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }, [authFetch, objectName, operation, user, recordId, locale, lookUpPeople, lookUpItemLabels]);

  // objectui#12693 — the banner names the object by the label the object
  // picker above already holds for it; an object the list does not carry, or
  // one with no label, reads as its name.
  const objectLabelOf = (name: string): string => {
    const label = objectOptions?.find((o) => o.name === name)?.label;
    return typeof label === 'string' && label.trim() ? label : name;
  };

  const opLabel = (op: string) => t(`engine.studio.access.explain.op.${op}`, locale);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <ShieldQuestion className="h-4 w-4" /> {t('engine.studio.access.explain.title', locale)}
          </SheetTitle>
          <SheetDescription>{t('engine.studio.access.explain.description', locale)}</SheetDescription>
        </SheetHeader>

        {/* ── request form ── */}
        <div className="mt-4 space-y-3 text-sm">
          <div className="space-y-1">
            <label id={userLabelId} className="text-xs font-medium text-muted-foreground">
              {t('engine.studio.access.explain.user', locale)}
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                aria-labelledby={`${userLabelId} ${userValueId}`}
                className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border bg-background px-2 text-left text-xs hover:bg-muted/60"
              >
                <UserIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span id={userValueId} className="min-w-0 flex-1 truncate">
                  {user ? user.label : t('engine.studio.access.explain.self', locale)}
                </span>
                {/* objectui#2381 — the picker was here all along but the button
                    read as static text; the chevron makes "pick another user"
                    discoverable. */}
                <ChevronsUpDown className="h-3 w-3 shrink-0 text-muted-foreground/70" />
              </button>
              {user && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 shrink-0 p-0 text-muted-foreground"
                  onClick={() => setUser(null)}
                  aria-label={t('engine.studio.access.explain.clearUser', locale)}
                  title={t('engine.studio.access.explain.clearUser', locale)}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          <div className="flex gap-2">
            <div className="min-w-0 flex-1 space-y-1">
              <label htmlFor="explain-object" className="text-xs font-medium text-muted-foreground">
                {t('engine.studio.access.explain.object', locale)}
              </label>
              {objectOptions && objectOptions.length > 0 ? (
                // objectui#2600 B2 — package-scoped dropdown: the object must be
                // one of this package's ~20 objects, so free-text (with an
                // example that isn't even in the package) only invites typos.
                // objectui#11865 — the shared Select (ExplainPicker), not a
                // native <select>.
                <ExplainPicker
                  id="explain-object"
                  className={PICKER_CLASS}
                  value={objectName}
                  onPick={setObjectName}
                  options={[
                    { value: '', label: t('engine.studio.access.explain.objectSelect', locale) },
                    ...objectOptions.map((o) => ({
                      value: o.name,
                      label: o.label && o.label !== o.name ? `${o.label} (${o.name})` : o.name,
                    })),
                  ]}
                />
              ) : (
                <Input
                  id="explain-object"
                  value={objectName}
                  onChange={(e) => setObjectName(e.target.value)}
                  placeholder={t('engine.studio.access.explain.objectPlaceholder', locale)}
                  className="h-8 text-xs"
                />
              )}
            </div>
            <div className="w-32 shrink-0 space-y-1">
              <label htmlFor="explain-operation" className="text-xs font-medium text-muted-foreground">
                {t('engine.studio.access.explain.operation', locale)}
              </label>
              <ExplainPicker
                id="explain-operation"
                className={PICKER_CLASS}
                value={operation}
                onPick={(picked) => {
                  const op = OPERATIONS.find((o) => o === picked);
                  if (op) setOperation(op);
                }}
                options={OPERATIONS.map((op) => ({ value: op, label: opLabel(op) }))}
              />
            </div>
          </div>

          {/* [C2 / ADR-0095] optional record selector — explains one concrete row */}
          <div className="space-y-1">
            <label htmlFor="explain-record" className="text-xs font-medium text-muted-foreground">
              {t('engine.studio.access.explain.record', locale)}
            </label>
            <div className="flex items-center gap-2">
              <Input
                id="explain-record"
                value={recordId}
                onChange={(e) => setRecordId(e.target.value)}
                placeholder={t('engine.studio.access.explain.recordPlaceholder', locale)}
                className="h-8 min-w-0 flex-1 text-xs"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 shrink-0 gap-1 text-xs"
                disabled={!objectName.trim()}
                onClick={() => setRecordPickerOpen(true)}
                title={t('engine.studio.access.explain.pickRecord', locale)}
              >
                <ChevronsUpDown className="h-3 w-3" />
                {t('engine.studio.access.explain.pickRecord', locale)}
              </Button>
              {recordId && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 shrink-0 p-0 text-muted-foreground"
                  onClick={() => setRecordId('')}
                  aria-label={t('engine.studio.access.explain.clearRecord', locale)}
                  title={t('engine.studio.access.explain.clearRecord', locale)}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          <Button size="sm" className="h-8 gap-1.5 text-xs" disabled={busy || !objectName.trim()} onClick={() => void run()}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <HelpCircle className="h-3.5 w-3.5" />}
            {busy ? t('engine.studio.access.explain.running', locale) : t('engine.studio.access.explain.run', locale)}
          </Button>
        </div>

        {/* ── result ── */}
        <div className="mt-5 space-y-4 text-sm">
          {error && !busy && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                <span className="font-medium">{t('engine.studio.access.explain.failed', locale)}</span> — {error}
              </span>
            </div>
          )}

          {!decision && !error && !busy && (
            <p className="text-xs text-muted-foreground">{t('engine.studio.access.explain.empty', locale)}</p>
          )}

          {decision && !busy && (
            <>
              {/* verdict banner */}
              <div
                data-testid="explain-verdict"
                className={
                  decision.allowed
                    ? 'flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-emerald-700 dark:text-emerald-400'
                    : 'flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-destructive'
                }
              >
                {decision.allowed ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}
                <span className="text-xs font-medium">
                  {tFormat(
                    decision.allowed ? 'engine.studio.access.explain.allowedLine' : 'engine.studio.access.explain.deniedLine',
                    locale,
                    { operation: opLabel(decision.operation), object: objectLabelOf(decision.object) },
                  )}
                </span>
              </div>

              {/* [C2] record-level verdict — why THIS record is (in)visible */}
              {decision.record && (
                <div
                  data-testid="explain-record-verdict"
                  className={
                    decision.record.visible
                      ? 'flex items-start gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-emerald-700 dark:text-emerald-400'
                      : 'flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-destructive'
                  }
                >
                  {decision.record.visible ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
                  <div className="min-w-0 text-xs">
                    <div className="font-medium">
                      {tFormat(
                        decision.record.visible
                          ? 'engine.studio.access.explain.recordVisibleLine'
                          : 'engine.studio.access.explain.recordHiddenLine',
                        locale,
                        { recordId: decision.record.recordId },
                      )}
                    </div>
                    {decision.record.decidedBy && (
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        {t('engine.studio.access.explain.decidedBy', locale)}:{' '}
                        <span className="font-medium text-foreground">
                          {t(`engine.studio.access.explain.layer.${decision.record.decidedBy}`, locale)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* principal: position → permission-set chain */}
              <div className="rounded-md border bg-muted/30 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-medium text-muted-foreground">
                    {t('engine.studio.access.explain.principal', locale)}
                  </p>
                  {decision.principal.posture && (
                    <Badge
                      variant="outline"
                      data-testid="explain-posture"
                      className="px-1.5 py-0 text-[10px] font-medium"
                      title={t('engine.studio.access.explain.postureHint', locale)}
                    >
                      {t(`engine.studio.access.explain.posture.${decision.principal.posture}`, locale)}
                    </Badge>
                  )}
                </div>
                {/* objectui#11862 — each user id names its person: the name
                    and email first, the id as secondary text. */}
                <div className="mt-1 flex min-w-0 items-start gap-1.5 text-xs" data-testid="explain-principal">
                  {decision.principal.userId ? (
                    <PrincipalPerson id={decision.principal.userId} person={people[decision.principal.userId]} />
                  ) : (
                    <span className="font-mono text-foreground">(anonymous)</span>
                  )}
                  {decision.principal.onBehalfOf?.userId ? (
                    <>
                      <span className="shrink-0 text-muted-foreground">⇄</span>
                      <PrincipalPerson
                        id={decision.principal.onBehalfOf.userId}
                        person={people[decision.principal.onBehalfOf.userId]}
                      />
                    </>
                  ) : null}
                </div>
                <div className="mt-2 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="text-[11px] text-muted-foreground">
                      {t('engine.studio.access.explain.positions', locale)}:
                    </span>
                    {(decision.principal.positions ?? []).map((p) => (
                      <CitedItemChip key={p} name={p} label={itemLabels.position[p]} variant="outline" />
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="text-[11px] text-muted-foreground">
                      {t('engine.studio.access.explain.permissionSets', locale)}:
                    </span>
                    {(decision.principal.permissionSets ?? []).map((p) => (
                      <CitedItemChip key={p} name={p} label={itemLabels.permission[p]} variant="secondary" />
                    ))}
                  </div>
                </div>
              </div>

              {/* the nine pipeline layers */}
              <div>
                <p className="mb-2 text-[11px] font-medium text-muted-foreground">
                  {t('engine.studio.access.explain.layers', locale)}
                </p>
                <ol className="space-y-2">
                  {decision.layers.map((l) => (
                    <li key={l.layer} className="rounded-md border p-2.5" data-testid={`explain-layer-${l.layer}`}>
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-xs font-medium">
                          {t(`engine.studio.access.explain.layer.${l.layer}`, locale)}
                        </span>
                        <span
                          className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] leading-none ${VERDICT_BADGE[l.verdict] ?? VERDICT_BADGE.neutral}`}
                        >
                          {t(`engine.studio.access.explain.verdict.${l.verdict}`, locale)}
                        </span>
                        {l.kernelTier && (
                          <span
                            className="shrink-0 rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[9px] uppercase leading-none text-muted-foreground"
                            title={t('engine.studio.access.explain.kernelTierHint', locale)}
                          >
                            {t(`engine.studio.access.explain.kernelTier.${l.kernelTier}`, locale)}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{l.detail}</p>
                      {(l.contributors ?? []).length > 0 && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1">
                          <span className="text-[10px] text-muted-foreground/70">
                            {t('engine.studio.access.explain.contributors', locale)}:
                          </span>
                          {(l.contributors ?? []).map((c, i) => (
                            <CitedItemChip
                              key={`${c.kind}:${c.name}:${i}`}
                              name={c.name}
                              label={
                                c.kind === 'position'
                                  ? itemLabels.position[c.name]
                                  : c.kind === 'permission_set'
                                    ? itemLabels.permission[c.name]
                                    : undefined
                              }
                              variant={c.kind === 'position' ? 'outline' : 'secondary'}
                              detail={c.via ? `${c.kind} · via ${c.via}` : c.kind}
                            />
                          ))}
                        </div>
                      )}

                      {/* [C2 / ADR-0095] per-record row story: outcome, concrete
                          rules (permission set → position → share → row rule),
                          and the effective row filter for this record. */}
                      {l.record && (
                        <div
                          className="mt-2 space-y-1.5 rounded border border-dashed border-border/70 bg-muted/20 p-2"
                          data-testid={`explain-record-${l.layer}`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-medium uppercase text-muted-foreground/70">
                              {t('engine.studio.access.explain.recordOutcome', locale)}
                            </span>
                            <span
                              className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] leading-none ${OUTCOME_BADGE[l.record.outcome] ?? OUTCOME_BADGE.not_evaluated}`}
                            >
                              {t(`engine.studio.access.explain.outcome.${l.record.outcome}`, locale)}
                            </span>
                            {l.record.matchesRecord != null && (
                              <span className="text-[10px] text-muted-foreground/70">
                                {t(
                                  l.record.matchesRecord
                                    ? 'engine.studio.access.explain.matches'
                                    : 'engine.studio.access.explain.noMatch',
                                  locale,
                                )}
                              </span>
                            )}
                          </div>
                          {l.record.detail && (
                            <p className="text-[11px] leading-relaxed text-muted-foreground">{l.record.detail}</p>
                          )}
                          {(l.record.rules ?? []).length > 0 && (
                            <ul className="space-y-1">
                              {(l.record.rules ?? []).map((r, i) => (
                                <li key={`${r.kind}:${r.name}:${i}`} className="flex items-center gap-1.5 text-[11px]">
                                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${EFFECT_DOT[r.effect] ?? EFFECT_DOT.neutral}`} title={r.effect} />
                                  <span className="font-medium text-foreground">
                                    {t(`engine.studio.access.explain.ruleKind.${r.kind}`, locale)}
                                  </span>
                                  <span className="min-w-0 truncate text-muted-foreground" title={r.name}>{r.name}</span>
                                  {r.grants && (
                                    <Badge variant="secondary" className="px-1 py-0 text-[9px] font-normal">{r.grants}</Badge>
                                  )}
                                  {r.via && <span className="min-w-0 truncate text-[10px] text-muted-foreground/70">· {r.via}</span>}
                                </li>
                              ))}
                            </ul>
                          )}
                          {l.record.rowFilter !== undefined && (
                            <div>
                              <p className="text-[10px] font-medium text-muted-foreground/70">
                                {t('engine.studio.access.explain.effectiveRowFilter', locale)}
                              </p>
                              <pre className="mt-0.5 overflow-x-auto rounded border bg-background/60 p-1.5 font-mono text-[10px] leading-snug">
                                {JSON.stringify(l.record.rowFilter, null, 2)}
                              </pre>
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              </div>

              {/* machine artifact — the composed read filter */}
              {decision.operation === 'read' && decision.readFilter !== undefined && (
                <div>
                  <p className="mb-1 text-[11px] font-medium text-muted-foreground">
                    {t('engine.studio.access.explain.readFilter', locale)}
                  </p>
                  <pre className="overflow-x-auto rounded-md border bg-muted/30 p-2 font-mono text-[11px] leading-snug">
                    {JSON.stringify(decision.readFilter, null, 2)}
                  </pre>
                </div>
              )}
            </>
          )}
        </div>

        <RecordPickerDialog
          open={pickerOpen}
          onOpenChange={(o: boolean) => setPickerOpen(o)}
          dataSource={adapter}
          objectName="sys_user"
          title={t('engine.studio.access.explain.pickUserTitle', locale)}
          onSelect={() => {}}
          onSelectRecords={(records: any[]) => {
            const u = records?.[0];
            if (u?.id != null) {
              setUser({ id: String(u.id), label: personLabel(u) });
              // objectui#11862 — the picked row names its person on the
              // principal line, with no second lookup.
              const person = personOf(u);
              if (person.name || person.email) setPeople((prev) => ({ ...prev, [String(u.id)]: person }));
            }
            setPickerOpen(false);
          }}
        />

        {/* [C2 / ADR-0095] record picker — bound to the object under explanation */}
        {objectName.trim() && (
          <RecordPickerDialog
            open={recordPickerOpen}
            onOpenChange={(o: boolean) => setRecordPickerOpen(o)}
            dataSource={adapter}
            objectName={objectName.trim()}
            title={t('engine.studio.access.explain.pickRecordTitle', locale)}
            onSelect={() => {}}
            onSelectRecords={(records: any[]) => {
              const r = records?.[0];
              if (r?.id != null) setRecordId(String(r.id));
              setRecordPickerOpen(false);
            }}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

export default AccessExplainPanel;
