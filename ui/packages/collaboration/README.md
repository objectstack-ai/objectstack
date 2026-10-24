# @object-ui/collaboration

Real-time collaboration for Object UI — live cursors, presence tracking, comment threads, and conflict resolution.

## Features

- 🖱️ **Live Cursors** - Display remote user cursors in real time with `LiveCursors`
- 👥 **Presence Avatars** - Show active users with `PresenceAvatars`
- 💬 **Comment Threads** - Threaded comments with @mentions via `CommentThread`
- 🔄 **Realtime Subscriptions** - WebSocket data subscriptions with `useRealtimeSubscription`
- 👁️ **Presence Tracking** - Track who's viewing or editing with `usePresence`
- ⚔️ **Conflict Resolution** - Version history and merge conflicts with `useConflictResolution`
- 🎯 **Type-Safe** - Full TypeScript support with exported types

## Installation

```bash
npm install @object-ui/collaboration
```

**Peer Dependencies:**
- `react` ^18.0.0 || ^19.0.0

## Quick Start

```tsx
import {
  usePresence,
  useRealtimeSubscription,
  LiveCursors,
  PresenceAvatars,
  CommentThread,
  type Comment,
  type PresenceUser,
} from '@object-ui/collaboration';

declare const broadcastPresence: (user: PresenceUser) => void;
declare const comments: Comment[];
declare const currentUser: { id: string; name: string };

function CollaborativeEditor() {
  const { users, updateCursor } = usePresence(broadcastPresence, {
    user: { id: 'user-1', name: 'Alice' },
  });

  const { lastMessage, connectionState } = useRealtimeSubscription({
    channel: 'document-123',
  });

  return (
    <div data-connection={connectionState}>
      <PresenceAvatars users={users} />
      <LiveCursors users={users} />
      <div onMouseMove={(event) => updateCursor({ x: event.clientX, y: event.clientY })}>
        {lastMessage ? lastMessage.channel : 'waiting for updates'}
      </div>
      <CommentThread threadId="thread-1" comments={comments} currentUser={currentUser} />
    </div>
  );
}
```

## API

### useRealtimeSubscription

Hook for WebSocket data subscriptions. `channel` is the only required key, and the
result carries the connection state plus the messages received so far:

```tsx
import { useRealtimeSubscription } from '@object-ui/collaboration';

const { lastMessage, messages, connectionState, error } = useRealtimeSubscription({
  channel: 'orders',
});
```

### usePresence

Hook for tracking user presence. The broadcast callback comes first and the
configuration second; the configuration carries the current user:

```tsx
import { usePresence, type PresenceUser } from '@object-ui/collaboration';

declare const broadcastPresence: (user: PresenceUser) => void;

const { users, updateCursor, currentUser } = usePresence(broadcastPresence, {
  user: { id: 'user-1', name: 'Alice' },
});
```

### useConflictResolution

Hook for version history and conflict management. It is called with the current
user's id, optionally their name:

```tsx
import { useConflictResolution } from '@object-ui/collaboration';

const { versions, conflicts, resolveConflict } = useConflictResolution('user-1', 'Alice');
```

### LiveCursors

Displays remote user cursors on the page:

```tsx
import { LiveCursors, type PresenceUser } from '@object-ui/collaboration';

declare const presenceUsers: PresenceUser[];

const cursors = <LiveCursors users={presenceUsers} />;
```

### PresenceAvatars

Shows avatar badges for active users:

```tsx
import { PresenceAvatars, type PresenceUser } from '@object-ui/collaboration';

declare const presenceUsers: PresenceUser[];

const avatars = <PresenceAvatars users={presenceUsers} maxVisible={5} />;
```

### CommentThread

Threaded comment component with @mentions. `comments` and `currentUser` are
required; new comments arrive through `onAddComment`:

```tsx
import { CommentThread, type Comment } from '@object-ui/collaboration';

declare const comments: Comment[];
declare const currentUser: { id: string; name: string };
declare const saveComment: (content: string, mentions: string[]) => void;

const thread = (
  <CommentThread
    threadId="thread-1"
    comments={comments}
    currentUser={currentUser}
    onAddComment={(content, mentions) => saveComment(content, mentions)}
  />
);
```

## Links

- 📦 [npm package](https://www.npmjs.com/package/@object-ui/collaboration)
- 📝 [Changelog](./CHANGELOG.md)
- 🐛 [Report an issue](https://github.com/objectstack-ai/objectui/issues)
- 🤝 [Contributing Guide](https://github.com/objectstack-ai/objectui/blob/main/CONTRIBUTING.md)
- 🗺️ [Roadmap](https://github.com/objectstack-ai/objectui/blob/main/ROADMAP.md)

## License

MIT — see [LICENSE](./LICENSE).
