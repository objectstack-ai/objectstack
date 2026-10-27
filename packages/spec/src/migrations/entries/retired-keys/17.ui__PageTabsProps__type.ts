// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #6776 — #5775's count was incomplete. The tab strip's visual style is the
// one prop whose declared spelling collides with the page component's own
// dispatch key, so `type` could never be authored in a flat or JSX carrier
// and was skipped unvalidated by `sdui-parser`'s `BASE_PROPS`. Renamed to
// the `tabStyle` every carrier can express and the renderer already reads.
export const entry = 'ui/PageTabsProps:type';
