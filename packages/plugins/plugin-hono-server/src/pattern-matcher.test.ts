import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import {
    matchOriginPattern,
    createOriginMatcher,
    hasWildcardPattern,
    isAllHostOriginPattern,
    normalizeOriginPatterns,
} from './pattern-matcher';

describe('matchOriginPattern', () => {
    describe('exact matching', () => {
        it('should match exact origin', () => {
            expect(matchOriginPattern('https://app.example.com', 'https://app.example.com')).toBe(true);
        });

        it('should not match different origins', () => {
            expect(matchOriginPattern('https://app.example.com', 'https://api.example.com')).toBe(false);
        });

        it('should match wildcard "*"', () => {
            expect(matchOriginPattern('https://any.domain.com', '*')).toBe(true);
        });
    });

    describe('subdomain wildcard matching', () => {
        it('should match subdomain with wildcard pattern', () => {
            expect(matchOriginPattern('https://app.objectui.org', 'https://*.objectui.org')).toBe(true);
            expect(matchOriginPattern('https://api.objectui.org', 'https://*.objectui.org')).toBe(true);
            expect(matchOriginPattern('https://studio.objectui.org', 'https://*.objectui.org')).toBe(true);
        });

        it('should match multi-level subdomains', () => {
            expect(matchOriginPattern('https://app.dev.objectui.org', 'https://*.objectui.org')).toBe(true);
            expect(matchOriginPattern('https://api.staging.objectui.org', 'https://*.objectui.org')).toBe(true);
        });

        it('should not match different domain', () => {
            expect(matchOriginPattern('https://app.example.com', 'https://*.objectui.org')).toBe(false);
        });

        it('should not match different protocol', () => {
            expect(matchOriginPattern('http://app.objectui.org', 'https://*.objectui.org')).toBe(false);
        });
    });

    describe('port wildcard matching', () => {
        it('should match localhost with any port', () => {
            expect(matchOriginPattern('http://localhost:3000', 'http://localhost:*')).toBe(true);
            expect(matchOriginPattern('http://localhost:8080', 'http://localhost:*')).toBe(true);
            expect(matchOriginPattern('http://localhost:5173', 'http://localhost:*')).toBe(true);
        });

        it('should not match different host', () => {
            expect(matchOriginPattern('http://example.com:3000', 'http://localhost:*')).toBe(false);
        });
    });

    describe('a loopback origin', () => {
        it('matches only a pattern that names it — the pattern, and nothing else', () => {
            expect(matchOriginPattern('http://localhost:3000', 'https://app.example.com')).toBe(false);
            expect(matchOriginPattern('http://127.0.0.1:3000', 'http://localhost:*')).toBe(false);
            expect(matchOriginPattern('http://[::1]:3000', 'https://*.example.com')).toBe(false);
        });
    });

    describe('multiple wildcard patterns', () => {
        it('should match wildcard in multiple positions', () => {
            expect(matchOriginPattern('https://app.objectui.org', 'https://*.objectui.*')).toBe(true);
            expect(matchOriginPattern('https://api.objectui.com', 'https://*.objectui.*')).toBe(true);
        });
    });
});

describe('createOriginMatcher', () => {
    describe('single pattern', () => {
        it('should create matcher for single string pattern', () => {
            const matcher = createOriginMatcher('https://*.objectui.org');

            expect(matcher('https://app.objectui.org')).toBe('https://app.objectui.org');
            expect(matcher('https://api.objectui.org')).toBe('https://api.objectui.org');
            expect(matcher('https://example.com')).toBe(null);
        });
    });

    describe('array of patterns', () => {
        it('should create matcher for array of patterns', () => {
            const matcher = createOriginMatcher([
                'https://*.objectui.org',
                'https://*.objectstack.ai'
            ]);

            expect(matcher('https://app.objectui.org')).toBe('https://app.objectui.org');
            expect(matcher('https://api.objectstack.ai')).toBe('https://api.objectstack.ai');
            expect(matcher('https://example.com')).toBe(null);
        });
    });

    describe('comma-separated patterns', () => {
        it('should parse comma-separated patterns', () => {
            const matcher = createOriginMatcher('https://*.objectui.org,https://*.objectstack.ai');

            expect(matcher('https://app.objectui.org')).toBe('https://app.objectui.org');
            expect(matcher('https://api.objectstack.ai')).toBe('https://api.objectstack.ai');
            expect(matcher('https://example.com')).toBe(null);
        });

        it('should handle whitespace in comma-separated patterns', () => {
            const matcher = createOriginMatcher('https://*.objectui.org, https://*.objectstack.ai , http://localhost:*');

            expect(matcher('https://app.objectui.org')).toBe('https://app.objectui.org');
            expect(matcher('https://api.objectstack.ai')).toBe('https://api.objectstack.ai');
            expect(matcher('http://localhost:3000')).toBe('http://localhost:3000');
            expect(matcher('https://example.com')).toBe(null);
        });
    });

    describe('mixed exact and wildcard patterns', () => {
        it('should match both exact and wildcard patterns', () => {
            const matcher = createOriginMatcher([
                'https://app.example.com',
                'https://*.objectui.org'
            ]);

            expect(matcher('https://app.example.com')).toBe('https://app.example.com');
            expect(matcher('https://dev.objectui.org')).toBe('https://dev.objectui.org');
            expect(matcher('https://other.com')).toBe(null);
        });
    });

    describe('localhost patterns', () => {
        it('should match localhost with port wildcard', () => {
            const matcher = createOriginMatcher('http://localhost:*');

            expect(matcher('http://localhost:3000')).toBe('http://localhost:3000');
            expect(matcher('http://localhost:8080')).toBe('http://localhost:8080');
            // The pattern names `localhost`; another loopback spelling is not it.
            expect(matcher('http://127.0.0.1:3000')).toBe(null);
        });

        it('admits a loopback origin beside a list on a development boot only', () => {
            const LOOPBACK = [
                'http://localhost:3000', 'https://localhost:8443', 'http://localhost',
                'http://127.0.0.1:3000', 'http://[::1]:3000',
            ];
            const elsewhere = createOriginMatcher('https://app.example.com', { developmentBoot: false });
            const development = createOriginMatcher('https://app.example.com', { developmentBoot: true });
            for (const origin of LOOPBACK) {
                expect(elsewhere(origin)).toBe(null);
                expect(development(origin)).toBe(origin);
            }
            expect(development('https://app.example.com')).toBe('https://app.example.com');
            // Non-loopback is still the list's to admit, on either boot.
            expect(development('https://evil.com')).toBe(null);
        });

        it('admits nothing for an empty list, loopback included, on either boot', () => {
            expect(createOriginMatcher([], { developmentBoot: true })('http://localhost:3000')).toBe(null);
            expect(createOriginMatcher(' ', { developmentBoot: true })('http://localhost:3000')).toBe(null);
        });
    });

    describe('the development boot, when not passed', () => {
        let saved: string | undefined;
        beforeEach(() => { saved = process.env.NODE_ENV; });
        afterEach(() => {
            if (saved === undefined) delete process.env.NODE_ENV;
            else process.env.NODE_ENV = saved;
        });

        it('is NODE_ENV exactly `development`, read when the matcher is created', () => {
            process.env.NODE_ENV = 'development';
            const created = createOriginMatcher('https://app.example.com');
            process.env.NODE_ENV = 'production';
            expect(created('http://localhost:3000')).toBe('http://localhost:3000');

            for (const value of ['production', 'test', undefined]) {
                if (value === undefined) delete process.env.NODE_ENV;
                else process.env.NODE_ENV = value;
                expect(createOriginMatcher('https://app.example.com')('http://localhost:3000')).toBe(null);
            }
        });
    });

    describe('empty origin handling', () => {
        it('should return null for empty request origin', () => {
            const matcher = createOriginMatcher('https://*.example.com');
            expect(matcher('')).toBe(null);
        });
    });
});

describe('hasWildcardPattern', () => {
    it('detects wildcards in a single string', () => {
        expect(hasWildcardPattern('https://*.example.com')).toBe(true);
        expect(hasWildcardPattern('https://example.com')).toBe(false);
    });

    it('detects wildcards in an array', () => {
        expect(hasWildcardPattern(['https://a.com', 'https://*.b.com'])).toBe(true);
        expect(hasWildcardPattern(['https://a.com', 'https://b.com'])).toBe(false);
    });
});

describe('isAllHostOriginPattern', () => {
    it("is true for '*' and for a pattern whose host part is the bare `*`", () => {
        for (const pattern of ['*', ' * ', '**', 'https://*', 'http://*', '*://*', 'http://*:*', 'https://*:8443']) {
            expect(isAllHostOriginPattern(pattern)).toBe(true);
        }
    });

    it('is false for a pattern that names any part of the host, and for an exact origin', () => {
        for (const pattern of [
            'https://*.example.com', 'http://localhost:*', '*.example.com',
            'https://app.example.com', 'http://[::1]:3000', 'https://*.*',
        ]) {
            expect(isAllHostOriginPattern(pattern)).toBe(false);
        }
    });

    it('agrees with the matcher: each pattern it names matches an origin on any host', () => {
        for (const pattern of ['*', 'https://*', '*://*', 'http://*:*']) {
            const origin = pattern.startsWith('http://') ? 'http://unlisted.example:8080' : 'https://unlisted.example';
            expect(matchOriginPattern(origin, pattern)).toBe(true);
        }
    });
});

describe('normalizeOriginPatterns', () => {
    it('splits comma-separated strings and trims whitespace', () => {
        expect(normalizeOriginPatterns('a, b , c')).toEqual(['a', 'b', 'c']);
    });

    it('passes arrays through after trimming', () => {
        expect(normalizeOriginPatterns([' a ', 'b'])).toEqual(['a', 'b']);
    });

    it('drops empty entries', () => {
        expect(normalizeOriginPatterns('a,,b')).toEqual(['a', 'b']);
    });
});
