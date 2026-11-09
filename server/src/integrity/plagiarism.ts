/**
 * Source-code similarity via winnowing (Schleimer, Wilkerson & Aiken, 2003 —
 * the algorithm behind MOSS). Code is normalized first so that renaming
 * variables, reformatting, or editing comments does not hide copying.
 */

const KEYWORDS = new Set(
  `and as assert async await break case catch char class const continue def default del do double elif else enum
  except extends false final finally float for fn from func function go if impl import in int interface is lambda
  let long loop match mod mut new nil none not null or package pass pub raise return self short static struct super
  switch this throw throws true try type typedef unsigned use var void while with yield string vector map set bool
  auto include using namespace std cin cout endl printf scanf print input range len sorted list dict append push
  make chan defer`.split(/\s+/),
);

/** Strip comments and string contents (language-agnostic, best effort). */
function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/^\s*#(?!include).*$/gm, '')
    .replace(/("""|''')[\s\S]*?\1/g, ' S ')
    .replace(/(["'`])(?:\\.|(?!\1)[^\\\n])*\1/g, ' S ');
}

export function normalizeTokens(code: string): string[] {
  const src = stripComments(code);
  const tokens = src.match(/[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|==|!=|<=|>=|&&|\|\||<<|>>|\+\+|--|[+\-*/%=<>!&|^~?:;,.(){}\[\]]/g) ?? [];
  return tokens.map((t) => {
    if (/^\d/.test(t)) return 'N';
    if (/^[A-Za-z_]/.test(t)) return KEYWORDS.has(t) ? t : 'V';
    return t;
  });
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function fingerprints(code: string, k = 6, w = 5): Set<number> {
  const toks = normalizeTokens(code);
  const grams: number[] = [];
  for (let i = 0; i + k <= toks.length; i++) grams.push(hash(toks.slice(i, i + k).join(' ')));
  const fp = new Set<number>();
  if (grams.length === 0) return fp;
  if (grams.length <= w) {
    fp.add(Math.min(...grams));
    return fp;
  }
  for (let i = 0; i + w <= grams.length; i++) {
    let min = grams[i];
    for (let j = 1; j < w; j++) if (grams[i + j] <= min) min = grams[i + j];
    fp.add(min);
  }
  return fp;
}

/** Overlap coefficient of two fingerprint sets (0..1). */
export function similarity(a: Set<number>, b: Set<number>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  const [s, l] = a.size < b.size ? [a, b] : [b, a];
  for (const x of s) if (l.has(x)) inter++;
  return inter / Math.min(a.size, b.size);
}

export interface PlagiarismDoc {
  id: string;
  label: string;
  code: string;
  /** Reference documents are compared against candidates but not flagged themselves. */
  reference?: boolean;
}

export interface PlagiarismMatch {
  a: string;
  b: string;
  aLabel: string;
  bLabel: string;
  similarity: number;
  reference: boolean;
}

/** Minimum token count for a comparison to be meaningful. */
const MIN_TOKENS = 25;

export function findMatches(docs: PlagiarismDoc[], threshold = 0.7): PlagiarismMatch[] {
  const prepared = docs
    .filter((d) => normalizeTokens(d.code).length >= MIN_TOKENS)
    .map((d) => ({ ...d, fp: fingerprints(d.code) }));
  const out: PlagiarismMatch[] = [];
  for (let i = 0; i < prepared.length; i++) {
    for (let j = i + 1; j < prepared.length; j++) {
      const a = prepared[i];
      const b = prepared[j];
      if (a.reference && b.reference) continue;
      const s = similarity(a.fp, b.fp);
      if (s >= threshold) {
        out.push({ a: a.id, b: b.id, aLabel: a.label, bLabel: b.label, similarity: Math.round(s * 100) / 100, reference: !!(a.reference || b.reference) });
      }
    }
  }
  return out.sort((x, y) => y.similarity - x.similarity);
}
