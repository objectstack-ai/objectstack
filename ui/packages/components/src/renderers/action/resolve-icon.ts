/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';
import { Icon } from 'lucide-react';
import { dynamicIconImports } from 'lucide-react/dynamic.mjs';

import type { LucideIcon, LucideProps } from 'lucide-react';

import { LUCIDE_RECORD_ICON_NAME_TABLE } from '../../lib/lucide-record-icon-names';

/**
 * THE icon-name seam (objectui#5935). One tokeniser, one rename map, one
 * membership set — for the whole repo.
 *
 * ## What this module does, and the line it does not cross
 *
 * Its whole contract is `name -> component`, and `null` when nothing matches.
 * ⛔ It does NOT decide what a surface draws when the answer is `null`. That
 * is the maintainer ruling of 2026-09-03 (objectui#5935, comment 5523286738,
 * verbatim 「同意你的建议」, option C), taken over the 2026-08-31 shape that
 * would have given this function an `onUnresolvable: 'placeholder' | 'null'`
 * parameter. The reason that parameter is absent is measured, not stylistic:
 * the tree has FOUR unresolvable behaviours, not two —
 *
 *   - `null`                          — this module's callers by default,
 *                                       `plugin-list/TabBar`, `plugin-view/ViewSwitcher`
 *   - `SquareDashed` placeholder+warn — `renderers/basic/icon.tsx` (objectui#5631,
 *                                       maintainer 2026-08-22, 一字不动)
 *   - an `Inbox` fallback glyph       — `plugin-detail/RelatedList`, `plugin-list/ListView`
 *   - a 3-character name chip         — `app-shell` `previews/ActionPreview`
 *
 * — so a two-valued knob could not have expressed the tree it was meant to
 * consolidate, and widening it to four would have published a presentation
 * decision on a lookup function. Each call site keeps its own fallback, at the
 * call site, visibly. `resolveIcon(x) ?? Inbox` is not a hidden divergence: it
 * is local and there is nothing for it to disagree with, unlike the three
 * tokenisers this seam replaced.
 *
 * ⭐ That contract is why the resolution below stayed SYNCHRONOUS when the
 * GLYPH became lazy (objectui#9251). All four behaviours above are chosen from
 * `null` vs not-`null` while the caller renders; an answer that had to be
 * awaited would have published a loading state into every one of them. The
 * membership question is answered from a static list, in the same tick, exactly
 * as before — only the SVG path data now arrives later.
 *
 * ## ⛔ The `icons` record is not read here, and must not come back
 *
 * This module used to answer `name -> component` by indexing lucide's runtime
 * `icons` record. A namespace object has no dead members, so that one index
 * pulled every icon module into the console's eager closure: measured on the
 * console build at `ac05d4f4dd`, 1,781 icon module definitions inside
 * `assets/ui-components-*.js`, in a chunk of 1,535,917 raw / 397,091 gzipped
 * bytes. The maintainer ruling of 2026-09-13 (objectui#9251, decision batch
 * #132 item 4, 「同意」) took it off that path, verbatim:
 *
 *   「`icons` 总表不再 eager:图标按名经动态导入表解析(Door 1 已证明该表几乎
 *     免费);合法图标名集合由构建期生成的静态名单提供(⛔ 不从
 *     `Object.keys(icons)` 推导 ⇒ #9204 救援 A 拒绝);总表的每个读点
 *     (`check-lucide-icon-record-names.mjs` 普查着)迁到懒解析;验收 = 页面
 *     实际字节减少,不是那一行变绿」
 *
 * So, precisely:
 *
 *   - MEMBERSHIP comes from `lib/lucide-record-icon-names.ts`, generated from
 *     lucide's own export manifest by
 *     `scripts/regenerate-lucide-record-icon-names.mjs`. ⛔ Never from
 *     `Object.keys(icons)` — that derivation IS the eager record, written a
 *     second way, and objectui#9204's rescue option A is refused by name in the
 *     ruling above for exactly that reason.
 *   - The GLYPH comes through `dynamicIconImports`, lucide's dynamic-import
 *     map, which objectui#9204 measured to be nearly free in this context
 *     (deferring it cost +923 gzipped bytes). ⛔ Keeping that map is part of the
 *     ruling, not an accident. The map is used directly rather than through
 *     `DynamicIcon` for one reason: `DynamicIcon` renders `null` while it
 *     loads, and `createElement(Fallback)` passes its fallback no props, so
 *     neither of its two states can carry the caller's `className` or lucide's
 *     per-icon classes. See {@link EMPTY_ICON_NODE}.
 *   - The VOCABULARY is unchanged: it is still the record's 1,781 keys and ⛔
 *     not `lucide-react/dynamic.mjs`'s `iconNames`, which is a strict superset
 *     that still carries `edit`, `smile`, `filter` and `alert-triangle` —
 *     spellings lucide RETIRED from the record and that this repo's authored
 *     names must keep failing on. `scripts/check-lucide-icon-record-names.mjs`
 *     is what holds the two apart, and it censuses this module as the one
 *     record-vocabulary site.
 *
 * ## ⛔ A new icon-rendering container does NOT bring its own resolver
 *
 * Ruling point 4 of 2026-08-31 (comment 5472612351, verbatim 「同意」):
 * 「本裁定后新容器 ⛔ 不得再自带解析器,一律走 seam」. This is mechanically
 * enforced, not merely asked for — `scripts/check-lucide-icon-record-names.mjs`
 * rediscovers every module that reads the record vocabulary and fails when the
 * discovered set differs from its declared census in EITHER direction. That
 * census is this file alone. A container that hand-rolls a lookup turns the
 * gate red on the commit that adds it.
 *
 * ## The tokeniser is MEASURED, not chosen
 *
 * `split(/[-_\s]+/)` with `Home -> House` applied universally, established by
 * the pre-dispatch enumeration required by the 2026-08-31 ruling
 * (objectui#5935, comment 5522254814) — four independent instruments, each
 * with a control that fired in the same run: a cross-product upper bound over
 * every authored name x all seven surfaces, a bound-free differential over
 * 8,298 spellings derived from all 1,767 live record keys, an AST sweep over
 * 349,813 string literals (25 forking literals, ALL in the same direction),
 * and the objectui#5631 pin. Its regression set is EMPTY in all three readings.
 *
 * ⛔ `split('-')` — what five of the seven sites used — is not adoptable: it
 * regresses 4,748 name-surface pairs in the bound-free space, stripping the two
 * regex surfaces of every snake_case and space-separated spelling they resolve
 * today. `split(/[-_\s]/)` is byte-identical to the adopted spelling over
 * 51,449 hostile spellings, and `.filter(Boolean)` is inert in this pipeline
 * (capitalising the empty string yields the empty string, and joining it
 * contributes nothing) — three spellings, two behaviours, one adopted.
 *
 * Why widening cannot regress anything, structurally: NO key of the record
 * contains `_`, whitespace or `-` (measured: 0 of 1767, with a firing control —
 * 95 keys contain a digit). So whenever splitting on `-` alone produces a live
 * key, that key contained no `_` and no whitespace, so no hyphen-token did
 * either, so splitting further changes nothing. The old resolving sets are
 * strict SUBSETS of this one.
 *
 * ## The module path stays `renderers/action/`
 *
 * It is where the shared resolver already lived and where sixteen importers,
 * the gate's declared census and three suites already point. Moving it would
 * be churn priced in merge conflicts against a card whose acceptance criterion
 * is that nothing observable moves.
 */

/**
 * The ONE rename map: names lucide RETIRED from its runtime `icons` record.
 *
 * ⛔ Not a general alias table and not an author-facing compatibility layer —
 * every entry is a spelling lucide itself renamed, kept so a name that used to
 * resolve still does. `Home` is not a key of the record; `House` is.
 */
const iconNameMap: Record<string, string> = {
  Home: 'House',
};

/**
 * The ONE tokeniser: `"arrow-right"`, `"arrow_right"` and `"arrow right"` all
 * become `"ArrowRight"`. Module-private on purpose — the only ways out of this
 * file are `resolveIcon` (the seam) and `describeIconLookup` (diagnostics), so
 * no caller can re-implement half the pipeline against it.
 */
function toPascalCase(name: string): string {
  return name
    .split(/[-_\s]+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

/**
 * The generated table, decoded on first use.
 *
 * Deliberately lazy: a page that draws no icon never pays for it, and the
 * eager cost of the module is one string literal rather than 1,781 object
 * properties. ⛔ Do not hoist this to module scope for tidiness — that trades a
 * measured saving for a formatting preference.
 */
let recordIconNames: Map<string, string> | null = null;

function recordIconName(key: string): string | undefined {
  if (recordIconNames === null) {
    const decoded = new Map<string, string>();
    for (const entry of LUCIDE_RECORD_ICON_NAME_TABLE.split(',')) {
      const separator = entry.indexOf(':');
      decoded.set(entry.slice(0, separator), entry.slice(separator + 1));
    }
    recordIconNames = decoded;
  }
  return recordIconNames.get(key);
}

/**
 * The per-icon `lucide-*` class names, rebuilt here because lucide derives them
 * from the icon's own module, which this seam does not have on the first frame.
 * `Icon` — the component every lucide glyph ultimately renders, and the one
 * used below — contributes only the bare `lucide` class when it is handed a
 * bare `iconNode`.
 *
 * ⚠️ Without this, `svg.lucide-house` would stop matching anywhere in the
 * product and in 194 lines of this repo's own assertions, and it would stop
 * matching SILENTLY: the glyph still draws, so nothing looks broken until a
 * stylesheet or a query that selects by icon identity quietly matches nothing.
 *
 * Two spellings are emitted: `lucide-${kebab}`, lucide's CANONICAL class for
 * the icon, and `lucide-${toKebabCase(toPascalCase(kebab))}`, the class lucide
 * derived from the PascalCase key up to 1.35.0 — one class for most icons and
 * two for the keys that pack digits or a leading initial (`ArrowDown01` also
 * gives `lucide-arrow-down01`). The PascalCase key is already in hand here, so
 * only the kebab-casing of it is re-implemented.
 *
 * ⚠️ That is NOT the set lucide-react 1.43.0 puts on its own component, which
 * no longer carries the key-derived class and carries one class per DECLARED
 * ALIAS instead (`house` also renders `lucide-home`). The alias list
 * exists only inside each lazily loaded icon module, and the maintainer's
 * ruling C on objectui#8941 (comment 5750512894, 「8941 C」) accepted that the
 * seam reproduces the canonical class and not the aliases, rather than carry
 * every alias in the eager static name list. `resolve-icon-lazy-9251.test.tsx`
 * pins exactly that much — `lucide` plus the canonical class — against the
 * record's own components over the WHOLE vocabulary.
 */
function lucideClassNames(recordKey: string, kebab: string, className?: string): string {
  const fromKey = `lucide-${recordKey.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()}`;
  return [fromKey, `lucide-${kebab}`, className]
    .filter((c, index, all) => Boolean(c) && String(c).trim() !== '' && all.indexOf(c) === index)
    .join(' ')
    .trim();
}

/**
 * lucide's own path-data shape, taken from the component that consumes it.
 *
 * ⛔ `NonNullable` is load-bearing, not decoration. lucide 1.43.0 split `Icon`'s
 * props into a UNION — one arm takes `iconNode` and forbids `icon`, the other
 * takes `icon` and forbids `iconNode` — and indexing a union yields the union
 * of the members, so this alias silently picked up the second arm's
 * `iconNode?: undefined`. That widened {@link EMPTY_ICON_NODE} to include
 * `undefined`, which is the one value NEITHER arm accepts, so the placeholder
 * written to guarantee a box stopped type-checking as a box.
 */
type IconNode = NonNullable<React.ComponentProps<typeof Icon>['iconNode']>;

/**
 * What the glyph holds before its module arrives: the same `<svg>` lucide
 * draws, with the same classes and the same box, and no paths in it yet.
 *
 * ⭐ This is what keeps the lazy half from being a visible regression. The
 * ALTERNATIVE — `DynamicIcon`'s own behaviour — is to render `null` until the
 * module resolves, which means the icon's slot has no box, so every toolbar and
 * menu row reflows when the chunks land, and `svg.lucide-house` matches nothing
 * for the first frame. Neither is necessary: which icon this is, is known
 * synchronously from the generated name list. Only its path data is late.
 */
const EMPTY_ICON_NODE = [] as unknown as IconNode;

/** Path data already fetched, so a second mount of the same glyph is instant. */
const loadedIconNodes = new Map<string, IconNode>();

/**
 * One component per resolved name, created once and reused.
 *
 * ⭐ Load-bearing, not an optimisation. Every call site in this repo renders the
 * return value as `<Icon ... />`, and several carry an
 * `eslint-disable react-hooks/static-components` line asserting that this seam
 * hands back "a stable icon component from a static registry". A fresh
 * component identity per render would remount the glyph on every parent render
 * — which for a lazily loaded icon means re-entering the loading state and
 * never settling.
 */
const resolvedComponents = new Map<string, LucideIcon>();

function lazyIconComponent(recordKey: string, kebab: string): LucideIcon {
  const cached = resolvedComponents.get(recordKey);
  if (cached) return cached;

  const Component = React.forwardRef<SVGSVGElement, LucideProps>(({ className, ...rest }, ref) => {
    const [iconNode, setIconNode] = React.useState<IconNode | undefined>(() => loadedIconNodes.get(kebab));

    React.useEffect(() => {
      if (iconNode !== undefined) return undefined;
      let live = true;
      const load = dynamicIconImports[kebab as keyof typeof dynamicIconImports];
      // `resolveIcon` only reaches here for a name the generated list carries,
      // and part 4 of `check-lucide-icon-record-names.mjs` fails the build if
      // any of those names is missing from this map. The guard is for a
      // consumer that has pinned a mismatched lucide, where an empty box is a
      // better answer than a thrown render.
      if (!load) return undefined;
      void load()
        .then((module: { __iconNode?: IconNode; __iconData?: { node?: IconNode } }) => {
          // lucide moved the path data between these two exports: an icon
          // module used to expose `__iconNode` directly and now wraps it in
          // `__iconData` alongside `name`, `size` and `aliases`. Both are read
          // because the failure mode of reading only one is invisible — the
          // placeholder `<svg>` below is already mounted with the right classes
          // and the right box, so a glyph that never arrives looks exactly like
          // one that has not arrived YET. Nothing throws and nothing logs.
          const node = module.__iconData?.node ?? module.__iconNode;
          if (!node) return;
          loadedIconNodes.set(kebab, node);
          if (live) setIconNode(node);
        })
        .catch(() => {
          // The empty `<svg>` stays. A network failure on one icon chunk must
          // not take the surface that hosts it down with it.
        });
      return () => {
        live = false;
      };
    }, [iconNode]);

    return React.createElement(Icon, {
      ...rest,
      ref,
      iconNode: iconNode ?? EMPTY_ICON_NODE,
      className: lucideClassNames(recordKey, kebab, className),
    });
  });
  // The same value lucide's `createLucideIcon` sets: `toPascalCase(kebab)` is
  // the record key, so React DevTools and test output read as they did before.
  Component.displayName = recordKey;

  const icon = Component as unknown as LucideIcon;
  resolvedComponents.set(recordKey, icon);
  return icon;
}

/**
 * The lookup this seam performs, exposed for DIAGNOSTICS only.
 *
 * `renderers/basic/icon.tsx` names both halves in its objectui#5631 warning
 * (`lookup: "Home" -> "House"`), and that message is under a maintainer ruling
 * 一字不动. Without this it would need its own copy of the tokeniser and the
 * map to keep saying the same thing — which is precisely the duplication this
 * card removed. ⛔ It decides nothing: no call site can change what resolves by
 * reading it.
 */
export function describeIconLookup(name: string): { pascal: string; key: string } {
  const pascal = toPascalCase(name);
  return { pascal, key: iconNameMap[pascal] || pascal };
}

/**
 * Resolve an authored Lucide icon name to its component.
 *
 * Accepts kebab-case, snake_case, space-separated and PascalCase spellings.
 * Returns `null` when the name is absent or names no live glyph — deciding what
 * to draw instead belongs to the caller (see the module docblock).
 *
 * ⚠️ The component this returns draws its `<svg>` — with lucide's own classes,
 * box and attributes — SYNCHRONOUSLY, and fills in the path data when the
 * icon's module arrives (objectui#9251). So `svg.lucide-house` matches on the
 * first frame and nothing reflows, while the 1,781 icon modules stay off the
 * eager path. ⛔ A test that asserts on the PATHS inside the svg must await
 * them (`findBy*` / `waitFor`); everything that asks which icon this is —
 * including `null` vs not — is answered in the same tick, as before.
 */
export function resolveIcon(name: string | undefined): LucideIcon | null {
  if (!name) return null;
  const recordKey = describeIconLookup(name).key;
  const kebab = recordIconName(recordKey);
  if (kebab === undefined) return null;
  return lazyIconComponent(recordKey, kebab);
}
