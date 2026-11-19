import dns from 'node:dns/promises';
import net from 'node:net';

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata',
  '169.254.169.254',
  '0.0.0.0',
  '::1',
]);

function isPrivateOrReservedIpv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local & cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 192 && b === 0 && parts[2] === 0) return true; // 192.0.0.0/24
  if (a === 192 && b === 0 && parts[2] === 2) return true; // TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // Benchmarking
  if (a === 198 && b === 51 && parts[2] === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && parts[2] === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // Multicast & reserved
  return false;
}

function isPrivateOrReservedIpv6(ip: string): boolean {
  const lower = ip.toLowerCase().split('%')[0];
  if (lower === '::' || lower === '::1') return true;
  if (lower.startsWith('::ffff:')) {
    const mappedV4 = lower.slice(7);
    if (net.isIPv4(mappedV4)) return isPrivateOrReservedIpv4(mappedV4);
  }
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // ULA fc00::/7
  if (/^fe[89ab]/.test(lower)) return true; // Link-local fe80::/10
  if (lower.startsWith('ff')) return true; // Multicast
  return false;
}

export function isPrivateIpAddress(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) return isPrivateOrReservedIpv4(ip);
  if (kind === 6) return isPrivateOrReservedIpv6(ip);
  return true;
}

export async function assertSafePublicUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error('Invalid URL format. Provide a full https:// or http:// link.');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Only public http:// and https:// URLs are permitted.');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Embedded credentials inside URLs are blocked for security.');
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    !host ||
    BLOCKED_HOSTNAMES.has(host) ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.localhost')
  ) {
    throw new Error('Internal, loopback, and cloud metadata hostnames are blocked.');
  }

  if (net.isIP(host)) {
    if (isPrivateIpAddress(host)) {
      throw new Error('Private or reserved IP ranges are blocked by SSRF policy.');
    }
    return parsed;
  }

  let resolved: Array<{ address: string; family: number }>;
  try {
    resolved = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error('Could not resolve hostname for the supplied URL.');
  }

  if (!resolved || resolved.length === 0) {
    throw new Error('DNS resolution returned no addresses for URL.');
  }

  for (const addr of resolved) {
    if (isPrivateIpAddress(addr.address)) {
      throw new Error('URL resolves to a private or internal IP address and was blocked by SSRF policy.');
    }
  }

  return parsed;
}

export interface SafeFetchedUrlResult {
  finalUrl: string;
  status: number;
  statusCode: number;
  contentType: string;
  headersSummary: Record<string, string>;
  buffer: Buffer;
}

export async function safeFetchPublicUrl(
  rawUrl: string,
  options?: { maxBytes?: number; timeoutMs?: number; maxRedirects?: number },
): Promise<SafeFetchedUrlResult> {
  const maxBytes = options?.maxBytes ?? 10 * 1024 * 1024;
  const timeoutMs = options?.timeoutMs ?? 12_000;
  const maxRedirects = options?.maxRedirects ?? 3;

  let currentUrl = (await assertSafePublicUrl(rawUrl)).toString();

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let res: Response;
    try {
      res = await fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': 'TruthLens-Forensic-Inspector/1.0 (+https://truthlens.local)',
          Accept: 'text/html,application/xhtml+xml,image/*,audio/*,application/pdf,text/plain;q=0.9,*/*;q=0.5',
        },
      });
    } catch (err) {
      clearTimeout(timer);
      const msg = err instanceof Error && err.name === 'AbortError'
        ? 'Remote URL timed out before responding.'
        : 'Unable to fetch remote URL safely.';
      throw new Error(msg);
    }

    if (res.status >= 300 && res.status < 400) {
      clearTimeout(timer);
      const loc = res.headers.get('location');
      if (!loc) {
        throw new Error('Remote URL returned an empty redirect.');
      }
      if (hop >= maxRedirects) {
        throw new Error('Exceeded maximum safe redirect hops.');
      }
      const nextUrl = new URL(loc, currentUrl).toString();
      currentUrl = (await assertSafePublicUrl(nextUrl)).toString();
      continue;
    }

    if (!res.ok) {
      clearTimeout(timer);
      throw new Error(`Remote server returned HTTP ${res.status}.`);
    }

    const contentLengthHeader = res.headers.get('content-length');
    if (contentLengthHeader) {
      const len = Number(contentLengthHeader);
      if (Number.isFinite(len) && len > maxBytes) {
        clearTimeout(timer);
        throw new Error(`Remote resource exceeds maximum allowed size (${Math.round(maxBytes / (1024 * 1024))} MB).`);
      }
    }

    const reader = res.body?.getReader();
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    try {
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            totalBytes += value.byteLength;
            if (totalBytes > maxBytes) {
              await reader.cancel();
              throw new Error(`Remote resource exceeded ${Math.round(maxBytes / (1024 * 1024))} MB download limit.`);
            }
            chunks.push(Buffer.from(value));
          }
        }
      } else {
        const ab = await res.arrayBuffer();
        if (ab.byteLength > maxBytes) {
          throw new Error(`Remote resource exceeded ${Math.round(maxBytes / (1024 * 1024))} MB download limit.`);
        }
        chunks.push(Buffer.from(ab));
      }
    } finally {
      clearTimeout(timer);
    }

    const headersSummary: Record<string, string> = {};
    for (const hName of ['content-type', 'last-modified', 'etag', 'server', 'cache-control']) {
      const val = res.headers.get(hName);
      if (val) {
        headersSummary[hName] = val.slice(0, 180);
      }
    }

    return {
      finalUrl: currentUrl,
      status: res.status,
      statusCode: res.status,
      contentType: (res.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim().toLowerCase(),
      headersSummary,
      buffer: Buffer.concat(chunks),
    };
  }

  throw new Error('Unable to resolve target URL safely.');
}
