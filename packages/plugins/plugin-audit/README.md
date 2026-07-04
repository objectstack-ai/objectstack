# @objectstack/plugin-audit

Audit Plugin for ObjectStack — System audit log object and audit trail for compliance and security monitoring.

## Features

- **Comprehensive Audit Trail**: Track all CRUD operations across all objects
- **User Activity Logging**: Record who did what, when, and from where
- **Field-Level Changes**: Capture before/after values for all field changes
- **Compliance Ready**: Meet SOC 2, HIPAA, GDPR audit requirements
- **Query Filtering**: Search audit logs by user, object, action, date range
- **Retention Policies**: Auto-archive or delete old audit logs
- **Security Events**: Track authentication, authorization, and security-related events
- **Immutable Logs**: Audit records cannot be modified or deleted (only archived)

## Installation

```bash
pnpm add @objectstack/plugin-audit
```

## Basic Usage

```typescript
import { defineStack } from '@objectstack/spec';
import { PluginAudit } from '@objectstack/plugin-audit';

const stack = defineStack({
  plugins: [
    PluginAudit.configure({
      enabled: true,
      trackObjects: '*', // Track all objects
      trackFields: '*', // Track all field changes
    }),
  ],
});
```

## Configuration

```typescript
interface AuditPluginConfig {
  /** Enable audit logging (default: true) */
  enabled?: boolean;

  /** Objects to track ('*' for all, or array of object names) */
  trackObjects?: '*' | string[];

  /** Fields to track ('*' for all, or object-specific config) */
  trackFields?: '*' | Record<string, string[]>;

  /** Track system events (login, logout, failed auth, etc.) */
  trackSystemEvents?: boolean;

  /** Retention period in days (default: 365) */
  retentionDays?: number;

  /** Auto-archive after retention period (default: true) */
  autoArchive?: boolean;

  /** Exclude certain users from audit (e.g., system users) */
  excludeUsers?: string[];
}
```

## Audit Log Schema

The plugin automatically creates the `audit_log` object:

```typescript
{
  id: string;              // Unique audit log entry ID
  timestamp: datetime;     // When the action occurred
  userId: string;          // User who performed the action
  userName: string;        // User's name at time of action
  userEmail: string;       // User's email at time of action
  action: string;          // 'insert', 'update', 'delete', 'read'
  object: string;          // Object type (e.g., 'opportunity')
  recordId: string;        // Record ID that was affected
  recordName: string;      // Record display name
  changes: json;           // Field-level changes (before/after)
  metadata: json;          // Additional context (IP, user agent, etc.)
  ipAddress: string;       // Client IP address
  userAgent: string;       // Client user agent
  sessionId: string;       // Session ID
  status: string;          // 'success' | 'failed'
  errorMessage: string;    // Error message if action failed
}
```

## Automatic Audit Logging

All CRUD operations are automatically audited:

```typescript
// This operation is automatically audited
await kernel.getDriver().insert({
  object: 'opportunity',
  data: {
    name: 'Big Deal',
    amount: 100000,
    stage: 'prospecting',
  },
});

// Audit log entry created:
// {
//   action: 'insert',
//   object: 'opportunity',
//   recordId: '123',
//   recordName: 'Big Deal',
//   changes: {
//     name: { from: null, to: 'Big Deal' },
//     amount: { from: null, to: 100000 },
//     stage: { from: null, to: 'prospecting' }
//   }
// }
```

## Querying Audit Logs

```typescript
// Get audit logs via kernel
const auditService = kernel.getService('audit');

// Get all changes for a specific record
const recordHistory = await auditService.getRecordHistory({
  object: 'opportunity',
  recordId: '123',
});

// Get user activity
const userActivity = await auditService.getUserActivity({
  userId: 'user:456',
  from: '2024-01-01',
  to: '2024-01-31',
});

// Search audit logs
const logs = await auditService.searchLogs({
  action: 'delete',
  object: 'account',
  from: '2024-01-01',
  to: '2024-01-31',
});

// Get failed actions (security monitoring)
const failures = await auditService.getFailedActions({
  from: '2024-01-01',
  limit: 100,
});
```

## Selective Tracking

### Track Specific Objects

```typescript
PluginAudit.configure({
  trackObjects: ['opportunity', 'account', 'contact'],
  // Only these objects will be audited
});
```

### Track Specific Fields

```typescript
PluginAudit.configure({
  trackFields: {
    opportunity: ['stage', 'amount', 'close_date'], // Only track these fields
    account: '*', // Track all fields for accounts
    contact: ['email', 'phone'], // Only email and phone for contacts
  },
});
```

### Exclude System Users

```typescript
PluginAudit.configure({
  excludeUsers: [
    'system:integration',
    'system:cron',
    'service:automation',
  ],
  // These users' actions won't be audited
});
```

## Advanced Features

### Manual Audit Entries

```typescript
// Log custom security event
await auditService.log({
  action: 'security:password_reset',
  userId: 'user:456',
  metadata: {
    resetMethod: 'email',
    ipAddress: '192.168.1.100',
  },
});

// Log business process event
await auditService.log({
  action: 'workflow:approval',
  object: 'opportunity',
  recordId: '123',
  metadata: {
    approver: 'manager:789',
    decision: 'approved',
  },
});
```

### Audit Snapshots

```typescript
// Create snapshot of record state at a specific time
const snapshot = await auditService.getRecordSnapshot({
  object: 'opportunity',
  recordId: '123',
  asOf: '2024-01-15T10:30:00Z',
});

// Returns: Record state as it existed on Jan 15, 2024 at 10:30 AM
```

### Audit Reports

```typescript
// Generate compliance report
const report = await auditService.generateReport({
  type: 'compliance',
  from: '2024-01-01',
  to: '2024-03-31',
  format: 'pdf',
});

// Generate user activity report
const userReport = await auditService.generateReport({
  type: 'user_activity',
  userId: 'user:456',
  from: '2024-01-01',
  to: '2024-01-31',
  includeDetails: true,
});
```

### Data Retention & Archival

```typescript
// Archive old audit logs
await auditService.archiveLogs({
  olderThan: '2023-01-01',
  destination: 's3://audit-archive/2023/',
});

// Permanently delete archived logs (compliance approved)
await auditService.purgeLogs({
  olderThan: '2020-01-01',
  confirmed: true, // Safety check
});
```

## Security Events

The plugin automatically logs security-related events:

- **Authentication**: Login, logout, password changes
- **Authorization**: Permission denied, role changes
- **Data Access**: Read operations on sensitive fields
- **Configuration**: System setting changes
- **API**: API key usage, rate limit violations

```typescript
// Automatically logged:
// - Login attempts (success/failure)
// - Permission denied errors
// - Sensitive field access
// - API authentication failures
```

## Compliance Integration

### GDPR Compliance

```typescript
// Right to be forgotten - audit trail for deletions
await auditService.logDataDeletion({
  userId: 'user:456',
  reason: 'gdpr_right_to_be_forgotten',
  deletedRecords: [
    { object: 'user', recordId: '456' },
    { object: 'contact', recordId: '789' },
  ],
});

// Right of access - audit trail for data exports
await auditService.logDataExport({
  userId: 'user:456',
  reason: 'gdpr_data_access_request',
  exportedObjects: ['user', 'contact', 'activity'],
});
```

### SOC 2 Compliance

```typescript
// Log administrative actions
await auditService.logAdminAction({
  adminId: 'admin:123',
  action: 'user_role_change',
  targetUserId: 'user:456',
  changes: {
    roles: { from: ['user'], to: ['user', 'admin'] },
  },
});
```

### HIPAA Compliance

```typescript
// Track PHI access
PluginAudit.configure({
  trackFields: {
    patient: ['ssn', 'medical_record_number', 'diagnosis'], // PHI fields
  },
  trackSystemEvents: true,
});
```

## REST API Endpoints

```
GET    /api/v1/audit                      # List audit logs
GET    /api/v1/audit/:id                  # Get specific log entry
GET    /api/v1/audit/record/:object/:id   # Get record history
GET    /api/v1/audit/user/:userId         # Get user activity
POST   /api/v1/audit/report               # Generate report
POST   /api/v1/audit/archive              # Archive old logs
```

## Dashboard Integration

```typescript
// Audit dashboard widget
const auditWidget = {
  title: 'Recent Activity',
  query: {
    object: 'audit_log',
    limit: 50,
    sort: [{ field: 'timestamp', direction: 'desc' }],
  },
};

// Security alerts dashboard
const securityWidget = {
  title: 'Failed Login Attempts',
  query: {
    object: 'audit_log',
    filters: [
      { field: 'action', operator: 'eq', value: 'auth:login' },
      { field: 'status', operator: 'eq', value: 'failed' },
      { field: 'timestamp', operator: 'gte', value: 'today' },
    ],
  },
};
```

## Best Practices

1. **Selective Tracking**: Only audit what's necessary for compliance
2. **Retention Policy**: Set appropriate retention based on regulations
3. **Performance**: Archive old logs to keep query performance high
4. **Security**: Restrict access to audit logs (admin only)
5. **Immutability**: Never allow modification of audit records
6. **Monitoring**: Set alerts for suspicious activity patterns
7. **Regular Review**: Periodically review audit logs for anomalies

## Performance Considerations

- **Async Logging**: Audit writes happen asynchronously (no performance impact)
- **Indexing**: Automatically indexes `userId`, `object`, `recordId`, `timestamp`
- **Partitioning**: Consider table partitioning for high-volume deployments
- **Archival**: Move old logs to cold storage (S3, Glacier)

## Contract Implementation

Implements audit logging hooks from `@objectstack/spec/contracts`:

```typescript
interface IAuditService {
  log(entry: AuditLogEntry): Promise<void>;
  getRecordHistory(options: RecordHistoryOptions): Promise<AuditLog[]>;
  getUserActivity(options: UserActivityOptions): Promise<AuditLog[]>;
  searchLogs(filter: AuditLogFilter): Promise<AuditLog[]>;
  getRecordSnapshot(options: SnapshotOptions): Promise<any>;
  archiveLogs(options: ArchiveOptions): Promise<void>;
}
```

## License

Apache-2.0. See [LICENSING.md](../../../LICENSING.md).

## See Also

- [SOC 2 Compliance Guide](https://www.aicpa.org/interestareas/frc/assuranceadvisoryservices/sorhome)
- [GDPR Requirements](https://gdpr.eu/)
- [HIPAA Compliance](https://www.hhs.gov/hipaa/)
- [@objectstack/plugin-security](../plugin-security/)
- [Audit Logging Best Practices](/content/docs/kernel/runtime-services/audit-service.mdx)
