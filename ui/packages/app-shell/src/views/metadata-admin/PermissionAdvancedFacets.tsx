/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import {
  Input,
  Label,
  Switch,
  Button,
  Badge,
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
} from '@object-ui/components';
import { ChevronRight, Plus, Trash2, Shield, Lock, PanelTop, FlaskConical } from 'lucide-react';
import { CelPredicateField } from './CelPredicateField.js';
import { CelTestRunDialog } from './CelTestRunDialog.js';
import type { CelLintIssue } from './celAuthoring.js';
import type {
  AdminScope as SpecAdminScope,
  RowLevelSecurityPolicy as SpecRlsPolicy,
} from '@objectstack/spec/security';

/**
 * Structured editors for the three "advanced" permission facets — Row-Level
 * Security, Tab Visibility, and Delegated Admin Scope — on the Studio /
 * env-scope permission matrix (ADR-0056 P3 / epic #2398).
 *
 * These facets were authorable ONLY as raw JSON in Setup. They are designed
 * here via structured editors. Each editor reads/writes the draft's
 * parsed camelCase field (`rowLevelSecurity` / `tabPermissions` / `adminScope`)
 * — tolerating a JSON string on load so legacy rows survive — and is persisted
 * by the editor's existing whole-record Save. The shapes below are the subset
 * of the framework spec this editor authors, checked against the spec schemas
 * rather than sampled from live data (objectstack#7130): RLS policies
 * `{name,object,operation,using,check,enabled}`; admin scope
 * `{businessUnit,includeSubtree,manageAssignments,assignablePermissionSets[]}`.
 */

/**
 * One RLS policy as this editor holds it.
 *
 * `label` / `description` are DRAWN, not authored, here (objectui#11199): each
 * policy card heads its inputs with the author's label and, beneath it, the
 * description, verbatim; a policy that declares neither renders exactly as
 * before. Their types are taken from the spec's `RowLevelSecurityPolicy`
 * (plain optional strings, not I18nLabel) rather than restated. No write path
 * here names them; every write spreads the policy (`{ ...pol, name }`), so an
 * edit carries both keys back out untouched.
 */
interface RlsPolicy extends Pick<SpecRlsPolicy, 'label' | 'description'> {
  name?: string;
  object?: string;
  operation?: string;
  using?: string;
  check?: string;
  enabled?: boolean;
}

/**
 * Keys this editor must never author onto an RLS policy, because the framework
 * spec REJECTS them at parse time.
 *
 * `rowLevelSecurity[].priority` was removed in `@objectstack/spec` 17.0.0
 * (objectstack#3896) and left as a `retiredKey` tombstone
 * (`packages/spec/src/security/rls.zod.ts`): an authored value is refused with
 * the upgrade prescription rather than ignored. Applicable policies OR-combine
 * (most permissive wins), so the "conflict resolution" it promised cannot
 * exist and there is nothing to preserve.
 *
 * Until objectstack#7130 this editor seeded `priority: 0` on every policy its
 * Add button created, so drafts it wrote can still carry the key. `policies`
 * below is the single value every write path spreads from, so stripping on
 * load — not a data migration — is what makes an edit-and-save round-trip of
 * such a policy come out parseable.
 */
const RETIRED_RLS_KEYS = ['priority'] as const;

/** Drop {@link RETIRED_RLS_KEYS} from a policy read out of the draft. */
function stripRetiredRlsKeys(policy: RlsPolicy): RlsPolicy {
  if (!policy || typeof policy !== 'object') return policy;
  const present = RETIRED_RLS_KEYS.filter((k) => k in policy);
  if (present.length === 0) return policy;
  const next: Record<string, unknown> = { ...policy };
  for (const k of present) delete next[k];
  return next as RlsPolicy;
}

/**
 * The delegated-admin scope AS THIS EDITOR HOLDS IT MID-EDIT.
 *
 * The keys are `@objectstack/spec/security`'s `AdminScope` — the AUTHORING
 * side (`z.input`), which is what this editor writes — and they are TAKEN from
 * it rather than restated (objectui#7265). The header above already said these
 * shapes were "checked against the spec schemas"; a hand-written copy can only
 * have been checked ONCE, and this one had already drifted in requiredness.
 *
 * `Partial<>` is the single deliberate divergence and it is the draft-buffer
 * one: the spec REQUIRES `businessUnit`, while this editor materializes the
 * facet from `asObject(draft.adminScope)` — `{}` before the author has typed
 * anything — and every field below reads through a fallback (`?? ''`, `!!`)
 * because a half-filled facet is the normal mid-edit state. Pinned in
 * `spec-symbol-parity.test.ts`, both halves: the spec still requires
 * `businessUnit` (so the widening is real and load-bearing) and no key here is
 * invented (so the widening stays confined to requiredness).
 *
 * ⚠️ Requiredness is the ONLY thing relaxed. A draft that reaches Save still has
 * to satisfy the server's `AdminScopeSchema`, which this type does not promise.
 *
 * `manageBindings` and `authorEnvironmentSets` are retired tombstones in the
 * spec (objectstack#23488): still keys of the type, typed so that no value can
 * be written to them, and refused at parse whatever they hold. This editor
 * draws no control for either and writes each live key by name, so the
 * tombstone's type is what refuses a write of either here. It strips neither
 * from a loaded scope: the server serves stored and draft rows through the
 * spec's stored-row conversion `permission-admin-scope-binding-authoring-removed`,
 * which drops both before a body reaches this editor; the spec's retirement
 * test pins that strip in its case "a STORED `permission` row carrying both
 * keys replays clean through the rehydration seam" (objectui#12406).
 */
type AdminScope = Partial<SpecAdminScope>;

type TabVisibility = 'visible' | 'hidden' | 'default_on' | 'default_off';
type TabPerms = Record<string, TabVisibility>;

const RLS_OPERATIONS = ['all', 'select', 'insert', 'update', 'delete'] as const;
const TAB_VISIBILITIES: TabVisibility[] = ['visible', 'hidden', 'default_on', 'default_off'];

/** Tolerantly coerce a facet value (parsed value or JSON string) to an array. */
function asArray<T = unknown>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  if (typeof v === 'string' && v.trim()) {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? (p as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * objectui#13113 — whether a policy as the draft holds it has a name at all
 * (blank counts as none). "Add policy" inserts a row without one: it is
 * INCOMPLETE, not wrong, so the row says beside itself what it needs, and the
 * host's autosave holds while any row is in that state (`rlsUnnamedCount` in
 * `PermissionMatrixEditor`, the same emptiness test). ⛔ The spec's name format
 * is not restated here: a non-empty name the server refuses is sent, and the
 * host renders that refusal in the author's words (objectui#7715's rule).
 */
function policyNamed(policy: RlsPolicy | null | undefined): boolean {
  return typeof policy?.name === 'string' && policy.name.trim() !== '';
}

/** Tolerantly coerce a facet value (parsed value or JSON string) to an object. */
function asObject<T extends object = Record<string, unknown>>(v: unknown): T {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as T;
  if (typeof v === 'string' && v.trim()) {
    try {
      const p = JSON.parse(v);
      if (p && typeof p === 'object' && !Array.isArray(p)) return p as T;
    } catch {
      /* fall through */
    }
  }
  return {} as T;
}

/** The item a stored value none of a picker's options carries is shown by. */
const OUTSIDE_OPTIONS = 'outside';

/**
 * objectui#11865 — an RLS policy's operation, or a tab's visibility, drawn with
 * the shared `Select`, the control Studio's object settings dials
 * (`SettingsPicker`) pick with. They used to be browser-native `<select>`s.
 * What a pick writes is unchanged: `onPick` receives the picked option's own
 * `value`, the string the native control's `change` carried, and each caller
 * turns it into the same draft update as before. Re-picking the current option
 * writes nothing, as it did there.
 *
 * - Items carry their option's INDEX, not its value, so a stored value that
 *   none of the options carries gets an item of its own, labelled with the
 *   value, even when that value is `''`, which `SelectItem` refuses. The
 *   trigger shows what the draft holds; the native control showed its first
 *   option there. Picking that item writes nothing.
 * - Read-only follows the primitive (objectui#11781): `disabled` disables the
 *   trigger, which wears `SelectTrigger`'s own disabled look.
 * - The native controls had no label, so the triggers have no name either.
 */
function FacetPicker({
  value,
  options,
  onPick,
  disabled,
  testId,
}: {
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onPick: (value: string) => void;
  disabled: boolean;
  testId: string;
}) {
  const at = options.findIndex((o) => o.value === value);
  return (
    <Select
      value={at !== -1 ? String(at) : OUTSIDE_OPTIONS}
      onValueChange={(token) => {
        // `undefined` for the outside item: it is the stored value, so there is nothing to write.
        const picked = options[Number(token)];
        if (picked) onPick(picked.value);
      }}
      disabled={disabled}
    >
      <SelectTrigger data-testid={testId} className="h-8 w-auto gap-2 px-2 text-sm">
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

const RLS_OPERATION_OPTIONS = RLS_OPERATIONS.map((op) => ({ value: op, label: op }));

interface FacetSectionProps {
  title: string;
  icon: React.ReactNode;
  count?: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
  /**
   * objectui#12456 — the section is a tab body of the Studio Access pillar:
   * no collapsible trigger (the tab names it), the editor always open, and
   * `shown` false hides it while it stays mounted.
   */
  flat?: { shown: boolean; testId: string };
}

/** A collapsible facet section so the three editors don't crowd the matrix. */
function FacetSection({ title, icon, count, children, defaultOpen, flat }: FacetSectionProps) {
  const [open, setOpen] = React.useState(!!defaultOpen);
  if (flat) {
    return (
      <section aria-label={title} hidden={!flat.shown} data-testid={flat.testId} className="px-6 py-4">
        {children}
      </section>
    );
  }
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-b">
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-6 py-2.5 text-left hover:bg-muted/40">
        <ChevronRight
          className={cn('h-4 w-4 text-muted-foreground transition-transform', open && 'rotate-90')}
        />
        {icon}
        <span className="text-sm font-medium">{title}</span>
        {count != null && count > 0 && (
          <Badge variant="secondary" className="text-[10px]">
            {count}
          </Badge>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="px-6 pb-4 pt-1">{children}</CollapsibleContent>
    </Collapsible>
  );
}

export interface PermissionAdvancedFacetsProps {
  draft: Record<string, unknown> & {
    rowLevelSecurity?: unknown;
    tabPermissions?: unknown;
    adminScope?: unknown;
  };
  setDraft: (updater: (prev: any) => any) => void;
  writable: boolean;
  /** All permission-set api-names — for the admin-scope assignable allowlist. */
  allSetNames: string[];
  /**
   * Resolve a policy object's field names — powers CEL field lint + autocomplete
   * (objectui#2413). Absent => no field hints (autocomplete still offers scope
   * vars + functions; lint still catches parse errors).
   */
  loadObjectFields?: (object: string) => Promise<string[]>;
  /**
   * Reports the count of blocking CEL parse errors across all policies so the
   * host editor can gate Save. Fires whenever the aggregate changes.
   */
  onCelErrorsChange?: (count: number) => void;
  t: (k: string) => string;
  /**
   * objectui#12456 — the Studio Access pillar shows each facet as its own tab.
   * When set, the three sections render flat (no collapsible trigger) and only
   * the named one is shown; `null` hides all three. The other two stay
   * MOUNTED, so the CEL lint of a policy keeps reporting to the host's Save
   * gate while its tab is not the open one. Omitted: the stacked collapsibles.
   */
  only?: 'rls' | 'tabs' | 'admin' | null;
}

export function PermissionAdvancedFacets({
  draft,
  setDraft,
  writable,
  allSetNames,
  loadObjectFields,
  onCelErrorsChange,
  t,
  only,
}: PermissionAdvancedFacetsProps) {
  const flatFor = (section: 'rls' | 'tabs' | 'admin') =>
    only === undefined ? undefined : { shown: only === section, testId: `perm-facet-${section}` };
  const policies = React.useMemo<RlsPolicy[]>(
    () => asArray<RlsPolicy>(draft.rowLevelSecurity).map(stripRetiredRlsKeys),
    [draft.rowLevelSecurity],
  );
  const scope = React.useMemo<AdminScope>(() => asObject(draft.adminScope), [draft.adminScope]);
  const tabs = React.useMemo<TabPerms>(() => asObject(draft.tabPermissions), [draft.tabPermissions]);

  /* ── CEL authoring safety (objectui#2413) ───────────────────────────── */

  // Lazily-resolved field names per policy object, for lint + autocomplete.
  const [fieldsByObject, setFieldsByObject] = React.useState<Record<string, string[]>>({});
  const requestedRef = React.useRef<Set<string>>(new Set());
  const ensureFields = React.useCallback(
    (object?: string) => {
      const key = (object ?? '').trim();
      // `*` (all objects) and blank have no single field set to offer.
      if (!key || key === '*' || !loadObjectFields) return;
      if (requestedRef.current.has(key)) return;
      requestedRef.current.add(key);
      loadObjectFields(key)
        .then((names) => setFieldsByObject((prev) => ({ ...prev, [key]: names })))
        .catch(() => setFieldsByObject((prev) => ({ ...prev, [key]: [] })));
    },
    [loadObjectFields],
  );
  const fieldsFor = (object?: string): string[] => fieldsByObject[(object ?? '').trim()] ?? [];

  // Per-clause blocking-error counts, keyed `"<index>:<clause>"`, summed up to
  // the host so Save can be gated on malformed CEL.
  const [errorMap, setErrorMap] = React.useState<Record<string, number>>({});
  const reportClause = React.useCallback((key: string, issues: CelLintIssue[]) => {
    const errs = issues.filter((x) => x.severity === 'error').length;
    setErrorMap((prev) => (prev[key] === errs ? prev : { ...prev, [key]: errs }));
  }, []);

  // Which policy's test-run dialog is open (`null` = closed).
  const [testIndex, setTestIndex] = React.useState<number | null>(null);

  // Load fields for every policy object; prune stale error entries when the
  // policy list shrinks so a deleted policy's error can't wedge Save closed.
  React.useEffect(() => {
    policies.forEach((p) => ensureFields(p.object));
    setErrorMap((prev) => {
      const valid = new Set<string>();
      policies.forEach((_, i) => {
        valid.add(`${i}:using`);
        valid.add(`${i}:check`);
      });
      let changed = false;
      const next: Record<string, number> = {};
      for (const k of Object.keys(prev)) {
        if (valid.has(k)) next[k] = prev[k];
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [policies, ensureFields]);

  const totalCelErrors = React.useMemo(
    () => Object.values(errorMap).reduce((a, b) => a + b, 0),
    [errorMap],
  );
  const onCelErrorsChangeRef = React.useRef(onCelErrorsChange);
  React.useEffect(() => {
    onCelErrorsChangeRef.current = onCelErrorsChange;
  });
  React.useEffect(() => {
    onCelErrorsChangeRef.current?.(totalCelErrors);
  }, [totalCelErrors]);

  const testPolicy = testIndex != null ? policies[testIndex] : undefined;

  const setPolicies = (next: RlsPolicy[]) =>
    setDraft((p) => ({ ...p, rowLevelSecurity: next }));
  const setScope = (patch: Partial<AdminScope>) =>
    setDraft((p) => ({ ...p, adminScope: { ...asObject(p.adminScope), ...patch } }));

  /**
   * Delegated admin scope: the boundary has to exist before anything can be
   * scoped to it (objectui#9464).
   *
   * `businessUnit` is the ONE key `AdminScopeSchema` requires — the other live
   * keys carry defaults — so a scope written before one is named is an object the
   * framework refuses WHOLESALE, and what it blocks is the author's next
   * whole-record Save, not just this section. Every DEPENDENT control therefore
   * writes through `setScopeDetail` instead of `setScope`, and carries the same
   * `disabled` condition, so the refusal is a visible affordance rather than a
   * dead click. The business-unit input itself keeps the ungated `setScope` —
   * it is what lifts the gate.
   *
   * ⚠️ This gates the WRITE; it never prunes. A scope that already carries
   * flipped switches keeps every one of them: a permission editor that quietly
   * un-does an author's input is a worse defect than the one this closes.
   *
   * The gate is the affordance's own precondition — a business unit that NAMES
   * something — which is strictly narrower than the spec's requirement that the
   * key merely be present. `scopeBlocksSave` below tracks the spec's condition
   * instead, because that is the one that actually refuses the record.
   */
  const scopeAnchored = typeof scope.businessUnit === 'string' && scope.businessUnit.trim() !== '';
  const setScopeDetail = (patch: Partial<AdminScope>) => {
    if (!scopeAnchored) return;
    setScope(patch);
  };

  /**
   * Whether the section carries any state at all — the collapsed badge's count.
   *
   * It used to count `businessUnit` / `assignablePermissionSets` only, so a
   * draft carrying `{ includeSubtree: true }` — already blocking Save — showed
   * no badge, pointing the author AWAY from the section that caused it. A
   * section carrying state may never report that it carries none.
   */
  const scopeConfigured = Object.keys(scope).length > 0;
  /** The spec's own condition: keys present, `businessUnit` absent ⇒ refused. */
  const scopeBlocksSave = scopeConfigured && typeof scope.businessUnit !== 'string';
  const setTabs = (next: TabPerms) => setDraft((p) => ({ ...p, tabPermissions: next }));

  const tabEntries = Object.entries(tabs);

  return (
    <div className={only === undefined ? 'border-b bg-muted/10' : undefined}>
      {/* Row-Level Security */}
      <FacetSection
        flat={flatFor('rls')}
        title={t('perm.rls.title')}
        icon={<Lock className="h-4 w-4 text-muted-foreground" />}
        count={policies.length}
      >
        <p className="text-xs text-muted-foreground mb-3">{t('perm.rls.help')}</p>
        <div className="space-y-3">
          {policies.map((pol, i) => (
            <div key={i} className="rounded-md border p-3 space-y-2 bg-background">
              {(pol.label || pol.description) && (
                <div className="space-y-0.5">
                  {pol.label && <div className="text-sm font-medium">{pol.label}</div>}
                  {pol.description && (
                    <p className="text-xs text-muted-foreground">{pol.description}</p>
                  )}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={pol.name ?? ''}
                  disabled={!writable}
                  placeholder={t('perm.rls.name')}
                  onChange={(e) => {
                    const next = [...policies];
                    next[i] = { ...pol, name: e.target.value };
                    setPolicies(next);
                  }}
                  className="h-8 w-48"
                />
                <Input
                  value={pol.object ?? ''}
                  disabled={!writable}
                  placeholder={t('perm.rls.object')}
                  onChange={(e) => {
                    const next = [...policies];
                    next[i] = { ...pol, object: e.target.value };
                    setPolicies(next);
                  }}
                  className="h-8 w-40"
                />
                <FacetPicker
                  testId={`rls-operation-${i}`}
                  value={pol.operation ?? 'all'}
                  disabled={!writable}
                  onPick={(v) => {
                    const next = [...policies];
                    next[i] = { ...pol, operation: v };
                    setPolicies(next);
                  }}
                  options={RLS_OPERATION_OPTIONS}
                />
                <label className="flex items-center gap-1.5 text-xs">
                  <Switch
                    checked={pol.enabled !== false}
                    disabled={!writable}
                    onCheckedChange={(v) => {
                      const next = [...policies];
                      next[i] = { ...pol, enabled: !!v };
                      setPolicies(next);
                    }}
                  />
                  {t('perm.rls.enabled')}
                </label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 ml-auto text-xs text-muted-foreground"
                  onClick={() => setTestIndex(i)}
                  title={t('perm.cel.test.title')}
                >
                  <FlaskConical className="h-3.5 w-3.5 mr-1" />
                  {t('perm.cel.test.run')}
                </Button>
                {writable && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => setPolicies(policies.filter((_, j) => j !== i))}
                    aria-label={t('perm.rls.remove')}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
              {/* objectui#13113 — an unnamed row is held unsent; say what it needs. */}
              {writable && !policyNamed(pol) && (
                <p className="text-xs text-muted-foreground" data-testid={`rls-name-needed-${i}`}>
                  {t('perm.rls.nameNeeded')}
                </p>
              )}
              <div className="grid gap-2 sm:grid-cols-2">
                <CelPredicateField
                  label={t('perm.rls.using')}
                  value={pol.using ?? ''}
                  disabled={!writable}
                  placeholder="organization_id == current_user.organization_id"
                  objectName={pol.object}
                  fieldNames={fieldsFor(pol.object)}
                  clause="using"
                  onLintChange={(issues) => reportClause(`${i}:using`, issues)}
                  onChange={(v) => {
                    const next = [...policies];
                    next[i] = { ...pol, using: v };
                    setPolicies(next);
                  }}
                  t={t}
                />
                <CelPredicateField
                  label={t('perm.rls.check')}
                  value={pol.check ?? ''}
                  disabled={!writable}
                  placeholder={t('perm.rls.checkPlaceholder')}
                  objectName={pol.object}
                  fieldNames={fieldsFor(pol.object)}
                  clause="check"
                  onLintChange={(issues) => reportClause(`${i}:check`, issues)}
                  onChange={(v) => {
                    const next = [...policies];
                    next[i] = { ...pol, check: v };
                    setPolicies(next);
                  }}
                  t={t}
                />
              </div>
            </div>
          ))}
          {policies.length === 0 && (
            <p className="text-xs text-muted-foreground italic">{t('perm.rls.empty')}</p>
          )}
          {writable && (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setPolicies([
                  ...policies,
                  { name: '', object: '*', operation: 'all', using: '', enabled: true },
                ])
              }
            >
              <Plus className="h-4 w-4 mr-1" /> {t('perm.rls.add')}
            </Button>
          )}
        </div>
      </FacetSection>

      {/* Dry-run a policy's USING/CHECK predicate against a sample record. */}
      <CelTestRunDialog
        open={testIndex != null}
        onOpenChange={(o) => setTestIndex(o ? testIndex : null)}
        policyName={testPolicy?.name || undefined}
        objectName={testPolicy?.object}
        fieldNames={fieldsFor(testPolicy?.object)}
        using={testPolicy?.using}
        check={testPolicy?.check}
        t={t}
      />

      {/* Tab Visibility */}
      <FacetSection
        flat={flatFor('tabs')}
        title={t('perm.tabs.title')}
        icon={<PanelTop className="h-4 w-4 text-muted-foreground" />}
        count={tabEntries.length}
      >
        <p className="text-xs text-muted-foreground mb-3">{t('perm.tabs.help')}</p>
        <div className="space-y-2">
          {tabEntries.map(([tab, vis]) => (
            <div key={tab} className="flex items-center gap-2">
              <Input
                value={tab}
                disabled={!writable}
                onChange={(e) => {
                  const nextKey = e.target.value;
                  const next: TabPerms = {};
                  for (const [k, v] of tabEntries) next[k === tab ? nextKey : k] = v;
                  setTabs(next);
                }}
                className="h-8 w-64"
              />
              <FacetPicker
                testId={`tab-visibility-${tab}`}
                value={vis}
                disabled={!writable}
                onPick={(v) => setTabs({ ...tabs, [tab]: v as TabVisibility })}
                options={TAB_VISIBILITIES.map((v) => ({ value: v, label: t(`perm.tabs.vis.${v}`) }))}
              />
              {writable && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  onClick={() => {
                    const next = { ...tabs };
                    delete next[tab];
                    setTabs(next);
                  }}
                  aria-label={t('perm.tabs.remove')}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
          {tabEntries.length === 0 && (
            <p className="text-xs text-muted-foreground italic">{t('perm.tabs.empty')}</p>
          )}
          {writable && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (tabs[''] !== undefined) return;
                setTabs({ ...tabs, '': 'visible' });
              }}
            >
              <Plus className="h-4 w-4 mr-1" /> {t('perm.tabs.add')}
            </Button>
          )}
        </div>
      </FacetSection>

      {/* Delegated Admin Scope */}
      <FacetSection
        flat={flatFor('admin')}
        title={t('perm.admin.title')}
        icon={<Shield className="h-4 w-4 text-muted-foreground" />}
        count={scopeConfigured ? 1 : 0}
      >
        <p className="text-xs text-muted-foreground mb-3">{t('perm.admin.help')}</p>
        <div className="space-y-3 max-w-2xl">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <Label className="text-xs">{t('perm.admin.businessUnit')}</Label>
              <Input
                value={scope.businessUnit ?? ''}
                disabled={!writable}
                onChange={(e) => setScope({ businessUnit: e.target.value })}
                className="h-8 w-64"
              />
            </div>
            <label className="flex items-center gap-1.5 text-xs pb-1.5">
              <Switch
                checked={!!scope.includeSubtree}
                disabled={!writable || !scopeAnchored}
                onCheckedChange={(v) => setScopeDetail({ includeSubtree: !!v })}
              />
              {t('perm.admin.includeSubtree')}
            </label>
          </div>
          {!scopeAnchored && (
            <p
              className={cn(
                'text-xs',
                scopeBlocksSave ? 'text-destructive' : 'text-muted-foreground',
              )}
            >
              {t('perm.admin.businessUnitRequired')}
            </p>
          )}
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <label className="flex items-center gap-1.5 text-xs">
              <Switch
                checked={!!scope.manageAssignments}
                disabled={!writable || !scopeAnchored}
                onCheckedChange={(v) => setScopeDetail({ manageAssignments: !!v })}
              />
              {t('perm.admin.manageAssignments')}
            </label>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">{t('perm.admin.assignableSets')}</Label>
            <div className="flex flex-wrap gap-1.5">
              {allSetNames.length === 0 && (
                <span className="text-xs text-muted-foreground">{t('perm.admin.noSets')}</span>
              )}
              {allSetNames.map((setName) => {
                const on = (scope.assignablePermissionSets ?? []).includes(setName);
                return (
                  <button
                    type="button"
                    key={setName}
                    disabled={!writable || !scopeAnchored}
                    aria-pressed={on}
                    onClick={() => {
                      const cur = scope.assignablePermissionSets ?? [];
                      const next = on ? cur.filter((s) => s !== setName) : [...cur, setName];
                      setScopeDetail({ assignablePermissionSets: next });
                    }}
                    className={cn(
                      'rounded-full border px-3 py-1 text-xs transition-colors disabled:opacity-50',
                      on
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-input bg-background hover:bg-accent',
                    )}
                  >
                    {setName}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </FacetSection>
    </div>
  );
}

export default PermissionAdvancedFacets;
