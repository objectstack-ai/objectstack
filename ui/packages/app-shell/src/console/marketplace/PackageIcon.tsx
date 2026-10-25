/**
 * PackageIcon — square icon tile for marketplace packages.
 *
 * Renders the package's `icon_url` when present, falling back to the
 * first letter of the display name (or manifest id) on missing-URL,
 * load-error, or empty URL. The fallback also covers the common
 * case where cloud rows point at icon assets that don't yet exist
 * on the configured CDN.
 */

import { useState } from 'react';

export interface PackageIconProps {
  iconUrl?: string | null;
  displayName?: string | null;
  manifestId?: string | null;
  /** Tailwind size classes — caller controls outer dimensions. */
  className?: string;
  /** Text size for the initial-letter fallback. */
  initialClassName?: string;
}

export function PackageIcon({
  iconUrl,
  displayName,
  manifestId,
  className = 'h-10 w-10',
  initialClassName = 'text-base font-semibold',
}: PackageIconProps) {
  const [broken, setBroken] = useState(false);
  const initial = ((displayName ?? manifestId ?? '?').trim()[0] ?? '?').toUpperCase();
  const showImg = !!iconUrl && !broken;

  return (
    <div className={`flex shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary overflow-hidden ${className}`}>
      {showImg ? (
        <img
          src={iconUrl as string}
          alt=""
          className={`${className} object-cover`}
          onError={() => setBroken(true)}
          loading="lazy"
        />
      ) : (
        <span className={initialClassName}>{initial}</span>
      )}
    </div>
  );
}
