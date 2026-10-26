// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PermissionPreview — read-only heatmap of a Permission Set draft.
 *
 * Permission Sets get edited as deeply-nested JSON in the generic
 * form, which makes it nearly impossible to spot mistakes like
 * "Account: edit without read" or "this set has zero objects". The
 * preview renders the matrix that operators actually reason about:
 *
 *   1. Header strip: name, profile/permission-set flag, system perms
 *      count, tab perms count, RLS rule count.
 *   2. Object × CRUD-VAMA grid. Each row is one object; each column
 *      is one capability (Create/Read/Edit/Delete/Export/Transfer/
 *      ViewAll/ModifyAll). Cells are colored chips — green when
 *      granted, neutral when not, amber when "View All" or "Modify
 *      All" is on (highlighting the bypass).
 *   3. Field-level security: grouped by object, only fields with a
 *      non-default setting are listed (read=false or editable=true).
 *   4. Row-level security: each `rowLevelSecurity` policy by its `name`,
 *      with its `label` beside it and its `description` beneath it when
 *      authored (objectui#11027). Both keys are plain strings in the spec,
 *      so an unauthored one renders nothing rather than a stand-in.
 *   5. System permissions + Tab visibility as compact chip lists.
 *
 * Sanity-check banner at the bottom flags risky combinations:
 *   • allowEdit without allowRead (silently fails at runtime)
 *   • allowDelete without allowRead
 *   • modifyAllRecords without viewAllRecords
 */

import * as React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Eye,
  Layers,
  Lock,
  ShieldCheck,
  Star,
  Tag,
} from 'lucide-react';
import type { ObjectAccessScope, ObjectPermission, FieldPermission } from '@objectstack/spec/security';
import type { MetadataPreviewProps } from '../preview-registry.js';
import { t as tr, tFormat } from '../i18n.js';
import { PreviewShell, PreviewMessage, PreviewErrorBoundary } from './PreviewShell.js';

/**
 * Boolean capabilities, in matrix-column order.
 *
 * Typed against the spec's `ObjectPermission` so a capability the spec adds
 * cannot stay invisible here indefinitely — the hand-written copy this
 * replaced was missing `allowExport` outright, so a permission set granting
 * export rendered identically to one that did not (objectstack#4115).
 *
 * `short` is the column letter, the same in every locale (the legend spells
 * the letters out); `long` is the catalogue row of the column's tooltip, read
 * in the preview's locale (objectui#10862).
 */
const CAPS: Array<{ key: keyof ObjectPermission; short: string; long: string; danger?: boolean }> = [
  { key: 'allowCreate', short: 'C', long: 'engine.permissionPreview.cap.create' },
  { key: 'allowRead', short: 'R', long: 'engine.permissionPreview.cap.read' },
  { key: 'allowEdit', short: 'U', long: 'engine.permissionPreview.cap.edit' },
  { key: 'allowDelete', short: 'D', long: 'engine.permissionPreview.cap.delete' },
  { key: 'allowExport', short: 'E', long: 'engine.permissionPreview.cap.export' },
  { key: 'allowTransfer', short: 'T', long: 'engine.permissionPreview.cap.transfer' },
  // Restore / Purge were removed with their authoring columns (objectui#6595):
  // `@objectstack/spec` retired both keys, and the operations they claimed to
  // gate have never existed. The `keyof ObjectPermission` typing above is what
  // keeps this honest in the other direction — once the spec bump carrying the
  // retirement lands, re-adding either row stops compiling.
  { key: 'viewAllRecords', short: 'V*', long: 'engine.permissionPreview.cap.viewAll', danger: true },
  { key: 'modifyAllRecords', short: 'M*', long: 'engine.permissionPreview.cap.modifyAll', danger: true },
];

/** Access-depth axis (ADR-0057), narrowest first — also the widening order. */
const SCOPE_ORDER: ObjectAccessScope[] = ['own', 'own_and_reports', 'unit', 'unit_and_below', 'org'];
/** The access-scope enum values, compacted — identifiers, the same in every locale. */
const SCOPE_LABEL: Record<ObjectAccessScope, string> = {
  own: 'own',
  own_and_reports: 'own+reports',
  unit: 'unit',
  unit_and_below: 'unit+below',
  org: 'org',
};

/**
 * One failed sanity check: the catalogue row that words it and the values that
 * row interpolates, read in the preview's locale at render (objectui#10862).
 */
interface Warning {
  object: string;
  messageKey: string;
  vars?: Record<string, string>;
}

/** One `rowLevelSecurity` policy, reduced to the keys the preview shows. */
interface PolicyRow {
  name?: string;
  label?: string;
  description?: string;
}

/** A spec string key's value, or `undefined` when it is absent, empty or not a string. */
function authoredText(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined;
}

function readPolicies(rls: unknown[]): PolicyRow[] {
  const rows: PolicyRow[] = [];
  for (const entry of rls) {
    if (!entry || typeof entry !== 'object') continue;
    const policy = entry as Record<string, unknown>;
    rows.push({
      name: authoredText(policy.name),
      label: authoredText(policy.label),
      description: authoredText(policy.description),
    });
  }
  return rows;
}

function findWarnings(objects: Record<string, ObjectPermission>): Warning[] {
  const out: Warning[] = [];
  for (const [obj, p] of Object.entries(objects)) {
    if (p.allowEdit && !p.allowRead) out.push({ object: obj, messageKey: 'engine.permissionPreview.warn.editWithoutRead' });
    if (p.allowDelete && !p.allowRead) out.push({ object: obj, messageKey: 'engine.permissionPreview.warn.deleteWithoutRead' });
    if (p.modifyAllRecords && !p.viewAllRecords) {
      out.push({ object: obj, messageKey: 'engine.permissionPreview.warn.modifyAllWithoutViewAll' });
    }
    // No "Purge without Delete" lint: `allowPurge` is retired (objectui#6595),
    // so the combination it warned about can no longer be authored.
    // Same class as Modify-All-without-View-All, one axis down: a write scope
    // wider than the read scope lets a user edit records they cannot see.
    const read = p.readScope ? SCOPE_ORDER.indexOf(p.readScope) : -1;
    const write = p.writeScope ? SCOPE_ORDER.indexOf(p.writeScope) : -1;
    if (read >= 0 && write > read) {
      out.push({
        object: obj,
        messageKey: 'engine.permissionPreview.warn.writeWiderThanRead',
        vars: { write: SCOPE_LABEL[p.writeScope!], read: SCOPE_LABEL[p.readScope!] },
      });
    }
  }
  return out;
}

export function PermissionPreview({ name, draft, locale }: MetadataPreviewProps) {
  const d = draft as Record<string, unknown>;
  const permName = String(d.name ?? name ?? '');
  const label = String(d.label ?? permName);
  // ADR-0090 D2: Profile removed; the star now marks the package-suggested default set (D5).
  const isDefault = !!d.isDefault;
  const objects = (d.objects ?? {}) as Record<string, ObjectPermission>;
  const fields = (d.fields ?? {}) as Record<string, FieldPermission>;
  const systemPerms = Array.isArray(d.systemPermissions) ? (d.systemPermissions as string[]) : [];
  const tabPerms = (d.tabPermissions ?? {}) as Record<string, string>;
  const rls = Array.isArray(d.rowLevelSecurity) ? (d.rowLevelSecurity as unknown[]) : [];
  const policies = readPolicies(rls);

  const objectNames = React.useMemo(() => Object.keys(objects).sort(), [objects]);
  const warnings = React.useMemo(() => findWarnings(objects), [objects]);

  // Group field permissions by object name (key format: "<object>.<field>").
  const fieldsByObject = React.useMemo(() => {
    const out = new Map<string, Array<{ field: string; perm: FieldPermission }>>();
    for (const [key, perm] of Object.entries(fields)) {
      const [obj, ...rest] = key.split('.');
      if (!obj || rest.length === 0) continue;
      const fname = rest.join('.');
      // Only surface entries that diverge from the default (read=true, edit=false).
      const isNonDefault = perm.readable === false || perm.editable === true;
      if (!isNonDefault) continue;
      if (!out.has(obj)) out.set(obj, []);
      out.get(obj)!.push({ field: fname, perm });
    }
    return out;
  }, [fields]);

  // A set whose only grants are row-level policies is not empty: those
  // policies are listed below (objectui#11027).
  if (
    objectNames.length === 0 &&
    systemPerms.length === 0 &&
    Object.keys(tabPerms).length === 0 &&
    rls.length === 0
  ) {
    return (
      <PreviewShell hint="permission">
        <PreviewMessage>{tr('engine.permissionPreview.empty', locale)}</PreviewMessage>
      </PreviewShell>
    );
  }

  return (
    <PreviewShell hint={`permission · ${objectNames.length} object${objectNames.length === 1 ? '' : 's'}`}>
      <PreviewErrorBoundary>
        <div className="p-3 space-y-3">
          {/* Header */}
          <div className="rounded border bg-muted/30 p-3">
            <div className="flex items-start gap-2">
              {isDefault ? (
                <Star className="h-4 w-4 mt-0.5 text-amber-600 shrink-0" />
              ) : (
                <ShieldCheck className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-medium truncate">{label}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">{permName}</span>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {tr(isDefault ? 'engine.permissionPreview.kind.default' : 'engine.permissionPreview.kind.set', locale)}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                  <Pill icon={Layers} label={tFormat('engine.permissionPreview.pill.objects', locale, { count: objectNames.length })} />
                  <Pill icon={Tag} label={tFormat('engine.permissionPreview.pill.systemPerms', locale, { count: systemPerms.length })} />
                  <Pill icon={Eye} label={tFormat('engine.permissionPreview.pill.tabs', locale, { count: Object.keys(tabPerms).length })} />
                  <Pill icon={Lock} label={tFormat('engine.permissionPreview.pill.rls', locale, { count: rls.length })} />
                </div>
              </div>
            </div>
          </div>

          {/* Object × CRUD matrix */}
          {objectNames.length > 0 && (
            <Section title={tr('engine.permissionPreview.section.objects', locale)} count={objectNames.length}>
              <div className="rounded border bg-background overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                      <th className="px-2.5 py-1.5 text-left font-medium sticky left-0 bg-muted/30">
                        {tr('engine.permissionPreview.col.object', locale)}
                      </th>
                      {CAPS.map((c) => (
                        <th key={c.key} className="px-1.5 py-1.5 text-center font-medium" title={tr(c.long, locale)}>
                          {c.short}
                        </th>
                      ))}
                      <th className="px-2 py-1.5 text-left font-medium" title={tr('engine.permissionPreview.col.scopeTitle', locale)}>
                        {tr('engine.permissionPreview.col.scope', locale)}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {objectNames.map((obj) => {
                      const p = objects[obj] ?? {};
                      return (
                        <tr key={obj}>
                          <td className="px-2.5 py-1 font-mono sticky left-0 bg-background">{obj}</td>
                          {CAPS.map((c) => {
                            const granted = !!p[c.key];
                            return (
                              <td key={c.key} className="px-1.5 py-1 text-center">
                                <Cell granted={granted} danger={c.danger} locale={locale} />
                              </td>
                            );
                          })}
                          <td className="px-2 py-1 whitespace-nowrap text-[10px] text-muted-foreground">
                            {p.readScope || p.writeScope ? (
                              <>
                                <span title={tr('engine.permissionPreview.readScope', locale)}>
                                  {p.readScope ? SCOPE_LABEL[p.readScope] : '—'}
                                </span>
                                <span className="mx-1 opacity-50">/</span>
                                <span title={tr('engine.permissionPreview.writeScope', locale)}>
                                  {p.writeScope ? SCOPE_LABEL[p.writeScope] : '—'}
                                </span>
                              </>
                            ) : (
                              <span className="opacity-40">{tr('engine.permissionPreview.scopeDefault', locale)}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Legend locale={locale} />
            </Section>
          )}

          {/* Field-Level Security overrides */}
          {fieldsByObject.size > 0 && (
            <Section
              title={tr('engine.permissionPreview.section.fields', locale)}
              count={Array.from(fieldsByObject.values()).reduce((a, v) => a + v.length, 0)}
            >
              <div className="rounded border bg-background divide-y text-xs">
                {Array.from(fieldsByObject.entries()).sort().map(([obj, entries]) => (
                  <div key={obj} className="px-2.5 py-2">
                    <div className="font-mono text-[11px] mb-1">{obj}</div>
                    <ul className="flex flex-wrap gap-1">
                      {entries.map(({ field, perm }) => (
                        <li
                          key={field}
                          className="inline-flex items-center gap-1 rounded border bg-muted/30 px-1.5 py-0.5"
                          title={`readable=${perm.readable !== false}, editable=${!!perm.editable}`}
                        >
                          <span className="font-mono">{field}</span>
                          {perm.readable === false && (
                            <span className="text-[9px] uppercase text-red-700">
                              {tr('engine.permissionPreview.fls.hidden', locale)}
                            </span>
                          )}
                          {perm.editable && (
                            <span className="text-[9px] uppercase text-emerald-700">
                              {tr('engine.permissionPreview.fls.editable', locale)}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Row-level security policies */}
          {policies.length > 0 && (
            <Section title={tr('perm.rls.title', locale)} count={policies.length}>
              <ul className="rounded border bg-background divide-y text-xs">
                {policies.map((p, i) => (
                  <li key={i} className="px-2.5 py-2">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      {p.label && <span className="font-medium">{p.label}</span>}
                      {p.name && <span className="font-mono text-[11px] text-muted-foreground">{p.name}</span>}
                    </div>
                    {p.description && <p className="mt-0.5 text-muted-foreground">{p.description}</p>}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {/* System permissions */}
          {systemPerms.length > 0 && (
            <Section title={tr('engine.permissionPreview.section.system', locale)} count={systemPerms.length}>
              <div className="flex flex-wrap gap-1">
                {systemPerms.map((s) => (
                  <span key={s} className="inline-flex items-center gap-1 rounded border bg-background px-1.5 py-0.5 text-[11px] font-mono">
                    {s}
                  </span>
                ))}
              </div>
            </Section>
          )}

          {/* Tab visibility */}
          {Object.keys(tabPerms).length > 0 && (
            <Section title={tr('engine.permissionPreview.section.tabs', locale)} count={Object.keys(tabPerms).length}>
              <div className="flex flex-wrap gap-1">
                {Object.entries(tabPerms).map(([tab, vis]) => (
                  <span
                    key={tab}
                    className="inline-flex items-center gap-1 rounded border bg-background px-1.5 py-0.5 text-[11px]"
                  >
                    <span className="font-mono">{tab}</span>
                    <span
                      className={
                        vis === 'hidden'
                          ? 'text-[9px] uppercase text-red-700'
                          : vis === 'visible' || vis === 'default_on'
                            ? 'text-[9px] uppercase text-emerald-700'
                            : 'text-[9px] uppercase text-muted-foreground'
                      }
                    >
                      {vis}
                    </span>
                  </span>
                ))}
              </div>
            </Section>
          )}

          {/* Sanity warnings */}
          {warnings.length > 0 && (
            <div className="rounded border border-amber-200 bg-amber-50 p-2.5 text-xs space-y-1">
              <div className="flex items-center gap-1.5 font-medium text-amber-800">
                <AlertTriangle className="h-3.5 w-3.5" />{' '}
                {tFormat(
                  warnings.length === 1 ? 'engine.permissionPreview.sanityOne' : 'engine.permissionPreview.sanityOther',
                  locale,
                  { count: warnings.length },
                )}
              </div>
              <ul className="space-y-0.5">
                {warnings.map((w, i) => (
                  <li key={i} className="text-amber-900">
                    <code className="font-mono">{w.object}</code>:{' '}
                    {w.vars ? tFormat(w.messageKey, locale, w.vars) : tr(w.messageKey, locale)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </PreviewErrorBoundary>
    </PreviewShell>
  );
}

function Cell({ granted, danger, locale }: { granted: boolean; danger?: boolean; locale?: string }) {
  if (!granted) {
    return (
      <Circle
        className="inline-block h-3 w-3 text-muted-foreground/40"
        aria-label={tr('engine.permissionPreview.notGranted', locale)}
      />
    );
  }
  const cls = danger ? 'text-amber-600' : 'text-emerald-600';
  return <CheckCircle2 className={`inline-block h-3.5 w-3.5 ${cls}`} aria-label={tr('engine.permissionPreview.granted', locale)} />;
}

function Legend({ locale }: { locale?: string }) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
      <span className="inline-flex items-center gap-1">
        <CheckCircle2 className="h-3 w-3 text-emerald-600" /> {tr('engine.permissionPreview.granted', locale)}
      </span>
      <span className="inline-flex items-center gap-1">
        <CheckCircle2 className="h-3 w-3 text-amber-600" /> {tr('engine.permissionPreview.legend.bypass', locale)}
      </span>
      <span className="inline-flex items-center gap-1">
        <Circle className="h-3 w-3 text-muted-foreground/40" /> {tr('engine.permissionPreview.notGranted', locale)}
      </span>
      <span className="ml-auto font-mono">{tr('engine.permissionPreview.legend.key', locale)}</span>
    </div>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
        <span>{title}</span>
        {count != null && <span className="opacity-70">({count})</span>}
      </div>
      {children}
    </div>
  );
}

function Pill({
  icon: Icon,
  label,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      {Icon && <Icon className="h-3 w-3 text-muted-foreground" />}
      <span>{label}</span>
    </span>
  );
}
