// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'ui-record-blocks-unknown-keys-refused',
  surface: 'page `record:alert` / `record:quick_actions` / `record:history` / '
    + '`record:discussion` components — `properties` (undeclared keys, notably a typo\'d '
    + '`severty`, quick_actions\' inline `actions`, history\'s host-channel `entries` / '
    + '`loading`, and any key at all on `record:discussion`)',
  replacement: 'the declared shapes the renderers read. `record:alert`: `severity?`, `title?` / '
    + '`body?` (string or inline locale map), `visible?` (boolean | CEL string | `{ dialect, '
    + 'source }`), `icon?`, `action?` `{ actionName, label?, variant? }`, `dismissible?`, '
    + '`dismissKey?`. `record:quick_actions`: `actionNames?`, `requiredPermissions?`, '
    + '`location?` (the spec\'s own action-location vocabulary), `align?`, `inline?`, '
    + '`variant?` / `size?` (the Button primitive\'s vocabulary). `record:history`: `limit?`, '
    + '`emptyText?` / `unknownUserText?` (literal strings). `record:discussion`: '
    + '`record:chatter`\'s own row — one schema for the pair. Every rejection carries the '
    + 'surface, the offending key and a prescription (`actions` → `actionNames`; `entries` / '
    + '`loading` → omit, the block self-fetches `sys_activity`; `aria` on quick_actions → not '
    + 'declared until the renderer reads the contract spelling; `visibleWhen` / `visibility` '
    + 'on the alert → `visible`; a locale map as history text → a literal string)',
  reason:
    'These were the four `record:*` components the #4001/#5068 gate could not reach after '
    + '#8691 closed the rail: each had a registered objectui renderer (and, bar '
    + '`record:discussion`, a `PageComponentType` entry and a console palette slot) but no '
    + '`ComponentPropsMap` row, so the props gate\'s dispatch skipped them as unregistered and '
    + 'every authored key rode through. A typo\'d `severty` on the platform\'s own banner '
    + 'surface parsed, typechecked, validated, built and shipped as a silent no-op while '
    + 'sibling components in the same file drew loud diagnostics. The rows declare the shapes '
    + 'the renderers actually read (measured from read points at the objectui pin, not from '
    + 'the registrations\' declared-input lists — quick_actions\' registration claims an '
    + 'empty-bar fallback the renderer does not implement, and omits the `aria.label` read '
    + 'that exists but under a spelling the shared ARIA shape refuses), so an undeclared key '
    + 'is now a publish-time refusal instead of a silent no-op.',
  acceptanceCriteria:
    'Every `record:alert` / `record:quick_actions` / `record:history` / `record:discussion` '
    + 'node validates with only declared keys, and declared keys parse byte-identically to '
    + 'before — the platform `sys_user` page\'s banner (inline locale maps, CEL `visible`, '
    + 'CTA) and self-service quick_actions bars, and the showcase task page\'s banner and bar, '
    + 'all pass with zero findings; `objectstack validate` reports no '
    + '`component-props-unknown-key` / `component-props-invalid` finding for these types. The '
    + 'one parse-time normalization is `ExpressionInputSchema`\'s own: a bare-string `visible` '
    + 'becomes the canonical `{ dialect: \'cel\', source }` envelope.',
};
