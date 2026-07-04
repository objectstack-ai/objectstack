# @objectstack/service-realtime

Realtime Service for ObjectStack — implements `IRealtimeService` with WebSocket and in-memory pub/sub.

## Features

- **WebSocket Support**: Real-time bidirectional communication
- **Pub/Sub Pattern**: Subscribe to channels and receive updates
- **Room-Based Architecture**: Organize connections into rooms
- **Presence Tracking**: Track online users and their status
- **Message Broadcasting**: Send messages to all connections or specific rooms
- **Event Streaming**: Stream database changes and system events
- **Auto-Reconnection**: Client auto-reconnects on connection loss
- **Type-Safe**: Full TypeScript support for events and messages

## Installation

```bash
pnpm add @objectstack/service-realtime
```

## Basic Usage

```typescript
import { defineStack } from '@objectstack/spec';
import { ServiceRealtime } from '@objectstack/service-realtime';

const stack = defineStack({
  services: [
    ServiceRealtime.configure({
      port: 3001,
      path: '/ws',
    }),
  ],
});
```

## Configuration

```typescript
interface RealtimeServiceConfig {
  /** WebSocket server port (default: 3001) */
  port?: number;

  /** WebSocket path (default: '/ws') */
  path?: string;

  /** Enable CORS (default: true) */
  cors?: boolean;

  /** Maximum connections per user (default: 10) */
  maxConnectionsPerUser?: number;

  /** Ping interval in ms (default: 30000) */
  pingInterval?: number;
}
```

## Service API (Server-Side)

```typescript
// Get realtime service
const realtime = kernel.getService<IRealtimeService>('realtime');
```

### Broadcasting

```typescript
// Broadcast to all connected clients
await realtime.broadcast({
  event: 'notification',
  data: { message: 'System update in 5 minutes' },
});

// Broadcast to specific room
await realtime.broadcastToRoom('opportunity:123', {
  event: 'record_updated',
  data: { recordId: '123', field: 'stage', value: 'closed_won' },
});

// Broadcast to specific user
await realtime.broadcastToUser('user:456', {
  event: 'mention',
  data: { commentId: 'comment:789', mentionedBy: 'user:123' },
});
```

### Channel Management

```typescript
// Join a channel (room)
await realtime.join(connectionId, 'opportunity:123');

// Leave a channel
await realtime.leave(connectionId, 'opportunity:123');

// Get all connections in a channel
const connections = await realtime.getChannelConnections('opportunity:123');

// Get all channels for a connection
const channels = await realtime.getConnectionChannels(connectionId);
```

### Presence

```typescript
// Set user presence
await realtime.setPresence('user:456', {
  status: 'online',
  currentPage: '/opportunity/123',
  lastActive: new Date(),
});

// Get user presence
const presence = await realtime.getPresence('user:456');

// Get all online users
const onlineUsers = await realtime.getOnlineUsers();

// Get users in a specific channel
const channelUsers = await realtime.getChannelPresence('opportunity:123');
```

## Client-Side Usage

### React Hook

```typescript
import { useRealtime } from '@objectstack/client-react';

function OpportunityDetails({ id }: { id: string }) {
  const { subscribe, send, isConnected } = useRealtime();

  useEffect(() => {
    // Subscribe to record updates
    const unsubscribe = subscribe(`opportunity:${id}`, (event) => {
      if (event.type === 'record_updated') {
        console.log('Record updated:', event.data);
        // Update UI
      }
    });

    return unsubscribe;
  }, [id]);

  return (
    <div>
      {isConnected ? '🟢 Connected' : '🔴 Disconnected'}
    </div>
  );
}
```

### JavaScript Client

```typescript
import { RealtimeClient } from '@objectstack/client';

const client = new RealtimeClient({
  url: 'ws://localhost:3001/ws',
  auth: {
    token: 'your-auth-token',
  },
});

// Connect
await client.connect();

// Subscribe to a channel
client.subscribe('opportunity:123', (event) => {
  console.log('Received event:', event);
});

// Send a message
client.send('typing', {
  recordId: '123',
  userId: 'user:456',
  isTyping: true,
});

// Disconnect
await client.disconnect();
```

## Advanced Features

### Event Streaming

Stream database changes in real-time:

```typescript
// Server-side: Stream record changes
realtime.streamRecordChanges('opportunity', {
  onInsert: async (record) => {
    await realtime.broadcast({
      event: 'record_created',
      data: { object: 'opportunity', record },
    });
  },
  onUpdate: async (record, changes) => {
    await realtime.broadcastToRoom(`opportunity:${record.id}`, {
      event: 'record_updated',
      data: { recordId: record.id, changes },
    });
  },
  onDelete: async (recordId) => {
    await realtime.broadcast({
      event: 'record_deleted',
      data: { object: 'opportunity', recordId },
    });
  },
});
```

### Private Channels

```typescript
// Server-side: Authorize private channel access
realtime.authorizeChannel = async (userId, channel) => {
  if (channel.startsWith('user:')) {
    // Only allow users to join their own private channel
    return channel === `user:${userId}`;
  }

  if (channel.startsWith('opportunity:')) {
    // Check if user has access to the opportunity
    const opportunityId = channel.split(':')[1];
    return await hasAccess(userId, 'opportunity', opportunityId);
  }

  return false;
};
```

### Typing Indicators

```typescript
// Client sends typing event
client.send('typing', {
  recordId: '123',
  userId: 'user:456',
  isTyping: true,
});

// Server broadcasts to room
realtime.on('typing', async (connectionId, data) => {
  await realtime.broadcastToRoom(`opportunity:${data.recordId}`, {
    event: 'user_typing',
    data: { userId: data.userId, isTyping: data.isTyping },
  }, { exclude: [connectionId] }); // Don't send back to sender
});

// Other clients receive typing notification
client.subscribe('opportunity:123', (event) => {
  if (event.type === 'user_typing') {
    showTypingIndicator(event.data.userId, event.data.isTyping);
  }
});
```

### Live Cursor Tracking

```typescript
// Client sends cursor position
client.send('cursor', {
  recordId: '123',
  x: 450,
  y: 200,
});

// Server broadcasts to room
realtime.on('cursor', async (connectionId, data) => {
  const user = await getConnectionUser(connectionId);

  await realtime.broadcastToRoom(`opportunity:${data.recordId}`, {
    event: 'cursor_moved',
    data: {
      userId: user.id,
      userName: user.name,
      x: data.x,
      y: data.y,
    },
  }, { exclude: [connectionId] });
});
```

### Collaborative Editing

```typescript
// Operational Transform (OT) for collaborative editing
client.send('edit', {
  documentId: '123',
  operation: {
    type: 'insert',
    position: 42,
    text: 'Hello',
  },
});

realtime.on('edit', async (connectionId, data) => {
  // Apply operation transform
  const transformedOp = await applyOT(data.operation);

  // Broadcast to all editors
  await realtime.broadcastToRoom(`document:${data.documentId}`, {
    event: 'operation',
    data: transformedOp,
  }, { exclude: [connectionId] });
});
```

## Integration with ObjectStack Features

### Feed Updates

```typescript
// When a comment is added
feed.on('comment_added', async (comment) => {
  await realtime.broadcastToRoom(`${comment.object}:${comment.recordId}`, {
    event: 'feed_update',
    data: { type: 'comment', comment },
  });
});
```

### Workflow Status

```typescript
// When a flow step completes
automation.on('step_completed', async (execution) => {
  await realtime.broadcastToUser(execution.userId, {
    event: 'flow_progress',
    data: {
      flowId: execution.flowId,
      step: execution.currentStep,
      progress: execution.progress,
    },
  });
});
```

### Analytics Dashboard

```typescript
// Stream real-time metrics
setInterval(async () => {
  const metrics = await analytics.getCurrentMetrics();

  await realtime.broadcastToRoom('dashboard:sales', {
    event: 'metrics_update',
    data: metrics,
  });
}, 5000); // Every 5 seconds
```

## Connection Events

```typescript
// Server-side event handlers
realtime.on('connection', async (connectionId, userId) => {
  console.log(`User ${userId} connected (${connectionId})`);

  // Set initial presence
  await realtime.setPresence(userId, { status: 'online' });
});

realtime.on('disconnection', async (connectionId, userId) => {
  console.log(`User ${userId} disconnected`);

  // Update presence
  await realtime.setPresence(userId, {
    status: 'offline',
    lastSeen: new Date(),
  });
});

realtime.on('error', async (connectionId, error) => {
  console.error(`Connection error:`, error);
});
```

## Best Practices

1. **Channel Organization**: Use namespaced channels (e.g., `object:recordId`)
2. **Authorization**: Always verify channel access before joining
3. **Message Size**: Keep messages small (< 10KB)
4. **Rate Limiting**: Limit message frequency per connection
5. **Cleanup**: Remove disconnected users from channels
6. **Heartbeat**: Implement ping/pong for connection health
7. **Compression**: Enable WebSocket compression for large messages

## Performance Considerations

- **Scaling**: Use Redis adapter for multi-server deployments
- **Connection Pooling**: Limit concurrent connections per user
- **Channel Limits**: Limit channels per connection
- **Message Batching**: Batch frequent updates to reduce traffic
- **Binary Protocol**: Use binary for large data transfers

## REST API Endpoints

```
POST   /api/v1/realtime/broadcast              # Broadcast to all
POST   /api/v1/realtime/broadcast/room/:room   # Broadcast to room
POST   /api/v1/realtime/broadcast/user/:userId # Broadcast to user
GET    /api/v1/realtime/presence                # Get online users
GET    /api/v1/realtime/presence/:userId        # Get user presence
GET    /api/v1/realtime/channels/:channel       # Get channel connections
```

## Contract Implementation

Implements `IRealtimeService` from `@objectstack/spec/contracts`:

```typescript
interface IRealtimeService {
  broadcast(message: Message): Promise<void>;
  broadcastToRoom(room: string, message: Message): Promise<void>;
  broadcastToUser(userId: string, message: Message): Promise<void>;
  join(connectionId: string, channel: string): Promise<void>;
  leave(connectionId: string, channel: string): Promise<void>;
  setPresence(userId: string, presence: PresenceData): Promise<void>;
  getPresence(userId: string): Promise<PresenceData | null>;
  getOnlineUsers(): Promise<string[]>;
  on(event: string, handler: EventHandler): void;
}
```

## License

Apache-2.0. See [LICENSING.md](../../../LICENSING.md).

## See Also

- [WebSocket API Documentation](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API)
- [@objectstack/client](../../client/)
- [@objectstack/client-react](../../client-react/)
- [Realtime Features Guide](/content/docs/protocol/objectos/realtime-protocol.mdx)
