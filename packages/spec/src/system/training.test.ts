import { describe, it, expect } from 'vitest';
import {
  TrainingCategorySchema,
  TrainingCompletionStatusSchema,
  TrainingCourseSchema,
  TrainingRecordSchema,
  TrainingPlanSchema,
  type TrainingCourse,
  type TrainingRecord,
} from './training.zod';

describe('TrainingCategorySchema', () => {
  it('should accept all valid categories', () => {
    const validCategories = [
      'security_awareness', 'data_protection', 'incident_response',
      'access_control', 'phishing_awareness', 'compliance',
      'secure_development', 'physical_security', 'business_continuity', 'other',
    ];

    validCategories.forEach((category) => {
      expect(() => TrainingCategorySchema.parse(category)).not.toThrow();
    });
  });

  it('should reject invalid category', () => {
    expect(() => TrainingCategorySchema.parse('yoga')).toThrow();
  });
});

describe('TrainingCompletionStatusSchema', () => {
  it('should accept all valid statuses', () => {
    const statuses = ['not_started', 'in_progress', 'completed', 'failed', 'expired'];

    statuses.forEach((status) => {
      expect(() => TrainingCompletionStatusSchema.parse(status)).not.toThrow();
    });
  });

  it('should reject invalid status', () => {
    expect(() => TrainingCompletionStatusSchema.parse('skipped')).toThrow();
  });
});

describe('TrainingCourseSchema', () => {
  it('should accept valid course with defaults', () => {
    const course = TrainingCourseSchema.parse({
      id: 'COURSE-SEC-001',
      title: 'Information Security Fundamentals',
      description: 'Annual security awareness training for all employees',
      category: 'security_awareness',
      targetRoles: ['all_employees'],
    });

    expect(course.mandatory).toBe(false);
    expect(course.passingScore).toBeUndefined();
    expect(course.validityDays).toBeUndefined();
  });

  it('should accept full course configuration', () => {
    const course: TrainingCourse = {
      id: 'COURSE-SEC-002',
      title: 'Phishing Awareness Training',
      description: 'Recognize and report phishing attempts',
      category: 'phishing_awareness',
      mandatory: true,
      targetRoles: ['all_employees', 'contractors'],
      passingScore: 80,
      version: '2.0',
    };

    expect(() => TrainingCourseSchema.parse(course)).not.toThrow();
  });

  it('should accept all category types', () => {
    const categories = [
      'security_awareness', 'data_protection', 'incident_response',
      'access_control', 'phishing_awareness', 'compliance',
      'secure_development', 'physical_security', 'business_continuity', 'other',
    ];

    categories.forEach((category) => {
      expect(() => TrainingCourseSchema.parse({
        id: `COURSE-${category}`,
        title: `${category} Training`,
        description: `Training for ${category}`,
        category,
        targetRoles: ['all'],
      })).not.toThrow();
    });
  });

  it('REFUSES an authored `durationMinutes` — a retiredKey() tombstone since #14477 (ADR-0049)', () => {
    // The full refusal envelope (path, code, prescription) is pinned in
    // `deadline-keys-retirement.test.ts`; this keeps the family suite honest
    // about the shape it parses: any value, not only `0`, is refused.
    expect(() => TrainingCourseSchema.parse({
      id: 'COURSE-001',
      title: 'Test',
      description: 'Test',
      category: 'other',
      durationMinutes: 30,
      targetRoles: ['all'],
    })).toThrow(/`TrainingCourse\.durationMinutes` was removed/s);
  });

  it('should reject passing score out of range', () => {
    expect(() => TrainingCourseSchema.parse({
      id: 'COURSE-001',
      title: 'Test',
      description: 'Test',
      category: 'other',
      targetRoles: ['all'],
      passingScore: 101,
    })).toThrow();

    expect(() => TrainingCourseSchema.parse({
      id: 'COURSE-001',
      title: 'Test',
      description: 'Test',
      category: 'other',
      targetRoles: ['all'],
      passingScore: -1,
    })).toThrow();
  });

  it('should reject missing required fields', () => {
    expect(() => TrainingCourseSchema.parse({})).toThrow();
    expect(() => TrainingCourseSchema.parse({ id: 'COURSE-001' })).toThrow();
  });
});

describe('TrainingRecordSchema', () => {
  it('should accept valid completed training record', () => {
    const record: TrainingRecord = {
      courseId: 'COURSE-SEC-001',
      userId: 'user_123',
      status: 'completed',
      assignedAt: 1704067200000,
      completedAt: 1704153600000,
      score: 95,
      expiresAt: 1735689600000,
    };

    expect(() => TrainingRecordSchema.parse(record)).not.toThrow();
  });

  it('should accept minimal not-started record', () => {
    const record = {
      courseId: 'COURSE-SEC-002',
      userId: 'user_456',
      status: 'not_started',
      assignedAt: Date.now(),
    };

    expect(() => TrainingRecordSchema.parse(record)).not.toThrow();
  });

  it('should accept failed record', () => {
    const record = {
      courseId: 'COURSE-SEC-003',
      userId: 'user_789',
      status: 'failed',
      assignedAt: 1704067200000,
      completedAt: 1704153600000,
      score: 45,
      notes: 'Did not meet passing score of 80%',
    };

    expect(() => TrainingRecordSchema.parse(record)).not.toThrow();
  });

  it('should reject score out of range', () => {
    expect(() => TrainingRecordSchema.parse({
      courseId: 'COURSE-001',
      userId: 'user_123',
      status: 'completed',
      assignedAt: Date.now(),
      score: 150,
    })).toThrow();
  });

  it('should reject missing required fields', () => {
    expect(() => TrainingRecordSchema.parse({})).toThrow();
    expect(() => TrainingRecordSchema.parse({ courseId: 'COURSE-001' })).toThrow();
  });
});

describe('TrainingPlanSchema', () => {
  it('should accept plan with defaults', () => {
    const plan = TrainingPlanSchema.parse({
      courses: [
        {
          id: 'COURSE-SEC-001',
          title: 'Security Awareness',
          description: 'Annual security training',
          category: 'security_awareness',
          targetRoles: ['all_employees'],
        },
      ],
    });

    expect(plan.enabled).toBe(true);
    expect(plan).not.toHaveProperty('recertificationIntervalDays');
    expect(plan.trackCompletion).toBe(true);
    expect(plan).not.toHaveProperty('gracePeriodDays');
    expect(plan.sendReminders).toBe(true);
    expect(plan).not.toHaveProperty('reminderDaysBefore');
  });

  it('should accept full plan configuration', () => {
    const plan = TrainingPlanSchema.parse({
      enabled: true,
      courses: [
        {
          id: 'COURSE-SEC-001',
          title: 'Security Fundamentals',
          description: 'Core security training',
          category: 'security_awareness',
          mandatory: true,
          targetRoles: ['all_employees'],
          passingScore: 80,
        },
        {
          id: 'COURSE-SEC-002',
          title: 'Secure Development',
          description: 'Secure coding practices',
          category: 'secure_development',
          mandatory: true,
          targetRoles: ['developers', 'devops'],
          passingScore: 85,
        },
      ],
      trackCompletion: true,
      sendReminders: true,
    });

    expect(plan.courses).toHaveLength(2);
    expect(plan).not.toHaveProperty('recertificationIntervalDays');
    expect(plan).not.toHaveProperty('gracePeriodDays');
    expect(plan).not.toHaveProperty('reminderDaysBefore');
  });

  it('should accept plan with empty courses', () => {
    const plan = TrainingPlanSchema.parse({
      courses: [],
    });

    expect(plan.courses).toHaveLength(0);
  });

  it('should reject missing courses', () => {
    expect(() => TrainingPlanSchema.parse({})).toThrow();
  });
});
