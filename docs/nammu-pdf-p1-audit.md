# Nammu PDF P1 audit and architecture

Status: P1 document-workspace foundation. BentoPDF remains a read-only donor repository and is not part of the Nammu build graph.

## Executive decision

Nammu PDF is a Nammu system application, not a BentoPDF deployment, iframe, tool homepage, or second local web application. The active PDF is represented by a persistent `PdfDocumentSession`; menus, toolbar buttons, shortcuts, context surfaces, and the future command palette all resolve to one `PdfCommandRegistry` entry. P1 uses locally bundled PDF.js for viewing/search and `pdf-lib` for four foundational page operations.

No BentoPDF application/controller source was copied into P1. This is deliberate: BentoPDF 2.8.8 declares `AGPL-3.0-only` (with a separately offered commercial license), while its most useful architecture is tool-page/global-state oriented. Capability adoption after P1 needs both an adapter design and a deliberate license decision.

## NammuOS integration audit

| Concern                  | Existing Nammu architecture                                                                      | P1 decision                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Application registration | `SYSTEM_APPS` is the authoritative system-app registry; `SystemAppContent` lazy-loads app bodies | Register `pdf` / `system:pdf` and lazy-load `PdfApp`                                        |
| Internal windows         | React window manager owns geometry, focus, taskbar, snapping and lifecycle                       | Nammu PDF remains one React-managed internal window                                         |
| Standalone apps          | `/apps/:id` resolves the same registry/content component                                         | Nammu PDF works as a standalone app; native-path handoff remains desktop-shell scoped       |
| Window launch data       | `WindowState.data` carries initial launch data                                                   | `PdfAppInitialData.openRequest` carries a typed native PDF request                          |
| Files integration        | Files already has trusted native paths and typed native filesystem capabilities                  | PDF double-click/context action dispatches a typed in-process handoff; no path enters a URL |
| Platform files           | Web and Tauri implement the same `platform.files` contract                                       | Add `readPdf(path)` only; Tauri validates `.pdf`, Web returns deterministic unsupported     |
| Native boundary          | Trusted `main` window already owns dialog/file capabilities                                      | No Rust command, HTTP endpoint, remote WebView access, or Tauri permission was added        |
| Existing PDF tools       | `src/tools/PDF.tsx` contains independent one-shot tools                                          | Retained for compatibility; not used as Nammu PDF's product model                           |
| Files PDF previews       | Native Files preview uses the Windows PDF backend                                                | Frozen and unchanged; Nammu PDF has its own document-session renderer                       |
| Web/Desktop              | Same React application with platform implementations                                             | Browser pick/download on Web; native picker/read/save dialog on Desktop                     |

The cloned `bentopdf` directory is a nested Git repository. It is excluded from the root TypeScript program so its independent Vite aliases, dependencies, and tests cannot contaminate Nammu's typecheck. It is not ignored, deleted, built, or modified by P1.

## BentoPDF architecture audit

BentoPDF is a Vite/TypeScript static application with approximately 125 HTML tool entry points. `src/js/config/tools.ts` is the discoverability registry. Individual `*-page.ts` controllers bind specialized DOM pages to processing helpers. `src/js/state.ts` holds a singleton (`activeTool`, files, one `pdfDoc`, page data and object URL) and explicitly resets that state when switching tools. This is the exact lifecycle that Nammu PDF must not inherit.

Useful internal subsystems found:

- PDF.js rendering, text extraction, password/error handling, and a dedicated worker entry.
- `pdf-lib` document/page transformations and `@pdf-lib/fontkit` font embedding.
- A vendored `bentopdf-viewer` 2.9.1 package (MIT, Preact/EmbedPDF lineage) for advanced viewing/annotation UI.
- A vendored `bentopdf-pdfium` editcore package (AGPL-3.0, JS + WASM) for direct text/object editing.
- qpdf WASM for content-preserving split/extraction/repair scenarios.
- PyMuPDF WASM for extraction, conversion, compression and deskew.
- Ghostscript WASM for PDF/A and font outlining.
- CoherentPDF/CPDF for bookmarks, labels, attachments, merge/split and structural operations.
- Tesseract workers for OCR, searchable output and OCR-assisted comparison.
- LibreOffice WASM workers for Office/OpenDocument conversion (documented by BentoPDF as roughly a 75 MB first-load engine).
- PDFKit and jsPDF for document creation/export, with html2canvas/Markdown/table helpers.
- PDFium editcore, form-creator controllers, annotation viewer extensions and signature helpers.
- `zgapdfsigner` + node-forge for digital signatures, plus network timestamp-authority support.
- Dedicated workers for merge, alternate merge, attachments, JSON, comparison and other long operations.
- Rete workflow nodes/registry that can inform future adapter coverage, but are not an appropriate Nammu UI/session layer.
- Service-worker/CDN configuration designed for BentoPDF's static website, not Nammu's runtime.

## Capability inventory

The classifications below describe reuse suitability, not P1 shipment status. `REUSABLE BEHIND ADAPTER` still requires license review when the donor implementation is AGPL.

### REUSABLE DIRECTLY

These are mature local primitives or permissively licensed dependencies already suitable for a Nammu-owned adapter:

- PDF.js: rendering, page text extraction, search, page dimensions, metadata reading and thumbnail rendering.
- `pdf-lib`: rotate, delete, duplicate/copy, insert, extract, merge foundations, blank pages, basic metadata, page numbers, headers/footers, Bates numbering, watermarks and simple drawing.
- Image/document creation primitives: jsPDF, PDFKit, fontkit, JSZip, TIFF/HEIC/image decoders where their individual licenses pass review.
- Pure helpers for page-range parsing, filename handling, rotation and other data-only logic, after source/license provenance is recorded.

P1 directly uses the upstream `pdfjs-dist` and `pdf-lib` packages, not BentoPDF copies of their wrappers.

### REUSABLE BEHIND ADAPTER

These capabilities have credible implementations but must accept/return Nammu session data rather than owning a page, input, download, or global singleton:

- Page/document operations: merge, split, extract, delete, insert blank, reverse, rotate/custom rotate, organize/duplicate, alternate/mix, duplex collate, overlay, divide, N-up, booklet, posterize, combine to one page, fix page size and page labels.
- Document decoration: bookmarks, table of contents, page numbers, Bates numbering, watermark, header/footer and background.
- Metadata/structure: view/edit/remove metadata, attachments add/edit/extract, layers/OCG and ZIP export.
- Editing/commenting: general PDF editor, stamps, signatures, annotation removal and form fill.
- Image exports/imports: images/JPG/PNG/WebP/SVG/BMP/HEIC/TIFF to PDF; PDF to JPG/PNG/WebP/BMP/TIFF/CBZ.
- Text/data exports: PDF to text/Markdown/JSON/CSV and prepared-for-AI output.
- Security workflows: flatten, sanitize, protect/unlock/remove restrictions/change permissions, signature validation and timestamping, subject to exact underlying guarantees.
- Compare PDFs and OCR-assisted compare, behind an operation runner and result model.

### NEEDS REFACTOR

- Direct text editing (`edit-pdf-text`) and PDF editor canvas: useful behavior is tightly coupled to large DOM controllers/editor state.
- Form creator: field creation/extraction logic is valuable, but its drag/drop page controller must become canvas tools + contextual inspector state.
- Annotation/signature UIs: specialized editor/viewer surfaces need to bind to the active session and Nammu selection model.
- Multi Tool and Workflow Builder: operations can become commands; their current navigation/execution shells should not survive.
- Organizer, crop, bookmark editor and comparison UI: must become workspace panels or focused dialogs, not alternate uploaded-file pages.
- Undo/redo: Bento tool completion is file-output oriented; Nammu needs document-operation-aware history and honest non-undoable operations.

### DEPENDENCY-BOUND

- `bentopdf-pdfium` editcore: direct text/object editing; AGPL-3.0 and a dedicated WASM runtime.
- qpdf WASM: high-fidelity extraction/split/repair and structural preservation.
- PyMuPDF WASM: PDF-to-Word/SVG/text/Markdown, extraction, compression, deskew and ebook/XPS conversion; AGPL-3.0.
- Ghostscript WASM: PDF/A, outlining and production transforms; AGPL-3.0.
- CoherentPDF/CPDF: structural merge/split/bookmarks/TOC/JSON/attachments; AGPL-3.0.
- LibreOffice WASM: Word, Excel, PowerPoint, ODT/ODS/ODP/ODG, Pages, WPD/WPS/PUB/VSD/RTF and related conversion; large worker/runtime footprint.
- Tesseract: OCR/searchable PDF and OCR comparison; language data and worker assets must be locally planned.
- wasm-vips: raster/image production transforms.
- `zgapdfsigner`/node-forge: digital signature and validation, with certificate/key UX and security review required.

### NETWORK-ASSET DEPENDENT

These are not acceptable as silent Desktop assumptions:

- Default PyMuPDF, Ghostscript and CPDF URLs are configured through CDN/WASM-provider logic.
- Advanced script fonts map to `rawcdn.githack.com` unless bundled or replaced.
- Tesseract language/core assets depend on configuration and can require downloads.
- Timestamping deliberately contacts approved TSA endpoints; signing code also contains a CORS-proxy deployment path.
- Bento's production service worker and GitHub metadata request are website behaviors, not Nammu requirements.

The donor includes air-gap tarballs of about 40.4 MB (PyMuPDF) and 11.1 MB (Ghostscript), plus vendored archives of about 3.3 MB (PDFium editcore) and 2.2 MB (viewer). Their presence is evidence for future footprint analysis, not approval to ship them.

### LEGACY FOR NAMMU PDF

- The tool-grid home, marketing/SEO pages, static HTML entry points and “upload → process → download → return” flow.
- `src/js/state.ts` singleton and reset-on-tool-switch lifecycle.
- Per-page DOM bootstraps and controllers that assume globally named elements.
- Bento navigation, settings/service-worker/CDN UI, homepage cards, blog, deployment and commercial-site infrastructure.
- Separate pages for size presets or variants when one parameterized Nammu command is sufficient.

### NOT SUITABLE

- Iframing or running BentoPDF as a second site/app runtime.
- Copying AGPL Bento controllers into an otherwise differently licensed product without an explicit licensing decision.
- Loading executable WASM from public CDNs by default in Nammu Desktop.
- Exposing every donor feature as a menu item before its behavior is implemented.
- Treating visual redaction overlays as content-removing redaction, or presenting signatures/encryption with guarantees the engine does not provide.
- Building heavyweight editing, OCR, Office or production runtimes into P1 merely to increase feature count.

## License and dependency decision

| Item                                                  | Reported license                             | P1 status                                                         |
| ----------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------- |
| BentoPDF application 2.8.8                            | AGPL-3.0-only or separate commercial license | Audited only; no application code copied                          |
| `pdfjs-dist` 5.4.624                                  | Apache-2.0                                   | Added to Nammu; worker bundled locally                            |
| `pdf-lib` 1.17.1                                      | MIT                                          | Existing Nammu dependency; used through `pdfEngine.ts`            |
| `bentopdf-viewer` 2.9.1                               | MIT                                          | Candidate for later comparison; not shipped in P1                 |
| `bentopdf-pdfium`                                     | AGPL-3.0                                     | Not shipped; license/runtime gate                                 |
| PyMuPDF / Ghostscript / CPDF                          | AGPL-3.0 in donor documentation              | Not shipped; license and footprint gate                           |
| qpdf WASM, LibreOffice WASM, Tesseract, signing stack | Dependency-specific                          | Not shipped; later license, security and footprint audit required |

No legal conclusion is implied by this engineering inventory. A release that copies donor AGPL source or bundles additional engines needs an explicit product-license decision and notices review.

## P1 architecture

```text
Nammu Files / File picker
        ↓ typed PDF-only request
PdfApp workspace
        ↓
PdfDocumentSession[] ── active document tab
        ├── canonical bytes
        ├── PDF.js render document
        ├── metadata + page model
        ├── selection / active page
        ├── zoom / view / active tool
        ├── dirty state
        └── bounded operation history
        ↓
PdfCommandRegistry
        ↓
Pdf engine adapter (P1: PDF.js + pdf-lib)
        ↓
updated session or platform Save As
```

`PdfOperationRunner` is represented in P1 by one serialized busy operation and typed user-facing failure state. A queued/cancellable worker scheduler is intentionally deferred until a selected donor engine can truly report progress/cancel. P1 does not claim cancellation for synchronous `pdf-lib` work.

## P1 workspace and commands

Implemented shell:

- Software-style menu bar, document tabs, compact contextual toolbar and status bar.
- Multiple open document sessions with a single active tab.
- Stateful sessions remain mounted while the Nammu window is minimized and are destroyed on close.
- Pages thumbnail panel, high-DPI lazy canvas pages, continuous/single-page view.
- Contextual document/page inspector.
- Zoom in/out, actual size, fit width, fit page, page navigation, select and hand modes.
- Local text search with page results.
- Command palette backed by the same registry as menus and shortcuts.
- Responsive collapse for both side panels.
- Dirty-state tab marker and guarded close flow.

Real transformative commands in P1:

1. Rotate selected page left/right.
2. Delete selected page (never the final page).
3. Extract selected pages through Save As.
4. Insert all pages from another PDF after the selection.

Save is deliberately “Save As”, not an unsafe promise to overwrite a native source through a generic path API. Undo/redo snapshots are capped at five entries and 64 MiB total; documents larger than the byte budget remain editable but do not retain oversized history snapshots.

## Locality, memory and failure behavior

- PDF.js worker code is bundled from `pdfjs-dist`; P1 has no CDN or server processing dependency.
- PDF parsing disables JavaScript evaluation in PDF.js (`isEvalSupported: false`).
- Encrypted PDFs fail with an explicit P1 limitation instead of a broken workspace.
- Empty, corrupt, invalid-page and engine page-count disagreement paths fail closed.
- The canonical byte array is preserved because PDF.js may transfer its input buffer to its worker.
- A document normally has canonical bytes plus PDF.js internal/render state. A transform temporarily creates parser/output buffers. P1 avoids keeping multiple unbounded history copies.
- Opening several very large documents still scales memory with document count; future sessions should support file-backed/streaming sources before claiming 500 MB-class editing.
- Closing a document destroys its PDF.js worker document; unmount destroys all remaining sessions.

## Deferred legacy/tool-page capability

All BentoPDF features not listed as P1 commands remain donor capabilities only. Existing Nammu one-shot PDF tools also remain registered for compatibility; they were not rewritten or deleted. No Comment, Forms, Protect or Convert command is shown until a real adapter exists, preventing fake professional UI.

## Recommended P2

## P1 closure

P1 is **COMPLETE / LOCKED**. Managed Nammu window close requests are now intercepted when any PDF session is dirty. The scoped Nammu-native prompt lists affected documents and offers Save All As, Discard All, and Cancel. Browser/standalone unload also receives the platform-standard unsaved-work guard. No other Nammu application close policy is changed.

P2 implementation and the complete donor capability ledger live in `docs/nammu-pdf-p2-fidelity.md` and `docs/nammu-pdf-capability-migration.md`.
