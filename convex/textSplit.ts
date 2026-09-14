// Split corrected text into sentences and group them into blocks of up to 5.
export function splitSentences(text: string): string[] {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return [];
  const parts = cleaned
    .split(/(?<=[.!?…])\s+(?=[""'(\p{L}])/u)
    .map((s) => s.trim())
    .filter(Boolean);
  // Fallback: if punctuation splitting produced one giant blob, split by length.
  if (parts.length === 1 && parts[0].length > 400) {
    const words = parts[0].split(" ");
    const out: string[] = [];
    let cur: string[] = [];
    for (const w of words) {
      cur.push(w);
      if (cur.join(" ").length > 120) {
        out.push(cur.join(" "));
        cur = [];
      }
    }
    if (cur.length) out.push(cur.join(" "));
    return out;
  }
  return parts;
}

export function chunkSentences(sentences: string[], size = 5): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < sentences.length; i += size) {
    chunks.push(sentences.slice(i, i + size));
  }
  return chunks;
}

export function chunkWords(text: string, wordsPerChunk = 320): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < words.length; i += wordsPerChunk) {
    out.push(words.slice(i, i + wordsPerChunk).join(" "));
  }
  return out;
}

// Heuristic: text already looks punctuated if it has one . ! ? per ~25 words.
export function looksPunctuated(text: string): boolean {
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words < 30) return /[.!?]/.test(text);
  const marks = (text.match(/[.!?]/g) ?? []).length;
  return marks >= words / 25;
}

// Split a long transcript into parts of at most ~maxWords, always at sentence
// boundaries (falling back to word chunks for unpunctuated blobs). Used to turn
// long videos into a series of lessons ("Parte 1/N", "Parte 2/N", …).
export function splitIntoParts(text: string, maxWords = 1800): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  if (words.length <= maxWords) return [words.join(" ")];

  const sentences = splitSentences(text);
  const parts: string[] = [];
  let cur: string[] = [];
  let count = 0;
  const wc = (s: string) => s.split(/\s+/).filter(Boolean).length;

  for (const s of sentences) {
    const w = wc(s);
    if (w > maxWords) {
      // Pathological single "sentence" — hard-split by words.
      if (cur.length) {
        parts.push(cur.join(" "));
        cur = [];
        count = 0;
      }
      parts.push(...chunkWords(s, maxWords));
      continue;
    }
    if (count + w > maxWords && cur.length) {
      parts.push(cur.join(" "));
      cur = [];
      count = 0;
    }
    cur.push(s);
    count += w;
  }
  if (cur.length) parts.push(cur.join(" "));
  return parts;
}
