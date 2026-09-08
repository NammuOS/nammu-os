export interface PdfPageSelectionModifiers {
  additive?: boolean;
  range?: boolean;
}

export interface PdfPageSelectionState {
  activePage: number;
  selectedPages: readonly number[];
  selectionAnchor: number;
}

function normalizedPages(pages: readonly number[], pageCount: number): number[] {
  return [...new Set(pages)]
    .filter((page) => Number.isInteger(page) && page >= 1 && page <= pageCount)
    .sort((a, b) => a - b);
}

export function selectPdfPage(
  current: PdfPageSelectionState,
  page: number,
  pageCount: number,
  modifiers: PdfPageSelectionModifiers = {},
): PdfPageSelectionState {
  if (!Number.isInteger(page) || page < 1 || page > pageCount) return current;

  if (modifiers.range) {
    const anchor = Math.min(Math.max(current.selectionAnchor || current.activePage, 1), pageCount);
    const start = Math.min(anchor, page);
    const end = Math.max(anchor, page);
    const range = Array.from({ length: end - start + 1 }, (_, index) => start + index);
    return {
      activePage: page,
      selectedPages: modifiers.additive
        ? normalizedPages([...current.selectedPages, ...range], pageCount)
        : range,
      selectionAnchor: anchor,
    };
  }

  if (modifiers.additive) {
    const selected = new Set(normalizedPages(current.selectedPages, pageCount));
    if (selected.has(page) && selected.size > 1) selected.delete(page);
    else selected.add(page);
    return {
      activePage: page,
      selectedPages: [...selected].sort((a, b) => a - b),
      selectionAnchor: page,
    };
  }

  return { activePage: page, selectedPages: [page], selectionAnchor: page };
}

export function selectAllPdfPages(pageCount: number): PdfPageSelectionState {
  const pages = Array.from({ length: Math.max(0, pageCount) }, (_, index) => index + 1);
  return {
    activePage: pages[0] ?? 1,
    selectedPages: pages,
    selectionAnchor: pages[0] ?? 1,
  };
}

export function buildPdfPageOrder(
  pageCount: number,
  selectedPages: readonly number[],
  targetPage: number,
  placement: 'before' | 'after',
): number[] | null {
  const selected = normalizedPages(selectedPages, pageCount);
  const selectedSet = new Set(selected);
  if (selected.length === 0 || selectedSet.has(targetPage)) return null;
  const remaining = Array.from({ length: pageCount }, (_, index) => index + 1).filter(
    (page) => !selectedSet.has(page),
  );
  const targetIndex = remaining.indexOf(targetPage);
  if (targetIndex < 0) return null;
  const insertionIndex = targetIndex + (placement === 'after' ? 1 : 0);
  const order = [
    ...remaining.slice(0, insertionIndex),
    ...selected,
    ...remaining.slice(insertionIndex),
  ];
  return order.every((page, index) => page === index + 1) ? null : order;
}

export function remapSelectedPages(
  pageOrder: readonly number[],
  previousSelection: readonly number[],
): number[] {
  const selected = new Set(previousSelection);
  return pageOrder.flatMap((oldPage, index) => (selected.has(oldPage) ? [index + 1] : []));
}
