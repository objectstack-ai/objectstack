/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * element:record_picker — an interactive element that lets the user pick one
 * record of an object and writes the selection into a page variable.
 *
 * Data binding follows the spec's ElementDataSource (`schema.dataSource`):
 *   { object, view?, filter?, sort?, limit? }
 * and is read from there ONLY: the flat `properties.object` / `filter` /
 * `sort` / `limit` are not read (objectui#11880, objectstack#11509 ruled
 * A-narrow). Display config is read off `schema.properties`:
 *   { labelField='name', valueField='id', label?, placeholder?, emptyText? }
 *
 * The selection is written through `usePageVariableBinding(schema.id)`: the
 * page variable whose `source` equals this picker's id receives the selected
 * record's `valueField` (default the record id). With no bound variable the
 * picker is uncontrolled (still usable, just inert) so it never throws outside
 * a Page. The written value drives any predicate referencing `page.<var>`
 * (e.g. another component's `visible` / `visibility`).
 *
 * `view` is resolved through {@link useElementDataSource} rather than read off
 * the binding directly (objectstack#6953). This block used to take `object` /
 * `filter` / `sort` / `limit` off `schema.dataSource` and DROP `view`, so
 * `dataSource: { object: 'account', view: 'hot' }` — the spec's own example —
 * built an unfiltered picker over every account instead of the rows the saved
 * view selects. That symptom is quieter than the one objectstack#5576 fixed on
 * `list-view`: nothing errors, the list is simply WIDER than what was authored,
 * which is exactly the failure an AI-authored page hides best.
 */

import * as React from 'react';
import { ComponentRegistry, elementDataSourceBlock } from '@object-ui/core';
import {
  ElementDataSourceErrorPanel,
  ElementDataSourceLoadingPanel,
  useAdapter,
  useDataInvalidation,
  useElementDataSource,
  usePageVariableBinding,
  useFilterScope,
  useResolvedFilter,
  resolveInlineAriaProps,
} from '@object-ui/react';
import { useObjectTranslation, pickLocalized, useDisplayLocale } from '@object-ui/i18n';
import type { I18nLabel } from '@objectstack/spec/ui';
import type { AriaProps } from '@object-ui/types';
import {
  Label,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '../../ui';
import { cn } from '../../lib/utils';
import { readProps } from './readProps';

function toText(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'object') {
    const o = v as Record<string, any>;
    return String(o.label ?? o.name ?? o.title ?? o.en ?? '');
  }
  return String(v);
}

function ElementRecordPickerRenderer({ schema }: { schema: any }) {
  const props = readProps<{
    labelField?: string;
    valueField?: string;
    // All three are `string | I18nLabel` because that is what the contract says:
    // rc.6 widened the whole trio to the same inline-locale-map union, and the
    // read sites below now RESOLVE the map arm on each, so the declarations and
    // the renderer finally agree (objectui#5590 for `emptyText`, objectui#5637
    // for these two). `label` was `unknown` for as long as it went through
    // `toText`, which accepts anything; it is the contract's union now that it
    // resolves like one.
    label?: string | I18nLabel;
    placeholder?: string | I18nLabel;
    emptyText?: string | I18nLabel;
    aria?: AriaProps;
  }>(schema);

  const adapter = useAdapter() as any;

  // The per-element data binding (ElementDataSourceSchema) is the ONE source of
  // the picker's query (objectui#11880): with no `dataSource.object` there is
  // no object, and the picker issues no read. `dataBinding.composed` carries the
  // binding's own keys already combined with the saved view its `view` names —
  // the view supplies the baseline, an explicit binding key overrides it, and
  // `filter` AND-combines because the spec calls the binding's filter
  // *additional*.
  //
  // The picker's OWN adapter is passed rather than left to the hook's context
  // fallback: this block reads its rows from `useAdapter()` (AppShellContext),
  // and resolving `view` against a different source than the one the rows come
  // from could report a view as missing on a host that has it.
  const dataBinding = useElementDataSource(schema, adapter);
  const composed = dataBinding.composed;
  // While a named view is unresolved (or unresolvable) there is no object to
  // query: reading one would fire the wide query the `view` was written to
  // narrow. `undefined` parks the fetch effect below; the render returns a
  // status panel instead.
  const unresolved = dataBinding.status === 'loading' || dataBinding.status === 'missing';
  const object = unresolved ? undefined : composed?.object;
  // objectui#10666 — the binding's filter (AND-combined with its view's), with
  // every context token (`{current_user_id}`, `{current_org_id}`, the date
  // macros) resolved ONCE through `@object-ui/core`'s shared
  // `resolveFilterPlaceholders`, against the session scope the host provides,
  // and HELD by structure (`useResolvedFilter` in `@object-ui/react`). The
  // picker sent the literal token on `$filter` before; the query and its
  // content key read this value.
  const filterScope = useFilterScope();
  const filter = useResolvedFilter(composed?.filter, filterScope);
  const sort = composed?.sort;
  const limit = composed?.limit ?? 50;
  const labelField = props.labelField ?? 'name';
  const valueField = props.valueField ?? 'id';

  const binding = usePageVariableBinding(schema?.id);
  // Above every early return below, so hook order stays stable across
  // resolution states — same rule as the block comment further down.
  // objectui#12910 — `t` reads the closed control's busy and empty defaults
  // from the bundle, so a zh-CN page draws its own language where this block
  // used to print English literals. Each inline `defaultValue` is the `en`
  // pack's value, held byte-identical to it by `pnpm check:i18n-keys`.
  const { language, t } = useObjectTranslation();

  const [rows, setRows] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const filterKey = React.useMemo(() => (filter ? JSON.stringify(filter) : ''), [filter]);
  // objectui#10664 — the sort reaches `$orderby` below, so the fetch effect
  // keys on it, by CONTENT the way `filterKey` keys the filter: a fresh array
  // with the same entries is not a change (AGENTS.md #10).
  const sortKey = React.useMemo(() => (sort ? JSON.stringify(sort) : ''), [sort]);

  // objectui#10853 — the data-invalidation bus (`notifyDataChanged` from
  // `@object-ui/react`), read the objectui#10623 / objectui#10778 way: the
  // nonce moves when the bus reports a change to the object this picker
  // QUERIES (or `'*'`), and the fetch effect below names it, so the options are
  // re-read. Before, a page action over raw HTTP left them stale unless the
  // host remounted the picker, and `PageView` is to stop doing that
  // (objectui#10519). Subscribed only when the effect can query (an adapter
  // that reads, and an object resolved).
  const invalidationNonce = useDataInvalidation(
    adapter && typeof adapter.find === 'function' ? object : undefined,
  );
  // The adapter and query the options on screen answer, for telling a re-read
  // of them from a read of other options. Written when a read commits.
  const committedReadRef = React.useRef<{ adapter: unknown; signature: string } | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    if (!adapter || !object || typeof adapter.find !== 'function') {
      setLoading(false);
      return;
    }
    // objectui#10853 — a read of exactly the query whose options are on
    // screen (a bus re-read) is IN PLACE: the control stays enabled over those
    // options and the bound page-variable value is not touched, and the answer
    // swaps them when it lands. Any other read starts from "Loading…", as it
    // always has.
    const signature = JSON.stringify([object, filterKey, sortKey, limit]);
    const committed = committedReadRef.current;
    const inPlace = committed !== null && committed.adapter === adapter && committed.signature === signature;
    if (!inPlace) {
      setLoading(true);
      setError(null);
    }
    (async () => {
      try {
        const query: any = {};
        if (filter) query.$filter = filter;
        if (sort) query.$orderby = sort;
        if (limit) query.$top = limit;
        const res = await adapter.find(object, query);
        // `data` is the ONE rows member `QueryResult` (`@object-ui/types`)
        // declares; the bare-array arm stays because fakes at this seam really
        // do answer with a plain array. A `res?.records` arm sat between them
        // until objectui#6726 — a below-the-adapter spelling
        // (`ObjectStackAdapter.normalizeQueryResult` maps the server/SDK
        // `records` envelope to `data` before returning), so no producer emits
        // it here. Pinned by
        // `record-picker.contractEnvelope-6726.test.tsx`.
        const data: any[] = res?.data ?? (Array.isArray(res) ? res : []);
        if (!cancelled) {
          setRows(data);
          // An in-place re-read that lands clears an earlier failure: the
          // options on screen answer the query now.
          setError(null);
          committedReadRef.current = { adapter, signature };
        }
      } catch (e: any) {
        // The message only marks the read as failed (the control shows the
        // translated error placeholder, never the message), so a rejection
        // with no message is still a failure: `''` keeps `error` non-null.
        if (!cancelled) setError(e?.message ?? '');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter, object, filterKey, sortKey, limit, invalidationNonce]);

  // Reflect the bound variable's value back into the control. When a variable
  // targets this picker we stay controlled for its whole lifetime (empty string
  // = no selection) so React never warns about an uncontrolled->controlled switch
  // once the first value lands. With no binding the picker is uncontrolled and
  // Radix manages its own state. shadcn Select keys on exact string values, so
  // coerce the id to a string.
  const current = binding?.value;
  const value = binding ? String(current ?? '') : undefined;

  const handleChange = React.useCallback(
    (next: string) => {
      binding?.setValue(next);
    },
    [binding],
  );

  // `label` and `placeholder` are `string | I18nLabel` and both land in a
  // position React refuses to stringify, so both resolve HERE, at their own read
  // site, through the same `pickLocalized` the settled `emptyText` shape below
  // uses (objectui#5637). They failed in two different ways, and only pinning
  // both explains why this is one change:
  //
  //   placeholder={ en, 'zh-CN' }  THREW `Objects are not valid as a React child`
  //   label={ en, 'zh-CN' }        rendered "Owner" — ENGLISH, to a zh-CN viewer
  //   label={ 'zh-CN', ja }        rendered NOTHING — the label element vanished
  //
  // The last two came from `toText`, whose object branch ends
  // `String(o.label ?? o.name ?? o.title ?? o.en ?? '')`. Reaching `o.en`
  // unconditionally is an ENGLISH PICK wearing locale resolution's clothes, and
  // its `?? ''` miss meets the `{label && …}` render site below — so a map that
  // simply omits English DELETED the label element, with nothing thrown and
  // nothing logged.
  //
  // ⛔ `toText` is deliberately not the fix site and is UNCHANGED. It is SHARED
  // with the row values (`toText(row?.[labelField])` below), which are record
  // FIELD VALUES, not `I18nLabel` — teaching it locale resolution would change
  // a second, unrelated call site whose contract is not this one.
  //
  // The placeholder default is applied BEFORE resolution, matching `emptyText`:
  // an absent key still means the bundle's `lookup.selectRecord` (objectui#12910;
  // it was the English "Select a record…"), and an authored `''` still
  // renders empty because `pickLocalized` passes either string through
  // untouched. `label` takes no default — absent resolves to `''`, which the
  // `{label && …}` site drops exactly as it always did.
  //
  // KNOWN GAP — the `translateLabel` half of this card's ruling is NOT applied
  // here. The sibling `label` read sites compose
  // `translateLabel(pickLocalized(…), language)`, but `translateLabel` and its
  // `KNOWN_LABEL_DICT` are module-private to
  // `renderers/layout/containers.tsx`, which this change's fence marks
  // out-of-scope; reaching them needs either an export from that file or a hoist
  // into a shared module, and `basic/ -> layout/` would be a new dependency
  // between renderer families. Tracked separately (objectui#5637 report).
  const label = pickLocalized(props.label, language);
  const placeholder = pickLocalized(
    props.placeholder ?? t('lookup.selectRecord', { defaultValue: 'Select record' }),
    language,
  );
  // `emptyText` is `string | I18nLabel`, and its destination is a TEXT NODE, so
  // it resolves through `pickLocalized` — the objectui-side helper the sibling
  // text-node sites read through (`element:text.content`,
  // `element:button.label`, `page:card.title`), which spells a miss as `''`
  // rather than the spec resolver's `undefined`. Before this the map arm was
  // handed to React as a child object, which React REFUSES rather than
  // stringifies: the whole picker subtree threw
  // `Objects are not valid as a React child`, the same pre-fix harm measured
  // for `schema.label` in `inline-locale-label-read-sites.test.tsx`.
  //
  // The default is applied BEFORE resolution so `??` keeps meaning exactly what
  // it meant (absent → default) and an authored `''` still renders empty —
  // `pickLocalized` passes either string through untouched. The default is
  // `common.noData` (objectui#12910; it was the English "No records"), the key
  // `element:repeater` reads for its own empty state since objectui#12889.
  const emptyText = pickLocalized(
    props.emptyText ?? t('common.noData', { defaultValue: 'No data' }),
    language,
  );

  // The block's `aria` bag (objectui#11083). The spec declares `aria`
  // (`AriaPropsSchema`) on `element:record_picker`, and nothing read it, so a
  // declared accessible name reached no element. It goes through
  // `resolveInlineAriaProps` from `@object-ui/react`, the one reader of that
  // bag, onto the TRIGGER: the `combobox` button that carries the control's
  // name, the same element `label`'s `htmlFor` names. No default role is added;
  // the trigger keeps the `combobox` role Radix gives it unless an author
  // declares another. Resolved here, above the status-panel returns, because it
  // calls a hook.
  const displayLocale = useDisplayLocale();
  const triggerAria = resolveInlineAriaProps(props.aria, displayLocale);

  // Placed AFTER every hook above so the hook order stays stable across
  // resolution states. A `view` that names nothing renders a configuration
  // error rather than an unfiltered picker: degrading to "all records" turns a
  // typo into a silently wider answer on a page that still looks like it works.
  if (dataBinding.status === 'missing') {
    return (
      <ElementDataSourceErrorPanel
        testId="record-picker"
        title={t('element.recordPicker.sourceUnresolved', {
          defaultValue: 'This record picker’s data source could not be resolved',
        })}
        message={dataBinding.error}
      />
    );
  }
  if (dataBinding.status === 'loading') {
    return <ElementDataSourceLoadingPanel testId="record-picker" />;
  }

  // `label`'s association with the trigger is wired the same way
  // `element:text_input` wires its own `label`/control pair (objectui#5735):
  // `htmlFor` on the label names `schema?.id`, and that same id lands on the
  // CONTROL — here `SelectTrigger`, a `button` with `role="combobox"` and
  // therefore labelable, so a plain `htmlFor`/`id` pair is the correct
  // association with no `aria-labelledby` needed (Radix sets none on the
  // trigger; objectui#3341's landed reasoning transfers verbatim). Only the
  // author can supply `schema.id`, so — exactly as on `text_input` — the
  // wiring can only hold when they did; with no `schema.id` the label renders
  // as unassociated caption text, same as before this change, rather than
  // reaching for a `useId()` fallback that would always name the control
  // (objectui#5771 — deliberately following #5735's answer to the same
  // question on its complement block, not re-opening it).
  return (
    <div
      className={cn('space-y-1.5', schema?.className)}
      data-testid="record-picker"
      data-picker-id={schema?.id}
    >
      {label && (
        <Label htmlFor={schema?.id} className="text-sm font-medium text-foreground">
          {label}
        </Label>
      )}
      <Select
        value={value}
        onValueChange={handleChange}
        disabled={loading || error !== null || !object}
      >
        <SelectTrigger
          id={schema?.id}
          className="w-full max-w-xs"
          data-testid="record-picker-trigger"
          {...triggerAria}
        >
          <SelectValue
            placeholder={
              loading
                ? t('common.loading', { defaultValue: 'Loading…' })
                : error !== null
                  ? t('list.loadErrorTitle', { defaultValue: 'Couldn’t load records' })
                  : placeholder
            }
          />
        </SelectTrigger>
        <SelectContent>
          {rows.map((row, i) => {
            const v = row?.[valueField];
            const key = v == null ? String(i) : String(v);
            return (
              <SelectItem key={key} value={key}>
                {toText(row?.[labelField]) || key}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
      {!loading && error === null && rows.length === 0 && (
        <p className="text-xs text-muted-foreground">{emptyText}</p>
      )}
    </div>
  );
}

// This block CONSUMES the gate's family without the JSX wrapper — the hook plus
// the two status panels — because its query has no schema key of its own the
// gate could write the binding onto. It reads `dataSource` exactly as
// the wrapping blocks do, so it declares it from the same seam: the marker is
// applied to the renderer at its registration rather than at a gate tag it does
// not have. Found by the render probe in
// `apps/console/src/__tests__/element-data-source-input-injection.test.tsx`,
// which detects the gate's own panels and does not care how they got there.
//
// ⚠️ The seam is imported from `@object-ui/core`, NOT from `@object-ui/react`
// where the sibling blocks take it — the ONE function under the ONE name, by a
// second path. This is the only site in the family that calls it at MODULE
// SCOPE inside a package this widely imported, and that combination is a real
// hazard here: 101 suites partially mock `@object-ui/react` by hand-listing the
// exports they return, so a module-scope read of a name those lists do not carry
// throws at COLLECTION time — the whole test file fails before it runs an
// assertion. Measured on this change: 17 files, all four CI shards, and not one
// failed assertion among them. Nothing in this repo mocks `@object-ui/core`, and
// this module already imports `ComponentRegistry` from it at module scope.
ComponentRegistry.register('record_picker', elementDataSourceBlock(ElementRecordPickerRenderer), {
  namespace: 'element',
  skipFallback: true,
  label: 'Record Picker',
  category: 'input',
  // objectui#11880 / objectui#12030: the picker reads its query from the
  // node-level `dataSource` binding only (objectstack#11509, ruled A-narrow).
  // The flat `object` / `filter` / `sort` / `limit` stood below, PUBLISHED and
  // NOT READ, until `@objectstack/spec` 18 retired all four as tombstones on
  // `ElementRecordPickerProps`; they left with that bump, so a JSX page that
  // writes one now gets `unknown-prop` from the compiler, as the spec refuses
  // it by name. Their history (objectui#3830's `filter` declaration,
  // objectui#4167's `sort` / `limit`, objectui#7663's rule-array convergence)
  // is in the git log of this list.
  inputs: [
    { name: 'labelField', type: 'string' },
    { name: 'valueField', type: 'string' },
    {
      name: 'placeholder',
      // TWO arms, declared in the change that makes the second one render — the
      // order `emptyText` below established and `packages/types`'
      // `ComponentInput.type` doc prescribes. The contract has been
      // `string | Record< string, string >` since rc.6 widened this key to the
      // same `I18nLabel` union it widened the rest of the trio to; this entry
      // held one arm only because the renderer handed the map straight to
      // `SelectValue`, where React REFUSED it rather than stringifying it. The
      // read site resolves it now (`pickLocalized`, above), so withholding the
      // object arm would be the opposite defect — `type-mismatch` reported on a
      // legal write this input's own description teaches (objectui#5637).
      type: ['string', 'object'],
      description:
        'Prompt shown in the closed control while no record is selected (renderer default: the active language’s "Select record", `lookup.selectRecord`). Display-only — it never reaches the query. Accepts either a plain string or an inline per-locale map (`{ en: "Owner", "zh-CN": "负责人" }`), the `I18nLabel` union rc.6 widened this key to; the renderer resolves the map against the active language at the read site, falling back through base language, a region-qualified sibling, `default`, then `en`. It is REPLACED while the picker is busy: the active language’s "Loading…" (`common.loading`) while it reads a new set of options and "Couldn’t load records" (`list.loadErrorTitle`) after an error both win over this key (a re-read of the same options after a data change keeps them on screen and shows no "Loading…"). An authored empty string stays empty; the default applies only when the key is absent.',
    },
    {
      name: 'label',
      // TWO arms, same reason and same ordering rule as `placeholder` above.
      // This key's pre-fix failure was the quieter one: it went through the
      // file's local `toText`, whose `o.en` fallback rendered ENGLISH to every
      // viewer and whose `?? ''` miss made a map without an `en` entry delete
      // the label element outright. Declaring the object arm while that was true
      // would have advertised a shape that reached the screen wrong or not at
      // all; the read site resolves it now (objectui#5637).
      type: ['string', 'object'],
      description:
        'Caption rendered above the picker, in a `<label>` element — tied to the control by `htmlFor` when the node carries an `id`, so clicking it focuses the picker and the text becomes the combobox’s accessible name (objectui#5771), unless the block’s `aria.ariaLabel` names the combobox, which wins. Display-only — it never reaches the query, and it is OMITTED entirely when the key is absent or resolves to an empty string. Accepts either a plain string or an inline per-locale map (`{ en: "Owner", "zh-CN": "负责人" }`), the `I18nLabel` union rc.6 widened this key to; the renderer resolves the map against the active language at the read site, with the same fallback chain as `placeholder`. Distinct from `labelField`, which names the RECORD field each offered row is titled by.',
    },
    // ── emptyText — declared on the rc.6 bump (objectui#4167) ──────────────
    // `@objectstack/spec` 17.0.0-rc.6 declared it on `ElementRecordPickerProps`
    // beside `sort` and `limit`; those two retired with the flat query keys in
    // `@objectstack/spec` 18 (objectui#12030), this one is display-only and stays.
    {
      name: 'emptyText',
      // TWO arms, and the order in which they were earned is the point. The
      // contract has been `string | Record< string, string >` since rc.6 widened
      // it to the same `I18nLabel` union it widened everywhere else, and since
      // objectui#3832 this entry could spell that union — but it deliberately
      // did NOT, because THIS RENDERER passed the value straight into a text
      // node with no locale resolution, and declaring an arm the renderer drops
      // advertises a shape that never reaches the screen. That narrowing was
      // correct for exactly as long as it was true. objectui#5590 made the
      // render site resolve the map (`pickLocalized`, above), so the second arm
      // is now a shape that DOES reach the screen and withholding it would be
      // the opposite defect — the gate reporting `type-mismatch` on a legal
      // write its own description teaches. Same resolution as
      // `element:text_input.defaultValue`, `element:text.content` and
      // `element:button.label`: declare the arm in the change that makes it
      // render, never before and never after.
      type: ['string', 'object'],
      description:
        'Text shown in place of the row list when the query returns no records (renderer default: the active language’s "No data", `common.noData`). Unlike the node-level `dataSource` binding\'s `filter` / `sort` / `limit` this is display-only — it never reaches the query, and the binding does not override it. Accepts either a plain string or an inline per-locale map (`{ en: "None", "zh-CN": "无记录" }`) — the `I18nLabel` union rc.6 widened this key to — and the renderer resolves the map against the active language at the read site, falling back through base language, `default`, then `en`. An authored empty string stays empty; the default applies only when the key is absent.',
    },
  ],
});

export { ElementRecordPickerRenderer };
