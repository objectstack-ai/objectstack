/**
 * OrgBadge — the two-letter organization mark used wherever the top bar shows
 * "which organization is this".
 *
 * Shared by the two top-bar organization surfaces so they cannot drift apart
 * visually: `WorkspaceSwitcher` (multi-membership — the org name plus a switch
 * dropdown) and `CurrentOrganizationIndicator` (exactly one membership — the
 * same mark and name, read-only). The initials are the only thing a narrow
 * viewport keeps, so a second implementation of them would be a visible
 * inconsistency rather than a tidiness question.
 */

/** First letters of up to two words — "Titanwind EHR" → "TE", "acme" → "A". */
export function getOrgInitials(name: string): string {
  return name
    .split(/[\s_-]+/)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export function OrgBadge({ name }: { name: string }) {
  return (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-muted text-[10px] font-semibold text-muted-foreground">
      {getOrgInitials(name)}
    </span>
  );
}
