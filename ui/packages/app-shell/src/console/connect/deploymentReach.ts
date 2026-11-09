// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Whether a client that connects from its vendor's cloud (claude.ai on the
 * web, Doubao Work's cloud tasks) can reach this deployment at the address
 * Connect an Agent shows. Only a public HTTPS address is reachable from
 * there: an `http://` address, `localhost`, a single-label or `.local` host
 * name, and a loopback, private, link-local or carrier-grade NAT IP literal
 * are not. A host name with a dot is taken as public: the page cannot see
 * how the reader's DNS resolves it.
 */
export function isPublicHttpsAddress(address: string): boolean {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host) return false;
  if (host.includes(':')) return !isNonPublicIpv6(host);
  const octets = ipv4Octets(host);
  if (octets) return !isNonPublicIpv4(octets);
  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  if (!host.includes('.')) return false;
  if (host.endsWith('.local') || host.endsWith('.internal')) return false;
  return true;
}

function ipv4Octets(host: string): number[] | null {
  const parts = host.split('.');
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p))) return null;
  const octets = parts.map(Number);
  return octets.every((n) => n <= 255) ? octets : null;
}

function isNonPublicIpv4([a, b]: number[]): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isNonPublicIpv6(host: string): boolean {
  if (host === '::' || host === '::1') return true;
  // IPv4-mapped (`::ffff:10.0.0.1`, or the hex form the URL parser writes).
  const mapped = /^::ffff:(.+)$/.exec(host);
  if (mapped) {
    const dotted = ipv4Octets(mapped[1]);
    if (dotted) return isNonPublicIpv4(dotted);
    const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(mapped[1]);
    if (hex) {
      const hi = parseInt(hex[1], 16);
      return isNonPublicIpv4([hi >> 8, hi & 0xff]);
    }
  }
  const first = parseInt(host.split(':')[0] || '0', 16);
  // fc00::/7 unique local, fe80::/10 link-local.
  return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80;
}
