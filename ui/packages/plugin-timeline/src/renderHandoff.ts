/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The shape `TimelineRenderer` RECEIVES — wider than the shape an author may
 * WRITE, on purpose (objectui#6356, maintainer ruling 2026-09-27, Q1 = A).
 *
 * `@object-ui/types` declares the authored feed element, `TimelineFeedItem`,
 * as the seven documented keys. `ObjectTimeline` composes five more onto every
 * item it maps from a record — `color`, `group`, `meta`, `startDate`,
 * `endDate` — plus the `_data` handle its click handler reads, and the
 * renderer's vertical branch draws them (marker colour, sticky bucket headers,
 * status / priority chips, a start → end range). The ruling made those keys
 * RENDERER-INTERNAL: nobody authors them (zero authored instances across every
 * authoring corpus the ruling's measurement read), and the horizontal branch
 * drops all five, so declaring them for authors would declare a capability the
 * runtime does not honour. They are typed HERE, where their only producer and
 * their only consumer live, and nowhere else.
 *
 * ⛔ Deliberately NOT exported from this package's index, and ⛔ never to be
 * added to `@object-ui/types`: the authoring faces there refuse these keys by
 * name on the strict authoring face, and a public type naming them would invite
 * the spelling that face refuses. The renderer stays more lenient than
 * validation — it reads them off this handoff — which is the house posture.
 */

import type { TimelineFeedItem, TimelineGanttItem, TimelineSchema } from '@object-ui/types';

/** One inline chip beside an item's title — a record's status / priority option. */
export interface TimelineRenderMetaChip {
  key: string;
  label: string;
  color?: string;
}

/**
 * A feed item as the renderer receives it: an authored {@link TimelineFeedItem},
 * or one `ObjectTimeline` composed from a record.
 *
 * Three authored keys are WIDER here because the composer fills them from
 * record values rather than from an author: `title` may be absent (a record
 * with no display value), `time` is the record's raw start value, and
 * `variant` is the record's own value — which is why the marker primitive
 * paints `todo` / `in-progress` / `done` besides the five authoring colours.
 */
export interface TimelineRenderFeedItem extends Omit<TimelineFeedItem, 'title' | 'time' | 'variant'> {
  title?: string;
  time?: unknown;
  variant?: string;
  /** Marker colour, from the record's colour field. Vertical branch only. */
  color?: string;
  /** Sticky bucket header this item sits under. Vertical branch only. */
  group?: string | null;
  /** Status / priority chips beside the title. Vertical branch only. */
  meta?: TimelineRenderMetaChip[];
  /** The record's raw start value; drawn when `time` is absent. Vertical branch only. */
  startDate?: unknown;
  /** The record's raw end value; drawn as `start → end`. Vertical branch only. */
  endDate?: unknown;
  /** The record itself, handed back to the click handler. */
  _data?: unknown;
}

/**
 * `TimelineSchema` with every declared member kept, `items` widened to the
 * handoff element, and the click slot `ObjectTimeline` installs.
 *
 * Spelled as a key-remapping mapped type and ⛔ not as `Omit`. It was written
 * while `TimelineSchema` inherited `BaseSchema`'s string index signature, under
 * which `keyof` resolved to `string` and `Omit` collapsed the whole interface
 * into that signature, dropping every declared member. A homomorphic mapped
 * type maps the declared members and any index signature separately, so only
 * `items` leaves whether or not a signature is present (objectui#8347 removed
 * `BaseSchema`'s).
 */
export type TimelineRenderSchema = {
  [K in keyof TimelineSchema as K extends 'items' ? never : K]: TimelineSchema[K];
} & {
  items?: Array<TimelineRenderFeedItem | TimelineGanttItem>;
  /**
   * The click handler `ObjectTimeline` composes onto the schema it hands over
   * (it resolves the item's record and fires the overlay navigation). A runtime
   * slot, not authorable metadata: it stays off `TimelineSchema` on purpose,
   * per the objectui#6170 docblock in `@object-ui/types` (`data-display.ts`).
   * While `BaseSchema` carried `[key: string]: any` the renderer's read of it
   * compiled as `any`; objectui#8347 removed the signature, so it is typed here,
   * where its only producer and its only consumer live. The gantt branch also
   * passes the authored row and both indices.
   */
  onItemClick?: (item: unknown, authored?: unknown, rowIndex?: number, itemIndex?: number) => void;
};
