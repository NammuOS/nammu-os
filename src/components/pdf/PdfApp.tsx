'use client';

import {
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  CopyPlus,
  FilePlus2,
  FileOutput,
  FileText,
  FolderOpen,
  Hand,
  LayoutGrid,
  ListChecks,
  MessageSquareText,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pointer,
  Redo2,
  RotateCcw,
  RotateCw,
  Save,
  Search,
  Trash2,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { NAMMU_OPEN_DOCUMENT_EVENT, type NammuOpenDocumentDetail } from '../../lib/appLaunch';
import { registerWindowCloseGuard } from '../../lib/windowCloseGuards';
import { useWindowRuntime } from '../os/WindowRuntimeContext';
import { getPlatformCapabilities } from '../../platform';
import styles from './PdfApp.module.css';
import { PdfPageCanvas, PdfPageThumbnail } from './PdfPageCanvas';
import { PdfCommentsInspector, PdfCommentToolbar } from './PdfCommentWorkspace';
import {
  PdfFormPropertiesInspector,
  PdfFormsFieldList,
  PdfFormsToolbar,
} from './PdfFormsWorkspace';
import {
  PDF_COMMANDS,
  PDF_MENU_ORDER,
  commandsForMenu,
  type PdfCommandActions,
  type PdfCommandContext,
  type PdfCommandId,
  type PdfMenuId,
} from './pdfCommands';
import {
  deletePdfPages,
  duplicatePdfPages,
  extractPdfPages,
  getPdfPageCount,
  insertPdfPages,
  loadPdfSession,
  reloadPdfContent,
  reorderPdfPages,
  rotatePdfPages,
  searchPdfDocument,
} from './pdfEngine';
import {
  createPdfAnnotation,
  deletePdfAnnotation,
  removeAllPdfAnnotations,
  updatePdfAnnotation,
} from './pdfAnnotations';
import {
  createPdfFormField,
  deletePdfFormField,
  duplicatePdfFormField,
  updatePdfFormField,
} from './pdfForms';
import { appendPdfHistory, transitionPdfHistory } from './pdfHistory';
import type {
  PdfAppInitialData,
  PdfDocumentSession,
  PdfNativeOpenRequest,
  PdfSearchResult,
  PdfViewMode,
  PdfWorkspaceTool,
  PdfZoomMode,
} from './model';
import type { PdfAnnotationDraft, PdfAnnotationPatch, PdfTextSelection } from './annotationModel';
import type { PdfFormFieldDraft, PdfFormFieldPatch } from './formModel';
import {
  buildPdfPageOrder,
  remapSelectedPages,
  selectAllPdfPages,
  selectPdfPage,
  type PdfPageSelectionModifiers,
} from './pageSelection';

const platform = getPlatformCapabilities();

interface HostClosePrompt {
  dirtySessionIds: readonly string[];
}

interface FidelityPrompt {
  label: string;
  warnings: readonly string[];
}

interface PageContextMenuState {
  pageNumber: number;
  x: number;
  y: number;
}

interface PageDropState {
  pageNumber: number;
  placement: 'before' | 'after';
}

type PdfTransformResult =
  | Uint8Array
  | {
      bytes: Uint8Array;
      selectedPages?: readonly number[];
      activePage?: number;
      selectedAnnotationId?: string | null;
      selectNewAnnotation?: boolean;
      selectedFormFieldId?: string | null;
      selectedFormWidgetId?: string | null;
      selectNewFormField?: boolean;
    };

interface AnnotationComposerState {
  draft: PdfAnnotationDraft;
  content: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function clampZoom(value: number): number {
  return Math.min(4, Math.max(0.2, Math.round(value * 10) / 10));
}

function dateLabel(value: string | null): string {
  if (!value) return 'Not set';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Not set';
}

export default function PdfApp({ initialData }: { initialData?: PdfAppInitialData }) {
  const windowRuntime = useWindowRuntime();
  const [sessions, setSessions] = useState<PdfDocumentSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [openMenu, setOpenMenu] = useState<PdfMenuId | null>(null);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [leftOpen, setLeftOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findResults, setFindResults] = useState<PdfSearchResult[]>([]);
  const [findBusy, setFindBusy] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [pendingClose, setPendingClose] = useState<string | null>(null);
  const [hostClosePrompt, setHostClosePrompt] = useState<HostClosePrompt | null>(null);
  const [fidelityPrompt, setFidelityPrompt] = useState<FidelityPrompt | null>(null);
  const [pageContextMenu, setPageContextMenu] = useState<PageContextMenuState | null>(null);
  const [draggedPages, setDraggedPages] = useState<readonly number[]>([]);
  const [pageDrop, setPageDrop] = useState<PageDropState | null>(null);
  const [viewport, setViewport] = useState({ width: 900, height: 700 });
  const [panning, setPanning] = useState(false);
  const [annotationComposer, setAnnotationComposer] = useState<AnnotationComposerState | null>(
    null,
  );
  const canvasViewportRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<HTMLDivElement>(null);
  const panStartRef = useRef({ x: 0, y: 0, left: 0, top: 0 });
  const sessionsRef = useRef<PdfDocumentSession[]>([]);
  const hostCloseResolverRef = useRef<((allow: boolean) => void) | null>(null);
  const fidelityResolverRef = useRef<((allow: boolean) => void) | null>(null);
  const fidelityApprovedRef = useRef(new Set<string>());
  const initialRequestRef = useRef<PdfNativeOpenRequest | null>(initialData?.openRequest ?? null);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeId) ?? null,
    [activeId, sessions],
  );

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    const windowId = windowRuntime.managedWindowId;
    if (!windowId) return;
    return registerWindowCloseGuard(windowId, () => {
      const dirtySessionIds = sessionsRef.current
        .filter((session) => session.dirty)
        .map((session) => session.id);
      if (dirtySessionIds.length === 0) return true;
      return new Promise<boolean>((resolve) => {
        hostCloseResolverRef.current?.(false);
        hostCloseResolverRef.current = resolve;
        setHostClosePrompt({ dirtySessionIds });
      });
    });
  }, [windowRuntime.managedWindowId]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!sessionsRef.current.some((session) => session.dirty)) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);

  useEffect(
    () => () => {
      hostCloseResolverRef.current?.(false);
      fidelityResolverRef.current?.(false);
    },
    [],
  );

  const updateSession = useCallback(
    (id: string, update: (session: PdfDocumentSession) => PdfDocumentSession) => {
      setSessions((current) =>
        current.map((session) => (session.id === id ? update(session) : session)),
      );
    },
    [],
  );

  const addDocument = useCallback(
    async (name: string, bytes: Uint8Array, source: PdfDocumentSession['source']) => {
      setError(null);
      setBusyLabel(`Opening ${name}`);
      try {
        const session = await loadPdfSession(name, bytes, source);
        setSessions((current) => [...current, session]);
        setActiveId(session.id);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'The PDF could not be opened.');
      } finally {
        setBusyLabel(null);
      }
    },
    [],
  );

  const openNativeRequest = useCallback(
    async (request: PdfNativeOpenRequest) => {
      const existing = sessions.find(
        (session) => session.source.kind === 'native-path' && session.source.path === request.path,
      );
      if (existing) {
        setActiveId(existing.id);
        return;
      }
      const result = await platform.files.readPdf(request.path);
      if (result.status === 'success') {
        await addDocument(request.name || result.value.name, result.value.bytes, {
          kind: 'native-path',
          path: request.path,
        });
      } else if (result.status !== 'cancelled') {
        setError('reason' in result ? result.reason : result.message);
      }
    },
    [addDocument, sessions],
  );

  useEffect(() => {
    const request = initialRequestRef.current;
    initialRequestRef.current = null;
    if (request) void openNativeRequest(request);
  }, [openNativeRequest]);

  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<NammuOpenDocumentDetail>).detail;
      if (detail?.appId === 'pdf') void openNativeRequest(detail.request);
    };
    window.addEventListener(NAMMU_OPEN_DOCUMENT_EVENT, listener);
    return () => window.removeEventListener(NAMMU_OPEN_DOCUMENT_EVENT, listener);
  }, [openNativeRequest]);

  useEffect(() => {
    const host = canvasViewportRef.current;
    if (!host) return;
    const measure = () => setViewport({ width: host.clientWidth, height: host.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, [activeId]);

  useEffect(
    () => () => {
      sessionsRef.current.forEach((session) => void session.renderDocument.destroy());
    },
    [],
  );

  const openFile = useCallback(async () => {
    setOpenMenu(null);
    const selected = await platform.files.pick({
      multiple: true,
      filters: [{ name: 'PDF documents', extensions: ['pdf'], mimeTypes: ['application/pdf'] }],
    });
    if (selected.status === 'success') {
      for (const file of selected.value.files) {
        await addDocument(file.name, file.bytes, { kind: 'picker' });
      }
    } else if (selected.status !== 'cancelled') {
      setError('reason' in selected ? selected.reason : selected.message);
    }
  }, [addDocument]);

  const saveSessionAs = useCallback(
    async (session: PdfDocumentSession): Promise<boolean> => {
      setBusyLabel(`Saving ${session.name}`);
      try {
        const result = await platform.files.save({
          suggestedName: session.name,
          contents: session.bytes,
          mimeType: 'application/pdf',
          filters: [{ name: 'PDF document', extensions: ['pdf'], mimeTypes: ['application/pdf'] }],
        });
        if (result.status === 'success') {
          updateSession(session.id, (current) => ({
            ...current,
            name: result.value.fileName,
            dirty: false,
          }));
          return true;
        }
        if (result.status !== 'cancelled')
          setError('reason' in result ? result.reason : result.message);
        return false;
      } finally {
        setBusyLabel(null);
      }
    },
    [updateSession],
  );

  const disposeAndRemove = useCallback(
    (id: string) => {
      const targetIndex = sessions.findIndex((session) => session.id === id);
      const target = sessions[targetIndex];
      if (target) void target.renderDocument.destroy();
      const next = sessions.filter((session) => session.id !== id);
      setSessions(next);
      setActiveId((currentId) =>
        currentId === id
          ? (next[Math.max(0, Math.min(targetIndex - 1, next.length - 1))]?.id ?? null)
          : currentId,
      );
    },
    [sessions],
  );

  const closeSession = useCallback(
    (id = activeId) => {
      if (!id) return;
      const target = sessions.find((session) => session.id === id);
      if (!target) return;
      setOpenMenu(null);
      if (target.dirty) {
        setActiveId(id);
        setPendingClose(id);
      } else {
        disposeAndRemove(id);
      }
    },
    [activeId, disposeAndRemove, sessions],
  );

  const requestFidelityApproval = useCallback(
    (
      session: PdfDocumentSession,
      label: string,
      mutationKind: 'structural' | 'annotation' | 'form' = 'structural',
    ): Promise<boolean> => {
      if (session.fidelity.signatures) {
        setError(
          'Document changes are disabled for signed PDFs because saving modifications would invalidate the digital signature.',
        );
        return Promise.resolve(false);
      }
      const warnings =
        mutationKind === 'annotation' || mutationKind === 'form'
          ? session.fidelity.warnings.filter(
              (warning) =>
                !warning.startsWith('Annotations') &&
                !(mutationKind === 'form' && warning.startsWith('Interactive forms')) &&
                !warning.startsWith('Bookmarks') &&
                !warning.startsWith('Custom page labels'),
            )
          : session.fidelity.warnings;
      if (warnings.length === 0 || fidelityApprovedRef.current.has(session.id)) {
        return Promise.resolve(true);
      }
      return new Promise<boolean>((resolve) => {
        fidelityResolverRef.current?.(false);
        fidelityResolverRef.current = resolve;
        setFidelityPrompt({ label, warnings });
      });
    },
    [],
  );

  const applyTransform = useCallback(
    async (
      label: string,
      transform: (session: PdfDocumentSession) => Promise<PdfTransformResult>,
      mutationKind: 'structural' | 'annotation' | 'form' = 'structural',
    ) => {
      const session = activeSession;
      if (!session) return;
      if (!(await requestFidelityApproval(session, label, mutationKind))) return;
      setError(null);
      setBusyLabel(label);
      try {
        const result = await transform(session);
        const bytes = result instanceof Uint8Array ? result : result.bytes;
        const loaded = await reloadPdfContent(session, bytes);
        const requestedSelection =
          result instanceof Uint8Array ? session.selectedPages : result.selectedPages;
        const selectedPages = [...new Set(requestedSelection ?? [session.activePage])].filter(
          (page) => page >= 1 && page <= loaded.pages.length,
        );
        const activePage = Math.min(
          result instanceof Uint8Array
            ? (selectedPages[0] ?? session.activePage)
            : (result.activePage ?? selectedPages[0] ?? session.activePage),
          loaded.pages.length,
        );
        const requestedAnnotationId =
          result instanceof Uint8Array ? session.selectedAnnotationId : result.selectedAnnotationId;
        const selectedAnnotationId =
          !(result instanceof Uint8Array) && result.selectNewAnnotation
            ? (loaded.annotations.find(
                (annotation) =>
                  !session.annotations.some((previous) => previous.id === annotation.id),
              )?.id ?? null)
            : requestedAnnotationId &&
                loaded.annotations.some((annotation) => annotation.id === requestedAnnotationId)
              ? requestedAnnotationId
              : null;
        const requestedFormFieldId =
          result instanceof Uint8Array ? session.selectedFormFieldId : result.selectedFormFieldId;
        const selectedFormFieldId =
          !(result instanceof Uint8Array) && result.selectNewFormField
            ? (loaded.form.fields.find(
                (field) => !session.form.fields.some((previous) => previous.id === field.id),
              )?.id ?? null)
            : requestedFormFieldId &&
                loaded.form.fields.some((field) => field.id === requestedFormFieldId)
              ? requestedFormFieldId
              : null;
        const selectedFormWidgetId =
          !(result instanceof Uint8Array) && result.selectNewFormField
            ? (loaded.form.fields.find((field) => field.id === selectedFormFieldId)?.widgets[0]
                ?.id ?? null)
            : result instanceof Uint8Array
              ? session.selectedFormWidgetId
              : (result.selectedFormWidgetId ?? session.selectedFormWidgetId);
        updateSession(session.id, (current) => ({
          ...current,
          ...loaded,
          activePage,
          selectedPages: selectedPages.length ? selectedPages : [activePage],
          selectionAnchor: activePage,
          selectedAnnotationId,
          selectedFormFieldId,
          selectedFormWidgetId,
          textSelection: null,
          dirty: true,
          revision: current.revision + 1,
          history: {
            past: appendPdfHistory(current.history.past, { label, bytes: current.bytes }),
            future: [],
          },
        }));
        await session.renderDocument.destroy();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : `${label} failed.`);
      } finally {
        setBusyLabel(null);
      }
    },
    [activeSession, requestFidelityApproval, updateSession],
  );

  const restoreHistory = useCallback(
    async (direction: 'undo' | 'redo') => {
      const session = activeSession;
      if (!session) return;
      const transition = transitionPdfHistory(session.history, session.bytes, direction);
      if (!transition) return;
      const { snapshot } = transition;
      setBusyLabel(
        direction === 'undo' ? `Undoing ${snapshot.label}` : `Redoing ${snapshot.label}`,
      );
      try {
        const loaded = await reloadPdfContent(session, snapshot.bytes);
        updateSession(session.id, (current) => {
          return {
            ...current,
            ...loaded,
            activePage: Math.min(current.activePage, loaded.pages.length),
            selectedPages: [Math.min(current.activePage, loaded.pages.length)],
            selectionAnchor: Math.min(current.activePage, loaded.pages.length),
            selectedAnnotationId: null,
            selectedFormFieldId: null,
            selectedFormWidgetId: null,
            textSelection: null,
            dirty: true,
            revision: current.revision + 1,
            history: transition.history,
          };
        });
        await session.renderDocument.destroy();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'History restoration failed.');
      } finally {
        setBusyLabel(null);
      }
    },
    [activeSession, updateSession],
  );

  const selectPage = useCallback(
    (pageNumber: number, modifiers: PdfPageSelectionModifiers = {}) => {
      if (!activeSession) return;
      updateSession(activeSession.id, (session) => ({
        ...session,
        ...selectPdfPage(session, pageNumber, session.pages.length, modifiers),
      }));
      requestAnimationFrame(() => {
        canvasViewportRef.current
          ?.querySelector<HTMLElement>(`[data-pdf-page="${pageNumber}"]`)
          ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
    },
    [activeSession, updateSession],
  );

  const setZoomMode = useCallback(
    (mode: PdfZoomMode) => {
      if (!activeSession) return;
      updateSession(activeSession.id, (session) => ({
        ...session,
        zoomMode: mode,
        zoom: mode === 'actual' ? 1 : session.zoom,
      }));
    },
    [activeSession, updateSession],
  );

  const commitAnnotation = useCallback(
    (draft: PdfAnnotationDraft) =>
      applyTransform(
        `Add ${draft.type} annotation`,
        async (session) => ({
          bytes: await createPdfAnnotation(session.bytes, draft),
          activePage: draft.pageNumber,
          selectedPages: [draft.pageNumber],
          selectNewAnnotation: true,
        }),
        'annotation',
      ),
    [applyTransform],
  );

  const createAnnotationFromWorkspace = useCallback(
    (draft: PdfAnnotationDraft) => {
      if ((draft.type === 'note' || draft.type === 'freeText') && !draft.content) {
        setAnnotationComposer({ draft, content: '' });
        return;
      }
      void commitAnnotation(draft);
    },
    [commitAnnotation],
  );

  const selectAnnotation = useCallback(
    (id: string | null) => {
      if (!activeSession) return;
      const annotation = activeSession.annotations.find((candidate) => candidate.id === id);
      updateSession(activeSession.id, (session) => ({
        ...session,
        selectedAnnotationId: annotation?.id ?? null,
        activePage: annotation?.pageNumber ?? session.activePage,
        selectedPages: annotation ? [annotation.pageNumber] : session.selectedPages,
        selectionAnchor: annotation?.pageNumber ?? session.selectionAnchor,
      }));
      if (annotation) {
        requestAnimationFrame(() => {
          canvasViewportRef.current
            ?.querySelector<HTMLElement>(`[data-pdf-page="${annotation.pageNumber}"]`)
            ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        });
      }
    },
    [activeSession, updateSession],
  );

  const setTextSelection = useCallback(
    (selection: PdfTextSelection | null) => {
      if (!activeSession) return;
      updateSession(activeSession.id, (session) => ({
        ...session,
        textSelection: selection,
        activePage: selection?.pageNumber ?? session.activePage,
        selectedPages: selection ? [selection.pageNumber] : session.selectedPages,
      }));
      if (
        selection &&
        (activeSession.tool === 'highlight' ||
          activeSession.tool === 'underline' ||
          activeSession.tool === 'strikeout')
      ) {
        createAnnotationFromWorkspace({
          pageNumber: selection.pageNumber,
          type: activeSession.tool,
          rect: selection.rect,
          quadPoints: selection.quadPoints,
          content: selection.text,
          appearance: activeSession.annotationAppearance,
        });
        window.getSelection()?.removeAllRanges();
      }
    },
    [activeSession, createAnnotationFromWorkspace, updateSession],
  );

  const navigateAnnotation = useCallback(
    (direction: -1 | 1) => {
      if (!activeSession?.annotations.length) return;
      const ordered = [...activeSession.annotations].sort(
        (a, b) => a.pageNumber - b.pageNumber || a.id.localeCompare(b.id),
      );
      const currentIndex = ordered.findIndex(
        (annotation) => annotation.id === activeSession.selectedAnnotationId,
      );
      const nextIndex =
        currentIndex < 0
          ? direction > 0
            ? 0
            : ordered.length - 1
          : (currentIndex + direction + ordered.length) % ordered.length;
      selectAnnotation(ordered[nextIndex].id);
    },
    [activeSession, selectAnnotation],
  );

  const selectFormField = useCallback(
    (fieldId: string | null, widgetId: string | null = null) => {
      if (!activeSession) return;
      const field = activeSession.form.fields.find((candidate) => candidate.id === fieldId);
      const widget =
        field?.widgets.find((candidate) => candidate.id === widgetId) ?? field?.widgets[0];
      updateSession(activeSession.id, (session) => ({
        ...session,
        selectedFormFieldId: field?.id ?? null,
        selectedFormWidgetId: widget?.id ?? null,
        activePage: widget?.pageNumber ?? session.activePage,
        selectedPages: widget ? [widget.pageNumber] : session.selectedPages,
        selectionAnchor: widget?.pageNumber ?? session.selectionAnchor,
      }));
      if (widget) {
        requestAnimationFrame(() => {
          canvasViewportRef.current
            ?.querySelector<HTMLElement>(`[data-pdf-page="${widget.pageNumber}"]`)
            ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        });
      }
    },
    [activeSession, updateSession],
  );

  const navigateFormField = useCallback(
    (direction: -1 | 1) => {
      if (!activeSession?.form.fields.length) return;
      const ordered = [...activeSession.form.fields].sort((a, b) => {
        const aPage = a.widgets[0]?.pageNumber ?? Number.MAX_SAFE_INTEGER;
        const bPage = b.widgets[0]?.pageNumber ?? Number.MAX_SAFE_INTEGER;
        return aPage - bPage || a.name.localeCompare(b.name);
      });
      const currentIndex = ordered.findIndex(
        (field) => field.id === activeSession.selectedFormFieldId,
      );
      const nextIndex =
        currentIndex < 0
          ? direction > 0
            ? 0
            : ordered.length - 1
          : (currentIndex + direction + ordered.length) % ordered.length;
      selectFormField(ordered[nextIndex].id, ordered[nextIndex].widgets[0]?.id ?? null);
    },
    [activeSession, selectFormField],
  );

  const actions = useMemo<PdfCommandActions>(
    () => ({
      open: openFile,
      saveAs: async () => {
        if (activeSession) await saveSessionAs(activeSession);
      },
      close: () => closeSession(),
      undo: () => restoreHistory('undo'),
      redo: () => restoreHistory('redo'),
      find: () => {
        setFindOpen(true);
        setOpenMenu(null);
      },
      selectAllPages: () => {
        if (!activeSession) return;
        updateSession(activeSession.id, (session) => ({
          ...session,
          ...selectAllPdfPages(session.pages.length),
        }));
      },
      zoomBy: (delta) => {
        if (!activeSession) return;
        updateSession(activeSession.id, (session) => ({
          ...session,
          zoom: clampZoom(session.zoom + delta),
          zoomMode: 'custom',
        }));
      },
      setZoomMode,
      setViewMode: (viewMode: PdfViewMode) => {
        if (activeSession) updateSession(activeSession.id, (session) => ({ ...session, viewMode }));
      },
      setTool: (tool: PdfWorkspaceTool) => {
        if (activeSession) updateSession(activeSession.id, (session) => ({ ...session, tool }));
      },
      setWorkspaceMode: (workspaceMode) => {
        if (activeSession) {
          updateSession(activeSession.id, (session) => ({
            ...session,
            workspaceMode,
            tool:
              workspaceMode === 'comment'
                ? session.tool === 'hand'
                  ? 'select'
                  : session.tool
                : workspaceMode === 'forms'
                  ? String(session.tool).startsWith('form-')
                    ? session.tool
                    : 'form-select'
                  : session.tool === 'select' || session.tool === 'hand'
                    ? session.tool
                    : 'select',
            textSelection: workspaceMode === 'comment' ? session.textSelection : null,
          }));
          setLeftOpen(true);
          if (workspaceMode === 'organize') setInspectorOpen(false);
          else setInspectorOpen(true);
        }
      },
      rotateSelected: (angle) =>
        applyTransform(
          angle > 0 ? 'Rotate selected pages right' : 'Rotate selected pages left',
          async (session) => ({
            bytes: await rotatePdfPages(session.bytes, session.selectedPages, angle),
            selectedPages: session.selectedPages,
            activePage: session.activePage,
          }),
        ),
      deleteSelected: () =>
        applyTransform('Delete selected pages', async (session) => {
          if (session.selectedPages.length >= session.pages.length) {
            throw new Error('A PDF must retain at least one page.');
          }
          const first = Math.min(...session.selectedPages);
          const bytes = await deletePdfPages(session.bytes, session.selectedPages);
          const nextPage = Math.min(first, session.pages.length - session.selectedPages.length);
          return { bytes, selectedPages: [nextPage], activePage: nextPage };
        }),
      duplicateSelected: () =>
        applyTransform('Duplicate selected pages', async (session) => {
          const last = Math.max(...session.selectedPages);
          const selectedPages = session.selectedPages.map((_, index) => last + index + 1);
          return {
            bytes: await duplicatePdfPages(session.bytes, session.selectedPages),
            selectedPages,
            activePage: selectedPages[0],
          };
        }),
      extractPages: async () => {
        if (!activeSession) return;
        setBusyLabel('Extracting selected pages');
        try {
          const bytes = await extractPdfPages(activeSession.bytes, activeSession.selectedPages);
          const base = activeSession.name.replace(/\.pdf$/i, '');
          const extracted = await loadPdfSession(
            `${base}-pages-${activeSession.selectedPages.join('-')}.pdf`,
            bytes,
            { kind: 'picker' },
          );
          const derived = { ...extracted, dirty: true };
          setSessions((current) => [...current, derived]);
          setActiveId(derived.id);
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : 'Pages could not be extracted.');
        } finally {
          setBusyLabel(null);
        }
      },
      insertPages: async (placement) => {
        if (!activeSession) return;
        try {
          const selected = await platform.files.pick({
            filters: [
              { name: 'PDF documents', extensions: ['pdf'], mimeTypes: ['application/pdf'] },
            ],
          });
          if (selected.status !== 'success' || !selected.value.files[0]) return;
          const insertFile = selected.value.files[0];
          const insertedCount = await getPdfPageCount(insertFile.bytes);
          await applyTransform(`Insert pages ${placement}`, async (session) => {
            const relativePage = session.activePage;
            const firstInserted = placement === 'before' ? relativePage : relativePage + 1;
            const selectedPages = Array.from(
              { length: insertedCount },
              (_, index) => firstInserted + index,
            );
            return {
              bytes: await insertPdfPages(session.bytes, insertFile.bytes, relativePage, placement),
              selectedPages,
              activePage: selectedPages[0],
            };
          });
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : 'Pages could not be inserted.');
        }
      },
      reorderPages: (pageOrder) =>
        applyTransform('Reorder selected pages', async (session) => {
          const selectedPages = remapSelectedPages(pageOrder, session.selectedPages);
          return {
            bytes: await reorderPdfPages(session.bytes, pageOrder),
            selectedPages,
            activePage: selectedPages[0],
          };
        }),
      createAnnotation: createAnnotationFromWorkspace,
      updateSelectedAnnotation: (patch: PdfAnnotationPatch) => {
        const annotation = activeSession?.annotations.find(
          (candidate) => candidate.id === activeSession.selectedAnnotationId,
        );
        if (!annotation) return;
        return applyTransform(
          `Update ${annotation.type} annotation`,
          async (session) => ({
            bytes: await updatePdfAnnotation(session.bytes, annotation, patch),
            activePage: annotation.pageNumber,
            selectedPages: [annotation.pageNumber],
            selectedAnnotationId: annotation.id,
          }),
          'annotation',
        );
      },
      deleteSelectedAnnotation: () => {
        const annotation = activeSession?.annotations.find(
          (candidate) => candidate.id === activeSession.selectedAnnotationId,
        );
        if (!annotation) return;
        return applyTransform(
          `Delete ${annotation.type} annotation`,
          async (session) => ({
            bytes: await deletePdfAnnotation(session.bytes, annotation),
            activePage: annotation.pageNumber,
            selectedPages: [annotation.pageNumber],
            selectedAnnotationId: null,
          }),
          'annotation',
        );
      },
      removeAllAnnotations: () => {
        if (
          !activeSession ||
          !window.confirm(
            'Remove every annotation from this document? Form fields will be preserved.',
          )
        )
          return;
        return applyTransform(
          'Remove all annotations',
          async (session) => ({
            bytes: await removeAllPdfAnnotations(session.bytes),
            activePage: session.activePage,
            selectedPages: session.selectedPages,
            selectedAnnotationId: null,
          }),
          'annotation',
        );
      },
      navigateAnnotation,
      createFormField: (draft: PdfFormFieldDraft) =>
        applyTransform(
          `Create ${draft.type} field`,
          async (session) => ({
            bytes: await createPdfFormField(session.bytes, draft),
            activePage: draft.pageNumber,
            selectedPages: [draft.pageNumber],
            selectNewFormField: true,
          }),
          'form',
        ),
      updateFormField: (fieldId: string, patch: PdfFormFieldPatch) =>
        applyTransform(
          'Update form field',
          async (session) => ({
            bytes: await updatePdfFormField(session.bytes, fieldId, patch),
            selectedFormFieldId: fieldId,
            selectedFormWidgetId: patch.widgetId ?? session.selectedFormWidgetId,
          }),
          'form',
        ),
      deleteSelectedFormField: () => {
        const fieldId = activeSession?.selectedFormFieldId;
        if (!fieldId) return;
        return applyTransform(
          'Delete form field',
          async (session) => ({
            bytes: await deletePdfFormField(session.bytes, fieldId),
            selectedFormFieldId: null,
            selectedFormWidgetId: null,
          }),
          'form',
        );
      },
      duplicateSelectedFormField: () => {
        const fieldId = activeSession?.selectedFormFieldId;
        if (!fieldId) return;
        return applyTransform(
          'Duplicate form field',
          async (session) => ({
            bytes: await duplicatePdfFormField(session.bytes, fieldId),
            selectNewFormField: true,
          }),
          'form',
        );
      },
      navigateFormField,
      showCommandPalette: () => {
        setPaletteQuery('');
        setPaletteOpen(true);
        setOpenMenu(null);
      },
      showAbout: () => {
        setAboutOpen(true);
        setOpenMenu(null);
      },
    }),
    [
      activeSession,
      applyTransform,
      closeSession,
      createAnnotationFromWorkspace,
      navigateAnnotation,
      navigateFormField,
      openFile,
      restoreHistory,
      saveSessionAs,
      setZoomMode,
      updateSession,
    ],
  );

  const commandContext = useMemo<PdfCommandContext>(
    () => ({ session: activeSession, busy: Boolean(busyLabel), actions }),
    [actions, activeSession, busyLabel],
  );

  const execute = useCallback(
    (id: PdfCommandId, overrides?: Partial<PdfCommandContext>) => {
      const command = PDF_COMMANDS.find((candidate) => candidate.id === id);
      const context = { ...commandContext, ...overrides };
      if (!command?.enabled(context)) return;
      setOpenMenu(null);
      void command.execute(context);
    },
    [commandContext],
  );

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const modifier = event.ctrlKey || event.metaKey;
      const target = event.target as HTMLElement | null;
      const editingText =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        Boolean(target?.isContentEditable);
      if (
        activeSession?.workspaceMode === 'organize' &&
        !editingText &&
        ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].includes(event.key)
      ) {
        const direction = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
        const page = Math.min(
          activeSession.pages.length,
          Math.max(1, activeSession.activePage + direction),
        );
        event.preventDefault();
        selectPage(page, { range: event.shiftKey, additive: modifier && event.shiftKey });
        return;
      }
      let id: PdfCommandId | null = null;
      if (modifier && !event.shiftKey && event.key.toLowerCase() === 'o') id = 'file.open';
      else if (modifier && event.shiftKey && event.key.toLowerCase() === 's') id = 'file.saveAs';
      else if (modifier && event.key.toLowerCase() === 'w') id = 'file.close';
      else if (modifier && !event.shiftKey && event.key.toLowerCase() === 'z') id = 'edit.undo';
      else if (
        modifier &&
        (event.key.toLowerCase() === 'y' || (event.shiftKey && event.key.toLowerCase() === 'z'))
      )
        id = 'edit.redo';
      else if (modifier && !event.shiftKey && event.key.toLowerCase() === 'f') id = 'edit.find';
      else if (modifier && event.key.toLowerCase() === 'a' && !editingText)
        id = 'edit.selectAllPages';
      else if (modifier && event.shiftKey && event.key.toLowerCase() === 'o')
        id = 'view.organizeWorkspace';
      else if (modifier && event.shiftKey && event.key.toLowerCase() === 'c')
        id = 'view.commentWorkspace';
      else if (modifier && event.shiftKey && event.key.toLowerCase() === 'f')
        id = 'view.formsWorkspace';
      else if (modifier && event.shiftKey && event.key.toLowerCase() === 'p')
        id = 'tools.commandPalette';
      else if (
        activeSession?.workspaceMode === 'organize' &&
        !editingText &&
        event.key === 'Delete'
      )
        id = 'document.deletePages';
      else if (activeSession?.workspaceMode === 'comment' && !editingText && event.key === 'Delete')
        id = 'comment.delete';
      else if (activeSession?.workspaceMode === 'forms' && !editingText && event.key === 'Delete')
        id = 'forms.delete';
      else if (event.key === 'Escape') {
        setOpenMenu(null);
        setPaletteOpen(false);
        setFindOpen(false);
        setAnnotationComposer(null);
        if (activeSession?.workspaceMode === 'comment') {
          actions.setTool('select');
          window.getSelection()?.removeAllRanges();
        }
        if (activeSession?.workspaceMode === 'forms') actions.setTool('form-select');
        return;
      }
      if (id) {
        event.preventDefault();
        execute(id);
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [actions, activeSession, execute, selectPage]);

  useEffect(() => {
    if (!findOpen || !activeSession || !findQuery.trim()) {
      setFindResults([]);
      setFindBusy(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setFindBusy(true);
      void searchPdfDocument(activeSession.renderDocument, findQuery)
        .then((results) => {
          if (!cancelled) setFindResults(results);
        })
        .catch(() => {
          if (!cancelled) setFindResults([]);
        })
        .finally(() => {
          if (!cancelled) setFindBusy(false);
        });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeSession, findOpen, findQuery]);

  const page = activeSession?.pages[activeSession.activePage - 1];
  const computedScale = useMemo(() => {
    if (!activeSession || !page) return 1;
    if (activeSession.zoomMode === 'actual' || activeSession.zoomMode === 'custom')
      return activeSession.zoom;
    const widthScale = Math.max(0.2, (viewport.width - 96) / page.width);
    if (activeSession.zoomMode === 'fit-width') return Math.min(widthScale, 3);
    return Math.min(widthScale, Math.max(0.2, (viewport.height - 96) / page.height), 3);
  }, [activeSession, page, viewport]);

  const organizeMode = activeSession?.workspaceMode === 'organize';
  const commentMode = activeSession?.workspaceMode === 'comment';
  const formsMode = activeSession?.workspaceMode === 'forms';
  const pageRewriteDisabled =
    !activeSession ||
    !activeSession.selectedPages.length ||
    Boolean(activeSession.fidelity.signatures) ||
    Boolean(busyLabel);
  const workspaceStyle = {
    '--pdf-left-panel': leftOpen ? (organizeMode ? '360px' : '188px') : '0px',
    '--pdf-right-panel':
      inspectorOpen && !organizeMode ? (commentMode || formsMode ? '292px' : '224px') : '0px',
  } as CSSProperties;

  const beginPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const host = canvasViewportRef.current;
    if (!host || activeSession?.tool !== 'hand' || event.button !== 0) return;
    panStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      left: host.scrollLeft,
      top: host.scrollTop,
    };
    host.setPointerCapture(event.pointerId);
    setPanning(true);
    event.preventDefault();
  };

  const movePan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const host = canvasViewportRef.current;
    if (!host || !panning) return;
    host.scrollLeft = panStartRef.current.left - (event.clientX - panStartRef.current.x);
    host.scrollTop = panStartRef.current.top - (event.clientY - panStartRef.current.y);
  };

  const settleHostClose = useCallback((allow: boolean) => {
    const resolve = hostCloseResolverRef.current;
    hostCloseResolverRef.current = null;
    setHostClosePrompt(null);
    resolve?.(allow);
  }, []);

  const saveDirtySessionsAndClose = useCallback(async () => {
    const ids = hostClosePrompt?.dirtySessionIds ?? [];
    for (const id of ids) {
      const session = sessionsRef.current.find((candidate) => candidate.id === id);
      if (session?.dirty && !(await saveSessionAs(session))) return;
    }
    settleHostClose(true);
  }, [hostClosePrompt, saveSessionAs, settleHostClose]);

  const settleFidelityPrompt = useCallback(
    (allow: boolean) => {
      if (allow && activeSession) fidelityApprovedRef.current.add(activeSession.id);
      const resolve = fidelityResolverRef.current;
      fidelityResolverRef.current = null;
      setFidelityPrompt(null);
      resolve?.(allow);
    },
    [activeSession],
  );

  const openPageContextMenu = useCallback(
    (pageNumber: number, event: ReactMouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (!activeSession?.selectedPages.includes(pageNumber)) selectPage(pageNumber);
      const bounds = appRef.current?.getBoundingClientRect();
      setPageContextMenu({
        pageNumber,
        x: Math.max(4, Math.min((bounds?.width ?? 900) - 213, event.clientX - (bounds?.left ?? 0))),
        y: Math.max(4, Math.min((bounds?.height ?? 700) - 230, event.clientY - (bounds?.top ?? 0))),
      });
    },
    [activeSession, selectPage],
  );

  useEffect(() => {
    if (!pageContextMenu) return;
    const close = () => setPageContextMenu(null);
    window.addEventListener('pointerdown', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('blur', close);
    };
  }, [pageContextMenu]);

  const beginPageDrag = useCallback(
    (pageNumber: number, event: ReactDragEvent<HTMLButtonElement>) => {
      if (!activeSession || activeSession.workspaceMode !== 'organize') {
        event.preventDefault();
        return;
      }
      const pages = activeSession.selectedPages.includes(pageNumber)
        ? activeSession.selectedPages
        : [pageNumber];
      if (!activeSession.selectedPages.includes(pageNumber)) selectPage(pageNumber);
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('application/x-nammu-pdf-pages', pages.join(','));
      setDraggedPages(pages);
      setPageContextMenu(null);
    },
    [activeSession, selectPage],
  );

  const updatePageDrop = useCallback(
    (pageNumber: number, event: ReactDragEvent<HTMLButtonElement>) => {
      if (!activeSession || !draggedPages.length || draggedPages.includes(pageNumber)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      const bounds = event.currentTarget.getBoundingClientRect();
      setPageDrop({
        pageNumber,
        placement: event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after',
      });
    },
    [activeSession, draggedPages],
  );

  const completePageDrop = useCallback(
    (pageNumber: number, event: ReactDragEvent<HTMLButtonElement>) => {
      event.preventDefault();
      if (!activeSession || !draggedPages.length) return;
      const placement = pageDrop?.pageNumber === pageNumber ? pageDrop.placement : 'before';
      const order = buildPdfPageOrder(
        activeSession.pages.length,
        draggedPages,
        pageNumber,
        placement,
      );
      setDraggedPages([]);
      setPageDrop(null);
      if (order) execute('document.reorderPages', { reorderOrder: order });
    },
    [activeSession, draggedPages, execute, pageDrop],
  );

  const clearPageDrag = useCallback(() => {
    setDraggedPages([]);
    setPageDrop(null);
  }, []);

  const paletteCommands = PDF_COMMANDS.filter(
    (command) =>
      !command.hidden &&
      command.id !== 'document.reorderPages' &&
      `${command.label} ${command.menu}`.toLowerCase().includes(paletteQuery.trim().toLowerCase()),
  );

  const handlePaletteKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    const first = paletteCommands.find((command) => command.enabled(commandContext));
    if (first) execute(first.id);
    setPaletteOpen(false);
  };

  return (
    <div
      ref={appRef}
      className={styles.app}
      data-testid="nammu-pdf-workspace"
      data-workspace-mode={activeSession?.workspaceMode ?? 'read'}
    >
      <div className={`${styles.menuBar} relative`}>
        {PDF_MENU_ORDER.map((menu) => (
          <div key={menu.id} className="relative">
            <button
              type="button"
              className={`${styles.menuButton} ${openMenu === menu.id ? styles.menuButtonActive : ''}`}
              onClick={() => setOpenMenu((current) => (current === menu.id ? null : menu.id))}
            >
              {menu.label}
            </button>
            {openMenu === menu.id ? (
              <div className={styles.menuPopover} role="menu">
                {commandsForMenu(menu.id).map((command) => (
                  <div key={command.id}>
                    {command.dividerBefore ? <div className={styles.menuDivider} /> : null}
                    <button
                      type="button"
                      role="menuitem"
                      className={`${styles.menuItem} ${command.danger ? 'text-red-300' : ''}`}
                      disabled={!command.enabled(commandContext)}
                      onClick={() => execute(command.id)}
                    >
                      <span>{command.checked?.(commandContext) ? '✓' : ''}</span>
                      <span>{command.label}</span>
                      <span className="font-mono text-[8px] text-os-text-dim">
                        {command.shortcut}
                      </span>
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ))}
        <span className="ml-auto pr-2 font-mono text-[8px] uppercase tracking-[0.16em] text-os-text-dim">
          Document workspace
        </span>
      </div>

      <div className={styles.tabs} role="tablist" aria-label="Open PDF documents">
        {sessions.map((session) => (
          <div
            key={session.id}
            className={`${styles.tab} ${session.id === activeId ? styles.tabActive : ''}`}
            role="tab"
            aria-selected={session.id === activeId}
          >
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
              onClick={() => setActiveId(session.id)}
            >
              <FileText size={12} className="shrink-0 text-os-accent" />
              <span className="truncate">{session.name}</span>
              {session.dirty ? (
                <span className="h-1.5 w-1.5 shrink-0 bg-os-accent" aria-label="Modified" />
              ) : null}
            </button>
            <button
              type="button"
              aria-label={`Close ${session.name}`}
              className="shrink-0 p-0.5 text-os-text-dim hover:text-os-text"
              onClick={() => closeSession(session.id)}
            >
              <X size={11} />
            </button>
          </div>
        ))}
        <button
          type="button"
          className={`${styles.toolButton} ml-1`}
          onClick={() => execute('file.open')}
          title="Open PDF"
        >
          <FilePlus2 size={13} />
        </button>
      </div>

      <div className={styles.toolbar}>
        <button
          type="button"
          className={styles.toolButton}
          onClick={() => void openFile()}
          title="Open PDF"
        >
          <FolderOpen size={14} />
          <span className={styles.toolLabel}>Open</span>
        </button>
        <button
          type="button"
          className={styles.toolButton}
          disabled={!activeSession || Boolean(busyLabel)}
          onClick={() => execute('file.saveAs')}
          title="Save As"
        >
          <Save size={14} />
          <span className={styles.toolLabel}>Save As</span>
        </button>
        <span className={styles.toolSeparator} />
        <button
          type="button"
          className={styles.toolButton}
          disabled={!activeSession?.history.past.length || Boolean(busyLabel)}
          onClick={() => execute('edit.undo')}
          title="Undo"
        >
          <Undo2 size={14} />
        </button>
        <button
          type="button"
          className={styles.toolButton}
          disabled={!activeSession?.history.future.length || Boolean(busyLabel)}
          onClick={() => execute('edit.redo')}
          title="Redo"
        >
          <Redo2 size={14} />
        </button>
        <span className={styles.toolSeparator} />
        {commentMode && activeSession ? (
          <PdfCommentToolbar
            session={activeSession}
            busy={Boolean(busyLabel)}
            execute={execute}
            onAppearanceChange={(color) =>
              updateSession(activeSession.id, (session) => ({
                ...session,
                annotationAppearance: { ...session.annotationAppearance, color },
              }))
            }
          />
        ) : formsMode && activeSession ? (
          <PdfFormsToolbar session={activeSession} busy={Boolean(busyLabel)} execute={execute} />
        ) : (
          <>
            <button
              type="button"
              className={`${styles.toolButton} ${activeSession?.tool === 'select' ? styles.toolButtonActive : ''}`}
              disabled={!activeSession}
              onClick={() => execute('view.selectTool')}
              title="Select tool"
            >
              <Pointer size={14} />
            </button>
            <button
              type="button"
              className={`${styles.toolButton} ${activeSession?.tool === 'hand' ? styles.toolButtonActive : ''}`}
              disabled={!activeSession}
              onClick={() => execute('view.handTool')}
              title="Hand tool"
            >
              <Hand size={14} />
            </button>
          </>
        )}
        <span className={styles.toolSeparator} />
        <button
          type="button"
          className={styles.toolButton}
          disabled={!activeSession}
          onClick={() => execute('view.zoomOut')}
          title="Zoom out"
        >
          <ZoomOut size={14} />
        </button>
        <span className="w-11 text-center font-mono text-[9px] text-os-text-muted">
          {activeSession ? `${Math.round(computedScale * 100)}%` : '—'}
        </span>
        <button
          type="button"
          className={styles.toolButton}
          disabled={!activeSession}
          onClick={() => execute('view.zoomIn')}
          title="Zoom in"
        >
          <ZoomIn size={14} />
        </button>
        <button
          type="button"
          className={styles.toolButton}
          disabled={!activeSession}
          onClick={() => execute('view.fitWidth')}
        >
          Fit width
        </button>
        <button
          type="button"
          className={styles.toolButton}
          disabled={!activeSession}
          onClick={() => execute('view.fitPage')}
        >
          Fit page
        </button>
        <span className={styles.toolSeparator} />
        {!commentMode && !formsMode ? (
          <>
            <button
              type="button"
              className={styles.toolButton}
              disabled={pageRewriteDisabled}
              onClick={() => execute('document.rotateLeft')}
              title="Rotate left"
            >
              <RotateCcw size={14} />
            </button>
            <button
              type="button"
              className={styles.toolButton}
              disabled={pageRewriteDisabled}
              onClick={() => execute('document.rotateRight')}
              title="Rotate right"
            >
              <RotateCw size={14} />
            </button>
            <button
              type="button"
              className={styles.toolButton}
              disabled={
                pageRewriteDisabled ||
                !activeSession ||
                activeSession.selectedPages.length >= activeSession.pages.length
              }
              onClick={() => execute('document.deletePages')}
              title="Delete selected pages"
            >
              <Trash2 size={14} />
            </button>
            <span className={styles.toolSeparator} />
          </>
        ) : null}
        <button
          type="button"
          className={`${styles.toolButton} ${organizeMode ? styles.toolButtonActive : ''}`}
          disabled={!activeSession}
          onClick={() => execute(organizeMode ? 'view.readWorkspace' : 'view.organizeWorkspace')}
          title={organizeMode ? 'Return to Read workspace' : 'Organize pages'}
        >
          <LayoutGrid size={14} />
          <span className={styles.toolLabel}>{organizeMode ? 'Read' : 'Organize'}</span>
        </button>
        <button
          type="button"
          className={`${styles.toolButton} ${formsMode ? styles.toolButtonActive : ''}`}
          disabled={!activeSession}
          onClick={() => execute(formsMode ? 'view.readWorkspace' : 'view.formsWorkspace')}
          title={formsMode ? 'Return to Read workspace' : 'Create and edit PDF forms'}
        >
          <ListChecks size={14} />
          <span className={styles.toolLabel}>{formsMode ? 'Read' : 'Forms'}</span>
        </button>
        <button
          type="button"
          className={`${styles.toolButton} ${commentMode ? styles.toolButtonActive : ''}`}
          disabled={!activeSession}
          onClick={() => execute(commentMode ? 'view.readWorkspace' : 'view.commentWorkspace')}
          title={commentMode ? 'Return to Read workspace' : 'Comment and annotate'}
        >
          <MessageSquareText size={14} />
          <span className={styles.toolLabel}>{commentMode ? 'Read' : 'Comment'}</span>
        </button>
        {organizeMode ? (
          <>
            <button
              type="button"
              className={styles.toolButton}
              disabled={pageRewriteDisabled}
              onClick={() => execute('document.duplicatePages')}
              title="Duplicate selected pages"
            >
              <CopyPlus size={14} />
            </button>
            <button
              type="button"
              className={styles.toolButton}
              disabled={!activeSession?.selectedPages.length || Boolean(busyLabel)}
              onClick={() => execute('document.extractPages')}
              title="Extract selected pages to a new tab"
            >
              <FileOutput size={14} />
            </button>
            <button
              type="button"
              className={styles.toolButton}
              disabled={pageRewriteDisabled}
              onClick={() => execute('document.insertBefore')}
              title="Insert PDF before selection"
            >
              <FilePlus2 size={14} />
              <span className={styles.toolLabel}>Before</span>
            </button>
            <button
              type="button"
              className={styles.toolButton}
              disabled={pageRewriteDisabled}
              onClick={() => execute('document.insertAfter')}
              title="Insert PDF after selection"
            >
              <FilePlus2 size={14} />
              <span className={styles.toolLabel}>After</span>
            </button>
          </>
        ) : null}
        <span className="flex-1" />
        <button
          type="button"
          className={styles.toolButton}
          onClick={() => setLeftOpen((value) => !value)}
          title="Toggle pages panel"
        >
          {leftOpen ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
        </button>
        <button
          type="button"
          className={styles.toolButton}
          onClick={() => setInspectorOpen((value) => !value)}
          title="Toggle inspector"
        >
          {inspectorOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
        </button>
      </div>

      <div className={styles.workspace} style={workspaceStyle}>
        <aside className={styles.leftPanel} aria-label={formsMode ? 'Fields panel' : 'Pages panel'}>
          <div className={styles.panelHeader}>
            <span>{formsMode ? 'Fields' : organizeMode ? 'Organize Pages' : 'Pages'}</span>
            <span>
              {formsMode
                ? (activeSession?.form.fields.length ?? 0)
                : activeSession
                  ? `${activeSession.selectedPages.length} selected · ${activeSession.pages.length}`
                  : '0'}
            </span>
          </div>
          {formsMode && activeSession ? (
            <PdfFormsFieldList
              session={activeSession}
              busy={Boolean(busyLabel)}
              onSelect={selectFormField}
              onNavigate={navigateFormField}
            />
          ) : organizeMode && activeSession ? (
            <div className={styles.organizeHeader}>
              <span>Drag selected pages as a block</span>
              <button type="button" onClick={() => execute('edit.selectAllPages')}>
                Select all
              </button>
            </div>
          ) : null}
          {!formsMode ? (
            <div
              className={`${styles.thumbnailScroller} ${organizeMode ? styles.thumbnailGridOrganize : ''}`}
            >
              {activeSession?.pages.map((entry) => (
                <PdfPageThumbnail
                  key={`${activeSession.id}-${activeSession.revision}-${entry.pageNumber}`}
                  document={activeSession.renderDocument}
                  pageNumber={entry.pageNumber}
                  pageWidth={organizeMode ? 132 : 112}
                  selected={activeSession.selectedPages.includes(entry.pageNumber)}
                  organize={organizeMode}
                  dragging={draggedPages.includes(entry.pageNumber)}
                  dropPlacement={
                    pageDrop?.pageNumber === entry.pageNumber ? pageDrop.placement : null
                  }
                  onSelect={selectPage}
                  onContextMenu={openPageContextMenu}
                  onDragStart={beginPageDrag}
                  onDragOver={updatePageDrop}
                  onDrop={completePageDrop}
                  onDragEnd={clearPageDrag}
                />
              ))}
            </div>
          ) : null}
        </aside>

        <main
          ref={canvasViewportRef}
          className={`${styles.canvasViewport} ${activeSession?.tool === 'hand' ? (panning ? 'cursor-grabbing' : 'cursor-grab') : ''}`}
          onPointerDown={beginPan}
          onPointerMove={movePan}
          onPointerUp={() => setPanning(false)}
          onPointerCancel={() => setPanning(false)}
        >
          {activeSession ? (
            <div className={styles.canvasStack}>
              {(activeSession.viewMode === 'single-page'
                ? activeSession.pages.filter(
                    (entry) => entry.pageNumber === activeSession.activePage,
                  )
                : activeSession.pages
              ).map((entry) => (
                <PdfPageCanvas
                  key={`${activeSession.id}-${activeSession.revision}-${entry.pageNumber}`}
                  document={activeSession.renderDocument}
                  pageNumber={entry.pageNumber}
                  scale={computedScale}
                  selected={activeSession.selectedPages.includes(entry.pageNumber)}
                  lazy={activeSession.viewMode === 'continuous'}
                  commentMode={commentMode}
                  formsMode={formsMode}
                  formsVisible={activeSession.workspaceMode === 'read' || formsMode}
                  form={activeSession.form}
                  tool={activeSession.tool}
                  annotations={activeSession.annotations}
                  selectedAnnotationId={activeSession.selectedAnnotationId}
                  annotationAppearance={activeSession.annotationAppearance}
                  onSelect={selectPage}
                  onSelectAnnotation={selectAnnotation}
                  onTextSelection={setTextSelection}
                  onCreateAnnotation={(draft) =>
                    execute('comment.create', { annotationDraft: draft })
                  }
                  selectedFormFieldId={activeSession.selectedFormFieldId}
                  selectedFormWidgetId={activeSession.selectedFormWidgetId}
                  signed={activeSession.fidelity.signatures}
                  onSelectFormField={selectFormField}
                  onCreateFormField={(draft) => execute('forms.create', { formFieldDraft: draft })}
                  onUpdateFormField={(fieldId, patch) =>
                    execute('forms.update', { formFieldId: fieldId, formFieldPatch: patch })
                  }
                />
              ))}
            </div>
          ) : (
            <div className={styles.emptyCanvas}>
              <div className="max-w-sm">
                <div className="mx-auto grid h-12 w-12 place-items-center border border-os-line-strong bg-os-window text-os-accent">
                  <FileText size={22} />
                </div>
                <h1 className="mt-5 text-[17px] font-medium text-os-text">Nammu PDF</h1>
                <p className="mt-2 text-[11px] leading-5 text-os-text-muted">
                  Open a document once, then read, inspect and organize it in one persistent
                  workspace.
                </p>
                <button
                  type="button"
                  className="mt-5 inline-flex h-8 items-center gap-2 border border-os-accent/50 bg-os-accent/10 px-4 text-[10px] text-os-text hover:bg-os-accent/15"
                  onClick={() => void openFile()}
                >
                  <FolderOpen size={13} /> Open PDF
                </button>
                <p className="mt-3 font-mono text-[8px] uppercase tracking-[0.12em] text-os-text-dim">
                  Local processing · Ctrl+O
                </p>
              </div>
            </div>
          )}
        </main>

        <aside
          className={styles.inspector}
          aria-label={
            commentMode
              ? 'Comments inspector'
              : formsMode
                ? 'Form field inspector'
                : 'Document inspector'
          }
        >
          <div className={styles.panelHeader}>
            <span>{commentMode ? 'Comments' : formsMode ? 'Field Inspector' : 'Inspector'}</span>
            <ChevronsUpDown size={11} />
          </div>
          {activeSession && page ? (
            commentMode ? (
              <PdfCommentsInspector
                session={activeSession}
                busy={Boolean(busyLabel)}
                onSelect={selectAnnotation}
                onApply={(patch) => execute('comment.update', { annotationPatch: patch })}
                onDelete={() => execute('comment.delete')}
                onNavigate={(direction) => actions.navigateAnnotation(direction)}
              />
            ) : formsMode ? (
              <PdfFormPropertiesInspector
                session={activeSession}
                busy={Boolean(busyLabel)}
                onApply={(patch) => execute('forms.update', { formFieldPatch: patch })}
                onDelete={() => execute('forms.delete')}
                onDuplicate={() => execute('forms.duplicate')}
              />
            ) : (
              <div className="h-[calc(100%-31px)] overflow-auto p-3 text-[10px]">
                <section>
                  <h2 className="font-mono text-[8px] uppercase tracking-[0.14em] text-os-text-dim">
                    Selection
                  </h2>
                  <dl className="mt-2 grid grid-cols-[68px_1fr] gap-x-2 gap-y-2 text-os-text-muted">
                    <dt>Page</dt>
                    <dd className="text-os-text">
                      {activeSession.activePage} of {activeSession.pages.length}
                    </dd>
                    <dt>Selected</dt>
                    <dd>{activeSession.selectedPages.length} page(s)</dd>
                    <dt>Size</dt>
                    <dd>
                      {Math.round(page.width)} × {Math.round(page.height)} pt
                    </dd>
                    <dt>Rotation</dt>
                    <dd>{page.rotation}°</dd>
                    <dt>Tool</dt>
                    <dd className="capitalize">{activeSession.tool}</dd>
                  </dl>
                </section>
                {activeSession.fidelity.signatures || activeSession.fidelity.warnings.length ? (
                  <>
                    <div className="my-4 h-px bg-os-line" />
                    <section>
                      <h2 className="font-mono text-[8px] uppercase tracking-[0.14em] text-amber-300">
                        Fidelity
                      </h2>
                      <p className="mt-2 leading-4 text-os-text-muted">
                        {activeSession.fidelity.signatures
                          ? 'Signed document: structural page changes are disabled because they invalidate signatures.'
                          : `${activeSession.fidelity.warnings.length} document feature warning(s) will be shown before the first structural change.`}
                      </p>
                    </section>
                  </>
                ) : null}
                <div className="my-4 h-px bg-os-line" />
                <section>
                  <h2 className="font-mono text-[8px] uppercase tracking-[0.14em] text-os-text-dim">
                    Document
                  </h2>
                  <dl className="mt-2 grid grid-cols-[68px_1fr] gap-x-2 gap-y-2 break-words text-os-text-muted">
                    <dt>Title</dt>
                    <dd className="text-os-text">
                      {activeSession.metadata.title || activeSession.name}
                    </dd>
                    <dt>Author</dt>
                    <dd>{activeSession.metadata.author || 'Not set'}</dd>
                    <dt>Subject</dt>
                    <dd>{activeSession.metadata.subject || 'Not set'}</dd>
                    <dt>Created</dt>
                    <dd>{dateLabel(activeSession.metadata.creationDate)}</dd>
                    <dt>Modified</dt>
                    <dd>{dateLabel(activeSession.metadata.modificationDate)}</dd>
                    <dt>File size</dt>
                    <dd>{formatBytes(activeSession.size)}</dd>
                  </dl>
                </section>
              </div>
            )
          ) : (
            <div className="p-3 text-[10px] leading-5 text-os-text-dim">
              Open a PDF to inspect document and page properties.
            </div>
          )}
        </aside>
      </div>

      <div className={styles.statusBar}>
        <button
          type="button"
          disabled={!activeSession || activeSession.activePage <= 1}
          onClick={() => activeSession && selectPage(activeSession.activePage - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft size={12} />
        </button>
        <span>
          {activeSession
            ? `Page ${activeSession.activePage} / ${activeSession.pages.length}`
            : 'No document'}
        </span>
        {activeSession && activeSession.selectedPages.length > 1 ? (
          <span>{activeSession.selectedPages.length} pages selected</span>
        ) : null}
        {activeSession && commentMode ? (
          <span>
            {activeSession.annotations.length} annotation
            {activeSession.annotations.length === 1 ? '' : 's'} · {activeSession.tool}
          </span>
        ) : null}
        {activeSession && formsMode ? (
          <span>
            {activeSession.form.fields.length} field
            {activeSession.form.fields.length === 1 ? '' : 's'} · {activeSession.form.kind}
          </span>
        ) : null}
        <button
          type="button"
          disabled={!activeSession || activeSession.activePage >= activeSession.pages.length}
          onClick={() => activeSession && selectPage(activeSession.activePage + 1)}
          aria-label="Next page"
        >
          <ChevronRight size={12} />
        </button>
        {page ? (
          <span>
            {Math.round(page.width)} × {Math.round(page.height)} pt
          </span>
        ) : null}
        <span className={styles.statusSpacer} />
        <span>{activeSession?.dirty ? 'Modified' : activeSession ? 'Saved' : ''}</span>
        <span>{busyLabel || error || 'Ready'}</span>
      </div>

      {pageContextMenu ? (
        <div
          className={styles.pageContextMenu}
          style={{ left: pageContextMenu.x, top: pageContextMenu.y }}
          role="menu"
          aria-label={`Page ${pageContextMenu.pageNumber} actions`}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {(
            [
              'document.rotateLeft',
              'document.rotateRight',
              'document.duplicatePages',
              'document.insertBefore',
              'document.insertAfter',
              'document.extractPages',
              'document.deletePages',
            ] as const
          ).map((id) => {
            const command = PDF_COMMANDS.find((candidate) => candidate.id === id);
            if (!command) return null;
            return (
              <button
                key={id}
                type="button"
                role="menuitem"
                disabled={!command.enabled(commandContext)}
                className={command.danger ? 'text-red-300' : undefined}
                onClick={() => {
                  setPageContextMenu(null);
                  execute(id);
                }}
              >
                {command.label.replace(' Selected Pages', '').replace(' to New Tab', '')}
              </button>
            );
          })}
        </div>
      ) : null}

      {findOpen ? (
        <div className="absolute right-[232px] top-[106px] z-[70] w-72 border border-os-line-strong bg-os-window shadow-2xl">
          <div className="flex h-9 items-center gap-2 border-b border-os-line px-2">
            <Search size={13} className="text-os-accent" />
            <input
              autoFocus
              value={findQuery}
              onChange={(event) => setFindQuery(event.target.value)}
              placeholder="Find in document"
              className="min-w-0 flex-1 bg-transparent text-[10px] text-os-text outline-none"
            />
            <button type="button" onClick={() => setFindOpen(false)}>
              <X size={12} />
            </button>
          </div>
          <div className="max-h-72 overflow-auto p-1">
            {findBusy ? <p className="p-3 text-[9px] text-os-text-dim">Searching pages…</p> : null}
            {!findBusy && findQuery && findResults.length === 0 ? (
              <p className="p-3 text-[9px] text-os-text-dim">No matches found.</p>
            ) : null}
            {findResults.map((result) => (
              <button
                key={result.pageNumber}
                type="button"
                onClick={() => selectPage(result.pageNumber)}
                className="block w-full border-b border-os-line px-2 py-2 text-left hover:bg-white/[0.04]"
              >
                <span className="font-mono text-[8px] text-os-accent">
                  PAGE {result.pageNumber} · {result.matches} MATCH
                  {result.matches === 1 ? '' : 'ES'}
                </span>
                <span className="mt-1 block text-[9px] leading-4 text-os-text-muted">
                  {result.excerpt}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {paletteOpen ? (
        <div
          className={styles.overlay}
          onMouseDown={(event) => event.target === event.currentTarget && setPaletteOpen(false)}
        >
          <div className={styles.dialog}>
            <div className="flex h-11 items-center gap-2 border-b border-os-line px-3">
              <Search size={14} className="text-os-accent" />
              <input
                autoFocus
                value={paletteQuery}
                onChange={(event) => setPaletteQuery(event.target.value)}
                onKeyDown={handlePaletteKey}
                placeholder="Search commands"
                className="min-w-0 flex-1 bg-transparent text-[11px] text-os-text outline-none"
              />
              <span className="font-mono text-[8px] text-os-text-dim">ESC</span>
            </div>
            <div className="max-h-80 overflow-auto p-1">
              {paletteCommands.map((command) => (
                <button
                  key={command.id}
                  type="button"
                  disabled={!command.enabled(commandContext)}
                  onClick={() => {
                    execute(command.id);
                    setPaletteOpen(false);
                  }}
                  className="flex min-h-9 w-full items-center gap-3 px-3 text-left text-[10px] text-os-text-muted hover:bg-white/[0.04] hover:text-os-text disabled:opacity-30"
                >
                  <span className="w-16 font-mono text-[8px] uppercase text-os-text-dim">
                    {command.menu}
                  </span>
                  <span className="flex-1">{command.label}</span>
                  <span className="font-mono text-[8px]">{command.shortcut}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {aboutOpen ? (
        <div
          className={styles.overlay}
          onMouseDown={(event) => event.target === event.currentTarget && setAboutOpen(false)}
        >
          <div className={`${styles.dialog} p-5`}>
            <div className="flex items-start gap-4">
              <div className="grid h-12 w-12 shrink-0 place-items-center border border-os-accent/40 bg-os-accent/10 text-os-accent">
                <FileText size={22} />
              </div>
              <div>
                <h2 className="text-[15px] text-os-text">Nammu PDF</h2>
                <p className="mt-2 text-[10px] leading-5 text-os-text-muted">
                  A local-first document workstation built around persistent sessions and reusable
                  commands. P1 uses PDF.js for rendering and pdf-lib for foundational page
                  operations.
                </p>
                <button
                  type="button"
                  className="mt-4 border border-os-line-strong px-3 py-1.5 text-[9px] text-os-text hover:bg-white/[0.04]"
                  onClick={() => setAboutOpen(false)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {annotationComposer ? (
        <div className={styles.overlay} role="dialog" aria-modal="true">
          <div className={`${styles.dialog} p-5`}>
            <h2 className="text-[14px] text-os-text">
              {annotationComposer.draft.type === 'note' ? 'Add sticky note' : 'Add text box'}
            </h2>
            <p className="mt-2 text-[9px] leading-4 text-os-text-dim">
              This content is stored as a real PDF annotation and remains editable in compatible
              readers.
            </p>
            <textarea
              autoFocus
              rows={5}
              maxLength={16_384}
              value={annotationComposer.content}
              onChange={(event) =>
                setAnnotationComposer((current) =>
                  current ? { ...current, content: event.target.value } : null,
                )
              }
              className="mt-4 w-full resize-y border border-os-line-strong bg-black/15 p-3 text-[10px] text-os-text outline-none focus:border-os-accent/60"
              placeholder={
                annotationComposer.draft.type === 'note' ? 'Write a comment…' : 'Enter text…'
              }
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="border border-os-line-strong px-3 py-1.5 text-[9px]"
                onClick={() => setAnnotationComposer(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="border border-os-accent/50 bg-os-accent/10 px-3 py-1.5 text-[9px] text-os-text disabled:opacity-40"
                disabled={!annotationComposer.content.trim()}
                onClick={() => {
                  const pending = annotationComposer;
                  setAnnotationComposer(null);
                  void commitAnnotation({ ...pending.draft, content: pending.content.trim() });
                }}
              >
                Add annotation
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pendingClose ? (
        <div className={styles.overlay}>
          <div className={`${styles.dialog} p-5`}>
            <h2 className="text-[14px] text-os-text">Save changes before closing?</h2>
            <p className="mt-2 text-[10px] leading-5 text-os-text-muted">
              Your document has unsaved page changes. Save As preserves the original unless you
              choose a destination that replaces it.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="border border-os-line-strong px-3 py-1.5 text-[9px]"
                onClick={() => setPendingClose(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="border border-red-400/30 px-3 py-1.5 text-[9px] text-red-300"
                onClick={() => {
                  const id = pendingClose;
                  setPendingClose(null);
                  disposeAndRemove(id);
                }}
              >
                Discard
              </button>
              <button
                type="button"
                className="border border-os-accent/50 bg-os-accent/10 px-3 py-1.5 text-[9px] text-os-text"
                onClick={async () => {
                  const session = sessions.find((candidate) => candidate.id === pendingClose);
                  if (session && (await saveSessionAs(session))) {
                    const id = session.id;
                    setPendingClose(null);
                    disposeAndRemove(id);
                  }
                }}
              >
                Save As…
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {hostClosePrompt ? (
        <div className={styles.overlay} role="dialog" aria-modal="true">
          <div className={`${styles.dialog} p-5`}>
            <h2 className="text-[14px] text-os-text">Save modified documents before closing?</h2>
            <p className="mt-2 text-[10px] leading-5 text-os-text-muted">
              Closing Nammu PDF would discard changes in the following document
              {hostClosePrompt.dirtySessionIds.length === 1 ? '' : 's'}:
            </p>
            <ul className="mt-3 max-h-36 overflow-auto border-y border-os-line py-2 text-[10px] text-os-text">
              {hostClosePrompt.dirtySessionIds.map((id) => (
                <li key={id} className="px-2 py-1">
                  {sessions.find((session) => session.id === id)?.name ?? 'Modified document'}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[9px] leading-4 text-os-text-dim">
              Save As uses a safe destination picker for each modified document.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="border border-os-line-strong px-3 py-1.5 text-[9px]"
                onClick={() => settleHostClose(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="border border-red-400/30 px-3 py-1.5 text-[9px] text-red-300"
                onClick={() => settleHostClose(true)}
              >
                Discard All
              </button>
              <button
                type="button"
                className="border border-os-accent/50 bg-os-accent/10 px-3 py-1.5 text-[9px] text-os-text"
                onClick={() => void saveDirtySessionsAndClose()}
              >
                Save All As…
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {fidelityPrompt ? (
        <div className={styles.overlay} role="dialog" aria-modal="true">
          <div className={`${styles.dialog} p-5`}>
            <h2 className="text-[14px] text-os-text">Document fidelity warning</h2>
            <p className="mt-2 text-[10px] leading-5 text-os-text-muted">
              “{fidelityPrompt.label}” rewrites the PDF structure. The current adapter cannot
              guarantee preservation of every advanced document feature:
            </p>
            <ul className="mt-3 max-h-48 list-disc overflow-auto border-y border-os-line px-6 py-2 text-[9px] leading-5 text-amber-200/85">
              {fidelityPrompt.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="border border-os-line-strong px-3 py-1.5 text-[9px]"
                onClick={() => settleFidelityPrompt(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="border border-amber-300/40 bg-amber-300/10 px-3 py-1.5 text-[9px] text-amber-100"
                onClick={() => settleFidelityPrompt(true)}
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {error ? (
        <button
          type="button"
          className="absolute bottom-8 left-1/2 z-[85] max-w-[min(560px,80%)] -translate-x-1/2 border border-red-400/30 bg-os-window px-3 py-2 text-left text-[9px] text-red-200 shadow-2xl"
          onClick={() => setError(null)}
        >
          {error}
          <X size={11} className="ml-3 inline" />
        </button>
      ) : null}
      {busyLabel ? (
        <div className="pointer-events-none absolute inset-x-0 top-[100px] z-[60] mx-auto w-fit border border-os-line-strong bg-os-window/95 px-3 py-1.5 font-mono text-[8px] uppercase tracking-[0.12em] text-os-accent shadow-xl">
          {busyLabel}…
        </div>
      ) : null}
    </div>
  );
}
