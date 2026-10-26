/**
 * AppMark — an app's one identity glyph, drawn at the size a surface needs
 * (objectui#12201, maintainer ruling of 2026-10-12, items 1 and 2).
 *
 * `branding.logo` is the app's square (1:1) icon — the one asset the spec
 * declares for it, an image URL — and every surface renders that one asset at
 * its own size: the top-bar app pill, every row of the app switcher, the phone
 * drawer header. There is no second asset and no wordmark slot.
 *
 * An app without `branding.logo` gets its `icon` (a lucide name) drawn on a
 * tile at the same size, so every row has a glyph. The tile is the app's
 * `branding.primaryColor` when it declares a hex there, and the neutral muted
 * tile otherwise — the same "no colour declared" answer `AppShell` gives the
 * active app, which writes `--primary` only for a hex. A logo URL that fails
 * to load falls back to the same tile rather than a broken-image glyph.
 *
 * The glyph is decorative: every surface that draws it puts the app's name
 * beside it, so it carries no accessible name of its own.
 *
 * @module
 */

import * as React from 'react';
import { cn } from '@object-ui/components';
import { getIcon } from '../utils/getIcon.js';
import { appTileColors } from './appTileColors.js';

/** The app fields this glyph reads — the spec's `AppSchema` names. */
export interface AppMarkApp {
  icon?: string;
  branding?: { logo?: string; primaryColor?: string } | null;
}

/**
 * `sm` is the 22 px the top-bar pill and the switcher rows use; `md` is the
 * 26 px of the phone drawer header (ruling item 1).
 */
export type AppMarkSize = 'sm' | 'md';

const SIZE_CLASSES: Record<AppMarkSize, { box: string; glyph: string }> = {
  sm: { box: 'size-[22px] rounded-[5px]', glyph: 'size-3.5' },
  md: { box: 'size-[26px] rounded-md', glyph: 'size-4' },
};

/**
 * The tile for a declared `primaryColor`. The utility strings are literals so
 * Tailwind emits them at build time; the author's colour reaches them only as
 * CSS custom properties, so `dark:` stays a real variant the theme controls
 * (AGENTS.md section 2, the author-declared colour carve-out).
 */
const BRANDED_TILE_CLASSES =
  'bg-[color:var(--os-app-tile-bg)] text-[color:var(--os-app-tile-fg)] ' +
  'dark:bg-[color:var(--os-app-tile-bg-dark)] dark:text-[color:var(--os-app-tile-fg-dark)]';

/** The tile for an app that declares no usable colour — theme tokens only. */
const NEUTRAL_TILE_CLASSES = 'border bg-muted text-muted-foreground';

export interface AppMarkProps {
  app: AppMarkApp | null | undefined;
  size?: AppMarkSize;
  className?: string;
}

export function AppMark({ app, size = 'sm', className }: AppMarkProps) {
  const logo = typeof app?.branding?.logo === 'string' && app.branding.logo ? app.branding.logo : undefined;
  // The URL that failed to load, so a later, different logo is tried afresh.
  const [failedLogo, setFailedLogo] = React.useState<string | undefined>(undefined);
  const sizeClasses = SIZE_CLASSES[size];

  if (logo && logo !== failedLogo) {
    return (
      <img
        src={logo}
        alt=""
        aria-hidden
        data-testid="app-mark-logo"
        onError={() => setFailedLogo(logo)}
        className={cn('shrink-0 object-contain', sizeClasses.box, className)}
      />
    );
  }

  const Icon = getIcon(app?.icon);
  const colors = appTileColors(app?.branding?.primaryColor);
  return (
    <span
      aria-hidden
      data-testid="app-mark-tile"
      className={cn(
        'inline-flex shrink-0 items-center justify-center',
        sizeClasses.box,
        colors ? BRANDED_TILE_CLASSES : NEUTRAL_TILE_CLASSES,
        className,
      )}
      style={
        colors
          ? ({
              '--os-app-tile-bg': colors.bg,
              '--os-app-tile-fg': colors.fg,
              '--os-app-tile-bg-dark': colors.bgDark,
              '--os-app-tile-fg-dark': colors.fgDark,
            } as React.CSSProperties)
          : undefined
      }
    >
      {/* eslint-disable-next-line react-hooks/static-components -- getIcon returns a stable icon component from a static registry, not one created during render */}
      <Icon className={sizeClasses.glyph} />
    </span>
  );
}
