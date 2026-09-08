import type { PdfDocumentSession, PdfHistorySnapshot } from './model';

export const PDF_HISTORY_ENTRY_LIMIT = 5;
export const PDF_HISTORY_BYTE_LIMIT = 64 * 1024 * 1024;

export function appendPdfHistory(
  entries: readonly PdfHistorySnapshot[],
  entry: PdfHistorySnapshot,
): readonly PdfHistorySnapshot[] {
  const candidates = [...entries, entry];
  const kept: PdfHistorySnapshot[] = [];
  let total = 0;
  for (
    let index = candidates.length - 1;
    index >= 0 && kept.length < PDF_HISTORY_ENTRY_LIMIT;
    index -= 1
  ) {
    const candidate = candidates[index];
    if (candidate.bytes.byteLength > PDF_HISTORY_BYTE_LIMIT) continue;
    if (total + candidate.bytes.byteLength > PDF_HISTORY_BYTE_LIMIT) break;
    kept.unshift(candidate);
    total += candidate.bytes.byteLength;
  }
  return kept;
}

export function transitionPdfHistory(
  history: PdfDocumentSession['history'],
  currentBytes: Uint8Array,
  direction: 'undo' | 'redo',
): { snapshot: PdfHistorySnapshot; history: PdfDocumentSession['history'] } | null {
  const source = direction === 'undo' ? history.past : history.future;
  const snapshot = source[source.length - 1];
  if (!snapshot) return null;
  const current = { label: snapshot.label, bytes: currentBytes };
  return {
    snapshot,
    history:
      direction === 'undo'
        ? {
            past: history.past.slice(0, -1),
            future: appendPdfHistory(history.future, current),
          }
        : {
            past: appendPdfHistory(history.past, current),
            future: history.future.slice(0, -1),
          },
  };
}
