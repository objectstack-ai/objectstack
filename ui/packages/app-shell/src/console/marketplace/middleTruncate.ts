/**
 * Middle truncation for a package's manifest id on a marketplace card
 * (objectui#12616).
 *
 * A manifest id is reverse-domain (`app.objectstack.hotcrm`): it reads from its
 * namespace to its package name, and the package name at the end is the part a
 * reader tells two cards apart by. An end ellipsis drops exactly that part. So
 * the card draws the id as two runs on one line: the head, everything up to and
 * including the last `.`, which shrinks and takes the ellipsis; and the package
 * suffix after it, which does not shrink. The cut is CSS, not a character
 * budget: it happens only when the card is too narrow for the whole id, at
 * whatever width the card has, and the element's text stays the whole id.
 *
 * This function only finds the split; it never shortens anything.
 */

/** The two runs a card draws a manifest id in. `head + suffix` is the id. */
export interface ManifestIdRuns {
  /** Everything up to and including the last `.`; the run that is cut. */
  head: string;
  /** The package name after the last `.`; empty when the id has no such segment. */
  suffix: string;
}

/**
 * Split `id` at its last `.` into a head and a package suffix. An id with no
 * `.`, or whose only `.` is its first or last character, has no package suffix
 * to keep: the whole id is the head, and the card cuts it at its end.
 */
export function splitPackageSuffix(id: string): ManifestIdRuns {
  const dot = id.lastIndexOf('.');
  if (dot <= 0 || dot === id.length - 1) return { head: id, suffix: '' };
  return { head: id.slice(0, dot + 1), suffix: id.slice(dot + 1) };
}
