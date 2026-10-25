/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Spec-aligned container renderers for the `page:*` component namespace.
 * Backs the Page-as-root record detail page model (Salesforce Lightning
 * Record Page parity).
 *
 * Maps `packages/spec/src/ui/component.zod.ts` props:
 *   - PageTabsProps      -> page:tabs
 *   - PageCardProps      -> page:card
 *   - PageAccordionProps -> page:accordion
 *   - PageHeaderProps    -> page:header
 *   - PageContainerProps -> page:footer / page:sidebar / page:section
 *                           (the thin wrappers; one shared `children` slot)
 */

import React from 'react';
import { ComponentRegistry, ExpressionEvaluator, declaredNameField, evalRowPredicate, formatTitleTemplate, hasDeclaredPredicate, getRecordDisplayName, recordDisplayValueAt, resolveNameField, toPredicateRecord } from '@object-ui/core';
import type { ComponentInput } from '@object-ui/core';
import { actionRendersAt, resolveDeclaredActionIds } from '@object-ui/types';
import type { DeclaredActionsRefusal } from '@object-ui/types';
import { useRecordContext, useAction, useCapabilityGate, usePredicateScope, usePageVariables, useInlineEdit, useActionTextLocalizer, useMetadataItem, reportUnresolvableVisibilityPredicate, resolveInlineAriaProps, buildNodeEvaluationScope } from '@object-ui/react';
import { renderChildren, renderNodeSlot, cn } from '../../lib/utils';
import { LazyIcon } from '../../lib/lazy-icon';
import { RelatedCountStore, useRelatedCountVersion } from '../../hooks/related-count-store';
import { useIsMobile } from '../../hooks/use-mobile';
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
  Separator,
  Button,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  Avatar,
  AvatarImage,
} from '../../ui';
import { RecordTitleChip } from '../../custom/RecordTitleChip';
import { resolveFieldReadFace } from '../../lib/field-face';
import { PageDescriptionContext } from './page-description-context';
import { renderBlockChildren } from './page-block-grid';
import { isFileIdToken } from '@objectstack/spec/data';
import { readActionEntryParamValues } from '../action/static-params';
import { useObjectLabel, useSafeFieldLabel, useObjectTranslation, useSafeTranslate, createSafeTranslation, pickLocalized, useDisplayLocale } from '@object-ui/i18n';
import { MoreHorizontal, RefreshCw } from 'lucide-react';

/**
 * The one authorable key the three thin containers publish — `page:section`,
 * `page:footer`, `page:sidebar` (objectui#4027).
 *
 * `@objectstack/spec` declares all three through one shared `PageContainerProps`
 * whose single key is `children` (objectstack#5775, objectstack `85ec26d28`, merged
 * 2026-08-07). They had been declared `EmptyProps` upstream — "this component
 * takes zero props" — while their renderers have always rendered a child list;
 * this side carried the mirror-image gap, registering all three with no `inputs`
 * at all, so the designer had nothing to authorize and the generated
 * `sdui.manifest.json` published them as propless.
 *
 * Declaring it as a `slot` is what makes this an AUTHORING-surface change and
 * nothing else — no validation verdict moves in either direction:
 *   - `sdui-parser/src/codegen.ts:emitInterface` filters `slot` inputs out of
 *     `sdui-intrinsics.d.ts`, where `SduiBaseProps.children` already types it;
 *   - `sdui-parser/src/validate.ts` lists `children` in `BASE_PROPS`, so it was
 *     never an `unknown-prop` and does not become one;
 *   - `isContainer: true` (already set on all three) is what authorizes children
 *     to the parser's `not-a-container` check.
 * What does move is the designer: an authorable slot on the components whose
 * entire purpose is to render one.
 *
 * Shared rather than copied three times, mirroring the spec's own single
 * `PageContainerProps` — three identical literals are three places to drift.
 */
const PAGE_CONTAINER_INPUTS: ComponentInput[] = [
  {
    name: 'children',
    type: 'slot',
    description: 'Child components rendered inside this container, in order',
  },
];

/**
 * How long the header's manual-refresh icon keeps spinning after a click
 * (objectui#3460).
 *
 * The refresh itself is fire-and-forget — it publishes on the #2269
 * invalidation bus and every mounted reader refetches in place, so there is no
 * completion signal to spin until. Against a warm backend the whole round trip
 * can finish inside one frame, which would render the click as "nothing
 * happened". This floor makes the click visibly land.
 */
const MANUAL_REFRESH_SPIN_MS = 650;

/**
 * Copy for the `page:tabs` count badge (objectstack#5506).
 *
 * The badge renders digits only, so its `aria-label` IS the badge as far as a
 * screen reader is concerned — and it used to be built by a template literal
 * that hardcoded both the English word and English pluralization.
 *
 * An i18next count family (objectui#11445): every pack spells out each CLDR
 * category its language selects, and the `_one` / `_other` rows below are what
 * `fallbackT` reads for a numeric `count` when no provider is mounted.
 *
 * `createSafeTranslation` rather than the per-call `useSafeTranslate` used
 * elsewhere in this file because these keys interpolate `{{count}}` and
 * `useSafeTranslate` carries no options bag.
 */
const TABS_DEFAULT_TRANSLATIONS: Record<string, string> = {
  'common.itemCount': '{{count}} items',
  'common.itemCount_one': '{{count}} item',
  'common.itemCount_other': '{{count}} items',
};
const useTabsTranslation = createSafeTranslation(TABS_DEFAULT_TRANSLATIONS, 'common.itemCount');

/**
 * Pull the standard designer-passthrough props off a renderer's `props`.
 * Every page:* renderer must forward these so the Studio designer overlay
 * can still target the rendered element.
 */
const splitDesignerProps = (props: Record<string, any>) => {
  const {
    'data-obj-id': dataObjId,
    'data-obj-type': dataObjType,
    style,
    ...rest
  } = props || {};
  return {
    designer: { 'data-obj-id': dataObjId, 'data-obj-type': dataObjType, style },
    rest,
  };
};

/** Pick a value for I18nLabelSchema (string or { default, ... } shape). */
const labelText = (label: any): string => {
  if (label == null) return '';
  if (typeof label === 'string') return label;
  if (typeof label === 'object') return label.default || label.value || '';
  return String(label);
};

/**
 * EXACT-LOCALE overrides for well-known English tab/accordion labels used by
 * Lightning-style record pages (Details / Related / Activity / History /
 * Notes / Files / Tasks / Events / Attachments / Chatter / Discussion),
 * consulted AHEAD of `KNOWN_LABEL_KEYS` below.
 *
 * It shipped as the only source, with exactly two arms — and that was
 * objectui#4645: `buildDefaultPageSchema` writes plain English tokens onto the
 * synthesized record-detail tabs and three of its comments say they "localize
 * through the tab strip's KNOWN_LABEL_DICT", which was true for Chinese and
 * silently false for the eight other shipped packs. A ja-JP / es-ES record
 * detail rendered `Details / Related / Attachments` inside otherwise fully
 * localized chrome.
 *
 * What stays here is what the packs cannot answer:
 *   - `zh-TW`. There is no `zh-TW` pack; i18next resolves it to the
 *     SIMPLIFIED `zh` resource, so this map is the only source of the
 *     Traditional forms. It must therefore win over the pack lookup, which is
 *     why the dict is consulted first rather than second.
 *   - the tokens no pack carries (`Notes`, `Files`, `Tasks`, `Events`,
 *     `Overview`, and the object-name rows) — dropping them would take
 *     coverage AWAY from zh.
 *
 * Authors can always override by passing a localised `label` (string or
 * `{ default, zh-CN, ... }` shape) directly in their schema; neither map is
 * consulted unless the input matches a known English token.
 */
const KNOWN_LABEL_DICT: Record<string, Record<string, string>> = {
  'zh-CN': {
    Details: '详情',
    Related: '相关',
    Activity: '活动',
    History: '历史',
    Notes: '备注',
    Files: '文件',
    Tasks: '任务',
    'Open Tasks': '待办任务',
    'Closed Tasks': '已完成任务',
    Events: '日程',
    Attachments: '附件',
    Chatter: '讨论',
    Discussion: '讨论',
    Comments: '评论',
    Overview: '概览',
    Summary: '摘要',
    Quotes: '报价单',
    Products: '产品',
    Contacts: '联系人',
    Accounts: '客户',
    Leads: '线索',
    Opportunities: '商机',
    Cases: '服务案例',
    Campaigns: '营销活动',
    Approvals: '审批',
    Documents: '文档',
    Emails: '邮件',
    Calls: '通话',
    Meetings: '会议',
  },
  'zh-TW': {
    Details: '詳情',
    Related: '相關',
    Activity: '活動',
    History: '歷史',
    Notes: '備註',
    Files: '檔案',
    Tasks: '任務',
    'Open Tasks': '待辦任務',
    'Closed Tasks': '已完成任務',
    Events: '行程',
    Attachments: '附件',
    Chatter: '討論',
    Discussion: '討論',
    Comments: '評論',
    Overview: '概覽',
    Summary: '摘要',
    Quotes: '報價單',
    Products: '產品',
    Contacts: '聯絡人',
    Accounts: '客戶',
    Leads: '線索',
    Opportunities: '商機',
    Cases: '服務案例',
    Campaigns: '行銷活動',
    Approvals: '審批',
    Documents: '文件',
    Emails: '郵件',
    Calls: '通話',
    Meetings: '會議',
  },
};

/**
 * The other half of the same lookup: the well-known English tokens the ten
 * shipped packs ALREADY translate, mapped to the key that carries them
 * (objectui#4645). No pack key is minted here — every row below was in all ten
 * packs before this change; the tab strip simply never asked for them.
 *
 * These are exactly the tokens `buildDefaultPageSchema` writes onto its
 * synthesized tab nodes, plus the two `record:discussion` spellings, so the
 * built-in record detail is covered end to end. A token absent from this map
 * (an authored `Invoices` tab) is left alone, which is the contract the dict
 * already had.
 */
const KNOWN_LABEL_KEYS: Record<string, string> = {
  Details: 'detail.details',
  Related: 'detail.related',
  Activity: 'detail.activity',
  History: 'detail.history',
  Attachments: 'detail.attachments',
  Approvals: 'detail.approvalsPanelTitle',
  Discussion: 'detail.discussion',
  Comments: 'detail.comments',
};

/**
 * `locale` is passed in rather than re-detected. Both call sites already
 * resolve it from `useObjectTranslation().language`; this function used to
 * call `detectLocale()` and read `document.documentElement.lang` on its own,
 * so the tab label and the chrome around it could render from two different
 * language sources — they desync the moment the user switches language
 * in-app, because the DOM attribute and the i18n instance update
 * independently (objectui#2871).
 */
const translateLabel = (
  text: string,
  locale: string,
  tt: (keyOrKeys: string | string[], fallback: string) => string,
): string => {
  if (!text) return text;
  // Match `zh-CN`, `zh-TW`, then base `zh` → `zh-CN`.
  const exact = KNOWN_LABEL_DICT[locale];
  const base = locale.split('-')[0];
  const fallback = base === 'zh' ? KNOWN_LABEL_DICT['zh-CN'] : undefined;
  const dict = exact || fallback;
  /**
   * One token, in lookup order: the exact-locale dict, then the pack.
   *
   * `undefined` means "this token has no translation in this locale" — NOT
   * "the pack answered with the English token". `tt` falls back to its second
   * argument, so a pack miss and an `en` session both come back as `text`
   * itself; collapsing them here is what keeps the compound path below from
   * claiming a translation it does not have.
   */
  const one = (token: string): string | undefined => {
    const hit = dict?.[token];
    if (hit !== undefined) return hit;
    const key = KNOWN_LABEL_KEYS[token];
    if (key === undefined) return undefined;
    const translated = tt(key, token);
    return translated === token ? undefined : translated;
  };
  // Direct hit on the full string.
  const direct = one(text);
  if (direct !== undefined) return direct;
  // Try splitting on " & " / " 和 " / " and " separators so labels like
  // "Notes & Attachments" translate piece-wise to "备注 & 附件" without
  // requiring every concrete combination to be enumerated in the dict.
  const sepRe = /\s*(?:&|and|和)\s*/i;
  if (sepRe.test(text)) {
    const parts = text.split(sepRe).map((p) => p.trim()).map(one);
    if (parts.every((p) => p !== undefined)) {
      const sep = locale.startsWith('zh') ? '与' : ' & ';
      return (parts as string[]).join(sep);
    }
  }
  return text;
};

/** `useSafeFieldLabel().fieldOptionLabel`'s shape. */
type FieldOptionLabel = (objectName: string, fieldName: string, value: string, fallback: string) => string;

/**
 * `fieldName`'s declaration on `objectSchema`, in either shape `fields` takes:
 * a map keyed by field name, or a list of entries that carry their `name`.
 * `undefined` when the object declares no such field.
 */
const declaredFieldDef = (objectSchema: any, fieldName: string): any =>
  Array.isArray(objectSchema?.fields)
    ? objectSchema.fields.find((f: any) => f?.name === fieldName)
    : objectSchema?.fields?.[fieldName];

/**
 * The option label a user reads for one select-field VALUE, or `undefined`
 * when `fieldName` is not an options-bearing field of `objectSchema` (or a
 * piece needed to translate it is absent).
 *
 * The ONE place this file maps an enum value to its label. Two readers call
 * it: the `{token}` interpolation below (`page:header`'s `title` /
 * `subtitle`), and the record copy the H1's `titleFormat` and declared-pointer
 * rungs read ({@link withOptionLabels}, objectui#10447, objectui#13103).
 */
const optionLabelFor = (
  objectSchema: any,
  fieldOptionLabel: FieldOptionLabel | undefined,
  objectName: string | undefined,
  fieldName: string,
  raw: string,
): string | undefined => {
  if (!objectSchema?.fields || !fieldOptionLabel || !objectName) return undefined;
  const fieldDef: any = declaredFieldDef(objectSchema, fieldName);
  const options: any[] | undefined = fieldDef?.options;
  if (!Array.isArray(options)) return undefined;
  const match = options.find((opt: any) => String(opt?.value ?? opt) === raw);
  const fallback = match?.label ? String(match.label) : raw;
  return fieldOptionLabel(objectName, fieldName, raw, fallback);
};

/**
 * A copy of `data` in which each select-field value reads as its option label
 * ({@link optionLabelFor}); `data` itself when no value maps.
 *
 * Why a copy and not a hook on the formatter (objectui#10447): the record
 * page H1's `titleFormat` rung renders through core's `formatTitleTemplate`,
 * the one interpolator every other title surface uses. That function takes a
 * template and a record, and nothing else. The H1 has always shown a select
 * token as its translated label ("In Progress", not `in_progress`), so the
 * translation happens on the record before the formatter sees it, and the
 * formatter's signature does not move.
 *
 * Only a top-level scalar is mapped: `null`, `undefined`, an expanded
 * reference and an array stay as they are, so core judges them exactly as it
 * judges the raw record. A mapped value is never empty (the label falls back
 * to the raw value), so the placeholders that resolve on the copy are the ones
 * that resolve on the raw record. That is what keeps `record:details`' dedupe,
 * which renders the same template over the raw record, deciding about the same
 * fields the H1 shows.
 */
const withOptionLabels = (
  data: any,
  objectSchema: any,
  fieldOptionLabel: FieldOptionLabel | undefined,
  objectName: string | undefined,
): any => {
  if (!data || typeof data !== 'object') return data;
  const source: Record<string, any> = data;
  let copy: Record<string, any> | undefined;
  for (const key of Object.keys(source)) {
    const v = source[key];
    if (v === null || v === undefined || typeof v === 'object') continue;
    const label = optionLabelFor(objectSchema, fieldOptionLabel, objectName, key, String(v));
    if (label === undefined) continue;
    if (!copy) copy = { ...source };
    copy[key] = label;
  }
  return copy ?? source;
};

/**
 * Replace `{field.path}` tokens in a template against the given data object.
 * Missing fields collapse to an empty string. The result is trimmed and
 * whitespace-collapsed so partial misses don't leave gaping holes.
 *
 * When `objectSchema` and `fieldOptionLabel` are supplied, a token that
 * resolves to a select-field value gets routed through the i18n option
 * label dictionary — so `subtitle: "{industry} · {type}"` renders as
 * "科技 · 客户" rather than the raw enum values "technology · customer".
 *
 * Callers: `page:header`'s own `title` and `subtitle`. The record-title
 * `titleFormat` rung does NOT come through here: it renders through core's
 * `formatTitleTemplate` (objectui#10447), because that template is the one
 * `getRecordDisplayName` and `record:details`' dedupe render too.
 */
const interpolate = (
  template: string,
  data: any,
  objectSchema?: any,
  fieldOptionLabel?: FieldOptionLabel,
  objectName?: string,
): string => {
  if (!template || typeof template !== 'string') return template || '';
  // No early return on the no-`{` case: that used to skip straight past the
  // trim below, so a whitespace-only literal (no token, nothing to
  // substitute) came back UNCHANGED while the exact same string with a
  // token in it got blanked — two branches disagreeing about whitespace
  // (objectui#9174). `.includes('{')` still buys the fast path its one real
  // saving, skipping the `replace()` callback, but every template — token or
  // not — now falls through to the SAME trim call below, so the two paths
  // cannot re-diverge.
  const out = template.includes('{')
    ? template.replace(/\{([a-zA-Z0-9_.]+)\}/g, (_m, path: string) => {
        const v = path.split('.').reduce<any>((acc, seg) => (acc == null ? acc : acc[seg]), data);
        if (v == null) return '';
        // Skip object/array values rather than letting `String(v)` produce a
        // useless "[object Object]" — this happens when a token resolves to a
        // related record (e.g. `{account}` on an opportunity). Authors who want
        // a field of the related record should use a deeper path
        // (e.g. `{account.name}`).
        if (typeof v === 'object') return '';
        const raw = String(v);
        // Route enum values through i18n so subtitle templates render
        // translated option labels instead of raw machine-readable values.
        // Only the first path segment is treated as a field name (deeper
        // paths reach into related records and have their own translation
        // surfaces).
        if (!path.includes('.')) {
          const label = optionLabelFor(objectSchema, fieldOptionLabel, objectName, path, raw);
          if (label !== undefined) return label;
        }
        return raw;
      })
    : template;
  return out.replace(/\s+/g, ' ').trim();
};

// ---------------------------------------------------------------------------
// The `aria` bag of the four page blocks (objectui#11083)
// ---------------------------------------------------------------------------
//
// `@objectstack/spec` declares an `aria` member (`AriaPropsSchema`) on
// `page:header`, `page:tabs`, `page:card` and `page:accordion`, and
// `SchemaRenderer` hoists `properties.aria` onto the node. None of the four
// renderers below read it, so a declared accessible name reached no element.
// Each one now spreads `resolveInlineAriaProps(schema?.aria, locale)` from
// `@object-ui/react`, the one reader of that bag, onto the block's own root
// element (the one carrying `className` and the designer props), against
// `useDisplayLocale()`. ⛔ No mapping of the bag lives in this file.
//
// ⛔ None of the four adds a default role. The root keeps the role it had
// (`header`'s own semantics, or none), so a block that authors no `aria`
// renders the same DOM as before. Whether a nameless-role root should get a
// default role is not decided here.

// ---------------------------------------------------------------------------
// page:tabs
// ---------------------------------------------------------------------------

interface PageTabsItem {
  label: any;
  /**
   * Stable, semantic tab identity (e.g. `details`, `related:<childObject>`) —
   * used as the Radix value and as the URL token for `?tab=` sync
   * (objectui#2257). Falls back to an index-derived value when absent, which
   * is NOT stable across item-list changes; synthesized pages always set it.
   */
  value?: string;
  icon?: string;
  /**
   * Optional badge value rendered after the label (e.g. related-list count).
   * Numbers >= 1000 are shortened to `1.2k`-style.
   */
  count?: number | string;
  /**
   * Conditional tab (framework#2606): CEL predicate — when it evaluates FALSE
   * the whole tab (header + panel) is omitted from the strip. Canonical
   * ADR-0089 key only; the deprecated `visibility`/`visibleOn` aliases are
   * not read on this surface. Accepts a bare CEL string or the normalized
   * `{ dialect, source }` Expression envelope the spec emits at parse.
   */
  visibleWhen?: string | boolean | { dialect?: string; source?: string };
  children: any[];
}

const formatTabCount = (v: number | string): string => {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return String(v);
  if (n >= 10000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
};

/**
 * One `record:related_list` the tab badge may count, with the gates in front
 * of it: every node on its path (the list itself included) that declares a
 * node-level `visibleWhen`. The walk only RECORDS the gates; it evaluates
 * nothing, so its result depends on the tab's subtree alone. The verdicts are
 * taken at render, against the viewer's scope (objectui#12987).
 */
interface CollectedRelatedList {
  node: any;
  gates: any[];
}

/**
 * Walk a tab's children (depth-first) and collect every `record:related_list`
 * schema node. Used to auto-derive a count for the tab badge when the spec
 * author didn't supply one explicitly. Multiple lists are summed (Salesforce
 * "Related" tab convention).
 *
 * The gate is the node-level `visibleWhen`, the one key the spec declares for
 * it: `PageComponentSchema` declares `visibleWhen` on the node, and the
 * `record:related_list` props shape refuses a `properties.visibleWhen` by name.
 * A gate that does not pass hides its whole subtree in the tab body, so a list
 * below a hidden container carries that container's gate too.
 */
const collectRelatedLists = (
  nodes: any,
  acc: CollectedRelatedList[] = [],
  gates: any[] = [],
): CollectedRelatedList[] => {
  if (!nodes) return acc;
  const list = Array.isArray(nodes) ? nodes : [nodes];
  for (const n of list) {
    if (!n || typeof n !== 'object') continue;
    // `!== undefined`, the test `SchemaRenderer`'s own `visibleWhen` leg uses,
    // so a node it evaluates is a node this walk records as a gate.
    const pathGates = n.visibleWhen !== undefined ? [...gates, n] : gates;
    if (n.type === 'record:related_list' || n.type === 'record_related_list') {
      acc.push({ node: n, gates: pathGates });
      continue; // Don't descend into a related_list's own subtree.
    }
    // ⚠️ `body` STAYS, and an earlier pass of this change wrongly removed it.
    // This walker does not RENDER anything — it descends a tab's subtree to
    // count `record:related_list` nodes for a badge. `page:card` still reads
    // `body` for stored documents, so a stored subtree under that key is still
    // drawn; dropping it here made the renderer draw content this count could
    // not see, which is a wrong badge rather than a retirement. The rule for
    // every NON-RENDERING reader in this tree: while any renderer still reaches
    // stored `body` content, the readers that must see the same content keep
    // their arm (objectui#6771, escalation objectui#9916).
    // `items` stays for its own reason — the `list` registration's item channel,
    // objectui#9590's card, not this spelling.
    const candidates = [
      n.children,
      n.properties?.children,
      n.properties?.items,
      n.body,
      n.items,
    ];
    for (const c of candidates) {
      if (c) collectRelatedLists(c, acc, pathGates);
    }
  }
  return acc;
};

/**
 * One count probe: which collection to count, scoped how.
 *
 * `filter` is the declared scope carried on the `record:related_list` node
 * (objectui#4664) — absent for a list that declared none, which keeps the
 * probe's query and its cache key byte-identical to what they were.
 */
interface Probe {
  objectName: string;
  relationshipField?: string;
  filter?: Record<string, any> | any[];
  attachments?: boolean;
}

/**
 * Walk a tab's children (depth-first) and return true when a
 * `record:attachments` node is present. The Attachments tab
 * (objectstack#4358) derives its badge from a `sys_attachment` count scoped
 * by `(parent_object, parent_id)` — a two-key filter the related-list probe
 * shape can't express, so it gets its own detection + probe path below.
 */
const containsAttachmentsNode = (nodes: any): boolean => {
  if (!nodes) return false;
  const list = Array.isArray(nodes) ? nodes : [nodes];
  for (const n of list) {
    if (!n || typeof n !== 'object') continue;
    if (n.type === 'record:attachments') return true;
    // `body` stays — same ground as `collectRelatedLists` above.
    const candidates = [n.children, n.properties?.children, n.properties?.items, n.body, n.items];
    for (const c of candidates) {
      if (c && containsAttachmentsNode(c)) return true;
    }
  }
  return false;
};

const PageTabsRenderer: React.FC<any> = ({ schema, className, ...props }) => {
  const { designer } = splitDesignerProps(props);
  // The block's `aria` bag, on the `Tabs` root (see "The `aria` bag of the four
  // page blocks" above).
  const displayLocale = useDisplayLocale();
  const tabsAria = resolveInlineAriaProps(schema?.aria, displayLocale);
  // `useTabsTranslation` surfaces `language` itself (it wraps
  // `useObjectTranslation`), so the count-badge copy and the tab-label
  // localization below read the same session locale from one hook.
  const { t: tTabs, language } = useTabsTranslation();
  // The pack half of `translateLabel` (objectui#4645). Per-call rather than a
  // second defaults map: these keys carry no interpolation, and the English
  // token IS the fallback, so `useSafeTranslate`'s (keys, fallback) shape is
  // exactly the lookup.
  const ttLabel = useSafeTranslate();
  const rawItems: PageTabsItem[] = schema?.items || [];
  // Tab visual style lives at `properties.type` ('line'|'card'|'pill') — the
  // outer `schema.type` is always 'page:tabs' (the component dispatch key).
  const type: 'line' | 'card' | 'pill' = schema?.properties?.type || schema?.tabStyle || 'line';
  const position: 'top' | 'left' = schema?.position || 'top';
  const isVertical = position === 'left';

  // Auto-derive tab counts from any `record:related_list` descendant of
  // each tab. The fetch is a `limit:1` find so we only consume the `total`
  // — cheap relative to the eventual list render the user gets when they
  // open the tab. Spec authors that pass `count` explicitly win.
  //
  // Counts are kept in a module-scoped store (`RelatedCountStore`) so:
  //   - sibling tab strips on the same record don't re-probe identical keys
  //   - bulk mutations elsewhere in the app (delete, create, save) can
  //     `RelatedCountStore.invalidate(objectName, parentId)` and every
  //     subscriber updates with no parent re-render.
  const ctx = useRecordContext();
  // objectui#13010 — the parent is the record the context NAMES (on a record
  // page, the route's id), not the id inside the loaded row. Keyed on
  // `ctx.data.id`, every count probe waited for the record read to land and
  // went out a full wave behind it, although an ungated probe needs nothing
  // from the record body: its filter is the relationship field and this id.
  // `recordId` is a required member of `RecordContextValue` that every
  // provider fills (`null` when it names no record), so this is the one read,
  // not a fallback. The probes that DO need the body — the ones behind a
  // `visibleWhen` — wait for it in `probeTargets` below.
  const parentId = ctx?.recordId ?? undefined;
  const ds = ctx?.dataSource;

  // Conditional tabs (framework#2606): an item-level `visibleWhen` CEL
  // predicate removes the ENTIRE tab (header + panel) when FALSE — unlike a
  // child component's own `visibleWhen`, which hides only the panel content
  // and leaves an empty tab header behind. Same binding environment as
  // page-component `visibleWhen`: record fields (bare and via `record.` /
  // `data.`), `user`/`current_user`, and page state as `page.<var>` — so tabs
  // appear/disappear live as page variables change. Canonical key only
  // (ADR-0089): the deprecated `visibility`/`visibleOn` aliases are not read
  // on this new surface.
  const predicateScope = usePredicateScope();
  const { variables: pageVariables } = usePageVariables();
  const recordData: any = ctx?.data;
  const isItemVisible = (it: PageTabsItem): boolean => {
    if (it?.visibleWhen === undefined || it?.visibleWhen === null) return true;
    // The node scope (`buildNodeEvaluationScope`: the ambient scope,
    // `current_user`, `record`, `page`) plus this site's own breadth: the row
    // spread flat underneath, and `record` / `data` set to the row
    // unconditionally on top. Composed rather than spelled out again, so a
    // root added to the node scope reaches this gate too (objectui#12992).
    const evaluator = new ExpressionEvaluator({
      ...(recordData && typeof recordData === 'object' ? recordData : {}),
      ...buildNodeEvaluationScope(predicateScope, recordData, pageVariables),
      record: recordData,
      data: recordData,
    });
    // objectui#13286 — a declared item predicate that FAULTS hides its tab
    // (fail-CLOSED). `evaluateCondition` answers a fault with its fail-soft
    // `true`, so this site reads the fault off the same single engine call's
    // `onFault` and overrides that answer, rather than paying for a second
    // `throwOnError` evaluation. The gate is a visibility gate whose `false`
    // removes the whole tab (header and panel): a predicate over the CEL
    // bounds, a type error or a missing function used to draw the tab for a
    // viewer the predicate was written to exclude.
    //
    // A gate that declares nothing — `''`, whitespace, an empty-`source`
    // envelope (`hasDeclaredPredicate` is false) — still means "no gate": it is
    // diagnosed through the same `onFault` but stays visible, like an absent
    // `visibleWhen`. A hidden ACTIVE tab falls back to the first visible tab
    // through the same filter a predicate that says `false` goes through.
    //
    // Reported through the SAME reporter and the SAME dedupe `Set` as the node
    // gate (objectui#6038), so one authored predicate is one line however
    // often it is re-rendered. The `'withholding'` consequence is the shared
    // reporter's fail-closed visibility copy: the tab is withheld, not drawn.
    const declared = hasDeclaredPredicate(it.visibleWhen);
    let faulted = false;
    const verdict = evaluator.evaluateCondition(it.visibleWhen, {
      onFault: (reason) => {
        faulted = true;
        // `'page-component'`, not a tier of its own (objectui#6487): the bag
        // built above binds `record`, `current_user` and `page.<var>` — the
        // three roots the node tier's advice paragraph names — so an author who
        // faults here needs exactly that paragraph. The extra breadth this site
        // adds (the row spread flat, `data` aliased to the row) is undeclared on
        // both surfaces, so it is not advertised on either.
        reportUnresolvableVisibilityPredicate(
          'page:tabs',
          schema?.id,
          'visibleWhen',
          it.visibleWhen,
          reason,
          'page-component',
          declared ? 'withholding' : 'visibility',
        );
      },
    });
    return declared && faulted ? false : verdict;
  };
  const visibleFlags = rawItems.map(isItemVisible);
  // Keep the filtered array's identity stable while visibility is unchanged
  // (usePageVariables returns a fresh object per render outside a Page), so
  // the count-probe memo/effect below don't re-walk on unrelated renders.
  const visibleKey = visibleFlags.join(',');
  const items = React.useMemo(
    () => rawItems.filter((_, i) => visibleFlags[i]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rawItems, visibleKey],
  );
  // Subscribe to the store version so badges re-render on invalidation /
  // remote count updates, and RE-PROBE freshly-invalidated keys (#2269): the
  // version is a dep of the probe effect below, so an invalidation (deleted
  // cache entries) triggers a refetch instead of leaving the badge stale.
  const countsVersion = useRelatedCountVersion();

  // Snapshot which tabs (index → derived (objectName, relationshipField))
  // need a count probe. Cached per items reference so we don't re-walk on
  // every render.
  const recordObject: string | undefined = ctx?.objectName;

  // objectui#12987 — a related list the tab body does not draw is not counted.
  // The body draws each block through `SchemaRenderer`, which decides a node's
  // `visibleWhen` with `ExpressionEvaluator.evaluateCondition` over the scope
  // `buildNodeEvaluationScope` builds. The gates below are decided by that same
  // evaluator over a scope built by that same function (objectui#12992), from
  // the same three hooks — NOT the item-level scope of `isItemVisible` above,
  // which also spreads the row flat and binds `data`.
  //
  // A predicate that cannot be evaluated (a root still loading, a malformed
  // source, a source over the CEL bounds) is treated as the body treats it
  // (objectui#13299): a DECLARED gate that faults is closed, so the block is
  // withheld and its list is not counted; a blank gate that declares nothing
  // stays open. The fault is read off this single engine call's `onFault`,
  // as the body reads it. The verdicts are re-taken every render, so a gate
  // that opens once its scope arrives adds the list to the badge on that
  // render. A fault is reported through the body's reporter, with the body's
  // consequence copy, whose dedupe key is (node type, key, source), so one
  // broken predicate is still one line.
  //
  // The walk runs per render (a tab's subtree is small) and its verdicts are
  // folded into `listGateKey`, a string, so the probe memo below keys on the
  // VALUE of the verdicts and never on a memo's identity (AGENTS.md #10).
  const listsByItem = items.map((it) =>
    it.count !== undefined && it.count !== null && it.count !== ''
      ? []
      : collectRelatedLists((it as any).children),
  );
  const gateVerdicts = new Map<any, boolean>();
  let blockEvaluator: ExpressionEvaluator | undefined;
  const isGateOpen = (gate: any): boolean => {
    const known = gateVerdicts.get(gate);
    if (known !== undefined) return known;
    blockEvaluator ??= new ExpressionEvaluator(
      buildNodeEvaluationScope(predicateScope, recordData, pageVariables),
    );
    let declared = true;
    let faulted = false;
    const verdict = blockEvaluator.evaluateCondition(gate.visibleWhen, {
      onFault: (reason) => {
        faulted = true;
        // Asked only on a fault, as the body asks it: `hasDeclaredPredicate`
        // reports a blank gate as a side effect.
        declared = hasDeclaredPredicate(gate.visibleWhen);
        reportUnresolvableVisibilityPredicate(
          gate.type,
          gate.id,
          'visibleWhen',
          gate.visibleWhen,
          reason,
          'page-component',
          declared ? 'withholding' : 'visibility',
        );
      },
    });
    const open = declared && faulted ? false : verdict;
    gateVerdicts.set(gate, open);
    return open;
  };
  const shownListsByItem = listsByItem.map((lists) =>
    lists.filter((entry) => entry.gates.every(isGateOpen)),
  );
  const listGateKey = listsByItem
    .map((lists, idx) => lists.map((entry) => (shownListsByItem[idx].includes(entry) ? '1' : '0')).join(''))
    .join('|');

  // objectui#13010 — whether the record BODY is here yet. The probes no longer
  // wait for it (see `parentId`), except where a verdict reads it: a list
  // behind a node-level `visibleWhen`, or in a tab whose item-level
  // `visibleWhen` decides it, is probed once the body has landed, as every
  // probe was before. Counting it sooner would spend a request on a list the
  // gate may close the moment its record arrives.
  const recordLoaded = recordData !== undefined && recordData !== null;
  const probeTargets = React.useMemo(() => {
    const out = new Map<number, Array<Probe>>();
    items.forEach((it, idx) => {
      if (it.count !== undefined && it.count !== null && it.count !== '') return;
      const itemGated = it.visibleWhen !== undefined;
      if (itemGated && !recordLoaded) return;
      const lists = shownListsByItem[idx]
        .filter((entry) => recordLoaded || entry.gates.length === 0)
        .map((entry) => entry.node);
      const probes: Array<Probe> = [];
      for (const rl of lists) {
        const objectName: string | undefined = rl?.properties?.objectName || rl?.objectName;
        if (!objectName) continue;
        const relationshipField: string | undefined =
          rl?.properties?.relationshipField || rl?.relationshipField;
        // objectui#4664 — the list's OWN declared scope, read off the very node
        // this badge is counting for. The badge must answer the same question
        // the rows do: `RelatedList` ANDs this filter with
        // `{ [relationshipField]: parentId }` for the rows, and the store ANDs
        // the same pair for the count. Skipping it is what produces the defect
        // this reads against — a badge saying 7 above a list showing 3.
        const filter = rl?.properties?.filter ?? rl?.filter;
        probes.push({
          objectName,
          relationshipField,
          ...(filter === undefined || filter === null ? {} : { filter }),
        });
      }
      // Attachments tab (objectstack#4358): count sys_attachment rows scoped
      // to this record. The synthetic `relationshipField` below is only a
      // cache-key discriminator — the actual filter is injected by the probe
      // wrapper in the effect, since the store's single-key filter shape
      // can't express `(parent_object, parent_id)`.
      if (recordObject && containsAttachmentsNode((it as any).children)) {
        probes.push({ objectName: 'sys_attachment', relationshipField: `attachments:${recordObject}`, attachments: true });
      }
      if (probes.length > 0) out.set(idx, probes);
    });
    return out;
    // `shownListsByItem` is fresh each render; `listGateKey` is its value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, recordObject, listGateKey, recordLoaded]);
  // objectui#6697 — the probe effect below keys on THIS string, not on the
  // `Map` above. `useMemo` is a pure optimisation, not a correctness
  // dependency: React may discard the cache and recompute even when
  // `[items, recordObject]` compare equal, and the factory builds a brand new
  // `Map` every time, so naming `probeTargets` in the effect re-probed every
  // tab on a discard alone. A string cannot carry that identity churn — it
  // compares by VALUE — so the effect now re-runs only when the probe set
  // really differs. Derived inside a memo of its own so the walk is paid once
  // per genuine recompute rather than once per render.
  const probeKey = React.useMemo(
    () => JSON.stringify(Array.from(probeTargets.entries())),
    [probeTargets],
  );

  React.useEffect(() => {
    if (!ds || typeof ds.find !== 'function') return;
    if (probeTargets.size === 0) return;
    let cancelled = false;
    void (async () => {
      // objectui#8882 — the badge asks the SAME question of the parent
      // relationship that the rows do, and that question's spelling depends on
      // the relationship field's ARITY. The store compiles it through
      // `composeParentScopeFilter`, the one compiler `RelatedList` uses for the
      // ROWS, but that seam can only answer from METADATA — so this call site
      // owes it the child object's field defs. It is the same `DataSource` the
      // row side reads them from, one layer up.
      //
      // Resolved BEFORE any probe rather than gating on a loaded schema: an
      // adapter without `getObjectSchema`, or one whose fetch rejects, still
      // probes — the seam then compiles the historical equality wire, which is
      // byte for byte what this effect sent before this card. What is NOT done
      // is probing first and correcting later: the store caches the first
      // answer it gets, and a lenient backend that answers the wrong question
      // with a number would have that number cached and never re-probed.
      const fieldsFor = new Map<string, unknown>();
      if (typeof ds.getObjectSchema === 'function') {
        const names = new Set<string>();
        for (const probes of probeTargets.values()) {
          for (const probe of probes) {
            // The attachments probe's `relationshipField` is a synthetic cache
            // discriminator, not a field on `sys_attachment`, and its wrapper
            // below replaces `$filter` outright — there is no arity to read.
            if (!probe.attachments) names.add(probe.objectName);
          }
        }
        await Promise.all(
          Array.from(names).map(async (name) => {
            try {
              fieldsFor.set(name, (await ds.getObjectSchema(name))?.fields);
            } catch {
              // Equality it is — the wire this effect has always sent.
            }
          }),
        );
      }
      if (cancelled) return;
      for (const probes of probeTargets.values()) {
        for (const probe of probes) {
          // RelatedCountStore.fetch is internally deduplicated, so concurrent
          // mounts of multiple tab strips don't generate redundant requests.
          // The attachments probe overrides the store-built single-key filter
          // with the two-key `(parent_object, parent_id)` scope; the synthetic
          // relationshipField keeps the cache key unique, and the store's
          // `sys_attachment` invalidation (data-change bus) still hits it.
          const finder = probe.attachments
            ? (object: string, query: any) =>
                ds.find(object, {
                  ...query,
                  $filter: { parent_object: recordObject, parent_id: parentId },
                })
            : (object: string, query: any) => ds.find(object, query);
          void RelatedCountStore.fetch(
            finder,
            probe.objectName,
            probe.relationshipField,
            parentId,
            probe.filter,
            probe.attachments ? undefined : (fieldsFor.get(probe.objectName) as any),
          ).catch(() => 0);
          if (cancelled) return;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ds, probeKey, parentId, countsVersion]);

  // Compute the displayed count by reading the store for every probe target.
  // useRelatedCountVersion above subscribed us to changes, so any store update —
  // whether from this effect or from an external invalidate — re-renders.
  const computeCount = (idx: number): number | undefined => {
    const probes = probeTargets.get(idx);
    if (!probes || probes.length === 0) return undefined;
    let sum = 0;
    let seenAny = false;
    for (const p of probes) {
      const v = RelatedCountStore.get(p.objectName, p.relationshipField, parentId, p.filter);
      if (v !== undefined) {
        sum += v;
        seenAny = true;
      }
    }
    return seenAny ? sum : undefined;
  };

  // Prefer an item's own STABLE `value` (semantic keys like `details` /
  // `related:<child>`, emitted by buildDefaultTabs — objectui#2257); fall back
  // to the index-derived value for authored schemas that don't declare one.
  // Stable values are what make the active tab URL-addressable: an index
  // value would silently point at a different tab when the item list changes.
  const itemsWithValue = items.map((it, idx) => ({
    ...it,
    value: typeof (it as any).value === 'string' && (it as any).value !== '' ? (it as any).value : `tab-${idx}`,
    // pickLocalized first (honours `{ en, zh }` / `{ default }`); translateLabel
    // then maps any plain-English well-known token (Details/Related/…) to the locale.
    labelStr: translateLabel(pickLocalized(it.label, language), language, ttLabel),
    // Explicit spec count wins; otherwise fall back to the derived probe.
    count: it.count !== undefined && it.count !== null && it.count !== ''
      ? it.count
      : computeCount(idx),
  }));

  // Host-provided initial tab (e.g. app-shell restoring `?tab=` — the active
  // tab is state that must SURVIVE this component remounting, so it cannot
  // live only in Radix's internal uncontrolled state). Honored only when it
  // names an actual tab; otherwise the first tab wins as before.
  const requestedDefault: string | undefined = (schema as any)?.defaultTab;
  const defaultValue =
    (requestedDefault && itemsWithValue.some((it) => it.value === requestedDefault)
      ? requestedDefault
      : undefined) ?? itemsWithValue[0]?.value;
  // Host callback on tab switch (app-shell writes `?tab=` with replace).
  const onTabChange: ((value: string) => void) | undefined = (schema as any)?.onTabChange;

  // Controlled active tab so a CONDITIONAL tab can vanish under the user
  // (framework#2606): when the active tab's `visibleWhen` flips FALSE (a page
  // variable or record change), fall back to the first visible tab instead of
  // leaving Radix pointing at a value with no trigger/panel — a blank content
  // area. The user's own selection is kept whenever it is still visible, and
  // restored semantics for `?tab=` (`defaultTab`) are unchanged.
  const [selectedValue, setSelectedValue] = React.useState<string | undefined>(defaultValue);
  const activeValue =
    (selectedValue && itemsWithValue.some((it) => it.value === selectedValue)
      ? selectedValue
      : undefined) ?? itemsWithValue[0]?.value ?? '';

  const listClass = cn(
    isVertical && 'flex-col h-auto items-stretch p-1',
    type === 'card' && 'bg-transparent gap-1',
    type === 'pill' && 'bg-muted rounded-full p-1 gap-1',
    // 'line' is the default: an anchored, underline-style strip. The Shadcn
    // primitive defaults to a pill-card look (bg-muted, rounded-md) that
    // floats unmoored on long record pages — override it so the strip reads
    // as a section anchor with a bottom border + per-trigger underline.
    type === 'line' && !isVertical && 'h-auto rounded-none bg-transparent p-0 gap-4 border-b border-border w-full justify-start',
    // Pin the horizontal tab strip to the top of the scroll container so
    // users keep their bearings on long record pages. Skipped for vertical
    // layouts where the strip is a sidebar, not a header.
    !isVertical && 'sticky top-0 z-20 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60',
  );

  const triggerClass = () => cn(
    isVertical && 'justify-start',
    type === 'card' && 'data-[state=active]:bg-background data-[state=active]:border data-[state=active]:shadow-sm rounded-md',
    type === 'pill' && 'rounded-full data-[state=active]:bg-background',
    type === 'line' && !isVertical && 'rounded-none border-b-2 border-transparent bg-transparent px-1 pb-2.5 -mb-px shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-foreground',
  );

  return (
    <Tabs
      value={activeValue}
      onValueChange={(v) => {
        setSelectedValue(v);
        onTabChange?.(v);
      }}
      orientation={isVertical ? 'vertical' : 'horizontal'}
      className={cn(className, isVertical && 'flex gap-4 w-full')}
      {...designer}
      {...tabsAria}
    >
      {/* Hide the tab strip entirely when there's only one tab — a single
          pill labelled "Details" is visual clutter rather than an
          affordance. Authors who want the strip even at length 1 pass
          `alwaysShowStrip: true`.

          BOTH spellings are read, canonical FIRST, and the top-level arm is
          why: `alwaysShowStrip` is a PUBLISHED input since objectui#4668, and
          `inputs` publishes top-level keys — `gen-manifest.ts`,
          `sdui-intrinsics.d.ts` and `sdui-parser`'s prop walk all judge the
          flat `{ type: 'page:tabs', alwaysShowStrip: true }`. This read was
          `properties.*`-only, so that flat form passed every one of those
          layers and was then dropped here. Measured on a one-tab schema before
          the arm was added: the wrapped form showed the strip, the flat form
          did not — publishing the key without this arm would have advertised a
          write the renderer throws away, which is the exact defect the parity
          gate exists to prevent, one layer further in.

          `SchemaRenderer` hoists `properties.*` onto the schema (it keeps the
          bag intact for the collision-prone `type` / `id`), so the canonical
          arm already covers the wrapped form; the `properties` arm stays for
          any path that reaches this renderer without that hoist. The same dual
          read `maxVisible` / `mobileMaxVisible` carry below, for the same
          reason. */}
      {(itemsWithValue.length > 1 ||
        schema?.alwaysShowStrip === true ||
        schema?.properties?.alwaysShowStrip === true) && (
        <TabsList className={listClass}>
          {itemsWithValue.map((item) => (
            <TabsTrigger key={item.value} value={item.value} className={triggerClass()}>
              {item.icon && (
                <LazyIcon
                  name={item.icon}
                  className="mr-1.5 h-3.5 w-3.5 shrink-0 opacity-70"
                  aria-hidden
                />
              )}
              <span>{item.labelStr}</span>
              {item.count !== undefined && item.count !== null && item.count !== '' && Number(item.count) > 0 && (
                <span
                  className="ml-1.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-muted px-1 text-[10px] font-medium leading-none text-muted-foreground"
                  // The accessible name and the visible digits never disagree.
                  // Below 1000 the badge shows the number itself, so it goes in
                  // as a NUMBER and i18next selects the CLDR slot from it
                  // (objectui#11445). A shortened `1.2k` goes in as the STRING
                  // the badge shows: i18next plural-selects only for a number,
                  // so the base key answers, and every pack writes it in a
                  // count-invariant form (`Элементов: 1.2k`).
                  aria-label={tTabs('common.itemCount', {
                    count: Number(item.count) < 1000 ? Number(item.count) : formatTabCount(item.count),
                  })}
                >
                  {formatTabCount(item.count)}
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      )}
      {itemsWithValue.map((item) => (
        <TabsContent
          key={item.value}
          value={item.value}
          className={cn(
            itemsWithValue.length > 1 ? 'mt-3' : 'mt-0',
            isVertical && 'mt-0 flex-1',
          )}
        >
          {renderChildren(item.children)}
        </TabsContent>
      ))}
    </Tabs>
  );
};

ComponentRegistry.register('tabs', PageTabsRenderer, {
  namespace: 'page',
  skipFallback: true,
  label: 'Page Tabs',
  category: 'layout',
  isContainer: true,
  // `alwaysShowStrip` is DECLARED, not merely honoured (objectui#4668).
  // @objectstack/spec 17.0.0 GA declares it on `PageTabsProps` and this
  // renderer has read it since the one-tab strip was first suppressed, while
  // `inputs` omitted it — so the manifest, the generated `.d.ts` and the
  // designer panel all said the key did not exist, `sdui-parser` reported
  // `unknown-prop` on an author who wrote it anyway, and the renderer honoured
  // it regardless. Same defect as `record:details.hideFields` in objectui#3808.
  inputs: [
    { name: 'items', type: 'array', of: 'object', required: true, description: 'Tab definitions [{ label, value?, icon?, count?, visibleWhen?, children }] — value is the stable ?tab= URL token, count auto-derives from record:related_list descendants when omitted' },
    { name: 'tabStyle', type: 'enum', enum: ['line', 'card', 'pill'] },
    { name: 'position', type: 'enum', enum: ['top', 'left'] },
    { name: 'alwaysShowStrip', type: 'boolean', description: 'Keep the tab strip visible when only one tab survives. Default false: a lone pill is clutter rather than an affordance, so a one-tab strip is hidden and its panel renders bare. Count the tabs AFTER each item visibleWhen predicate has been evaluated — a page authored with four tabs of which three are conditional reaches this rule whenever the other three are false.' },
  ],
});

// ---------------------------------------------------------------------------
// page:card
// ---------------------------------------------------------------------------

const PageCardRenderer: React.FC<any> = ({ schema, className, ...props }) => {
  const { designer } = splitDesignerProps(props);
  const { language } = useObjectTranslation();
  // The block's `aria` bag, on the `Card` root (see "The `aria` bag of the four
  // page blocks" above).
  const displayLocale = useDisplayLocale();
  const cardAria = resolveInlineAriaProps(schema?.aria, displayLocale);
  // Resolve the title via pickLocalized so inline-i18n shapes (`{ en, zh }`)
  // render in the active locale. `labelText` only understands `{ default, value }`
  // and would silently blank an `{ en, zh }` title — e.g. the Cloud Pricing
  // page's per-plan name + price headings vanished in both locales.
  const title = pickLocalized(schema?.title, language);
  const bordered = schema?.bordered !== false;
  // `children` is the authorable spelling; `body` is a READ-ONLY back-compat
  // fallback for documents already stored with it (objectui#4027).
  //
  // `body` was retired from the contract by objectstack#5775 (objectstack `85ec26d28`, ADR-0087
  // D2): it was a second spelling of the slot every other container — grid, flex,
  // section, tabs items — calls `children`, and the spec now declares `children`
  // on `PageCardProps` and rejects `body` by name. The registration below stopped
  // publishing `body` in the same change, so nothing teaches it any more.
  //
  // The READ deliberately stays, and stays FIRST: a stored document written
  // against the old contract still renders until the ADR-0087 D2 conversion
  // rewrites `body` → `children` at load time. Order matters only for a document
  // carrying both, which the conversion is what resolves; deleting the read
  // before the conversion is live would blank an existing card's content
  // silently — the `page-header-subtitle-alias` sequencing precedent, verbatim.
  // ⚠️ ONE OF FOUR SURVIVING FALLBACKS, all in this file: this one and the
  // three thin `page:section` / `page:footer` / `page:sidebar` containers
  // below. ⛔ Do not delete any of them on the authority of this comment —
  // objectui#6771 retired the spelling on every RENDERER outside the `page:*`
  // namespace, and what holds these four is stored documents, not the
  // authoring face.
  //
  // What separates THIS one from the three below is a CONVERSION, not a
  // ground: `@objectstack/spec`'s conversions registry carries
  // `page-card-body-to-children` (`toMajor: 17`, surface
  // `page.component.page:card.body`) and carries nothing for the other three.
  // ⇒ a stored row under this key has a migration path; a stored row under
  // theirs has none. Escalated as objectui#9916.
  const body = schema?.body ?? schema?.children;
  const footer = schema?.footer;

  return (
    <Card
      className={cn(className, !bordered && 'border-0 shadow-none bg-transparent')}
      {...designer}
      {...cardAria}
    >
      {title && (
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
      )}
      {/* ⛔ No `&&` guard on a node slot (objectui#9162): `&&` evaluates to
          the slot itself, so a legal authored `body: 0` painted the character
          "0" — and this renderer's `schema` is `any`, which is why the card's
          TypeScript census could not see these two while the runtime probe
          could. `renderNodeSlot` invokes the wrapper only when the slot has
          content, so the chrome disappears with it. */}
      {/* A list of children lays out on the page block grid, the way a
          region's blocks do (objectui#12624): four metric tiles in a card
          share a row on a wide screen. */}
      {renderNodeSlot(body, (node) => (
        <CardContent>{renderBlockChildren(node, renderChildren)}</CardContent>
      ))}
      {renderNodeSlot(footer, (node) => (
        <CardFooter className="flex justify-between">{renderChildren(node)}</CardFooter>
      ))}
    </Card>
  );
};

ComponentRegistry.register('card', PageCardRenderer, {
  namespace: 'page',
  skipFallback: true,
  label: 'Page Card',
  category: 'layout',
  isContainer: true,
  inputs: [
    // Two arms, because the contract has two (objectui#3832): the spec's
    // `PageCardProps.title` accepts a plain string OR an inline translation map,
    // and the renderer resolves both (`pickLocalized` at the read site above).
    // While this said `type: 'string'` the manifest gate reported
    // `type-mismatch` on the map form — the shape this input's own description
    // teaches — so the block contradicted itself on a write it recommended.
    { name: 'title', type: ['string', 'object'], description: 'Accepts an inline translation map ({ en, "zh-CN", … })' },
    { name: 'bordered', type: 'boolean' },
    // The card's content slot, respelled from `body` to `children`
    // (objectui#4027). One slot, one spelling: objectstack#5775 (objectstack `85ec26d28`)
    // retired `PageCardProps.body` and declared `children` in its place, so a
    // designer that kept offering `body` was teaching a key the contract now
    // rejects by name. The renderer still READS `body` for stored documents —
    // see the comment at its read site above — but a back-compat read is not a
    // second authorable spelling, and `inputs` is the authoring surface.
    { name: 'children', type: 'slot', description: 'Card content components, in order (the card body slot)' },
    { name: 'footer', type: 'slot' },
  ],
});

// ---------------------------------------------------------------------------
// page:accordion
// ---------------------------------------------------------------------------

interface PageAccordionItem {
  label: any;
  icon?: string;
  collapsed?: boolean;
  children: any[];
}

const PageAccordionRenderer: React.FC<any> = ({ schema, className, ...props }) => {
  const { designer } = splitDesignerProps(props);
  const { language } = useObjectTranslation();
  // The block's `aria` bag, on the `Accordion` root of either variant (see
  // "The `aria` bag of the four page blocks" above).
  const displayLocale = useDisplayLocale();
  const accordionAria = resolveInlineAriaProps(schema?.aria, displayLocale);
  // Same lookup the tab strip reads (objectui#4645) — `page:accordion` is the
  // other renderer that localizes well-known English section labels, and the
  // two must not answer differently for the same token.
  const ttLabel = useSafeTranslate();
  const items: PageAccordionItem[] = schema?.items || [];
  const allowMultiple = !!schema?.allowMultiple;
  // Variants:
  //   - `flush` (default): no per-item border. Lets the inner content (e.g.
  //     a `record:related_list` Card) provide its own containment so the
  //     accordion doesn't fight with nested visuals.
  //   - `card`: legacy bordered look. Authors opt in by setting
  //     `variant: 'card'` (or `properties.variant: 'card'`) on the schema.
  const variant: 'flush' | 'card' =
    schema?.variant ?? schema?.properties?.variant ?? 'flush';
  const itemClass = variant === 'flush' ? 'border-b last:border-b-0' : undefined;

  const itemsWithValue = items.map((it, idx) => ({
    ...it,
    value: `panel-${idx}`,
    labelStr: translateLabel(pickLocalized(it.label, language), language, ttLabel),
  }));

  const defaultOpen = itemsWithValue
    .filter((it) => it.collapsed === false)
    .map((it) => it.value);

  // Radix Accordion has separate single/multiple variants; render the right
  // one without trying to share a generic prop bag.
  const commonChildren = itemsWithValue.map((item) => (
    <AccordionItem key={item.value} value={item.value} className={itemClass}>
      <AccordionTrigger className="text-sm font-semibold tracking-tight hover:no-underline">
        {/* One wrapping element, not two siblings — AccordionTrigger's
            underlying primitive (`ui/accordion.tsx`, no-touch zone) lays its
            children out with `justify-between` against the auto-appended
            ChevronDown, so an icon + label passed as separate flex children
            would be spread apart instead of grouped (same pattern as the
            `page:tabs` trigger below, minus this wrapper — that trigger's
            own class list uses `justify-center`, not `justify-between`). */}
        <span className="flex items-center gap-1.5">
          {item.icon && (
            <LazyIcon
              name={item.icon}
              className="h-3.5 w-3.5 shrink-0 opacity-70"
              aria-hidden
            />
          )}
          <span>{item.labelStr}</span>
        </span>
      </AccordionTrigger>
      <AccordionContent>{renderChildren(item.children)}</AccordionContent>
    </AccordionItem>
  ));

  if (allowMultiple) {
    return (
      <Accordion
        type="multiple"
        defaultValue={defaultOpen}
        className={className}
        {...designer}
        {...accordionAria}
      >
        {commonChildren}
      </Accordion>
    );
  }

  return (
    <Accordion
      type="single"
      collapsible
      defaultValue={defaultOpen[0]}
      className={className}
      {...designer}
      {...accordionAria}
    >
      {commonChildren}
    </Accordion>
  );
};

ComponentRegistry.register('accordion', PageAccordionRenderer, {
  namespace: 'page',
  skipFallback: true,
  label: 'Page Accordion',
  category: 'layout',
  isContainer: true,
  inputs: [
    { name: 'items', type: 'array', of: 'object', required: true, description: 'Panel definitions [{ label, icon?, collapsed?, children }] — collapsed: false opens a panel by default' },
    { name: 'allowMultiple', type: 'boolean' },
    { name: 'variant', type: 'enum', enum: ['flush', 'card'] },
  ],
});

// ---------------------------------------------------------------------------
// page:section — thin wrapper used inside regions for grouping children.
// ---------------------------------------------------------------------------

const PageSectionRenderer: React.FC<any> = ({ schema, className, ...props }) => {
  const { designer } = splitDesignerProps(props);
  return (
    <section
      className={cn('space-y-4', className)}
      {...designer}
    >
      {/* A list of children lays out on the page block grid, as in
          `page:card` above (objectui#12624). */}
      {/*
        ⚠️ `body` KEPT on all three thin containers, and the ground is the
        SPEC'S OWN — ⛔ not the "they never published it" argument an earlier
        pass of this comment made, which was false in both directions.

        `@objectstack/spec`'s `PageContainerProps` names these three and says
        it outright: `children` is the canonical spelling and `body` is
        deliberately not declared, but 「The renderers keep reading `body` as a
        back-compat fallback for stored documents; that fallback is objectui's
        to retire on its own schedule, and it is not a second authorable
        spelling.」 ⇒ they share `page:card`'s ground exactly. What they lack is
        a CONVERSION: the spec's registry carries `page-card-body-to-children`
        and NOTHING for these three, so dropping this arm leaves a stored row
        with no migration path at all.

        The authoring corpus IS answerable, and was answered by the committed
        instrument rather than an ad-hoc scan:
          pnpm census:body-dialect --keys page:section,page:footer,page:sidebar,page:card,card
        CONTROL (fires): `card` + `body` 40 on the pre-retirement tree -> 2 on
        this one. SUBJECT: `page:section` resolves 6 nodes on both trees, 0
        with `body`, 4 with `children` — a LIT zero. ⚠️ `page:footer` and
        `page:sidebar` resolve 0 nodes at all, so their zero is a key-population
        zero and says nothing.

        ⇒ nothing in this repository authors it; whether a stored ROW does is a
        database question this tree cannot ask. Escalated as objectui#9916, and
        the two facts that belong to it are POSTED there (comment 5733844778),
        not merely asserted to be: the designer canvas already honours `children`
        ONLY for `page:section` (`PageBlockCanvas.tsx`), so runtime and canvas
        already disagree about a stored `body` here; and `page:card`'s "until the
        conversion lands" precondition is STALE — `pageCardBodyToChildren` carries
        `toMajor: 17` and `retiredFromLoadPath: true` and this repo installs spec
        17.4.0, so the live ground there is unreplayed stored rows.
      */}
      {renderBlockChildren(schema?.children || schema?.body, renderChildren)}
    </section>
  );
};

ComponentRegistry.register('section', PageSectionRenderer, {
  namespace: 'page',
  skipFallback: true,
  label: 'Page Section',
  category: 'layout',
  isContainer: true,
  inputs: PAGE_CONTAINER_INPUTS,
});

// ---------------------------------------------------------------------------
// page:header — title row + optional subtitle + action slot.
// `actions` entries are ACTION IDS, resolved against the object's own metadata
// (objectstack#11592 ruling, objectui#6252) — see `resolvedHeaderActions`.
// ---------------------------------------------------------------------------

/**
 * One-time diagnostics for header-action `visible` / `hidden` predicates
 * (#2358). Warn-once per (action, predicate) pair so re-renders don't spam the
 * console, mirroring ActionEngine's `warnHiddenPredicate` (objectstack-ai/objectstack#2183).
 *
 * The *fault* half of these diagnostics is no longer written here: since
 * objectui#3521 the predicates run through `evalRowPredicate`, whose own
 * warn-once machinery reports a faulting predicate under the label this file
 * passes (`page:header action "…" visible`) — one report per broken predicate,
 * identical in wording to the row kebab and the selection bar. What stays local
 * is the missing-field diagnostic below, which names a *fact* the engine cannot
 * see (the payload this page bound does not carry the key at all).
 */
const _warnedHeaderPredicates = new Set<string>();

/**
 * Warn when a predicate references `record.<field>` keys that are absent from
 * the loaded record payload (#2358 trap 3): a projected or partial read binds a
 * record without those keys, so such a predicate silently resolves to
 * `undefined` and fail-closed hides the action with no error to catch. A key
 * that is present-but-null does NOT trigger this (legitimately empty field).
 * Skipped while the record is empty/loading to avoid false positives.
 *
 * ⛔ Do NOT re-attribute this to `hidden: true` (`5a07e67d9`). `hidden` is a
 * UI concern ("Hidden from default UI"), not a projection rule: the framework's
 * read path drops `internal: true` columns and the `__search` companion, and
 * nothing else. This surface knows only WHICH keys the bound payload lacks; it
 * does not own the read that produced it, so it must not name a cause.
 */
function warnMissingRecordFields(name: unknown, source: string, record: unknown): void {
  if (!record || typeof record !== 'object' || Object.keys(record as object).length === 0) return;
  const re = /\brecord\.([A-Za-z_][A-Za-z0-9_]*)/g;
  const missing: string[] = [];
  for (let m = re.exec(source); m; m = re.exec(source)) {
    if (!(m[1] in (record as Record<string, unknown>)) && !missing.includes(m[1])) missing.push(m[1]);
  }
  if (missing.length === 0) return;
  const key = `missing::${String(name)}::${source}`;
  if (_warnedHeaderPredicates.has(key)) return;
  _warnedHeaderPredicates.add(key);
  console.warn(
    `[page:header] action "${String(name)}" predicate references record field(s) ` +
    `not present in the record payload: ${missing.join(', ')}. Predicate: ${source}. ` +
    `This page bound a record payload that does not carry those key(s) — a projected ` +
    `or partial read ($select, an embedded card, a custom page passing a projected ` +
    `record) will not include them — so the predicate fails closed and the action ` +
    `stays hidden.`,
  );
}

/**
 * Warn-once ledger for a declared header action id that resolved to nothing
 * (objectui#6252). Keyed by `object::id::reason` so one page cannot spam the
 * console across re-renders, mirroring `_warnedHeaderPredicates` above.
 */
const _warnedHeaderActionIds = new Set<string>();

/**
 * Report a `page:header.actions` id that the object's own metadata does not
 * define.
 *
 * ⛔ Deliberately LOUD rather than a silent drop. A dropped id is invisible by
 * construction — the header simply renders one button fewer, which is exactly
 * what an author who mistyped `covert_lead` sees, and exactly what an author
 * whose action is correctly gated by `visible` sees too. The silent-loss class
 * this avoids is the one this repo keeps re-filing (objectui#7146/#7147/#7148);
 * the resolution step is the only place that can still tell the two apart, so
 * it says so here.
 *
 * The object's registered names are named in the message because the fix is
 * almost always one of them.
 */
function warnUnresolvedHeaderActionId(
  id: string,
  objectName: string | undefined,
  reason: 'no-object' | 'no-metadata' | 'not-found',
  available: string[],
): void {
  const key = `${objectName ?? ''}::${id}::${reason}`;
  if (_warnedHeaderActionIds.has(key)) return;
  _warnedHeaderActionIds.add(key);
  const why =
    reason === 'no-object'
      ? 'this header is not bound to an object (no RecordContext `objectName`), so ids cannot be resolved at all'
      : reason === 'no-metadata'
        ? `no metadata could be read for object "${String(objectName)}" (no MetadataProvider in scope, or the object does not exist)`
        : `object "${String(objectName)}" declares no action by that name. Declared: ${
            available.length > 0 ? available.join(', ') : '(none)'
          }`;
  console.warn(
    `[page:header] action id "${id}" did not resolve — ${why}. ` +
    'Nothing is rendered for it. `PageHeaderProps.actions` is a list of ACTION IDS ' +
    "(@objectstack/spec: `z.array(z.string())`, \"Action IDs to show in header\"), " +
    "resolved against the object's own `actions` metadata the same way " +
    '`record:quick_actions` resolves them.',
  );
}

/**
 * Warn-once ledger for a refused `page:header.actions` array (objectui#7182),
 * keyed like `_warnedHeaderActionIds` above.
 */
const _refusedHeaderActionArrays = new Set<string>();

/**
 * Report a `page:header.actions` array `resolveDeclaredActionIds` refused — a
 * mixed id/object array, or an element that is neither (objectui#7182,
 * maintainer ruling 2026-09-02, option C).
 *
 * `console.error`, not `warn`: an unresolved id (above) is a lookup miss the
 * page may still be right about; a refused array is metadata the contract does
 * not accept, and the header draws NONE of its authored actions rather than the
 * half it could — drawing the half is exactly the "one array, two meanings"
 * defect the ruling closes. The message names the offending index so the fix
 * is a one-element edit, and the surface, so the same array refused by
 * `record:quick_actions` reads as the same rule.
 */
function reportRefusedHeaderActions(
  objectName: string | undefined,
  refusal: DeclaredActionsRefusal,
): void {
  const key = `${objectName ?? ''}::${refusal.index}::${refusal.message}`;
  if (_refusedHeaderActionArrays.has(key)) return;
  _refusedHeaderActionArrays.add(key);
  console.error(
    `[page:header] actions refused at index ${refusal.index} — ${refusal.message}. ` +
    'None of the authored actions is rendered. `PageHeaderProps.actions` is a list of ACTION IDS ' +
    '(@objectstack/spec: `z.array(z.string())`); an inline action object is a transition ' +
    'tolerance that must not share an array with ids.',
  );
}

/**
 * The download path a bare `sys_file` id resolves to. A private copy of
 * `@object-ui/fields`' `fileUrlFromId` rule; `recordPictureUrl` below says why
 * it is a copy.
 */
const RECORD_PICTURE_FILE_PATH = '/api/v1/storage/files/';

/**
 * The URL the record chrome draws the record's picture from, or `undefined`
 * when the value holds nothing to draw (objectui#11383).
 *
 * `value` is the served row's value of the field the object names in its
 * `imageField`. `@objectstack/spec` refuses at parse an `imageField` that
 * names an undeclared field or a field of any type but `image` / `avatar`, so
 * the type is not checked again here. The value takes the spec's read forms
 * for those types: the expanded `{ url, … }` the server hydrates a stored
 * reference into, or the bare `sys_file` id when it did not (the stable
 * download path serves it), a URL string on a row written before references,
 * and a list of these on a `multiple` field. The first entry that resolves
 * wins. Nothing else resolves: an object without a `url` is not a read form
 * the spec admits, so it is not drawn.
 *
 * ⚠️ A SECOND RESOLUTION, and it says so. `readFileValue` in `@object-ui/fields`
 * (its file-value module) resolves the same forms for the image cell
 * (`ImageCellRenderer`). It is not imported because `@object-ui/fields`
 * depends on this package, so the import would close a cycle, and moving that
 * resolver down into `@object-ui/core` adds a public export, which this change
 * does not make. The two agree on every form above; `readFileValue` also
 * accepts an id-only object, which this does not.
 * `packages/fields/src/widgets/file-value.recordChromeParity-11383.test.tsx`
 * keeps the two resolutions together (seat ruling 5981856796, option C), and
 * a change to either still has to be made in both.
 */
function recordPictureUrl(value: unknown): string | undefined {
  for (const entry of Array.isArray(value) ? value : [value]) {
    if (typeof entry === 'string') {
      if (!entry) continue;
      return isFileIdToken(entry)
        ? `${RECORD_PICTURE_FILE_PATH}${encodeURIComponent(entry)}`
        : entry;
    }
    if (entry !== null && typeof entry === 'object') {
      const url = (entry as { url?: unknown }).url;
      if (typeof url === 'string' && url) return url;
    }
  }
  return undefined;
}

/**
 * The props of {@link PageHeaderActions}.
 *
 * `actions`, `maxVisible` and `mobileMaxVisible` are `page:header`'s own
 * authored keys, read as that block reads them; the system actions are not a
 * prop, they come from `RecordContext.headerSystemActions` as they always did.
 */
export interface PageHeaderActionsProps {
  /** The authored `actions` array: action ids (the contract) or, during the transition, inline action objects. */
  actions?: unknown;
  /** The inline-button budget on desktop, as `page:header`'s `maxVisible`; an out-of-contract value falls back to 3. */
  maxVisible?: unknown;
  /** The inline-button budget on mobile, as `page:header`'s `mobileMaxVisible`; an out-of-contract value falls back to 1. */
  mobileMaxVisible?: unknown;
  /** Drawn in place of the action row when no action survives the gates. */
  emptySlot?: React.ReactNode;
}

/**
 * A record's header actions: the declared actions placed at `record_header` /
 * `record_more` and the host's system actions (Edit / Share / Delete), gated,
 * ordered, split into inline buttons and the `⋯` overflow, and dispatched
 * through the action runner.
 *
 * This is `page:header`'s action row, lifted out of `PageHeaderRenderer` so
 * that a host can draw the same row where a page has no `page:header`
 * (objectui#12906): a page that declares `print` may hold only the printable
 * component types, and `page:header` is not one of them, so the console's
 * record view draws this row in its screen-only chrome beside Print. It is
 * the ONE resolver for both surfaces, ⛔ never a second one. It must render
 * inside the record's `RecordContext` and `ActionProvider`, as `page:header`
 * does.
 */
export const PageHeaderActions: React.FC<PageHeaderActionsProps> = ({
  actions: rawHeaderActions,
  maxVisible: rawMaxVisible,
  mobileMaxVisible: rawMobileMaxVisible,
  emptySlot = null,
}) => {
  const ctx = useRecordContext();
  // Record-level inline-edit session (objectui#2572 item 4): while a shared
  // inline draft is active, header actions flagged `disableDuringInlineEdit`
  // (the host's Edit CTA) grey out so the classic form-edit surface can't be
  // stacked on top of the live draft — two competing edit sessions with no
  // reconciliation. `useInlineEdit` is null outside an InlineEditProvider
  // (non-record pages), which leaves everything enabled.
  const inlineEditing = !!useInlineEdit()?.editing;
  // Ambient host scope (signed-in user / app / features), fed by app-shell's
  // ExpressionProvider. Needed so header-action `visible` CEL predicates can
  // gate on `ctx.user.*` (e.g. sys_environment "Change Plan (admin)" →
  // `ctx.user.isPlatformAdmin == true`). Without it the action-visibility
  // evalCtx below only had record fields, so every `ctx.user`-gated header
  // action was silently filtered out.
  const predicateScope = usePredicateScope();
  const { execute } = useAction();
  // [ADR-0066 D4 / framework#3923] Shared capability gate — see filterAction.
  const mayInvoke = useCapabilityGate();
  const isMobile = useIsMobile();
  // The ONE resolver for a declared action's authored strings (objectui#4265).
  // This header used to localize `label` only — via `useObjectLabel().actionLabel`
  // inline below — and dispatch the action's `confirmText` / `successMessage`
  // untouched, so on an authored record page one bundle entry met two fates: the
  // button rendered the translation and the confirm dialog rendered the English
  // literal from the metadata.
  const localizeActionTexts = useActionTextLocalizer();
  // One id base for the disabled-reason descriptions the header's actions
  // render (objectui#11811); each action suffixes it, since `renderHeaderActions`
  // below draws them in a loop where no hook can be called.
  const disabledReasonIdBase = React.useId();
  // Console-supplied chrome copy (objectstack#5407). `detail.moreActions` is
  // the SAME key `action:menu`'s overflow trigger already reads, so the two
  // `⋯` buttons a record page can show cannot read differently per locale.
  const tt = useSafeTranslate();
  const headerObjectSchema: any = (ctx as any)?.objectSchema;
  const headerObjectName: string | undefined = ctx?.objectName || headerObjectSchema?.name;
  // System actions (Edit / Share / Delete) injected by the host via
  // `RecordContext.headerSystemActions`. Appended AFTER authored actions
  // and deduplicated by `name` so the host can always supply them
  // regardless of whether the page schema is authored (full Lightning) or
  // synthesised. Authored pages may opt out by omitting them at the host
  // or by adding a name-clashing action of their own.
  const hostSystemActions = (ctx as any)?.headerSystemActions as any[] | undefined;

  // ── Declared action IDS — the contract of record (objectstack#11592) ───────
  //
  // `@objectstack/spec`'s `PageHeaderProps.actions` is
  // `z.array(z.string()).describe('Action IDs to show in header')`, and has been
  // for as long as the key has existed. This renderer read the array as
  // `ActionDef` OBJECTS and resolved nothing, so metadata that satisfied the
  // published contract rendered ZERO buttons here — the defect objectstack#11592
  // reports and its ruling (maintainer, 2026-08-25, 「全部同意」 on recommendation
  // B) settles in favour of ids.
  //
  // Resolution happens HERE, at the top of the pipeline, so exactly ONE filter
  // chain runs below: `actionRendersAt` placement, the capability gate,
  // `visible` / `hidden` and `order` all see uniformly object-shaped defs and
  // are untouched by this. That is also what makes the equivalence claim
  // testable — an id-authored header and an object-authored header converge on
  // the same array before a single filter runs.
  //
  // The array's SHAPE and its resolution are `resolveDeclaredActionIds`'s call
  // (`@object-ui/types`, beside `actionRendersAt`) — the ONE rule this surface
  // shares with `record:quick_actions` (objectui#7182, maintainer ruling
  // 2026-09-02, option C). This file used to normalise PER ELEMENT while that
  // renderer switched on the WHOLE array, so a half-migrated `['convert', { … }]`
  // resolved the id and passed the object through here, and rendered nothing
  // for the id there: one authored array, two meanings. Now it has one — an
  // array is all ids or all inline objects, and a mixed array is REFUSED (none
  // of its authored actions is drawn, and the console names the offending
  // index) on both surfaces alike.
  //
  // The all-object arm survives as RENDERER TOLERANCE for the transition. It
  // stays UNDECLARED — the spec's contract is ids, and the spec already refuses
  // an object element at validation — and it is retired on its own card once
  // the last inline array has been converted, not here.
  const authoredHeaderActions = React.useMemo<unknown[]>(
    () => (Array.isArray(rawHeaderActions) ? rawHeaderActions : []),
    [rawHeaderActions],
  );
  // Registry-independent verdict first — the same function, called with no
  // registry: `kind` and `ids` are final from the shape alone, which is all
  // the hook-order question below needs (`useMetadataItem` runs every render,
  // so the read is requested or skipped before the registry exists).
  const headerActionsShape = React.useMemo(
    () => resolveDeclaredActionIds<any>(authoredHeaderActions, undefined),
    [authoredHeaderActions],
  );
  // `useMetadataItem` is the SAME entry `record:quick_actions` resolves through
  // — not a second lookup path. Passing `null` for the name is its documented
  // no-op, so a header with no ids (or no object bound) does not fetch.
  const needsActionLookup =
    headerActionsShape.kind === 'ids' && headerActionsShape.ids.length > 0 && !!headerObjectName;
  const { item: headerActionsObjectMeta, loading: headerActionsMetaLoading } = useMetadataItem(
    'object',
    needsActionLookup ? headerObjectName : null,
  );
  const resolvedHeaderActions = React.useMemo<any[]>(() => {
    const registered: any[] = Array.isArray(headerActionsObjectMeta?.actions)
      ? (headerActionsObjectMeta as any).actions
      : [];
    const declared = resolveDeclaredActionIds<any>(authoredHeaderActions, registered);
    if (declared.kind === 'refused') {
      reportRefusedHeaderActions(headerObjectName, declared);
      return [];
    }
    if (declared.kind === 'ids') {
      // The lookup has not answered yet. Render the ids as nothing rather than
      // as "unresolved" — the metadata read is in flight, and warning here would
      // fire on every first paint.
      const settled = !needsActionLookup || !headerActionsMetaLoading;
      if (settled) {
        const registeredNames = Array.from(
          new Set(
            registered
              .map((def: any) => (typeof def?.name === 'string' ? def.name : ''))
              .filter((name: string) => name !== ''),
          ),
        ) as string[];
        for (const { id } of declared.unresolved) {
          warnUnresolvedHeaderActionId(
            id,
            headerObjectName,
            !headerObjectName ? 'no-object' : (!headerActionsObjectMeta ? 'no-metadata' : 'not-found'),
            registeredNames,
          );
        }
      }
    }
    return declared.actions;
  }, [
    authoredHeaderActions,
    headerActionsObjectMeta,
    headerActionsMetaLoading,
    needsActionLookup,
    headerObjectName,
  ]);

  // ── Action predicates: ONE dialect, ONE entry (objectui#3521) ──────────────
  //
  // `visible` / `hidden` / `disabled` on a header action are evaluated by
  // `evalRowPredicate` — the SAME entry the row kebab (`RowActionMenu`), the
  // selection bar (`partitionBulkRows`) and conditional formatting have used
  // since objectui#1584 / ADR-0058. A bare string is therefore CEL, which is
  // what `@objectstack/spec` types `ActionSchema.visible` as and what the
  // server enforces with, so the CEL-only constructs an author writes once
  // (`record.tags.size() > 0`, `'"red" in record.f_multiselect'`,
  // `record.f_date < today()`) now reach a verdict here instead of throwing in
  // a JS parser and fail-closed hiding the button. Before this, the header was
  // the last surface still handing EVERY predicate to the legacy JS evaluator,
  // so one piece of metadata meant two different things depending on whether
  // the reader was a list row or a record page.
  //
  // A legacy-dialect string (`${…}`, `===`/`!==`, `?.`, `??`, JS-only methods
  // like `.includes()`) still routes to the legacy evaluator inside
  // `evalRowPredicate` via `isLegacyDialectSource`, with its one-time
  // deprecation warning — existing authored pages do not regress.
  //
  // Fail-closed and warn-once come from that same entry (`fallback: false`,
  // `warnOnError: true`), so a broken predicate hides its button here exactly
  // as it does on the other surfaces, and says so once.
  const headerPredicateFields = headerObjectSchema?.fields;
  const headerPredicateScope = React.useMemo(() => {
    const scopeUser = (predicateScope as any)?.user;
    // Relation fields bind as the FOREIGN KEY the server stores, not as the
    // record `$expand` substituted for them (objectui#3501): the detail fetch
    // expands every relation it can, so `record.owner == os.user.id` — the
    // spelling that works server-side and in a bare list — could only ever be
    // false here, while `record.owner.id` faults on an empty lookup. The
    // top-level `record` / bare-field / `data.*` bindings get this same
    // normalization from `evalRowPredicate`'s `fields` option below; this copy
    // is for the `ctx.*` namespace, which the engine does not build. Display
    // (`interpolate` above) still reads the raw `ctx.data`, which is what
    // renders the related record's NAME.
    const predicateRecord = toPredicateRecord(ctx?.data, headerPredicateFields);
    return {
      // The ambient host scope (`features` / `current_user` / …) binds
      // top-level, the way it does for a row predicate — the header used to
      // expose it only under `ctx.*`. (⛔ No `app` among them since
      // objectui#8155 unbound that root; the `ctx.app` mirror below therefore
      // reads whatever a host still passes, which in this repo is nothing.)
      ...(predicateScope && typeof predicateScope === 'object' ? predicateScope : {}),
      user: scopeUser,
      // Server-CEL-parity identity alias (#2358 trap 1): the spec's canonical
      // CEL identity scope is `os.user.*`, so a predicate authored against the
      // server dialect resolves here too instead of faulting (fail-closed).
      os: (predicateScope as any)?.os ?? { user: scopeUser },
      ctx: {
        user: scopeUser,
        record: predicateRecord,
        data: predicateRecord,
        app: (predicateScope as any)?.app,
        features: (predicateScope as any)?.features,
      },
    };
  }, [predicateScope, ctx?.data, headerPredicateFields]);

  /**
   * Evaluate one header-action predicate. `label` is the locator carried into
   * the fault warning, so a hidden button names itself in the console.
   *
   * `fallback` is the verdict a predicate that FAULTS resolves to, and it is
   * the key's own fail direction, so the caller names it:
   *
   *   - `visible` → `false`: a faulting gate hides the action (fail-closed);
   *   - `hidden`  → `false`: a faulting `hidden` leaves the action rendered,
   *     exactly as the old `catch → undefined` did;
   *   - `disabled` → `true`: a faulting gate DISABLES the action (fail-closed,
   *     objectui#11212 — Rider 1 of objectui#4421: a permission-shaped gate is
   *     closed while the permissions payload has not loaded). It used to
   *     share `visible`'s `false`, which on this key means ENABLED — so
   *     `disabled: !current_user.can(…)` left the action pressable until the
   *     payload arrived, the one leg of this surface that failed open.
   */
  const evalHeaderPredicate = React.useCallback(
    (pred: unknown, label: string, fallback: boolean): boolean =>
      evalRowPredicate(pred as never, ctx?.data ?? {}, {
        fallback,
        scope: headerPredicateScope,
        fields: headerPredicateFields,
        warnOnError: true,
        label,
      }),
    [ctx?.data, headerPredicateScope, headerPredicateFields],
  );

  const headerActionPlan = React.useMemo<{ actions: any[]; authoredKeys: ReadonlySet<string> }>(() => {
    const recordData: any = ctx?.data;
    // The record binds three ways inside `evalRowPredicate` — `record.status`
    // (spec/canonical), bare `status` (the row-action shorthand) and
    // `data.status` (legacy) — so no authoring convention silently falls
    // through to the JS global scope the way a bare identifier used to
    // (`window.status`, an empty string, filtering the action out). The host
    // scope and the `ctx.*` / `os.user` namespaces come from
    // `headerPredicateScope` above. See `evalHeaderPredicate`.
    const filterAction = (a: any): boolean => {
      // [ADR-0066 D4 / framework#3923] Capability gate — the UI half of the
      // dual-surface `requiredPermissions` contract.
      //
      // `page:header` filters its own actions rather than going through
      // `ActionEngine.getActionsForLocation`, so the engine's gate never ran on
      // the ONE surface `record_header` / `record_more` actions live on: a
      // button declaring a capability nobody holds rendered, and only the
      // server's 403 stopped it — and only for platform action routes, never
      // for a `type: 'api'` action pointed at a custom endpoint. Same rule as
      // the engine, so the two surfaces can't disagree: hide unless the caller
      // holds ALL declared capabilities.
      //
      // Fail-OPEN when the caller's capabilities are unknown (no
      // ActionProvider user, no host predicate scope) — unknown is not denied,
      // and hiding on missing data is the worse regression.
      if (!mayInvoke(a?.requiredPermissions)) return false;
      // Boolean / expression visibility — supports both `visible: false`,
      // `visible: 'record.status == "open"'` and the structured shape
      // `visible: { dialect: 'cel', source: '…' }` used by spec authors.
      const v = a?.visible;
      if (v !== undefined && v !== null) {
        if (typeof v === 'boolean') {
          if (!v) return false;
        } else {
          const src =
            typeof v === 'string'
              ? v
              : (v && typeof v === 'object' && typeof (v as any).source === 'string')
                ? (v as any).source
                : null;
          if (src) {
            warnMissingRecordFields(a?.name, src, recordData);
            // The predicate is handed over WHOLE, not as its `source`: a
            // `{ dialect: 'cel' }` envelope is authoritative CEL and must not
            // be flattened onto a dialect guess — the same rule the row kebab
            // applies by passing `def.visible` through untouched.
            // On a fault (`fallback: false`) the action hides rather than risk
            // surfacing a destructive button in the wrong state.
            if (!evalHeaderPredicate(v, `page:header action "${String(a?.name)}" visible`, false)) {
              return false;
            }
          }
        }
      }
      // `hidden` is the mirror image — when truthy, skip.
      const h = a?.hidden;
      if (h !== undefined && h !== null) {
        if (typeof h === 'boolean') {
          if (h) return false;
        } else {
          const src =
            typeof h === 'string'
              ? h
              : (h && typeof h === 'object' && typeof (h as any).source === 'string')
                ? (h as any).source
                : null;
          if (src) {
            warnMissingRecordFields(a?.name, src, recordData);
            // `fallback: false` keeps `hidden`'s historical fail direction: a
            // predicate that cannot be evaluated does NOT hide the action (the
            // old `catch → undefined` read as "not hidden").
            if (evalHeaderPredicate(h, `page:header action "${String(a?.name)}" hidden`, false)) {
              return false;
            }
          }
        }
      }
      return true;
    };
    // Placement, for AUTHORED actions only (objectui#3142). The header serves
    // TWO locations — `record_header` (inline) and `record_more` (the ⋯
    // overflow menu; see renderHeaderActions, #2358 trap 2) — so declaring
    // either one places the action here. A missing or empty `locations` used
    // to mean "show here", which made this header the one surface where an
    // action nobody placed still appeared; `RecordDetailView` pre-filters the
    // same actions strictly, and the synthesizer's own contract already says
    // "must include `locations: ['record_header']` to render"
    // (buildDefaultPageSchema.ts), so the leniency contradicted both.
    const placedOnHeader = (a: any): boolean =>
      actionRendersAt(a, 'record_header') || actionRendersAt(a, 'record_more');
    // `resolvedHeaderActions` — ids already resolved to defs, inline defs passed
    // through — so this chain is shape-uniform and unchanged by objectui#6252.
    const authored = resolvedHeaderActions.filter(a => placedOnHeader(a) && filterAction(a));
    // Host-injected chrome (Edit / Share / Delete / Open-in-new-tab) is placed
    // by the HOST, not authored — so it is not location-filtered, matching
    // `action:bar`'s `systemActions` carve-out. Before #3142 this slot WAS
    // location-filtered here and not there, so the same `sys_delete` obeyed
    // two different rules depending on which renderer drew the header.
    // Capability and visibility gates still apply.
    const system = Array.isArray(hostSystemActions)
      ? hostSystemActions.filter(filterAction)
      : [];
    // Dedupe by `name` — authored wins.
    const seen = new Set<string>();
    const out: any[] = [];
    for (const a of [...authored, ...system]) {
      const key = (a?.name || a?.id || '') as string;
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      out.push(a);
    }
    // Which surviving keys are AUTHORED (objectui#11811). Authored entries go
    // through the dedupe first, so a host action survives under a key only
    // when no authored action holds it — the key alone tells the two apart
    // past the localizer, which copies every def. Read by the disabled-reason
    // branch below: only an authored action's DECLARED `disabled` is a fact
    // about the record; the host's Edit / Delete carry a boolean the host
    // computed for reasons of its own (approval lock, `userActions`), which
    // the host explains where it computes them.
    const authoredKeys = new Set<string>(
      authored
        .map((a) => (a?.name || a?.id || '') as string)
        .filter((key) => key !== ''),
    );
    // Order the merged list before the inline/overflow split — the same rule
    // action:bar applies (objectui#2339):
    //   1. `order` ascending (unset = 0; lower = more prominent)
    //   2. `variant === 'primary'` as a tie-break within equal order
    //   3. original registration order (stable) for the remaining ties
    // This is what lets metadata declare which actions claim the inline
    // button slots vs. the `⋯` overflow menu (objectui#2361).
    const needsOrdering = out.some(
      (a) => a?.order !== undefined || a?.variant === 'primary',
    );
    if (!needsOrdering) return { actions: out, authoredKeys };
    const ordered = [...out].sort((a, b) => {
      const byOrder = (a?.order ?? 0) - (b?.order ?? 0);
      if (byOrder !== 0) return byOrder;
      const ap = a?.variant === 'primary' ? 0 : 1;
      const bp = b?.variant === 'primary' ? 0 : 1;
      return ap - bp; // equal → stable sort preserves registration order
    });
    return { actions: ordered, authoredKeys };
    // `evalHeaderPredicate` closes over `predicateScope` (via
    // `headerPredicateScope`) and the object's fields, so it replaces the raw
    // scope in this list rather than adding to it.
  }, [resolvedHeaderActions, hostSystemActions, ctx?.data, evalHeaderPredicate]);
  const headerActionsRaw = headerActionPlan.actions;
  const authoredHeaderActionKeys = headerActionPlan.authoredKeys;

  /**
   * Localize the surviving actions ONCE, here, so the button text and the
   * dispatched def cannot disagree (objectui#4265).
   *
   * Both the display path (`resolveLabel` below) and the execution path
   * (`dispatchHeaderAction` → ActionRunner, which reads `confirmText` for the
   * confirm dialog body and `successMessage` for the toast) read this same
   * list, so one localization covers both. Localizing after the filter/order
   * memo keeps translation out of the predicate gates — a `visible` CEL is
   * evaluated against the record, never against display text.
   *
   * Idempotent by construction: a host that already localized these actions
   * (RecordDetailView's `recordHeaderActions`, which feeds the SYNTHESIZED page
   * schema) passes the translated string back in as the bundle fallback, and
   * the same key resolves to the same value. Only the authored-page path —
   * where `schema.actions` reaches this renderer straight from page metadata —
   * changes behaviour.
   */
  const headerActions = React.useMemo<any[]>(
    () => headerActionsRaw.map((a: any, idx: number) =>
      localizeActionTexts(ctx?.objectName, a, {
        // Last-resort display text only; `ActionDef.name` is the translation
        // key and the spec makes it required.
        fallbackLabel: (typeof a?.id === 'string' && a.id) || `Action ${idx + 1}`,
      }),
    ),
    [headerActionsRaw, localizeActionTexts, ctx?.objectName],
  );

  // Dispatch shape for record-page header actions (objectui#3391) — the same
  // shape ObjectGrid row actions, RelatedRecordActionsBridge, and
  // DeclaredActionsBar use: stash the current record under `params._rowRecord`
  // (the api handler's `{field}` URL-interpolation + record-id source) and
  // surface a spec-shaped `params` ARRAY as `actionParams` (the runner's
  // param-dialog input), reserving `params` for the stash. Without this, a
  // `record_header` `type:'api'` action targeting `/api/v1/data/:object/{id}`
  // was sent with the literal `{id}` (`%7Bid%7D` on the wire) while the SAME
  // declaration interpolated fine from `list_item`. Dispatching a fresh object
  // also keeps ActionRunner's collected-params merge (which writes
  // `action.params` in place) from mutating the authored schema node between
  // invocations. Non-record hosts (no RecordContext data) dispatch unchanged.
  //
  // One exception on both paths (objectui#10462, ruling A on objectui#10289):
  // an OBJECT `params` is carried as values only for a `type: 'api'` action,
  // the objectstack#5777 payload window. On any other type it is dropped, with
  // a development warning, and the stash alone rides `params`.
  const record = ctx?.data;
  const dispatchHeaderAction = React.useCallback((action: any) => {
    const { params: rawParams, ...rest } = (action ?? {}) as Record<string, any>;
    const values = Array.isArray(rawParams)
      ? undefined
      : readActionEntryParamValues({ ...rest, params: rawParams }, rest.type || rest.actionType, 'page:header');
    if (!record || typeof record !== 'object') {
      const dropsObjectParams = rawParams != null && !Array.isArray(rawParams) && values === undefined;
      void execute(dropsObjectParams ? rest : action);
      return;
    }
    const dispatch: any = { ...rest };
    if (Array.isArray(rawParams)) {
      if (!dispatch.actionParams && rawParams.length > 0) dispatch.actionParams = rawParams;
      dispatch.params = { _rowRecord: record };
    } else {
      dispatch.params = { ...(values || {}), _rowRecord: record };
    }
    void execute(dispatch);
  }, [record, execute]);

  const renderHeaderActions = () => {
    if (headerActions.length === 0) return null;
    // The label is already resolved — the `headerActions` memo above ran every
    // action through the shared localizer (`{ns}.objects.{objectName}
    // ._actions.{name}.label`, authored literal as fallback), together with the
    // `confirmText` / `successMessage` that ride the same dispatch. Reading it
    // back off the def is what keeps the button and the confirm dialog on one
    // bundle entry (objectui#4265).
    const resolveLabel = (action: any) => action?.label ?? '';
    // Inline/overflow split (objectui#2361) — up to `maxVisible` actions
    // render side-by-side as buttons; the rest collapse into a `⋯` overflow
    // menu. Which actions stay inline is metadata-driven:
    //   1. actions declaring ONLY `record_more` (not `record_header`) are the
    //      spec's "overflow menu under the ⋯ button" location — they are
    //      always routed into the overflow menu and never occupy an inline
    //      slot, regardless of how few actions the header has (#2358 trap 2);
    //   2. `component: 'action:menu'` forces an action into the `⋯` menu
    //      regardless of the count (chrome actions like Share/Delete);
    //   3. the remainder is pre-sorted by `order` / `variant: 'primary'`
    //      (see the headerActions memo above); the primary button leads it
    //      (see `primaryAction` below), and the first `maxVisible` of the
    //      page's OWN actions claim the inline slots;
    //   4. a host button (the record page's Edit) is not one of the page's
    //      actions: it takes no slot and never folds (objectui#12617).
    // `maxVisible` / `mobileMaxVisible` are overridable on the page:header
    // schema and default to 3 / 1. This keeps the header from drowning in 4–5
    // buttons on every record page.
    //
    // `readMax` enforces the SPEC's value domain rather than a laxer renderer
    // tolerance (objectui#5006). Measured on `ComponentPropsMap['page:header']`
    // at @objectstack/spec 17.0.0, both keys are a POSITIVE SAFE INTEGER
    // (`{format:'safeint'}` + `{check:'greater_than',value:0,inclusive:false}`),
    // so `0`, `-1`, `1.5` and anything past `Number.MAX_SAFE_INTEGER` are all
    // rejected by the contract. This reader used to be the loosest of the three
    // authorities — it accepted `0` and floored fractions — so a value that
    // `os validate` / `os build` rejects outright still changed what rendered
    // here, and the loosest layer decided behaviour. A contract-rejected value
    // now falls back to the default instead of taking effect.
    //
    // `Number.isSafeInteger` is the exact translation of `safeint`, not an
    // approximation: plain `Number.isInteger` would admit `2**53 + 2` and
    // `1e21`, both of which spec rejects (`Too big: expected int to be
    // <= 9007199254740991`). It also subsumes the old `Number.isFinite` guard,
    // since Infinity and NaN are not safe integers.
    //
    // ⛔ Do NOT re-lax this into a tolerant read. objectui's authoring-time
    // gates stay coarse by ruling (maintainer, 2026-08-17): `ComponentInput`
    // keeps its single `number` arm and `checkType` is not bound to spec, so
    // SPEC IS THE SOLE JUDGE OF VALUES — which makes agreeing with it this
    // renderer's job. Rejections are pinned in `page-header-actions.test.tsx`.
    const readMax = (v: any): number | undefined =>
      typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : undefined;
    const maxVisible = isMobile
      ? (readMax(rawMobileMaxVisible) ?? 1)
      : (readMax(rawMaxVisible) ?? 3);
    const isMoreOnly = (a: any): boolean =>
      Array.isArray(a?.locations) &&
      a.locations.length > 0 &&
      a.locations.includes('record_more') &&
      !a.locations.includes('record_header');
    const moreOnlyActions = headerActions.filter(isMoreOnly);
    const menuOnly = headerActions.filter(
      (a: any) => !isMoreOnly(a) && a?.component === 'action:menu',
    );
    const buttonable = headerActions.filter(
      (a: any) => !isMoreOnly(a) && a?.component !== 'action:menu',
    );
    // "Host" is the key test the disabled-reason branch below uses: a key no
    // authored action holds came from `headerSystemActions`. "Destructive" is
    // ONE predicate read everywhere below: the `⋯`'s destructive band and its
    // separator, the red row, the inline button's style and the primary pick
    // (objectui#12764). Its word is the spec's: `@objectstack/spec`'s action
    // `variant` enum is `primary | secondary | danger | ghost | link`, and
    // "danger = destructive". Shadcn's `destructive` is not a spec value, so
    // it is not read here; the host's Delete is `sys_delete` by name.
    const isDestructiveAction = (a: any): boolean =>
      a?.variant === 'danger' || a?.name === 'sys_delete';
    const isHostAction = (a: any): boolean => {
      const key = (a?.name || a?.id || '') as string;
      return key !== '' && !authoredHeaderActionKeys.has(key);
    };
    // ONE primary button (objectui#12617). `@objectstack/spec`'s action
    // contract says "in `record_header` the first visible action becomes the
    // primary button", and lets a renderer prefer a `variant: 'primary'`
    // action. So the primary is the first action declaring `variant:
    // 'primary'`, else the first of the `order`-sorted list; it leads the row
    // and is the only filled button. Every other inline button is an outline
    // button. Before this, every action without a declared variant drew the
    // filled style, so a header with three actions showed three primaries and
    // none of them read as the main one.
    // Only an action that can sit in the row competes for it — a destructive
    // host action never does (see `isHostButton` below) — and a destructive
    // action is never the primary: a `variant: 'danger'` action first in the
    // row drew as the filled primary (objectui#12764).
    const isHostButton = (a: unknown): boolean => isHostAction(a) && !isDestructiveAction(a);
    const rowEligible = buttonable.filter((a) => !isHostAction(a) || isHostButton(a));
    const primaryCandidates = rowEligible.filter((a) => !isDestructiveAction(a));
    const primaryIdx = primaryCandidates.findIndex((a) => a?.variant === 'primary');
    const primaryAction: unknown = primaryCandidates[primaryIdx >= 0 ? primaryIdx : 0];
    const ranked = primaryAction
      ? [primaryAction, ...buttonable.filter((a) => a !== primaryAction)]
      : buttonable;
    // The page's own actions share the `maxVisible` budget; what does not fit
    // folds into the `⋯`. A host button (Edit) is the record's base action:
    // it stays a labelled button in the row at every width, so it neither
    // takes a slot nor folds — it used to fold behind an icon-only twin once
    // the app's actions filled the row (objectui#12529). A DESTRUCTIVE host
    // action is the exception and always folds: a host's Delete belongs in
    // the `⋯`'s destructive band, never inline as a red button.
    const authoredButtons = ranked.filter((a) => !isHostAction(a));
    const inlineAuthored = new Set<unknown>(authoredButtons.slice(0, maxVisible));
    const inlineActions = ranked.filter((a) => isHostButton(a) || inlineAuthored.has(a));
    const foldedButtons = [
      ...authoredButtons.slice(maxVisible),
      ...ranked.filter((a) => isHostAction(a) && !isHostButton(a)),
    ];
    // The overflow reads as one list in three bands (objectui#12529): the
    // authored actions first, then the host's menu chrome (favorites /
    // Share), then every destructive entry last, set apart by a separator.
    // Each band keeps the `order` sort the memo above gave it.
    const overflowPool = [...foldedButtons, ...menuOnly, ...moreOnlyActions];
    const overflowActions = [
      ...overflowPool.filter((a) => !isDestructiveAction(a) && !isHostAction(a)),
      ...overflowPool.filter((a) => !isDestructiveAction(a) && isHostAction(a)),
      ...overflowPool.filter(isDestructiveAction),
    ];
    // The first destructive entry gets a separator above it, unless it opens
    // the menu (a separator under nothing sets nothing apart).
    const firstDestructiveIdx = overflowActions.findIndex(isDestructiveAction);
    const useOverflow = overflowActions.length > 0;
    // Resolve a `disabled` predicate against the record — a boolean OR an
    // expression (`'record.status == …'` or the `{ dialect, source }`
    // envelope). Without this a CEL `disabled` silently did nothing (only
    // boolean was honoured).
    //
    // Same entry and same bindings as `visible` above: ONE evaluator for this
    // surface, so a `disabled` predicate cannot speak a different dialect from
    // the `visible` predicate sitting next to it in the same action
    // (objectui#3521). Its fail direction is its OWN (objectui#11212): a
    // predicate that faults DISABLES the button (`fallback: true`) and says so
    // once — the closed answer on this key, as `visible`'s `false` is on that
    // one. An absent or empty gate is still "not disabled"; only a DECLARED
    // predicate that cannot be evaluated takes the fallback.
    const resolveDisabled = (d: any, actionName: unknown): boolean => {
      if (d === undefined || d === null) return false;
      if (typeof d === 'boolean') return d;
      const src = typeof d === 'string'
        ? d
        : (d && typeof d === 'object' && typeof (d as any).source === 'string' ? (d as any).source : undefined);
      if (!src) return false;
      return evalHeaderPredicate(d, `page:header action "${String(actionName)}" disabled`, true);
    };
    // A live inline-edit session disables actions the host flagged with
    // `disableDuringInlineEdit` (objectui#2572 item 4) — see `inlineEditing`
    // at the top of the renderer.
    const isActionDisabled = (action: any): boolean =>
      (inlineEditing && action?.disableDuringInlineEdit === true) ||
      resolveDisabled(action?.disabled, action?.name ?? action?.id);
    // The reason a greyed-out action gives (objectui#11811) — or `undefined`
    // when it gives none. Only an AUTHORED action's DECLARED `disabled` earns
    // it: that verdict is a fact about the record, read off the action spec.
    // The inline-edit lock above is the host's own state, and the host's Edit /
    // Delete carry a boolean the host computed (see `authoredKeys` in the plan
    // memo), so neither says "not available for this record". The reason is
    // the generic one; an author-written reason beside the predicate would be a
    // spec key, which is objectstack's to declare.
    const disabledReasonFor = (action: any): string | undefined => {
      const key = (action?.name || action?.id || '') as string;
      if (key === '' || !authoredHeaderActionKeys.has(key)) return undefined;
      if (!resolveDisabled(action?.disabled, action?.name ?? action?.id)) return undefined;
      return tt('actions.notAvailableForRecord', 'Not available for this record');
    };
    const renderButton = (action: any, idx: number) => {
      const label = resolveLabel(action);
      // The primary (see `primaryAction` above) is the one filled button —
      // Shadcn's `default`; a destructive action shown inline is Shadcn's
      // `destructive` (objectui#12764); every other inline button is an
      // outline button (objectui#12617).
      const variant =
        action === primaryAction ? 'default' : isDestructiveAction(action) ? 'destructive' : 'outline';
      const size = action.size || 'sm';
      const disabled = isActionDisabled(action);
      const icon = typeof action.icon === 'string' ? action.icon : null;
      const actionKey = action.name || action.id || `header-action-${idx}`;
      const disabledReason = disabledReasonFor(action);
      const reasonId = `${disabledReasonIdBase}-reason-${idx}`;
      const button = (
        <Button
          key={actionKey}
          variant={variant}
          size={size}
          disabled={disabled}
          aria-describedby={disabledReason ? reasonId : undefined}
          className="gap-2"
          onClick={() => {
            if (typeof action.onClick === 'function') {
              void action.onClick();
              return;
            }
            dispatchHeaderAction(action);
          }}
        >
          {icon && <LazyIcon name={icon} className="h-4 w-4" />}
          <span>{label}</span>
        </Button>
      );
      if (!disabledReason) return button;
      // A natively `disabled` button fires no pointer or focus events, and the
      // Button primitive adds `disabled:pointer-events-none` on top — so a
      // tooltip (or a native `title`) on the button itself never opens. The
      // wrapping span is the trigger instead, the idiom Radix documents for a
      // disabled button: it takes the hover, and `tabIndex={0}` lets a keyboard
      // user focus it, which opens the tooltip too. The reason is ALSO a
      // persistent accessible description (`aria-describedby` on both the
      // button and the span, onto an `sr-only` copy). Same shape as
      // `record:quick_actions`' button and `DeclaredActionsBar`'s.
      return (
        <TooltipProvider key={actionKey} delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                tabIndex={0}
                aria-describedby={reasonId}
                data-disabled-reason=""
                className="inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {button}
                <span id={reasonId} className="sr-only">{disabledReason}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent>{disabledReason}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    };
    return (
      <div
        className="flex flex-wrap items-center gap-2 shrink-0"
        role="toolbar"
        aria-label={tt('detail.pageHeaderActions', 'Page header actions')}
      >
        {inlineActions.map(renderButton)}
        {useOverflow && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="gap-1 px-2"
                aria-label={tt('detail.moreActions', 'More actions')}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              {overflowActions.map((action, idx) => {
                const label = resolveLabel(action);
                const disabled = isActionDisabled(action);
                const icon = typeof action.icon === 'string' ? action.icon : null;
                const isDestructive = isDestructiveAction(action);
                // objectui#11811 — the same reason as the inline button, but
                // drawn as a visible second line, not a tooltip. Inside the
                // menu a tooltip trigger is unreachable from the keyboard: a
                // disabled item is skipped by arrow-key focus (`focusable:
                // !disabled` in the menu's roving group), and the menu traps
                // Tab. The menu is already an explicit, opened surface, so the
                // reason simply shows there, and is the item's description
                // while its name stays the label alone.
                const disabledReason = disabledReasonFor(action);
                const labelId = `${disabledReasonIdBase}-more-label-${idx}`;
                const reasonId = `${disabledReasonIdBase}-more-reason-${idx}`;
                const itemKey = action.name || action.id || `overflow-action-${idx}`;
                return (
                  <React.Fragment key={itemKey}>
                  {idx === firstDestructiveIdx && idx > 0 && <DropdownMenuSeparator />}
                  <DropdownMenuItem
                    disabled={disabled}
                    aria-labelledby={disabledReason ? labelId : undefined}
                    aria-describedby={disabledReason ? reasonId : undefined}
                    onSelect={(e) => {
                      e.preventDefault();
                      if (typeof action.onClick === 'function') {
                        void action.onClick();
                        return;
                      }
                      dispatchHeaderAction(action);
                    }}
                    className={cn(
                      'gap-2',
                      isDestructive && 'text-destructive focus:text-destructive focus:bg-destructive/10'
                    )}
                  >
                    {icon && <LazyIcon name={icon} className="h-4 w-4" />}
                    {disabledReason ? (
                      <span className="flex min-w-0 flex-col">
                        <span id={labelId}>{label}</span>
                        <span id={reasonId} className="text-xs text-muted-foreground">{disabledReason}</span>
                      </span>
                    ) : (
                      <span>{label}</span>
                    )}
                  </DropdownMenuItem>
                  </React.Fragment>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    );
  };

  return <>{renderHeaderActions() ?? emptySlot}</>;
};

const PageHeaderRenderer: React.FC<any> = ({ schema, className, ...props }) => {
  const { designer } = splitDesignerProps(props);
  // The block's `aria` bag, on the `header` root of both layouts below (see
  // "The `aria` bag of the four page blocks" above).
  const displayLocale = useDisplayLocale();
  const headerAria = resolveInlineAriaProps(schema?.aria, displayLocale);
  const ctx = useRecordContext();
  const { objectLabel: tObjectLabel } = useObjectLabel();
  const { fieldOptionLabel } = useSafeFieldLabel();
  const { language } = useObjectTranslation();
  // Console-supplied chrome copy (objectstack#5407): the ⟳ button's label.
  // The action row's copy is read by `PageHeaderActions` above.
  const tt = useSafeTranslate();
  // ── Manual refresh (objectui#3460) ────────────────────────────────────────
  // Rendered as page CHROME at the far end of the header row, NOT as a header
  // action: business/system actions come and go per object and record state,
  // while refresh has to sit in the same place on every record page. Keeping it
  // out of the action pipeline also keeps it out of that pipeline's capability
  // gating and `maxVisible` overflow budget — reading a record you are already
  // looking at is not a permissioned operation, and the button must never be
  // the one that gets collapsed into `⋯`.
  //
  // The host opts in by providing `RecordContext.refresh`; hosts that don't
  // (previews, embedded drawers, non-record pages) render exactly as before.
  const hostRefresh = ctx?.refresh;
  const [manualRefreshing, setManualRefreshing] = React.useState(false);
  const refreshSpinTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  React.useEffect(() => () => clearTimeout(refreshSpinTimer.current), []);
  const handleManualRefresh = React.useCallback(() => {
    if (!hostRefresh) return;
    void hostRefresh();
    setManualRefreshing(true);
    clearTimeout(refreshSpinTimer.current);
    refreshSpinTimer.current = setTimeout(
      () => setManualRefreshing(false),
      MANUAL_REFRESH_SPIN_MS,
    );
  }, [hostRefresh]);
  // Spec bridge may either inline `properties.*` onto the node or preserve
  // the raw bag (see record:quick_actions for the same pattern). Read from
  // both so a `{ properties: { title } }` schema is rendered correctly.
  const titleSrc = schema?.title ?? schema?.properties?.title;
  const subtitleSrc = schema?.subtitle ?? schema?.properties?.subtitle;
  // The page's `description`, handed down when this header owns the page's
  // title (objectui#12624): drawn under the title and subtitle, the order the
  // console page header uses, instead of above the title by the page.
  const pageDescription = React.useContext(PageDescriptionContext);
  const headerObjectSchema: any = (ctx as any)?.objectSchema;
  const headerObjectName: string | undefined = ctx?.objectName || headerObjectSchema?.name;
  const explicitTitle = interpolate(
    pickLocalized(titleSrc, language),
    ctx?.data,
    headerObjectSchema,
    fieldOptionLabel,
    headerObjectName,
  );
  const subtitle = interpolate(
    pickLocalized(subtitleSrc, language),
    ctx?.data,
    headerObjectSchema,
    fieldOptionLabel,
    headerObjectName,
  );
  // `breadcrumb` is deliberately NOT read (objectui#11166, ruling RETIRE). All
  // it ever drew was an empty `data-page-breadcrumb-slot` div that nothing
  // filled, and the console's app header already draws the trail. The spec
  // refuses `PageHeaderProps.breadcrumb` by name since 17.6.0
  // (objectstack#20758); a value that still reaches this renderer renders
  // exactly as an absent one: ignored, no error. ⛔ Do not add a trail here;
  // that is an ENFORCE ruling, not a fix.

  // Schema-level opt-outs let authors keep the historic "bare h1" header
  // when they don't want a record chip (e.g. a non-record landing page).
  const disableRecordChrome =
    schema?.recordChrome === false || schema?.properties?.recordChrome === false;
  // The favorite star is a control that stores something, so it draws only
  // where the host wires a toggle: the `RecordContext` carries
  // `onToggleFavorite` (objectui#12427), and that is the one switch. Metadata
  // does not control it: `@objectstack/spec` 18 retires `showStar`
  // (objectstack#23650), so this renderer no longer reads it and an authored
  // value changes nothing (objectui#12627).
  const showCopyId = schema?.showCopyId !== false && schema?.properties?.showCopyId !== false;

  // Inline header actions — authored pages embed action buttons directly on
  // `page:header.actions` (or `.properties.actions`). Custom CRM record
  // detail pages (lead → Convert Lead, opportunity → Mark Won/Lost, …)
  // rely on this slot. Without this rendering they would silently disappear.
  const rawHeaderActions = schema?.actions ?? schema?.properties?.actions;

  /**
   * The ⟳ button (objectui#3460), or `null` when the host provides no
   * `refresh`.
   *
   * Styled as the `⋯` overflow trigger's twin — same `outline` variant, same
   * `size="sm"`, same padding — so the whole row reads as ONE button family
   * (`[Start][Expedite][Edit][⋯][⟳]`). A bare ghost icon next to a row of
   * bordered pills read as detached from it.
   */
  const renderRefreshButton = (): React.ReactNode => {
    if (!hostRefresh) return null;
    const refreshLabel = tt('common.refresh', 'Refresh');
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="gap-1 px-2"
              onClick={handleManualRefresh}
              aria-label={refreshLabel}
              data-page-refresh
            >
              <RefreshCw className={cn('h-4 w-4', manualRefreshing && 'animate-spin')} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{refreshLabel}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  };

  /**
   * The header's trailing slot: the action row (or the empty layout slot that
   * stands in for it) followed by the refresh chrome.
   *
   * Both header layouts below funnel through this so the ⟳ keeps the same
   * position whether or not the record chip is rendered — including the first
   * paint of a record page, before `ctx.data` lands. When no host provides
   * `refresh` the slot is returned untouched, byte for byte what it was.
   */
  const renderHeaderTail = (emptySlot: React.ReactNode): React.ReactNode => {
    const actions = (
      <PageHeaderActions
        actions={rawHeaderActions}
        maxVisible={schema?.maxVisible ?? schema?.properties?.maxVisible}
        mobileMaxVisible={schema?.mobileMaxVisible ?? schema?.properties?.mobileMaxVisible}
        emptySlot={emptySlot}
      />
    );
    const refreshButton = renderRefreshButton();
    if (!refreshButton) return actions;
    return (
      <div className="flex items-center gap-2 shrink-0">
        {actions}
        {refreshButton}
      </div>
    );
  };

  // Decide whether to render the record chip. Conditions:
  //   1. There's a live RecordContext with data + an object schema.
  //   2. Author hasn't opted out via `recordChrome: false`.
  // When both pass, we resolve the chip title from (in order):
  //   - explicit `schema.title` (interpolated against data),
  //   - the object's DECLARED name pointer (`nameField`, then its deprecated
  //     `displayNameField` alias), when it holds a value on this record,
  //   - `objectSchema.titleFormat`, the legacy render-only template,
  //   - the unified ADR-0079 resolver (type-aware derivation, once the two
  //     rungs above have declined),
  //   - that same resolver's record-key rung, but ONLY for an object that
  //     names no title field at all (`4c6f549ef`),
  //   - `${objectLabel} ${id}` as a last-resort.
  //
  // ⭐ The declared pointer OUTRANKS `titleFormat` (objectui#9436, ruled C1).
  // That is the protocol's order, not this renderer's choice:
  // `@objectstack/spec`'s `titleFormat` describe says "an explicit nameField
  // now takes precedence", ADR-0079 D3 says the same, and
  // `getRecordDisplayName` implements it (declared pointer at steps 1+2, the
  // template at step 3). This header used to rank the template FIRST, so on an
  // object declaring both, the H1 and the name every resolver-backed surface
  // shows were two different fields. `DetailView.resolveDisplayTitle` and
  // `record:details`' H1 dedupe moved in the same change, because they read the
  // same order. Pinned in `__tests__/page-header-title.test.tsx`.
  //
  // ⛔ `objectSchema.primaryField` is NOT a rung and must not become one again
  // (objectui#7586). It used to sit directly under `schema.title`, ABOVE the
  // unified resolver — on the surface that renders the ACTUAL H1 of a
  // synthesized record page, so it decided the heading a user reads. It is a
  // `DetailViewSchema` key (`@object-ui/types` `views.ts`): a VIEW key, which
  // `DetailView.resolveDisplayTitle` reads off `schema` and is welcome to. On
  // an OBJECT def it is undeclared — `@objectstack/spec`'s object schema is a
  // `strictObject` answering `unrecognized_keys: ['primaryField']` and
  // `ObjectSchema.create()` throws — which is why objectstack#6326 deleted the
  // identical read from two lint rules and objectui#7287 / PR #7585 deleted it
  // from `resolveTitleField`. This package's own CHANGELOG already described
  // the probe as "not a spec property — always undefined" while this line kept
  // honouring it. Pinned in `__tests__/page-header-title.test.tsx`.
  const hasRecord = !!(ctx?.data && (ctx as any)?.objectSchema);
  if (hasRecord && !disableRecordChrome) {
    const data: any = ctx!.data;
    const objSchema: any = (ctx as any).objectSchema;
    const rawObjectName: string | undefined = ctx!.objectName || objSchema?.name;
    const fallbackLabel = labelText(objSchema?.label) || objSchema?.name || ctx!.objectName || '';
    const objectLabel: string | undefined = rawObjectName
      ? tObjectLabel({ name: rawObjectName, label: fallbackLabel })
      : fallbackLabel || undefined;
    // Honor objectSchema.titleFormat (e.g. `{first_name} {last_name}`) as the
    // rung BELOW the declared pointer. `DetailView.resolveDisplayTitle` ranks
    // the two the same way, so default and synthesized record pages produce
    // the same title.
    //
    // ⭐ ONE interpolator (objectui#10447). The template renders through
    // core's `formatTitleTemplate`, the function `getRecordDisplayName`'s
    // template rung and `record:details`' H1 dedupe call. This rung used to
    // run this file's own `interpolate` plus a separator cleanup, with
    // different token rules: an expanded lookup token rendered as nothing
    // here and as its display name in core, so `{account} - {deal_no}` read
    // `Q3-042` in the H1 while the dedupe compared `Acme - Q3-042`, and the
    // row equal to the H1 stayed printed under it. objectui#9436 moved only
    // this rung's rank; the rungs' order below is unchanged.
    //
    // The template and the Expression envelope go to core as declared (core
    // reads both), and whatever core returns is the rung's answer: its empty
    // string is its "nothing resolved", and there is no second test for an
    // unresolved token. The one thing the H1 adds is the translated option
    // label for a select value, applied to a copy of the record
    // (`withOptionLabels`) so the formatter's signature does not move.
    //
    // The same labelled copy feeds the declared-pointer rung below
    // (objectui#13103): a select `nameField` heads the page with its option
    // label, exactly as the same field does through the template.
    const labelledData = withOptionLabels(data, objSchema, fieldOptionLabel, rawObjectName);
    const interpolatedTitleFormat = formatTitleTemplate(objSchema?.titleFormat, labelledData);
    // Unified resolver (ADR-0079): honours the object's declared
    // `nameField`/`displayNameField` and falls back to type-aware field
    // derivation. `deriveFromRecordKeys: false` keeps bare record-key
    // guesses from outranking the legacy probes below; the resolver's
    // `Record #<id>` floor is detected and skipped so the richer
    // `${objectLabel} ${id}` fallback still wins for truly unnamed records.
    const recordId = data?.id ?? data?._id;
    // The resolver's own floor, detected so the richer `${objectLabel} ${id}`
    // fallback below wins for a truly unnamed record.
    const isResolverFloor = (resolved: string) =>
      resolved === 'Untitled' ||
      (recordId !== null && recordId !== undefined && resolved === `Record #${recordId}`);
    const unifiedTitle = (() => {
      const resolved = getRecordDisplayName(objSchema, data, { deriveFromRecordKeys: false });
      return isResolverFloor(resolved) ? '' : resolved;
    })();
    // `4c6f549ef` — the record-key safety net, and the two rules that make
    // it safe. It used to be spelled out here as a raw
    // `data?.name || data?.full_name || data?.title || data?.subject || …`
    // chain: a SECOND implementation of the very question
    // `recordDisplayValueAt` exists to answer, whose header (objectui#8350)
    // says in as many words not to re-spell it at a call site. Raw `||`
    // diverged from it on both of that function's own clauses —
    //
    //   - it reads the STORED value, so a `lookup` candidate handed its
    //     EXPANDED REFERENCE OBJECT to JSX and the whole header died with
    //     "Objects are not valid as a React child" (React #31). The breadcrumb
    //     never had this defect because it asks this same resolver WITHOUT
    //     `deriveFromRecordKeys: false`, so every rung of its walk goes
    //     through `recordDisplayValueAt` -> `displayNameOfEmbeddedObject`;
    //   - it counts a whitespace-only string as a value, so a record whose
    //     name field held only spaces rendered a blank H1.
    //
    // Both die with the copy. `deriveFromRecordKeys` was only ever switched
    // off so this renderer could interleave its own `${objectLabel} ${id}`
    // fallback — which it still does, just below. The second call is that
    // same skipped rung, run for real instead of imitated.
    const recordKeyTitle = (() => {
      if (unifiedTitle) return '';
      // An object that NAMES its title field — a declared `nameField` /
      // `displayNameField`, or a type-aware derivation over its `fields`,
      // which is exactly what `resolveNameField` answers — has already said
      // which field titles a record. An empty value there is an EMPTY TITLE,
      // not licence to borrow a different field's value: that silent hop is
      // what turned a blank `name` into a crash, so the hop is part of the
      // defect and not just its rendering. Degrade to the placeholder floor.
      if (resolveNameField(objSchema)) return '';
      const resolved = getRecordDisplayName(objSchema, data);
      return isResolverFloor(resolved) ? '' : resolved;
    })();
    const placeholderTitle =
      (objectLabel && data?.id ? `${objectLabel} ${String(data.id).slice(0, 8)}` : '') ||
      objectLabel ||
      '';
    // The declared pointer as its OWN rung, directly above the template
    // (objectui#9436). It is the resolver's steps 1+2, read through the one
    // exported spelling of the pointer rather than a re-typed `??` chain, and
    // filtered by the same floor test `unifiedTitle` applies. So for an object
    // WITHOUT a `titleFormat` this rung answers exactly what `unifiedTitle`
    // answered before it; only the template's rank moved. A blank value here
    // falls through to the template, just as `getRecordDisplayName` walks from
    // a blank step 1+2 to step 3. It reads the record through the same
    // `withOptionLabels` copy the template rung reads (objectui#13103), so a
    // select pointer shows its option label, not its stored value; a non-
    // select pointer reads the same value it reads on the raw record.
    const declaredTitle = (() => {
      const resolved = recordDisplayValueAt(labelledData, declaredNameField(objSchema));
      return resolved && !isResolverFloor(resolved) ? resolved : '';
    })();
    // The declared pointer drawn through its field's FACE (objectui#13216).
    // When the pointer rung is the one that answers (no explicit `title`, a
    // value on this record) and the pointer's field declares a widget whose
    // read face is a component of its own, the H1 draws the value through that
    // face instead of printing the stored text: a `recipient_id` declaring
    // `widget: 'recipient-picker'` heads a record share with the recipient's
    // name, not the user id it stores.
    //
    // The rule is the field registry's, asked through the field-face seam
    // (`lib/field-face.ts`), which `@object-ui/fields` fills when it loads with
    // the same `getCellRenderer(resolveCellRendererType(field))` lookup the
    // grid's cells make. This file names no widget: the declaration decides.
    // No resolver (a host that never loads `@object-ui/fields`), no field
    // declaration, no widget, or a widget with no face of its own answers
    // `undefined`, and the H1 draws `resolvedTitle` exactly as before.
    //
    // The face gets the stored value and the whole record as
    // `dependentValues`, as a grid cell gets its row, so a face whose value
    // only means something beside a sibling (`dependsOn: ['recipient_type']`)
    // reads it. `resolvedTitle` stays the stored text: no face string exists
    // synchronously, so nothing that reads the title as text changes.
    const declaredFace = (() => {
      if (explicitTitle || !declaredTitle) return undefined;
      const nameFieldName: unknown = declaredNameField(objSchema);
      if (typeof nameFieldName !== 'string' || !nameFieldName) return undefined;
      const fieldDef = declaredFieldDef(objSchema, nameFieldName);
      if (!fieldDef || typeof fieldDef !== 'object') return undefined;
      // The map form of `fields` keys a declaration by its name; the face
      // reads the name off the declaration, as a grid column's carries it.
      const field = { ...fieldDef, name: nameFieldName };
      const Face = resolveFieldReadFace(field);
      if (!Face) return undefined;
      // eslint-disable-next-line react-hooks/static-components -- resolveFieldReadFace returns a renderer registered in the field registry (a stable module-level component), not one created during render
      return <Face value={data?.[nameFieldName]} field={field} dependentValues={data} />;
    })();
    const titleCandidate =
      explicitTitle ||
      declaredTitle ||
      interpolatedTitleFormat ||
      unifiedTitle ||
      recordKeyTitle;
    // Defensive backstop — deliberately last, and deliberately NOT the fix: on
    // its own it would leave a header quietly showing the wrong field's
    // contents. No non-string may reach JSX as a child.
    //
    // ⚠️ NO RUNG ABOVE CAN PRODUCE ONE TODAY, and this comment says so rather
    // than implying a live hazard (AGENTS.md #9). Every rung is a string at
    // its source: the resolver's are, and `explicitTitle` is one because
    // `pickLocalized` — which every author-supplied `title` passes through
    // first — is typed to a string and collapses an object with no string
    // value to `''`. `interpolate` WOULD hand a non-string straight back
    // (it returns its argument untouched when that argument is not a
    // string), so the guard is against a future rung, not against today's.
    // Measured by ablation: deleting this line leaves every pin in
    // `page-header-title.emptyNameLookupFallback-10117.test.tsx` green, and
    // that null result is recorded there rather than papered over with a
    // contrived pin.
    //
    // Reduced through the same authority rather than a local `String()`, so
    // an expanded reference resolves to its display name here too instead of
    // to "[object Object]".
    const resolvedTitle =
      (typeof titleCandidate === 'string'
        ? (titleCandidate.trim() ? titleCandidate : '')
        : (recordDisplayValueAt({ value: titleCandidate }, 'value') ?? '')) ||
      placeholderTitle;
    // The record's picture (objectui#11383, ruling A on hotcrm#1199). The
    // object names the field in its object-level `imageField`, and that
    // declaration is the ONLY channel: ⛔ no `page:header` prop, and no field
    // read by a conventional name (`logo`, `avatar`, `image`, …). The value is
    // the served row's. A field the reader may not see arrives absent, so
    // nothing is drawn: the server already masked it, and it is not decided
    // again here. No declaration, or no drawable value, draws nothing at all,
    // ⛔ never initials or a placeholder. That is also why this is a Radix
    // `Avatar` with no `AvatarFallback`: its image renders once it has loaded,
    // so a URL that fails to load leaves no broken-image icon behind.
    //
    // It goes in the chip's `icon` slot, which the chip marks `aria-hidden`:
    // the H1 beside it already names the record, so the picture is
    // decorative and its `alt` is empty. An `avatar` field is a person's photo
    // and is drawn round and cropped; an `image` field (a logo) is drawn whole
    // in a rounded square.
    const pictureFieldName: unknown = objSchema?.imageField;
    const pictureUrl =
      typeof pictureFieldName === 'string' && pictureFieldName
        ? recordPictureUrl(data?.[pictureFieldName])
        : undefined;
    const pictureIsAvatar =
      pictureUrl !== undefined &&
      objSchema?.fields?.[pictureFieldName as string]?.type === 'avatar';
    const recordPicture = pictureUrl ? (
      <Avatar
        data-record-picture=""
        className={cn('h-8 w-8', pictureIsAvatar ? 'rounded-full' : 'rounded-md')}
      >
        <AvatarImage
          src={pictureUrl}
          alt=""
          className={pictureIsAvatar ? 'object-cover' : 'object-contain'}
        />
      </Avatar>
    ) : undefined;
    // Width arbitration between the title column and the action tail
    // (objectui#7244). The tail is `shrink-0` — correct, buttons must not be
    // squeezed into unreadable slivers — so in a `nowrap` row it takes what it
    // needs and the title column, being the only flexible item, absorbs the
    // entire deficit. Measured at a 799px viewport on a Field Zoo record
    // (3 labelled record_header actions + `⋯` + `⟳`): header 687px, tail
    // 641.5px, `gap-4` 16px, leaving the title column **29.5px** for an h1
    // whose `scrollWidth` was 180px — the title rendered as "S…" while the
    // breadcrumb still showed the full "Specimen — Full".
    //
    // Two utilities settle it, both scoped to `sm:` so the sub-640px column
    // layout stays byte-for-byte what it was:
    //   - `sm:min-w-48` gives the title column a 12rem floor it will not
    //     yield, so the deficit has nowhere to go but the tail;
    //   - `sm:flex-wrap` gives the deficit somewhere to go — the tail drops to
    //     its own line instead of overflowing the header.
    // The h1 still ellipsises, but now at a width you can read a name from.
    //
    // The floor is deliberately NOT a `min-w-0` removal: `min-w-0` is what lets
    // `truncate` clip at all, and the chip's own inner column keeps it. This
    // only stops the OUTER column from being driven below a readable width.
    //
    // Headers whose tail already fits are unaffected — an Account record
    // (edit + `⋯` + `⟳`) needs 192 + 16 + ~180px of a 687px header, so it stays
    // on one line exactly as before.
    return (
      <header
        className={cn(
          'flex flex-col sm:flex-row sm:flex-wrap items-start sm:items-center justify-between gap-3 sm:gap-4 pb-4 border-b',
          className,
        )}
        {...designer}
        {...headerAria}
      >
        <div className="flex flex-col min-w-0 sm:min-w-48 flex-1">
          <RecordTitleChip
            title={resolvedTitle}
            titleNode={declaredFace}
            icon={recordPicture}
            objectLabel={objectLabel}
            // Host-injected (objectui#13385): the note a host attaches to the
            // object label, e.g. how a Setup record's object is managed.
            objectLabelNote={ctx?.objectLabelNote}
            resourceId={data?.id ? String(data.id) : undefined}
            showCopyId={showCopyId}
            isFavorite={ctx?.isFavorite}
            onToggleFavorite={
              ctx?.onToggleFavorite
                ? () => ctx.onToggleFavorite?.()
                : undefined
            }
          />
          {subtitle && (
            <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
          )}
          {explicitTitle && pageDescription && (
            <p className="text-sm text-muted-foreground mt-1" data-page-description="">{pageDescription}</p>
          )}
        </div>
        {renderHeaderTail(<div data-page-actions-slot className="shrink-0" />)}
      </header>
    );
  }

  // Non-record fallback: keep the original bare-title layout so non-record
  // pages (dashboards, settings) stay unaffected.
  return (
    <header
      className={cn('flex flex-col gap-2 pb-4 border-b', className)}
      {...designer}
      {...headerAria}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col">
          {explicitTitle && (
            <h1 className="text-2xl font-semibold tracking-tight">{explicitTitle}</h1>
          )}
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
          {explicitTitle && pageDescription && (
            <p className="text-sm text-muted-foreground" data-page-description="">{pageDescription}</p>
          )}
        </div>
        {renderHeaderTail(<div data-page-actions-slot />)}
      </div>
    </header>
  );
};

ComponentRegistry.register('header', PageHeaderRenderer, {
  namespace: 'page',
  skipFallback: true,
  label: 'Page Header',
  category: 'layout',
  // The renderer reads all of these off the schema (or off `properties.*` —
  // the spec bridge may inline or preserve the bag), so an author configures
  // the header through them. `className` is left out as a styling
  // pass-through, and the host-injected `RecordContext.headerSystemActions`
  // is not authored here at all.
  inputs: [
    // Both carry two arms (objectui#3832). The spec accepts a plain string or an
    // inline translation map on each — measured against
    // `ComponentPropsMap['page:header']` at rc.6, where the union is
    // string-or-record — and the renderer resolves the map form through
    // `pickLocalized` before interpolating. The single `'string'` arm they used
    // to declare is what made the manifest gate warn `type-mismatch` on the very
    // map form this description tells the author to write.
    { name: 'title', type: ['string', 'object'], description: 'Supports {field} interpolation and inline translation maps; falls back to the record title' },
    { name: 'subtitle', type: ['string', 'object'], description: 'Same interpolation as Title' },
    { name: 'actions', type: 'array', of: 'string', description: "Action IDS — the names of actions declared on the object's own metadata — rendered in the header before any host-injected system actions. An id whose action declares neither record_header nor record_more in its locations renders nowhere." },
    // No `breadcrumb`: it was declared but NOT read (objectui#11166), and stayed
    // here only while the spec accepted the key. `@objectstack/spec` 17.6.0
    // carries the retirement (objectstack#20758, a tombstone refused by name),
    // so the entry left at that bump (objectui#11438), as this comment asked.
    { name: 'recordChrome', type: 'boolean', description: 'Set false for the bare h1 header on non-record pages' },
    // No `showStar`: the favorites star draws where the host's record context
    // wires `onToggleFavorite`, and metadata does not control it. The spec
    // retires the key (objectstack#23650), so the input left ahead of that
    // bump (objectui#12627).
    { name: 'showCopyId', type: 'boolean' },
    // The inline/overflow budget, DECLARED rather than merely honoured
    // (objectui#4668). Both are @objectstack/spec 17.0.0 GA keys this renderer
    // has read since objectui#2361 (`readMax(...)` at the split above, in both
    // spellings — `page-header-actions.test.tsx` pins the schema-level and the
    // `properties.*` variant), while `inputs` omitted them: the manifest and
    // `sdui-intrinsics.d.ts` left them out and `sdui-parser` warned
    // `unknown-prop` on the very key that then took effect.
    //
    // ONE arm each, not a union: measured against
    // `ComponentPropsMap['page:header']` on the installed GA pin, both are
    // `z.number()` constrained to a POSITIVE SAFE INTEGER — `0`, `-1` and `2.5`
    // are all rejected by value, which is why the descriptions say so instead
    // of leaving an author to discover it from a parse error. (`readMax` at the
    // inline/overflow split above now enforces exactly that domain — objectui#5006
    // closed the gap where this renderer accepted `0` and floored fractions while
    // the contract rejected both. The coarse `number` arm here still cannot
    // express the domain: `ComponentInput.type` has no integer/min/max slot, so
    // `description` stays the only authoring-time expression of it, and spec
    // stays the sole judge of values.)
    { name: 'maxVisible', type: 'number', description: 'How many header actions render as inline buttons on desktop before the rest fold into the overflow menu. A positive integer — the contract rejects 0 and fractional values. Two kinds of action are routed to the overflow menu regardless of this budget and never occupy an inline slot: an action whose locations declare record_more without record_header, and any action with component action:menu. The host\'s own buttons (the record page\'s Edit) take no slot and never fold. The first inline action, or the one declaring variant primary, is the one filled primary button; the others are outline buttons. An action declaring variant danger is never the primary: inline it is a destructive button, and in the overflow menu it is a red row below a separator.' },
    { name: 'mobileMaxVisible', type: 'number', description: 'The same inline-button budget on mobile viewports, where horizontal room is scarce. A positive integer, defaulting to 1; the desktop half is Max Inline Actions, and the overflow routing rules stated there apply unchanged.' },
  ],
});

// ---------------------------------------------------------------------------
// page:footer — thin <footer> wrapper.
// ---------------------------------------------------------------------------

const PageFooterRenderer: React.FC<any> = ({ schema, className, ...props }) => {
  const { designer } = splitDesignerProps(props);
  return (
    <>
      <Separator className="my-4" />
      <footer
        className={cn('flex items-center justify-between text-sm text-muted-foreground', className)}
        {...designer}
      >
        {/* `body` kept — escalation recorded at `page:section` above (objectui#6771). */}
        {renderChildren(schema?.children || schema?.body)}
      </footer>
    </>
  );
};

ComponentRegistry.register('footer', PageFooterRenderer, {
  namespace: 'page',
  skipFallback: true,
  label: 'Page Footer',
  category: 'layout',
  isContainer: true,
  inputs: PAGE_CONTAINER_INPUTS,
});

// ---------------------------------------------------------------------------
// page:sidebar — thin <aside> wrapper for region children.
// ---------------------------------------------------------------------------

const PageSidebarRenderer: React.FC<any> = ({ schema, className, ...props }) => {
  const { designer } = splitDesignerProps(props);
  return (
    <aside
      className={cn('flex flex-col gap-4 w-full md:w-80 shrink-0', className)}
      {...designer}
    >
      {/* `body` kept — escalation recorded at `page:section` above (objectui#6771). */}
      {renderChildren(schema?.children || schema?.body)}
    </aside>
  );
};

ComponentRegistry.register('sidebar', PageSidebarRenderer, {
  namespace: 'page',
  skipFallback: true,
  label: 'Page Sidebar',
  category: 'layout',
  isContainer: true,
  inputs: PAGE_CONTAINER_INPUTS,
});
