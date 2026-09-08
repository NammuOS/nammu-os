import type { PdfNativeOpenRequest } from '../components/pdf/model';

export const NAMMU_OPEN_DOCUMENT_EVENT = 'nammu-open-document';

export interface NammuOpenDocumentDetail {
  appId: 'pdf';
  request: PdfNativeOpenRequest;
}

export function requestOpenPdf(path: string, name: string): boolean {
  if (typeof window === 'undefined' || !path || path.includes('\0')) return false;
  window.dispatchEvent(
    new CustomEvent<NammuOpenDocumentDetail>(NAMMU_OPEN_DOCUMENT_EVENT, {
      detail: { appId: 'pdf', request: { kind: 'native-path', path, name } },
    }),
  );
  return true;
}
