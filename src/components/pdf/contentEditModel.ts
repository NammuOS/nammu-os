export type PdfContentTool = 'edit-select' | 'edit-text';

export type PdfEditableContentKind = 'text' | 'image';

export interface PdfEditableContentObject {
  id: string;
  kind: PdfEditableContentKind;
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  text?: string;
  fontSize?: number;
  color?: string;
  resourceName?: string;
  imageFormat?: 'png' | 'jpeg';
  createdAt: string;
  modifiedAt: string;
  /** Original stream tag used to address copied page instances safely. */
  sourceStreamId?: string;
}

export interface PdfContentObjectDraft {
  pageNumber: number;
  kind: PdfEditableContentKind;
  x: number;
  y: number;
  width?: number;
  height?: number;
  rotation?: number;
  opacity?: number;
  text?: string;
  fontSize?: number;
  color?: string;
  imageBytes?: Uint8Array;
  imageFormat?: 'png' | 'jpeg';
}

export interface PdfContentObjectPatch {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  opacity?: number;
  text?: string;
  fontSize?: number;
  color?: string;
  imageBytes?: Uint8Array;
  imageFormat?: 'png' | 'jpeg';
}

export interface PdfContentEditModel {
  objects: readonly PdfEditableContentObject[];
  selectedObjectId: string | null;
}

export const EMPTY_CONTENT_EDIT_MODEL: PdfContentEditModel = {
  objects: [],
  selectedObjectId: null,
};
