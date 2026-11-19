import zlib from 'node:zlib';
import { sanitizeText } from '../security/sanitize.ts';

export interface DocumentForensicMetrics {
  documentType: 'pdf' | 'text';
  pdfVersion: string | null;
  estimatedPages: number | null;
  author: string | null;
  creator: string | null;
  producer: string | null;
  creationDate: string | null;
  modDate: string | null;
  hasEmbeddedScripts: boolean;
  incrementalUpdatesCount: number;
  lineCount: number;
  wordCount: number;
  charCount: number;
  extractedExcerpt: string;
  extractedDates: string[];
  extractedLocations: string[];
  extractedClaims: string[];
}

function extractPdfInfoValue(raw: string, key: string): string | null {
  const regex = new RegExp(`/${key}\\s*\\(([^)]{1,200})\\)`, 'i');
  const match = raw.match(regex);
  if (!match?.[1]) return null;
  return sanitizeText(match[1].replace(/\\([()\\])/g, '$1'), 160) || null;
}

function extractPdfTextFromContentStream(streamText: string, out: string[]) {
  const tjRegex = /\(([^()\\]*(?:\\.[^()\\]*)*)\)\s*Tj/g;
  let m: RegExpExecArray | null;
  while ((m = tjRegex.exec(streamText)) !== null && out.length < 80) {
    const clean = sanitizeText(m[1].replace(/\\([()\\])/g, '$1'), 180);
    if (clean && clean.length >= 2) out.push(clean);
  }
  const tjArrRegex = /\[([^\]]{1,800})\]\s*TJ/g;
  while ((m = tjArrRegex.exec(streamText)) !== null && out.length < 80) {
    const inner = m[1];
    const parts: string[] = [];
    const strRegex = /\(([^()\\]*(?:\\.[^()\\]*)*)\)/g;
    let sm: RegExpExecArray | null;
    while ((sm = strRegex.exec(inner)) !== null) {
      parts.push(sm[1].replace(/\\([()\\])/g, '$1'));
    }
    const joined = sanitizeText(parts.join(''), 200);
    if (joined && joined.length >= 2) out.push(joined);
  }
}

const KNOWN_LOCATION_PATTERNS: Array<{ label: string; regex: RegExp }> = [
  { label: 'Mumbai', regex: /\b(mumbai|bombay|andheri|bandra|dadar|mh[- ]?0[1-4])\b/i },
  { label: 'Bengaluru', regex: /\b(bengaluru|bangalore|mg road|koramangala|whitefield|ka[- ]?0[1-5])\b/i },
  { label: 'New Delhi', regex: /\b(delhi|new delhi|connaught|dl[- ]?0[1-9])\b/i },
  { label: 'Chennai', regex: /\b(chennai|madras|t\.?\s?nagar|tn[- ]?0[1-9])\b/i },
  { label: 'Hyderabad', regex: /\b(hyderabad|secunderabad|charminar|ts[- ]?0[7-9])\b/i },
  { label: 'Kolkata', regex: /\b(kolkata|calcutta|howrah|wb[- ]?0[1-8])\b/i },
  { label: 'London', regex: /\b(london|westminster|thames)\b/i },
  { label: 'New York', regex: /\b(new york|manhattan|brooklyn|nyc)\b/i },
];

function extractStructuredDocEntities(text: string): {
  extractedDates: string[];
  extractedLocations: string[];
  extractedClaims: string[];
} {
  const dateSet = new Set<string>();
  const isoRegex = /\b(20\d{2}[-/]\d{2}[-/]\d{2})\b/g;
  let m: RegExpExecArray | null;
  while ((m = isoRegex.exec(text)) !== null && dateSet.size < 12) {
    dateSet.add(m[1].replace(/\//g, '-'));
  }
  const monthDateRegex =
    /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+20\d{2}\b/gi;
  while ((m = monthDateRegex.exec(text)) !== null && dateSet.size < 12) {
    dateSet.add(m[0]);
  }
  const yearRegex = /\b(20[0-3]\d)\b/g;
  while ((m = yearRegex.exec(text)) !== null && dateSet.size < 12) {
    dateSet.add(m[1]);
  }

  const extractedLocations = KNOWN_LOCATION_PATTERNS.filter((p) => p.regex.test(text)).map((p) => p.label);

  const sentences = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => sanitizeText(s, 220))
    .filter((s) => s.length >= 16);

  const claimKeywords = /\b(recorded|verified|live|claim|witness|incident|issued|signed|date|location|reported|flood|statement|authentic)\b/i;
  const prioritized = sentences.filter((s) => claimKeywords.test(s));
  const extractedClaims = (prioritized.length > 0 ? prioritized : sentences).slice(0, 5);

  return {
    extractedDates: Array.from(dateSet),
    extractedLocations,
    extractedClaims,
  };
}

export function analyzeDocumentBuffer(
  buf: Buffer,
  mimeType: string,
): DocumentForensicMetrics {
  if (mimeType === 'application/pdf') {
    const latin = buf.toString('latin1');
    const verMatch = latin.match(/^%PDF-(\d\.\d)/);
    const pdfVersion = verMatch?.[1] ?? null;

    const pageMatches = latin.match(/\/Type\s*\/Page\b/g);
    const estimatedPages = pageMatches ? pageMatches.length : null;

    const eofMatches = latin.match(/%%EOF/g);
    const incrementalUpdatesCount = eofMatches ? Math.max(0, eofMatches.length - 1) : 0;

    const hasEmbeddedScripts = /\/(JavaScript|JS|OpenAction|Launch)\b/.test(latin);

    const author = extractPdfInfoValue(latin, 'Author');
    const creator = extractPdfInfoValue(latin, 'Creator');
    const producer = extractPdfInfoValue(latin, 'Producer');
    const creationDate = extractPdfInfoValue(latin, 'CreationDate');
    const modDate = extractPdfInfoValue(latin, 'ModDate');
    const title = extractPdfInfoValue(latin, 'Title');

    const textSnippets: string[] = [];

    const streamRegex = /<<([\s\S]{0,600}?)>>\s*stream\r?\n/g;
    let smMatch: RegExpExecArray | null;
    let streamsChecked = 0;
    while ((smMatch = streamRegex.exec(latin)) !== null && streamsChecked < 24 && textSnippets.length < 80) {
      streamsChecked++;
      const dict = smMatch[1];
      const startIdx = smMatch.index + smMatch[0].length;
      const endIdx = latin.indexOf('endstream', startIdx);
      if (endIdx <= startIdx) continue;
      const rawSlice = buf.subarray(startIdx, Math.min(endIdx, startIdx + 256 * 1024));
      if (/\/FlateDecode\b/.test(dict)) {
        try {
          const inflated = zlib.inflateSync(rawSlice).toString('latin1');
          extractPdfTextFromContentStream(inflated, textSnippets);
        } catch {
          try {
            const inflatedRaw = zlib.inflateRawSync(rawSlice).toString('latin1');
            extractPdfTextFromContentStream(inflatedRaw, textSnippets);
          } catch {
            // Skip non-text / image / font streams cleanly
          }
        }
      } else {
        extractPdfTextFromContentStream(rawSlice.toString('latin1'), textSnippets);
      }
    }

    if (textSnippets.length === 0) {
      const litRegex = /\(([A-Za-z0-9 ,.;:'"!?/@#%&()\-]{4,120})\)/g;
      let m: RegExpExecArray | null;
      while ((m = litRegex.exec(latin)) !== null && textSnippets.length < 40) {
        const cleaned = sanitizeText(m[1], 140);
        if (cleaned && !cleaned.startsWith('D:')) {
          textSnippets.push(cleaned);
        }
      }
    }

    const excerpt = sanitizeText(
      [title ? `Title: ${title}` : '', textSnippets.join(' ')].filter(Boolean).join(' — '),
      1600,
    );
    const entities = extractStructuredDocEntities(excerpt);

    return {
      documentType: 'pdf',
      pdfVersion,
      estimatedPages,
      author,
      creator,
      producer,
      creationDate,
      modDate,
      hasEmbeddedScripts,
      incrementalUpdatesCount,
      lineCount: excerpt ? excerpt.split('\n').length : 0,
      wordCount: excerpt ? excerpt.split(/\s+/).filter(Boolean).length : 0,
      charCount: buf.length,
      extractedExcerpt:
        excerpt || 'PDF metadata header inspected (image-only or custom-encoded streams without extractable ASCII text).',
      ...entities,
    };
  }

  const text = sanitizeText(buf.toString('utf8'), 12000);
  const lines = text ? text.split(/\r?\n/) : [];
  const words = text ? text.split(/\s+/).filter(Boolean) : [];
  const entities = extractStructuredDocEntities(text);

  return {
    documentType: 'text',
    pdfVersion: null,
    estimatedPages: null,
    author: null,
    creator: null,
    producer: null,
    creationDate: null,
    modDate: null,
    hasEmbeddedScripts: false,
    incrementalUpdatesCount: 0,
    lineCount: lines.length,
    wordCount: words.length,
    charCount: text.length,
    extractedExcerpt: text.slice(0, 1600),
    ...entities,
  };
}
