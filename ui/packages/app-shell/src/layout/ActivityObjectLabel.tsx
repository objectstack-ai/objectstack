/**
 * ActivityObjectLabel — the one resolver that names the object a `sys_activity`
 * row is about, shared by the bell's Activity tab (`InboxPopover`) and Home's
 * activity card (`HomeActivity`, objectui#12238).
 *
 * Kept here (not in InboxPopover.tsx) so both surfaces import the same
 * component instead of each growing a resolver of its own. Internal to the
 * package: ⛔ not re-exported from `layout/index.ts` or the package entry.
 *
 * @module
 */

import { useObjectLabel, useObjectTranslation } from '@object-ui/i18n';
import { findByName, metadataText } from '../hooks/useNavTargetLabel.js';
import { useMetadata } from '../providers/MetadataProvider.js';

/** `''` from a bundle lookup that found nothing and had no metadata to fall back to. */
function nonEmpty(text: string | undefined): string | undefined {
  return typeof text === 'string' && text.trim() !== '' ? text : undefined;
}

/**
 * The object an Activity row is about, named by its label in the reader's
 * language, the way the row's own summary names it (objectui#12212).
 *
 * `sys_activity` keeps the object's API name (`object_name`), and the row
 * printed it as stored, so `Updated User Preference "ui.recent"` sat over
 * `… · sys_user_preference`. The console resolves the name; the row stays as
 * the server wrote it. The label is read the way `useNavTargetLabel` reads an
 * object's: the definition's `label` from `useMetadata().objects` (an inline
 * locale map read in the active language), passed through `useObjectLabel`'s
 * bundle lookup (`{ns}.objects.<name>.label`). `objects` is the shell's cached
 * `object` list, loaded once for the whole type, never once per row.
 *
 * The API name is the fallback, and only that: an object the list does not
 * hold (not loaded yet, or since removed) and no bundle names is shown by its
 * name, as before.
 *
 * A component of its own so that the list is read only while a row is on
 * screen. The rows are built on every render of the bell, open or closed, and
 * reading `objects` is what loads the type.
 *
 * Home's activity card renders the same component for the same row
 * (objectui#12238), so the bell and Home name an object one way.
 */
export function ActivityObjectLabel({ objectName }: { objectName: string }) {
  const { objects } = useMetadata();
  const { objectLabel } = useObjectLabel();
  const { language } = useObjectTranslation();
  const text = metadataText(findByName(objects, objectName)?.label, language);
  return <>{nonEmpty(objectLabel({ name: objectName, label: text ?? '' })) ?? objectName}</>;
}
