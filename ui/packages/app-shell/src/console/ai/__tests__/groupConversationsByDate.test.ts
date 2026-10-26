import { describe, expect, it } from 'vitest';
import { groupConversationsByDate } from '../ConversationsSidebar';
import type { ConversationListItem } from '../../../hooks/useConversationList';

const DAY = 24 * 60 * 60 * 1000;
// Fixed reference time. Offsets are chosen to land squarely in their bucket
// regardless of the test runner's timezone (0 = today; exactly 24h = yesterday;
// 4/15/60 days are unambiguous), so the calendar-midnight boundary can't flake.
const now = Date.UTC(2026, 5, 13, 12, 0, 0);
const conv = (id: string, offset: number): ConversationListItem =>
  ({ id, updatedAt: new Date(now - offset).toISOString() }) as ConversationListItem;

describe('groupConversationsByDate', () => {
  it('buckets into ordered recency sections', () => {
    const groups = groupConversationsByDate(
      [conv('older', 60 * DAY), conv('today', 0), conv('week', 4 * DAY), conv('yesterday', DAY), conv('month', 15 * DAY)],
      now,
    );
    expect(groups.map((g) => g.key)).toEqual(['today', 'yesterday', 'previous7Days', 'previous30Days', 'older']);
    expect(groups.map((g) => g.items[0].id)).toEqual(['today', 'yesterday', 'week', 'month', 'older']);
  });

  it('omits empty sections', () => {
    const groups = groupConversationsByDate([conv('a', 0), conv('b', 0)], now);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('today');
    expect(groups[0].items).toHaveLength(2);
  });

  it('sorts newest-first within a section and treats unparseable timestamps as oldest', () => {
    const groups = groupConversationsByDate(
      [
        conv('o2', 61 * DAY),
        conv('o1', 60 * DAY),
        { id: 'bad', updatedAt: 'not-a-date' } as ConversationListItem,
      ],
      now,
    );
    const older = groups.find((g) => g.key === 'older');
    expect(older?.items.map((i) => i.id)).toEqual(['o1', 'o2', 'bad']);
  });

  it('falls back to createdAt when updatedAt is absent', () => {
    const groups = groupConversationsByDate(
      [{ id: 'c', createdAt: new Date(now).toISOString() } as ConversationListItem],
      now,
    );
    expect(groups[0]?.key).toBe('today');
  });
});
