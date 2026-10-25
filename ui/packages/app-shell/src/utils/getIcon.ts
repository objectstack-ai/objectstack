/**
 * Icon utilities
 *
 * `getIcon(name)` is app-shell's local name for `getLazyIcon` from
 * `@object-ui/components` — the one Lucide-by-name resolver the console, its
 * settings pages and this package all go through (objectui#11679). Keeping the
 * module and its name means the call sites that do
 * `const Icon = getIcon(name); <Icon />`, and the tests that `vi.mock` this
 * path, are unchanged.
 *
 * ⛔ Do not grow a second implementation here. This file used to carry its own
 * copy, and that copy had drifted: its tokeniser lacked the letter-to-digit
 * boundary objectui#9414 added to `toKebabIconName`, so a digit-suffixed name
 * such as `Building2` — the spelling `lucide-react` exports — became
 * `building2`, failed the known-name check, and silently degraded to the
 * `Database` glyph. The console's own copy had the same tokeniser and no
 * known-name check at all, so it handed `building2` to `DynamicIcon`, which
 * logged `[lucide-react]: Name in Lucide DynamicIcon not found` on the settings
 * hub and the company page (the name came off the framework's `company`
 * settings manifest when objectui#11679 was measured — a historical reading,
 * not re-derived here). The known-name check, the tokeniser and the `Database`
 * fallback now live once, in `packages/components/src/lib/lazy-icon.tsx`.
 */

export { getLazyIcon as getIcon } from '@object-ui/components';
