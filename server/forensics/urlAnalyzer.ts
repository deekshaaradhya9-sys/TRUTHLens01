import crypto from 'node:crypto';
import path from 'node:path';
import DOMPurify from 'isomorphic-dompurify';
import { safeFetchPublicUrl } from '../security/ssrf.ts';
import {
  ALLOWED_EXTENSIONS,
  normalizeMimeType,
  sanitizeFilename,
  sanitizeText,
  verifyMagicBytes,
} from '../security/sanitize.ts';
import { computeSha256 } from './ledger.ts';

export type UrlIngestResult =
  | {
      kind: 'media';
      finalUrl: string;
      filename: string;
      buffer: Buffer;
      canonicalMime: string;
      modality: 'image' | 'audio' | 'video' | 'document';
      ext: string;
      sha256: string;
      httpStatus: number;
      headersSummary: Record<string, string>;
    }
  | {
      kind: 'webpage';
      finalUrl: string;
      filename: string;
      buffer: Buffer;
      canonicalMime: 'text/plain';
      modality: 'document';
      ext: '.txt';
      sha256: string;
      httpStatus: number;
      metadata: {
        hostname: string;
        title: string;
        description: string;
        ogTitle: string;
        ogImage: string;
        canonicalUrl: string;
        author: string;
        publishedDate: string;
        outboundDomains: string[];
        wordCount: number;
      };
      extractedExcerpt: string;
      headersSummary: Record<string, string>;
    };

function stripHtmlTags(raw: string): string {
  return raw
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function extractMetaTag(html: string, keys: string[]): string {
  for (const key of keys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re1 = new RegExp(
      `<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`,
      'i',
    );
    const re2 = new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${escaped}["'][^>]*>`,
      'i',
    );
    const m = html.match(re1) || html.match(re2);
    if (m?.[1]) {
      return sanitizeText(m[1], 400);
    }
  }
  return '';
}

function extractLinkRel(html: string, relName: string): string {
  const escaped = relName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re1 = new RegExp(`<link[^>]+rel=["']${escaped}["'][^>]+href=["']([^"']+)["'][^>]*>`, 'i');
  const re2 = new RegExp(`<link[^>]+href=["']([^"']+)["'][^>]+rel=["']${escaped}["'][^>]*>`, 'i');
  const m = html.match(re1) || html.match(re2);
  if (m?.[1]) {
    const clean = sanitizeText(m[1], 500);
    if (/^https?:\/\//i.test(clean)) return clean;
  }
  return '';
}

function extractOutboundDomains(html: string, baseHostname: string): string[] {
  const domains = new Set<string>();
  const hrefRegex = /href=["'](https?:\/\/[^"'\s>]+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = hrefRegex.exec(html)) !== null && domains.size < 25) {
    try {
      const parsed = new URL(match[1]);
      if (parsed.hostname && parsed.hostname !== baseHostname) {
        domains.add(parsed.hostname.toLowerCase());
      }
    } catch {
      // ignore malformed links
    }
  }
  return Array.from(domains).slice(0, 15);
}

export async function inspectAndIngestPublicUrl(
  rawUrl: string,
  maxBytes: number,
): Promise<UrlIngestResult> {
  const fetched = await safeFetchPublicUrl(rawUrl, {
    maxBytes,
    timeoutMs: 12000,
    maxRedirects: 3,
  });

  if (fetched.status < 200 || fetched.status >= 400) {
    throw new Error(`Remote server returned HTTP ${fetched.status}.`);
  }

  const finalParsed = new URL(fetched.finalUrl);
  const contentTypeNorm = normalizeMimeType(fetched.contentType);
  const urlPathName = finalParsed.pathname.split('/').pop() || '';
  const urlExt = path.extname(urlPathName).toLowerCase();

  // Check if URL returned a supported binary media/document directly
  const looksLikeBinaryMedia =
    contentTypeNorm.startsWith('image/') ||
    contentTypeNorm.startsWith('audio/') ||
    contentTypeNorm.startsWith('video/') ||
    contentTypeNorm === 'application/pdf' ||
    contentTypeNorm === 'application/x-pdf' ||
    contentTypeNorm === 'text/plain' ||
    (contentTypeNorm === 'application/octet-stream' && ALLOWED_EXTENSIONS.has(urlExt));

  if (looksLikeBinaryMedia) {
    const rawName = sanitizeFilename(urlPathName || `url_artifact_${crypto.randomUUID().slice(0, 8)}${urlExt || '.bin'}`);
    const magic = verifyMagicBytes(fetched.buffer, contentTypeNorm, rawName);
    if (!magic.ok) {
      throw new Error(`Remote file rejected by magic-byte verification: ${magic.reason}`);
    }
    return {
      kind: 'media',
      finalUrl: fetched.finalUrl,
      filename: rawName.includes('.') ? rawName : `${rawName}${magic.ext}`,
      buffer: fetched.buffer,
      canonicalMime: magic.canonicalMime,
      modality: magic.modality,
      ext: magic.ext,
      sha256: computeSha256(fetched.buffer),
      httpStatus: fetched.status,
      headersSummary: fetched.headersSummary,
    };
  }

  // Handle HTML / XML / JSON public web pages safely
  const isWebMarkup =
    contentTypeNorm === '' ||
    contentTypeNorm.includes('text/html') ||
    contentTypeNorm.includes('application/xhtml+xml') ||
    contentTypeNorm.includes('application/json') ||
    contentTypeNorm.includes('application/xml') ||
    contentTypeNorm.includes('text/xml');

  if (!isWebMarkup) {
    throw new Error(`Unsupported remote Content-Type "${contentTypeNorm || 'unknown'}".`);
  }

  const rawText = fetched.buffer.toString('utf8');
  const titleMatch = rawText.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const pageTitle = sanitizeText(titleMatch?.[1] || finalParsed.hostname, 200);
  const description = extractMetaTag(rawText, ['description', 'og:description', 'twitter:description']);
  const ogTitle = extractMetaTag(rawText, ['og:title', 'twitter:title']);
  const ogImageRaw = extractMetaTag(rawText, ['og:image', 'twitter:image']);
  const ogImage = /^https?:\/\//i.test(ogImageRaw) ? ogImageRaw : '';
  const canonicalUrl = extractLinkRel(rawText, 'canonical') || fetched.finalUrl;
  const author = extractMetaTag(rawText, ['author', 'article:author']);
  const publishedDate = extractMetaTag(rawText, [
    'article:published_time',
    'pubdate',
    'publish_date',
    'date',
  ]);
  const outboundDomains = extractOutboundDomains(rawText, finalParsed.hostname.toLowerCase());

  const stripped = contentTypeNorm.includes('application/json')
    ? rawText.slice(0, 6000)
    : stripHtmlTags(rawText);
  const cleanBody = DOMPurify.sanitize(stripped, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] })
    .replace(/\u0000/g, '')
    .trim()
    .slice(0, 5000);

  const wordCount = cleanBody ? cleanBody.split(/\s+/).filter(Boolean).length : 0;

  const snapshotLines = [
    `TRUTHLENS WEB PROVENANCE SNAPSHOT`,
    `Source URL: ${fetched.finalUrl}`,
    `Canonical URL: ${canonicalUrl}`,
    `Hostname: ${finalParsed.hostname}`,
    `HTTP Status: ${fetched.status}`,
    `Title: ${ogTitle || pageTitle}`,
    author ? `Author: ${author}` : '',
    publishedDate ? `Published Date: ${publishedDate}` : '',
    description ? `Meta Description: ${description}` : '',
    ogImage ? `OG Image URL: ${ogImage}` : '',
    outboundDomains.length > 0 ? `Outbound Domains: ${outboundDomains.join(', ')}` : '',
    `--- SANITIZED CONTENT EXCERPT ---`,
    cleanBody || '[No readable body text extracted]',
  ]
    .filter(Boolean)
    .join('\n');

  const snapshotBuffer = Buffer.from(snapshotLines, 'utf8');
  const safeHostSlug = sanitizeFilename(finalParsed.hostname).replace(/\./g, '_');

  return {
    kind: 'webpage',
    finalUrl: fetched.finalUrl,
    filename: `web_snapshot_${safeHostSlug}_${crypto.randomUUID().slice(0, 6)}.txt`,
    buffer: snapshotBuffer,
    canonicalMime: 'text/plain',
    modality: 'document',
    ext: '.txt',
    sha256: computeSha256(snapshotBuffer),
    httpStatus: fetched.status,
    metadata: {
      hostname: finalParsed.hostname,
      title: ogTitle || pageTitle,
      description,
      ogTitle,
      ogImage,
      canonicalUrl,
      author,
      publishedDate,
      outboundDomains,
      wordCount,
    },
    extractedExcerpt: cleanBody.slice(0, 1500),
    headersSummary: fetched.headersSummary,
  };
}
