// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * FlowReferenceField — an *editable combobox* for flow-node config values that
 * are really references (an object's field, an object/flow/role/user/… by name,
 * a connector, an email template, or another node in this flow) rather than
 * free-form strings.
 *
 * Why a combobox and not a strict dropdown: the designer must never trap the
 * author. The control suggests known values (fetched per {@link ReferenceKind})
 * but always accepts free text, so a field that doesn't exist yet or an empty
 * catalog still let the author type a value. Implemented with a native
 * `<datalist>` for exactly that suggest-but-allow-anything behaviour, zero
 * extra dependencies, and built-in accessibility.
 *
 * Four kinds carry a stronger contract than suggest-and-allow-anything
 * (objectstack-ai/objectstack#3508): the directory-backed kinds (`user`/`team`/`department`/
 * `position`) render a record lookup against the data API (with a manual-entry
 * escape hatch, so the never-trap rule still holds), `org-membership-level` is
 * a strict select over a closed enum, `manager` is auto-resolved (disabled
 * cell), and `queue` warns that the runtime doesn't resolve it. A kind whose
 * published binding is the REGISTRY instead (`{ source: 'registry', type }`,
 * objectstack#22710 — `position` on a server carrying it) renders a select over
 * that metadata type's items and commits the item's name (objectui#7611 Q3b),
 * with the same manual-entry escape hatch.
 *
 * An `object` reference renders the shared {@link ObjectPicker} instead
 * (objectui#11783): still suggest-but-allow-anything, but the value is committed
 * once, on a choice, Enter or blur, rather than on every keystroke.
 *
 * Two layers:
 *   • {@link ReferenceCombobox} — the bare control, given an already-resolved
 *     concrete kind. Reused by the `objectList` repeater for per-row reference
 *     cells (e.g. an approver's value).
 *   • {@link FlowReferenceField} — the inspector field wrapper (label + hint),
 *     resolving a *polymorphic* reference against the node's own sibling config.
 *
 * Data sources are resolved lazily from the running backend (the same source of
 * truth as the rest of the designer); `object-field` additionally needs to know
 * *which* object — resolved from the reference's `objectSource` against the
 * flow draft (trigger object) or the node's sibling config.
 */

import * as React from 'react';
import {
  Button, Input, Label,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@object-ui/components';
import { Pencil, Search } from 'lucide-react';
import { APPROVER_VALUE_SOURCES } from '@objectstack/spec/automation';
import { BUILTIN_MEMBERSHIP_ROLE_OPTIONS } from '@objectstack/spec/identity';
import { useAdapter } from '@object-ui/react';
import { LookupField } from '@object-ui/fields';
import type { FormField, LookupFieldMetadata } from '@object-ui/types';
import type { FlowReferenceSpec, ReferenceKind, RefValueSource } from './flow-node-config.js';
import { useMetadataClient } from '../useMetadata.js';
import { useObjectFields } from '../previews/useObjectFields.js';
import { t, tFormat, useMetadataLocale, type SupportedLocale } from '../i18n.js';
import { flagUnknownValue, RequiredMarker } from './_shared.js';
import { ObjectPicker } from './ObjectPicker.js';
import { APPROVER_REGISTRY_TYPES } from '../../../utils/approverValueSources.js';
import { isStudioHiddenSystemField } from '../../studio-design/studioHiddenSystemField.js';

/** Context the reference picker needs to resolve dynamic option sources. */
export interface FlowReferenceContext {
  /** The whole flow draft — used for `$trigger` object + the node list. */
  draft: Record<string, unknown>;
  /** The node currently being edited — used to resolve sibling config keys. */
  node: Record<string, unknown> | null;
}

interface Option {
  value: string;
  label: string;
  /**
   * Secondary text shown beside the label in the suggestion list — a connector
   * action's authored `description` (objectui#11028). Absent → the label alone.
   */
  hint?: string;
}

/**
 * Reference kinds backed by a flat METADATA list (`client.list(type)`), mapped
 * to their metadata-type name. `object-field` and `node` are resolved
 * specially (not via a list) and are intentionally absent — and so are the
 * directory kinds (`user` / `team` / `department` / `position`), which are
 * backed by DATA records, not the metadata registry: they used to map here,
 * so the picker queried `GET /api/v1/meta/user` (which lists no `sys_user`
 * rows), came back empty, and silently degraded to a free-text id box
 * (objectstack-ai/objectstack#3508). They live in {@link KIND_TO_RECORD_LOOKUP} instead.
 * `object` is absent too: it renders the shared {@link ObjectPicker}, which
 * reads its own catalog (objectui#11783).
 */
const KIND_TO_META_TYPE: Partial<Record<ReferenceKind, string>> = {
  flow: 'flow',
  connector: 'connector',
  'email-template': 'email_template',
};

/**
 * Reference kinds backed by DATA records in the system directory objects —
 * mirrors `APPROVER_VALUE_BINDINGS` in `@objectstack/spec` (automation/
 * approval.zod.ts, objectstack-ai/objectstack#3508; import it once a published ^16 release
 * carries the export). The approval engine resolves these against records,
 * so the designer offers a record lookup through the DataSource adapter.
 *
 * `valueField` is the committed value. `position` deliberately stores the
 * machine NAME — the engine filters `sys_user_position.position` by name, and
 * names stay portable across environments the way row ids do not. The others
 * store the row id. `department` resolves against `sys_business_unit` (there
 * is no `sys_department`).
 */
export interface RecordLookupBinding {
  /** Directory object the picker queries via the data API. */
  object: string;
  /** Record field committed as the reference value. */
  valueField: 'id' | 'name';
  /** Record field shown as the row label. */
  displayField: string;
  /** `search` opts into the people picker (avatar rows) — users only. */
  picker?: 'search';
  /** Secondary-line fields for people rows. */
  subtitle?: string[];
}
/**
 * PRESENTATION for the directory-backed kinds — which column to show, whether
 * to open the people picker, what subtitle to put under a row.
 *
 * Deliberately local: the spec publishes the data contract only and says so.
 * Everything below this line is objectui's call; everything above it (which
 * object, which column is committed) now comes from the spec.
 */
const RECORD_LOOKUP_PRESENTATION = {
  user: { displayField: 'name', picker: 'search', subtitle: ['email'] },
  team: { displayField: 'name' },
  department: { displayField: 'name' },
  position: { displayField: 'label' },
} as const satisfies Partial<
  Record<ReferenceKind, Omit<RecordLookupBinding, 'object' | 'valueField'>>
>;

/**
 * The older-server fallback, DERIVED from the spec's published binding.
 *
 * `object` / `valueField` used to be hand-written here, under a comment saying
 * this table "mirrors `APPROVER_VALUE_BINDINGS` … import it once a published
 * release carries the export". `@objectstack/spec@17` carries it, so this now
 * reads `APPROVER_VALUE_SOURCES` and composes objectui's presentation on top
 * (objectui#3017).
 *
 * That matters more here than anywhere else in the designer: the FIRST copy of
 * this data contract was wrong — every directory kind was wired to the metadata
 * registry, which holds no `sys_user` / `sys_team` / `sys_business_unit` /
 * `sys_position` ROWS, so candidates came back empty, the control degraded to
 * free text, and `sales_manager` got typed into a field that accepts three
 * values (objectstack-ai/objectstack#3508). Spec answered by publishing the binding with a
 * `satisfies` that makes an undeclared `ApproverType` a compile error; reading
 * it here is what finally carries that guarantee across the repo boundary.
 *
 * A kind whose spec source is not `data` is skipped rather than thrown on — a
 * module-level throw would white-screen the designer over a vocabulary change.
 * `FlowReferenceField.specDerivation.test.ts` asserts the table is non-vacuous
 * and still covers every kind with presentation.
 */
export const KIND_TO_RECORD_LOOKUP: Partial<Record<ReferenceKind, RecordLookupBinding>> =
  Object.fromEntries(
    Object.entries(RECORD_LOOKUP_PRESENTATION).flatMap(([kind, presentation]) => {
      const source = APPROVER_VALUE_SOURCES[kind as keyof typeof APPROVER_VALUE_SOURCES];
      if (!source || source.source !== 'data') return [];
      return [[
        kind,
        {
          object: source.object,
          valueField: source.valueField as RecordLookupBinding['valueField'],
          ...presentation,
        },
      ]];
    }),
  );

/**
 * The membership-tier vocabulary, DERIVED from the spec — never restated here.
 *
 * `org-membership-level` is intentionally NOT in {@link KIND_TO_META_TYPE}: it
 * used to map to `client.list('role')`, but ADR-0090 D3 removed the `role`
 * metadata type, so that call returned nothing and the picker silently
 * degraded to a free-text box — which is how `sales_manager` got typed into a
 * closed enum. The tier renders as a STRICT select (objectstack-ai/objectstack#3508); free
 * text would re-open the same trap.
 *
 * This list used to be hand-spelled `owner` / `admin` / `member` under a
 * comment attributing the set to better-auth ("only ever accepts these
 * three"). That copy went stale the moment ADR-0105 D8 added
 * `delegated_admin` to `sys_member.role`: the picker offered a quarter less
 * than the column stores, and a legitimately-saved `delegated_admin` approver
 * rendered as `delegated_admin (invalid)` — a spec-valid, runtime-resolvable
 * value labelled invalid to the author's face (`c7a74c80d`).
 *
 * It now reads `BUILTIN_MEMBERSHIP_ROLE_OPTIONS`, which the spec publishes as
 * the complete option list for `sys_member.role` and calls "the picker's
 * vocabulary" in as many words — values AND labels — so the same drift cannot
 * recur by construction. Same move, and the same reason, as
 * {@link KIND_TO_RECORD_LOOKUP}.
 */
const ORG_MEMBERSHIP_LEVEL_OPTIONS: Option[] = BUILTIN_MEMBERSHIP_ROLE_OPTIONS.map(
  ({ value, label }) => ({ value, label }),
);

/**
 * Label a tier the SERVER published. A value the spec already knows keeps the
 * spec's own label; an unknown one is humanized (`delegated_admin` →
 * "Delegated Admin") rather than shown as a raw token, so a vocabulary this
 * package's pin predates still reads as a real choice.
 */
function membershipLevelLabel(value: string): string {
  const known = ORG_MEMBERSHIP_LEVEL_OPTIONS.find((o) => o.value === value);
  if (known) return known.label;
  return value
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * The tier options to offer, preferring the SERVER-published enum.
 *
 * The same precedence rule this file already states for record lookups (see
 * {@link recordLookupFor}): the schema's own `xRef.sources` entry wins,
 * because it cannot drift from the vocabulary the engine actually accepts.
 * {@link ORG_MEMBERSHIP_LEVEL_OPTIONS} is the fallback for a server predating
 * the annotation — and, being spec-derived, is not a second source of truth.
 *
 * An enum source publishing NO values falls back rather than rendering an
 * empty strict select: a select with nothing in it traps the author with no
 * way to express a value at all, the one thing this control must never do.
 */
export function membershipLevelOptions(source: RefValueSource | undefined): Option[] {
  if (source?.source === 'enum' && source.values.length > 0) {
    return source.values.map((value) => ({ value, label: membershipLevelLabel(value) }));
  }
  return ORG_MEMBERSHIP_LEVEL_OPTIONS;
}

/** A concrete (non-polymorphic) reference resolution. */
export interface ResolvedRef {
  kind: ReferenceKind;
  objectSource?: string;
  connectorSource?: string;
  /**
   * The schema's own answer for where this kind's candidates live, when the
   * server published one (framework#3508 follow-up). Takes precedence over
   * {@link KIND_TO_RECORD_LOOKUP}, which stays as the fallback for a server
   * that predates the annotation.
   */
  source?: RefValueSource;
}

/**
 * Resolve a (possibly polymorphic) reference spec to a concrete kind. For a
 * polymorphic spec, `sibling(key)` supplies the discriminator value (the row's
 * `type`, or a sibling config key). Returns undefined when nothing resolves —
 * the caller then renders plain free text.
 */
export function resolveRefKind(
  ref: FlowReferenceSpec | undefined,
  sibling: (key: string) => unknown,
): ResolvedRef | undefined {
  if (!ref) return undefined;
  if (ref.kind) {
    return {
      kind: ref.kind,
      objectSource: ref.objectSource,
      connectorSource: ref.connectorSource,
      source: ref.sources?.[ref.kind],
    };
  }
  if (ref.kindFrom && ref.map) {
    const disc = sibling(ref.kindFrom);
    const k = typeof disc === 'string' ? ref.map[disc] : undefined;
    // The source is keyed by the DISCRIMINATOR (the approver `type`), not by
    // the picker kind: `role` and `org_membership_level` share one kind but
    // are separate enum members upstream.
    if (k) {
      return {
        kind: k,
        objectSource: ref.objectSource,
        connectorSource: ref.connectorSource,
        source: typeof disc === 'string' ? ref.sources?.[disc] : undefined,
      };
    }
  }
  return undefined;
}

/**
 * The record lookup to render for a resolved reference.
 *
 * The schema's `xRef.sources` wins when present — it is the spec's own
 * `APPROVER_VALUE_BINDINGS`, so it cannot drift from what the engine resolves.
 * {@link KIND_TO_RECORD_LOOKUP} supplies the fallback (older server) and, in
 * both paths, the PRESENTATION: which field to show, whether to open the
 * people picker, what subtitle to put under a row. Those are this package's
 * calls and deliberately stay out of the spec.
 *
 * A `data` source for a kind this package has no presentation entry for still
 * renders a lookup — display falls back to the committed column, which beats
 * degrading a resolvable reference to free text.
 */
export function recordLookupFor(resolved: ResolvedRef | undefined): RecordLookupBinding | undefined {
  if (!resolved) return undefined;
  const local = KIND_TO_RECORD_LOOKUP[resolved.kind];
  const published = resolved.source;
  if (published && published.source !== 'data') return undefined;
  if (!published) return local;
  return {
    object: published.object,
    valueField: published.valueField as RecordLookupBinding['valueField'],
    displayField: local?.displayField ?? published.valueField,
    ...(local?.picker ? { picker: local.picker } : {}),
    ...(local?.subtitle ? { subtitle: local.subtitle } : {}),
  };
}

/**
 * The older-server fallback for a REGISTRY-bound kind (objectui#7611 Q3b),
 * derived from the bundled spec exactly as {@link KIND_TO_RECORD_LOOKUP} is:
 * empty under the installed spec, `{ position: 'position' }` when the bundle
 * carries objectstack#22710 (the console objectstack ships injects it). Never a
 * list written here — which kinds are registry-backed is the spec's answer.
 */
export const KIND_TO_REGISTRY_TYPE: Readonly<Partial<Record<ReferenceKind, string>>> = APPROVER_REGISTRY_TYPES;

/**
 * The metadata type a resolved reference lists its candidates from, when its
 * binding is the REGISTRY (`{ source: 'registry', type }`, objectstack#22710),
 * else `undefined`.
 *
 * The same precedence as {@link recordLookupFor}: the schema's published
 * `xRef.sources` entry wins — it is the server's own binding — and a kind the
 * server publishes as anything else (a `data` row lookup above all, which keeps
 * the record arm exactly as it was) never reaches the registry. Only with no
 * published source does the spec-derived {@link KIND_TO_REGISTRY_TYPE} answer.
 */
export function registryTypeFor(resolved: ResolvedRef | undefined): string | undefined {
  if (!resolved) return undefined;
  const published = resolved.source;
  if (published) return published.source === 'registry' ? published.type : undefined;
  return KIND_TO_REGISTRY_TYPE[resolved.kind];
}

/** Read `node.config[key]` as a non-empty string, else undefined. */
function configString(node: Record<string, unknown> | null | undefined, key: string): string | undefined {
  const cfg = node?.config;
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return undefined;
  const v = (cfg as Record<string, unknown>)[key];
  return typeof v === 'string' && v ? v : undefined;
}

/** Resolve the target object name for an `object-field` reference. */
function resolveObjectName(kind: ReferenceKind, objectSource: string | undefined, ctx: FlowReferenceContext): string | undefined {
  if (kind !== 'object-field') return undefined;
  const src = objectSource || '$trigger';
  if (src === '$trigger') {
    const nodes = Array.isArray(ctx.draft.nodes) ? (ctx.draft.nodes as Array<Record<string, unknown>>) : [];
    const start = nodes.find((n) => n?.type === 'start');
    return configString(start, 'objectName');
  }
  // A sibling config key on the same node (CRUD nodes carry their own objectName).
  return configString(ctx.node, src);
}

/**
 * Resolve the chosen connector name for a `connector-action` reference — read
 * from the sibling key on this node's `connectorConfig` block (default
 * `connectorId`), which is where the connector picker writes it.
 */
export function resolveConnectorName(kind: ReferenceKind, connectorSource: string | undefined, ctx: FlowReferenceContext): string | undefined {
  if (kind !== 'connector-action') return undefined;
  const cc = ctx.node?.connectorConfig;
  if (!cc || typeof cc !== 'object' || Array.isArray(cc)) return undefined;
  const v = (cc as Record<string, unknown>)[connectorSource || 'connectorId'];
  return typeof v === 'string' && v ? v : undefined;
}

/**
 * A connector descriptor's action list → combobox options (exported for test).
 *
 * The action's `description` rides along as the option's `hint`, so the author
 * reads what an action does where they pick it (objectui#11028). The served
 * descriptor carries it as a plain string (`ConnectorActionDescriptor.description`
 * in `@objectstack/spec`); a missing, blank or non-string one adds no hint.
 */
export function connectorActionsToOptions(actions: unknown): Option[] {
  if (!Array.isArray(actions)) return [];
  return actions
    .filter((a): a is { key: string; label?: unknown; description?: unknown } =>
      !!a && typeof (a as { key?: unknown }).key === 'string' && !!(a as { key: string }).key)
    .map((a) => {
      const description = typeof a.description === 'string' ? a.description.trim() : '';
      return {
        value: a.key,
        label: typeof a.label === 'string' && a.label && a.label !== a.key ? `${a.label} (${a.key})` : a.key,
        ...(description ? { hint: description } : {}),
      };
    });
}

/**
 * The runtime connector registry (`GET /api/v1/automation/connectors`) → connector
 * picker options (exported for test). Each descriptor is `{ name, label?, origin? }`.
 *
 * A materialized declarative instance (ADR-0096, `origin: 'declarative'`) is
 * annotated `· declarative` so an author can tell it apart from a plugin-registered
 * connector — both are equally dispatchable, but the provenance differs. The
 * option `value` stays the bare connector name, so selecting it commits the name.
 * The annotation word is read in `locale` (objectui#10586); omitted, it is en.
 */
export function connectorsToOptions(connectors: unknown, locale?: SupportedLocale): Option[] {
  if (!Array.isArray(connectors)) return [];
  return connectors
    .filter((c): c is { name: string; label?: string; origin?: string } =>
      !!c && typeof (c as { name?: unknown }).name === 'string' && !!(c as { name: string }).name)
    .map((c) => {
      const base = typeof c.label === 'string' && c.label && c.label !== c.name ? `${c.label} (${c.name})` : c.name;
      return {
        value: c.name,
        label: c.origin === 'declarative' ? `${base} · ${t('engine.inspector.reference.declarative', locale)}` : base,
      };
    });
}

/**
 * Fetch a metadata type's items as combobox options. `type === undefined`
 * disables the fetch (returns empty), so the hook can be called
 * unconditionally regardless of the reference kind.
 */
function useMetadataListOptions(type: string | undefined): { options: Option[]; loading: boolean } {
  const client = useMetadataClient();
  const [state, setState] = React.useState<{ options: Option[]; loading: boolean }>({
    options: [],
    loading: !!type,
  });
  React.useEffect(() => {
    if (!type) {
      setState({ options: [], loading: false });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    client
      .list<{ name?: string; label?: string }>(type)
      .then((rows) => {
        if (cancelled) return;
        const options = (Array.isArray(rows) ? rows : [])
          .filter((r) => r && typeof r.name === 'string' && r.name)
          .map((r) => ({
            value: String(r.name),
            label: typeof r.label === 'string' && r.label && r.label !== r.name ? `${r.label} (${r.name})` : String(r.name),
          }));
        setState({ options, loading: false });
      })
      .catch(() => {
        if (!cancelled) setState({ options: [], loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, [client, type]);
  return state;
}

/**
 * Fetch a connector's actions as combobox options from the runtime connector
 * descriptors (`GET /api/v1/automation/connectors`, each `{ name, actions:
 * [{key,label,description}] }`). `connectorName === undefined` disables the fetch (so the
 * hook is safe to call unconditionally). Degrades to empty on any failure.
 */
function useConnectorActionOptions(connectorName: string | undefined): { options: Option[]; loading: boolean } {
  const [state, setState] = React.useState<{ options: Option[]; loading: boolean }>({
    options: [],
    loading: !!connectorName,
  });
  React.useEffect(() => {
    if (!connectorName) {
      setState({ options: [], loading: false });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    fetch('/api/v1/automation/connectors', { credentials: 'include', headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((payload) => {
        if (cancelled) return;
        const connectors = payload?.data?.connectors ?? payload?.connectors ?? [];
        const conn = Array.isArray(connectors)
          ? connectors.find((c: { name?: unknown }) => c?.name === connectorName)
          : undefined;
        setState({ options: connectorActionsToOptions(conn?.actions), loading: false });
      })
      .catch(() => {
        if (!cancelled) setState({ options: [], loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, [connectorName]);
  return state;
}

/**
 * Fetch the runtime connector registry (`GET /api/v1/automation/connectors`) as
 * connector picker options. Unlike a generic `client.list('connector')` — which
 * lists declared `connectors:` metadata (including inert catalog descriptors, and
 * missing plugin-registered connectors) — this lists exactly the **dispatchable**
 * connectors a `connector_action` node can call: plugin connectors AND materialized
 * declarative instances (ADR-0096), the latter annotated by origin. `enabled === false`
 * disables the fetch (hook stays unconditional). Degrades to empty on any failure.
 * `locale` is the annotation's language; switching it re-reads the registry.
 */
function useConnectorListOptions(enabled: boolean, locale: SupportedLocale): { options: Option[] } {
  const [state, setState] = React.useState<{ options: Option[] }>({ options: [] });
  React.useEffect(() => {
    if (!enabled) {
      setState({ options: [] });
      return;
    }
    let cancelled = false;
    fetch('/api/v1/automation/connectors', { credentials: 'include', headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((payload) => {
        if (cancelled) return;
        const connectors = payload?.data?.connectors ?? payload?.connectors ?? [];
        setState({ options: connectorsToOptions(connectors, locale) });
      })
      .catch(() => {
        if (!cancelled) setState({ options: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, locale]);
  return state;
}

/**
 * A single-select RECORD lookup cell for the directory-backed reference kinds
 * (objectstack-ai/objectstack#3508). Wraps `@object-ui/fields` LookupField with the app-shell
 * adapter as its DataSource — the same pattern `AccessExplainPanel` and
 * `AssignedUsersSection` already use to pick `sys_user` rows inside metadata
 * editing (ADR-0072: the picker only offers references that actually resolve).
 *
 * "Never trap the author" still holds: with no adapter (offline preview
 * gallery, no backend) the cell degrades to plain free text, and even with an
 * adapter a pencil toggle switches to manual entry — a value the directory
 * can't resolve yet (fresh env, dangling id) stays typeable.
 */
function RecordLookupCell({ binding, value, onPick, onCommit, onBlur, disabled, placeholder, locale }: {
  binding: RecordLookupBinding;
  value: unknown;
  /** Immediate commit for picker selections (there is no blur to flush on). */
  onPick: (value: string) => void;
  /** Keystroke-level commit for the manual-entry input (flushed via onBlur). */
  onCommit: (value: unknown) => void;
  onBlur?: () => void;
  disabled?: boolean;
  placeholder?: string;
  /** The designer locale the two toggle buttons are named in. */
  locale: SupportedLocale;
}) {
  const adapter = useAdapter();
  const [manual, setManual] = React.useState(false);
  const current = value != null ? String(value) : '';
  // The picker's carrier: the lookup's field metadata plus the picker
  // configuration this host writes. `idField`, `picker` and `subtitle` are not
  // field metadata (`FieldSchema` refuses all three by name, and the field
  // metadata types stopped declaring them, objectui#12242); the form entry
  // declares them, and `LookupField` reads them through that declaration.
  const lookupCarrier: LookupFieldMetadata & Pick<FormField, 'idField' | 'picker' | 'subtitle'> = {
    type: 'lookup',
    name: 'value',
    reference: binding.object,
    displayField: binding.displayField,
    // `position` commits the machine name, the rest the row id.
    idField: binding.valueField,
    multiple: false,
    // A directory row is never created from a flow-authoring picker.
    // The spec's `allowCreate`, the only spelling `LookupField` reads
    // (objectui#12157): its explicit `false` outranks the widget's
    // default-on quick-create for a user-facing reference.
    allowCreate: false,
    placeholder,
    ...(binding.picker ? { picker: binding.picker } : {}),
    ...(binding.subtitle ? { subtitle: binding.subtitle } : {}),
  };

  if (!adapter || manual) {
    return (
      <div className="flex w-full items-center gap-1">
        <Input
          value={current}
          onChange={(e) => onCommit(e.target.value)}
          onBlur={onBlur}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          placeholder={placeholder}
          disabled={disabled}
          className="h-8 flex-1 text-sm"
        />
        {adapter && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 w-8 shrink-0 p-0 text-muted-foreground"
            onClick={() => setManual(false)}
            disabled={disabled}
            aria-label={t('engine.inspector.reference.pickFromRecords', locale)}
            title={t('engine.inspector.reference.pickFromRecords', locale)}
          >
            <Search className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex w-full items-center gap-1">
      <div className="min-w-0 flex-1">
        <LookupField
          value={current || null}
          onChange={(v: unknown) => onPick(v == null ? '' : String(v))}
          readonly={disabled}
          dataSource={adapter}
          field={lookupCarrier}
        />
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 w-8 shrink-0 p-0 text-muted-foreground"
        onClick={() => setManual(true)}
        disabled={disabled}
        aria-label={t('engine.inspector.reference.enterManually', locale)}
        title={t('engine.inspector.reference.enterManually', locale)}
      >
        <Pencil className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

/**
 * A single-select REGISTRY picker cell (objectui#7611 Q3b) for a reference
 * whose binding is `{ source: 'registry', type }`: the value is the machine
 * NAME of an item of metadata `type`, so the candidates are that type's items —
 * listed through the designer's metadata client, `GET /api/v1/meta/<type>`,
 * which serves the code-declared and the environment-authored items alike
 * (ADR-0131 D2) — and a choice commits the item's `name`, never anything else.
 *
 * "Never trap the author" holds as it does for {@link RecordLookupCell}: a
 * pencil toggle switches to manual entry, and a registry that lists nothing
 * (none declared yet, a failed read) leaves the plain text box rather than an
 * empty select. A stored name the listed items do not carry still renders,
 * flagged `(not found)`, so opening an old row never silently blanks it.
 */
function RegistryPickCell({ type, value, onPick, onCommit, onBlur, disabled, placeholder, locale }: {
  /** The metadata type whose items are the candidates. */
  type: string;
  value: unknown;
  /** Immediate commit for a choice (there is no blur to flush on). */
  onPick: (value: string) => void;
  /** Keystroke-level commit for the manual-entry input (flushed via onBlur). */
  onCommit: (value: unknown) => void;
  onBlur?: () => void;
  disabled?: boolean;
  placeholder?: string;
  /** The designer locale the toggle buttons and the flag are worded in. */
  locale: SupportedLocale;
}) {
  const { options, loading } = useMetadataListOptions(type);
  const [manual, setManual] = React.useState(false);
  const current = value != null ? String(value) : '';
  const listed = !loading && options.length > 0;

  if (manual || !listed) {
    return (
      <div className="flex w-full items-center gap-1" data-testid="registry-pick" data-registry-type={type} data-mode="text">
        <Input
          value={current}
          onChange={(e) => onCommit(e.target.value)}
          onBlur={onBlur}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          placeholder={loading ? t('engine.form.loadingOptions', locale) : placeholder}
          disabled={disabled || loading}
          className="h-8 flex-1 text-sm"
        />
        {listed && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 w-8 shrink-0 p-0 text-muted-foreground"
            onClick={() => setManual(false)}
            disabled={disabled}
            aria-label={t('engine.inspector.reference.pickFromRegistry', locale)}
            title={t('engine.inspector.reference.pickFromRegistry', locale)}
          >
            <Search className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    );
  }

  const shown = current && !options.some((o) => o.value === current)
    ? [...options, { value: current, label: flagUnknownValue(current, t('engine.form.notFound', locale), locale) }]
    : options;
  return (
    <div className="flex w-full items-center gap-1" data-testid="registry-pick" data-registry-type={type} data-mode="select">
      <div className="min-w-0 flex-1">
        <Select value={current || undefined} onValueChange={onPick} disabled={disabled}>
          <SelectTrigger className="h-8 w-full text-sm">
            <SelectValue placeholder={placeholder ?? '—'} />
          </SelectTrigger>
          <SelectContent>
            {shown.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 w-8 shrink-0 p-0 text-muted-foreground"
        onClick={() => setManual(true)}
        disabled={disabled}
        aria-label={t('engine.inspector.reference.enterManually', locale)}
        title={t('engine.inspector.reference.enterManually', locale)}
      >
        <Pencil className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

export interface ReferenceComboboxProps {
  /** The resolved concrete reference, or undefined → plain free text. */
  resolved: ResolvedRef | undefined;
  value: unknown;
  onCommit: (value: unknown) => void;
  /** Optional blur handler (the `objectList` repeater flushes rows on blur). */
  onBlur?: () => void;
  /**
   * Immediate-commit callback for picker-style selections (record lookup,
   * strict select) — controls with no blur event to flush on. The `objectList`
   * repeater passes its set-and-flush; when absent, falls back to
   * `onCommit` + `onBlur`, which suits the standalone inspector field.
   */
  onSelect?: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  context?: FlowReferenceContext;
  /** Show the "Fields of X." / unresolved hint under the control (default true). */
  showHint?: boolean;
  /**
   * The control's accessible name, for a caller that draws the visible label
   * itself (the inspector field wrapper below). Read by the object picker.
   */
  ariaLabel?: string;
}

/**
 * The bare reference combobox — suggestions for `resolved.kind`, always
 * free-text editable, except for the kinds with a stronger contract:
 * directory-backed kinds render a record lookup ({@link RecordLookupCell}),
 * registry-bound kinds a select over the registry ({@link RegistryPickCell}),
 * `org-membership-level` a strict select (closed enum), `manager` a disabled
 * auto-resolved cell, and `queue` free text with a not-supported warning
 * (objectstack-ai/objectstack#3508). Hooks are called unconditionally (kind-gated args) so the
 * component is safe to use in a repeater where the kind changes per row.
 */
export function ReferenceCombobox({ resolved, value, onCommit, onBlur, onSelect, disabled, placeholder, context, showHint = true, ariaLabel }: ReferenceComboboxProps) {
  const listId = React.useId();
  // No `locale` prop here: the out-of-enum tier flag reads the designer's
  // locale itself, as the sibling `FlowObjectListField` does (objectui#10448).
  const locale = useMetadataLocale();
  const ctx: FlowReferenceContext = context ?? { draft: {}, node: null };
  const kind = resolved?.kind;
  // Picker-style commits have no blur event; default to commit-then-flush.
  const commitSelection = onSelect ?? ((v: string) => { onCommit(v); onBlur?.(); });

  // object-field: resolve the target object, then its field catalog.
  const objectName = resolved ? resolveObjectName(resolved.kind, resolved.objectSource, ctx) : undefined;
  const { fields: objectFields } = useObjectFields(kind === 'object-field' ? objectName : undefined);

  // connector-action: resolve the chosen connector, then its action catalog.
  const connectorName = resolved ? resolveConnectorName(resolved.kind, resolved.connectorSource, ctx) : undefined;
  const { options: connectorActionOptions } = useConnectorActionOptions(kind === 'connector-action' ? connectorName : undefined);

  // connector: the dispatchable runtime registry (plugin + materialized declarative
  // instances, ADR-0096), NOT the generic declared-metadata list — see the hook.
  const { options: connectorListOptions } = useConnectorListOptions(kind === 'connector', locale);

  // Flat metadata-list kinds (flow / connector / email-template).
  const listType =
    kind && kind !== 'object-field' && kind !== 'node' && kind !== 'connector-action' && kind !== 'connector'
      ? KIND_TO_META_TYPE[kind]
      : undefined;
  const { options: listOptions } = useMetadataListOptions(listType);

  const options = React.useMemo<Option[]>(() => {
    if (kind === 'object-field') {
      // objectui#13152 — a column the platform injects and hides (the
      // `__search` companion, `owning_business_unit_id`, `organization_id`)
      // is not suggested, judged by the Data rail's own predicate
      // (`isStudioHiddenSystemField`, objectui#11780). The box still takes
      // any typed name, and a stored value draws as it was written.
      return objectFields
        .filter((f) => !isStudioHiddenSystemField({ system: f.system, hidden: f.hidden }))
        .map((f) => ({
          value: f.name,
          label: f.label && f.label !== f.name ? `${f.label} (${f.name})` : f.name,
        }));
    }
    if (kind === 'connector-action') return connectorActionOptions;
    if (kind === 'connector') return connectorListOptions;
    if (kind === 'node') {
      const nodes = Array.isArray(ctx.draft.nodes) ? (ctx.draft.nodes as Array<Record<string, unknown>>) : [];
      const currentId = typeof ctx.node?.id === 'string' ? ctx.node.id : undefined;
      return nodes
        .filter((n) => typeof n?.id === 'string' && n.id && n.id !== currentId)
        .map((n) => {
          const id = String(n.id);
          const lbl = typeof n.label === 'string' && n.label ? `${n.label} (${id})` : id;
          return { value: id, label: lbl };
        });
    }
    if (listType) return listOptions;
    return [];
  }, [kind, listType, objectFields, connectorActionOptions, connectorListOptions, listOptions, ctx.draft, ctx.node]);

  // For an object-field whose object can't be resolved, tell the author why the
  // suggestions are empty — but still let them type a value.
  const unresolvedObject = kind === 'object-field' && !objectName;
  // Same for a connector-action with no connector chosen yet.
  const unresolvedConnector = kind === 'connector-action' && !connectorName;

  // ── Kinds with a stronger contract than suggest-and-allow-anything ──────
  // (All hooks above have already run — the branches below only render.)

  // Directory-backed kinds → single-select record lookup (objectstack-ai/objectstack#3508).
  // The object + committed column come from the schema when the server
  // publishes them, so this package no longer decides where the engine's
  // approvers live — see `recordLookupFor`.
  const lookup = recordLookupFor(resolved);
  if (lookup) {
    return (
      <RecordLookupCell
        binding={lookup}
        value={value}
        onPick={commitSelection}
        onCommit={onCommit}
        onBlur={onBlur}
        disabled={disabled}
        placeholder={placeholder}
        locale={locale}
      />
    );
  }

  // Registry-bound kinds → a select over the metadata type the binding names
  // (objectui#7611 Q3b). Read off the published binding like the lookup above,
  // so this package never decides which kinds live in the registry.
  const registryType = registryTypeFor(resolved);
  if (registryType) {
    return (
      <RegistryPickCell
        type={registryType}
        value={value}
        onPick={commitSelection}
        onCommit={onCommit}
        onBlur={onBlur}
        disabled={disabled}
        placeholder={placeholder}
        locale={locale}
      />
    );
  }

  // Closed enum → strict select, never free text: `sales_manager` typed into
  // a membership-tier box matches nobody at runtime. The vocabulary comes from
  // the SERVER when it publishes one and from the spec-derived fallback
  // otherwise — never from a list hand-spelled here (`c7a74c80d`). A stored
  // value outside the enum (legacy dirty data) still renders, flagged, so
  // editing an old row never silently blanks it — mirroring the repeater's
  // select cells.
  if (kind === 'org-membership-level') {
    const current = value != null ? String(value) : '';
    const tiers = membershipLevelOptions(resolved?.source);
    const shown = current && !tiers.some((o) => o.value === current)
      ? [...tiers, { value: current, label: flagUnknownValue(current, t('engine.form.invalid', locale), locale) }]
      : tiers;
    return (
      <Select value={current || undefined} onValueChange={commitSelection} disabled={disabled}>
        <SelectTrigger className="h-8 w-full text-sm">
          <SelectValue placeholder={placeholder ?? '—'} />
        </SelectTrigger>
        <SelectContent>
          {shown.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  // Auto-resolved at runtime (submitter's manager) — no value to author. A
  // stored value (the advanced field-name override, authorable via API) still
  // displays. The explanation renders regardless of `showHint`: it is the
  // reason the input is disabled, not an optional nicety.
  if (kind === 'manager') {
    return (
      <div className="w-full space-y-1">
        <Input
          value={value != null ? String(value) : ''}
          disabled
          placeholder={t('engine.inspector.reference.managerPlaceholder', locale)}
          className="h-8 text-sm"
        />
        <p className="text-[11px] leading-snug text-muted-foreground">
          {t('engine.inspector.reference.managerHint', locale)}
        </p>
      </div>
    );
  }

  // Declared-but-unenforced (objectstack-ai/objectstack#3508): the runtime has no queue
  // resolution, so a stored value keeps its free-text cell but carries a
  // warning — rendered regardless of `showHint` because the slot silently
  // routes to nobody. New rows can no longer choose this type.
  if (kind === 'queue') {
    return (
      <div className="w-full space-y-1">
        <Input
          value={value != null ? String(value) : ''}
          onChange={(e) => onCommit(e.target.value)}
          onBlur={onBlur}
          placeholder={placeholder}
          disabled={disabled}
          className="h-8 text-sm"
        />
        <p className="text-[11px] leading-snug text-amber-600 dark:text-amber-400">
          {t('engine.inspector.reference.queueUnsupported', locale)}
        </p>
      </div>
    );
  }

  // An object name (objectui#11783) → the shared picker: the catalog grouped
  // and labelled, the platform's own objects collapsed under System, and the
  // value committed ONCE — on a choice, Enter or blur — so nothing that
  // resolves the trigger's object refetches per keystroke. Text that names no
  // object (an expression, a template) is still committed as typed.
  if (kind === 'object') {
    return (
      <ObjectPicker
        ariaLabel={ariaLabel}
        value={value != null ? String(value) : ''}
        onCommit={commitSelection}
        disabled={disabled}
        placeholder={placeholder}
        locale={locale}
      />
    );
  }

  return (
    <div className="w-full space-y-1">
      <Input
        list={options.length ? listId : undefined}
        value={value != null ? String(value) : ''}
        onChange={(e) => onCommit(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        disabled={disabled}
        className="h-8 text-sm"
      />
      {options.length > 0 && (
        <datalist id={listId}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.hint ? `${o.label} — ${o.hint}` : o.label}
            </option>
          ))}
        </datalist>
      )}
      {showHint && kind === 'object-field' && objectName && (
        <p className="text-[11px] leading-snug text-muted-foreground">{tFormat('engine.inspector.reference.fieldsOf', locale, { object: objectName })}</p>
      )}
      {showHint && unresolvedObject && (
        <p className="text-[11px] leading-snug text-muted-foreground">
          {t('engine.inspector.reference.setTriggerObject', locale)}
        </p>
      )}
      {showHint && kind === 'connector-action' && connectorName && (
        <p className="text-[11px] leading-snug text-muted-foreground">{tFormat('engine.inspector.reference.actionsOf', locale, { connector: connectorName })}</p>
      )}
      {showHint && unresolvedConnector && (
        <p className="text-[11px] leading-snug text-muted-foreground">{t('engine.inspector.reference.chooseConnector', locale)}</p>
      )}
    </div>
  );
}

export interface FlowReferenceFieldProps {
  field: { label: string; placeholder?: string; ref?: FlowReferenceSpec };
  value: unknown;
  onCommit: (value: unknown) => void;
  disabled?: boolean;
  context?: FlowReferenceContext;
  /** The spec requires this key (objectui#10948): the label carries {@link RequiredMarker}. */
  required?: boolean;
}

/**
 * Inspector field wrapper: a labelled reference combobox. A polymorphic ref is
 * resolved against the node's own sibling config keys (e.g. the script node's
 * `template` follows `actionType`).
 */
export function FlowReferenceField({ field, value, onCommit, disabled, context, required }: FlowReferenceFieldProps) {
  const node = context?.node ?? null;
  const resolved = resolveRefKind(field.ref, (key) => configString(node, key));
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">
        {field.label}
        {required && <RequiredMarker />}
      </Label>
      <ReferenceCombobox
        resolved={resolved}
        value={value}
        onCommit={onCommit}
        disabled={disabled}
        placeholder={field.placeholder}
        context={context}
        ariaLabel={field.label}
      />
    </div>
  );
}
