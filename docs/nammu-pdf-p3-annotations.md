# Nammu PDF P3 — Comment and annotation architecture

P1 and P2 remain locked. P3 extends the existing `DocumentSession`, command registry and PDF adapter; it does not introduce another document store, route, native subsystem or editor runtime.

## Donor and engine audit

The BentoPDF revision in this workspace exposes annotation behavior through four materially different paths:

| Donor surface                                     | Actual implementation                                                                                                          | License/runtime finding                                                                                                                                                | P3 decision                                                                                                                                  |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| PDF Editor (`edit-pdf-page.ts`)                   | `bentopdf-viewer` plus `bentopdf-pdfium/editcore.wasm`; annotation plugin, comment/property panels and document export         | BentoPDF controller is AGPL-3.0-only. The packaged viewer declares MIT, but EditCore/PDFium is AGPL-3.0 and the editor path is engine-bound.                           | Product behavior was studied; no controller, PDFium WASM or donor UI was copied or shipped. The composite ledger row remains `IN_PROGRESS`.  |
| Add Stamps (`add-stamps.ts`)                      | Customized PDF.js viewer/annotation extension hosted in an iframe, with PDF.js annotation storage/export                       | Controller is AGPL and depends on a parallel full-viewer application.                                                                                                  | Existing stamps are rendered/preserved read-only. Stamp authoring is not falsely claimed in P3.                                              |
| Sign PDF (`sign-pdf-page.ts`)                     | PDF.js annotation editor/storage and `saveDocument`, optionally followed by flattening                                         | Controller is AGPL; appearance signing and flattening are mixed into a separate viewer workflow.                                                                       | Not embedded. Visual signatures remain separate from cryptographic signatures and are not claimed in P3.                                     |
| Remove Annotations (`remove-annotations-page.ts`) | Deletes every page `Annots` entry using pdf-lib                                                                                | Donor controller is AGPL; pdf-lib is MIT. The donor implementation also destroys form widgets because widgets share `Annots`.                                          | Reimplemented as a clean audited adapter that removes annotations/links while retaining `/Widget` entries.                                   |
| PDF.js 5.4.624                                    | Canvas rendering, text layer, `getAnnotations`, annotation storage and built-in FreeText/Highlight/Stamp/Ink/Signature editors | Apache-2.0, already installed, local worker. Full editor use requires UI-manager/layer lifecycle and still does not cover the requested underline/strikeout/shape set. | Retained for rendering, text geometry and independent reload inspection. The full PDF.js viewer/editor shell is not duplicated inside Nammu. |
| pdf-lib 1.17.1                                    | Low-level PDF dictionaries, indirect references, streams and document save                                                     | MIT, already installed, fully local. High-level APIs do not author general annotations.                                                                                | A focused low-level annotation adapter writes standards-level annotation objects and appearance streams.                                     |

The vendored viewer exposes annotation and comment/property components, but adopting its full container would create a second document manager and UI source of truth inside Nammu PDF. P3 instead retains Nammu's persistent workstation and only uses compatible upstream engines already in the application.

No dependency was added. No CDN, network request, Tauri permission, Rust command, filesystem change or BentoPDF runtime asset is required by P3.

## Authoritative architecture

```text
DocumentSession bytes
  ├─ PDF.js document
  │    ├─ page canvas
  │    ├─ selectable text layer → PDF quad geometry
  │    └─ getAnnotations() → safe annotation model/comments panel
  └─ PdfCommandRegistry
       └─ annotation command
            └─ pdf-lib annotation adapter
                 └─ updated bytes
                      └─ normal DocumentSession reload/history/dirty flow
```

The persisted PDF bytes are authoritative. React stores a normalized, bounded view of annotations for selection and presentation, then rebuilds it from PDF.js after every committed mutation. There is no second annotation document and no separate undo stack.

One ink gesture produces one command after pointer-up. Pointer movement changes only a local preview; it does not serialize PDF bytes or append history. Create, update, delete and remove-all each create one existing bounded-history entry and naturally trigger P1 dirty-close protection.

## Comment workspace

`Comment` is a workspace mode beside Read and Organize. It keeps the same active `DocumentSession`, tabs, canvas and page navigation while exposing:

- compact command-backed toolbar;
- selectable PDF text layer;
- page-local placement/drawing overlay;
- annotation hit/selection layer over PDF.js rendering;
- contextual annotation properties;
- ordered comments list with previous/next navigation;
- page and annotation state in the existing status bar.

The Comment menu, toolbar, command palette and shortcuts use the same `PdfCommandRegistry` entries. Internal `comment.create` and `comment.update` commands accept typed payloads and are hidden from menu/palette discovery when no payload exists.

## Real PDF annotation classification

| P3 type          | Classification                 | PDF subtype/data                                                     | Persistence                                                                                                     |
| ---------------- | ------------------------------ | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Highlight        | `REAL_PDF_ANNOTATION`          | `/Highlight`, `/QuadPoints`, `/AP`                                   | Serialized and independently re-read by PDF.js. Multi-line selections retain one quad per line fragment.        |
| Underline        | `REAL_PDF_ANNOTATION`          | `/Underline`, `/QuadPoints`, `/AP`                                   | Serialized and re-read.                                                                                         |
| Strikethrough    | `REAL_PDF_ANNOTATION`          | `/StrikeOut`, `/QuadPoints`, `/AP`                                   | Serialized and re-read.                                                                                         |
| Sticky note      | `REAL_PDF_ANNOTATION`          | `/Text`, `/Name /Comment`, `/Contents`, `/T`                         | Comment, author and dates persist. Reader supplies the standard note appearance.                                |
| Text box         | `REAL_PDF_ANNOTATION`          | `/FreeText`, `/DA`, `/Q`, embedded Helvetica appearance              | Content, font size/color and author persist. P3 deliberately does not implement text reflow/desktop publishing. |
| Freehand         | `REAL_PDF_ANNOTATION`          | `/Ink`, `/InkList`, `/AP`                                            | A normalized completed stroke is committed once.                                                                |
| Line             | `REAL_PDF_ANNOTATION`          | `/Line`, `/L`, `/LE`, `/AP`                                          | Serialized and re-read.                                                                                         |
| Arrow            | `REAL_PDF_ANNOTATION`          | `/Line`, `/L`, `/LE [ /None /OpenArrow ]`, `/AP`                     | Serialized and normalized back to the Arrow tool.                                                               |
| Rectangle        | `REAL_PDF_ANNOTATION`          | `/Square`, `/IC`, border style, `/AP`                                | Stroke/fill/width/opacity persist.                                                                              |
| Ellipse          | `REAL_PDF_ANNOTATION`          | `/Circle`, `/IC`, border style, `/AP`                                | Stroke/fill/width/opacity persist.                                                                              |
| Polygon/polyline | `UNSUPPORTED` for P3 authoring | Existing objects are preserved; normalized model support is reserved | The low-level model recognizes them, but P3 does not expose incomplete authoring/manipulation UI.               |
| Stamp            | `UNSUPPORTED` for P3 authoring | Existing `/Stamp` renders through PDF.js and is preserved read-only  | Image stamp import/move/resize remains ledger row 004.                                                          |
| Visual signature | `UNSUPPORTED`                  | Not conflated with Ink or certificate signing                        | Ledger row 107 remains pending.                                                                                 |

Nothing is persisted as a Nammu-only visual overlay. Gesture previews and selection outlines are transient workspace UI only and cannot be mistaken for saved annotations.

## Existing annotations and editing

PDF.js supplies stable indirect-reference identities where available. Supported standard annotations with a stable reference can be selected, have comment/author/appearance updated, or be deleted. Stamps, visual signatures and unknown subtypes are preserved read-only because regenerating their appearances could destroy content Nammu does not understand.

Unknown annotations remain in the source bytes during normal P3 edits. Their contents and author values are treated as untrusted plain text; no rich-text HTML, annotation JavaScript, embedded action or external URL is executed. React renders strings as text and the adapter strips disallowed control characters and applies bounded lengths/array counts.

`Remove All Annotations` is an explicit destructive command. It removes page annotations (including links) but preserves AcroForm `/Widget` objects. It is never run automatically and normal bounded undo remains available before the session is saved or closed.

Move/resize handles are not exposed in P3. The current adapter can safely change non-geometric appearance/content without inventing a partially synchronized drag system. Geometry manipulation remains an explicit later refinement rather than a visual-only promise.

## Fidelity and signature policy

The adapter independently scans for `/FT /Sig` and rejects creation, editing, deletion and remove-all even if a UI check were bypassed. The registry also disables annotation mutation on signed documents. This is conservative because any full-file save can invalidate an existing digital signature.

Annotation mutations preserve page order, unknown indirect objects and existing annotations. Complex documents still receive the existing first-mutation fidelity review for applicable full-save risks such as forms, XFA, incremental-update history and extended metadata. P3 does not automatically flatten any annotation; flattening remains ledger row 043.

## Performance and memory

- PDF.js annotations are read in bounded batches of eight pages with a hard session presentation limit of 10,000 annotations.
- Continuous view remains lazy: only pages near the viewport paint canvases/text layers.
- Pointer moves update only the active gesture preview; PDF serialization happens once on commit.
- Annotation mutations currently perform one full pdf-lib save and one DocumentSession/PDF.js reload. This preserves a single truth and bounded history but is not an incremental-save implementation.
- Text and numeric-array normalization are bounded. Annotation text is capped at 16,384 characters.
- P3 adds no WASM/native runtime and no duplicate PDF engine.

## Verification scope

Focused coverage proves:

- PDF.js independently recognizes all ten authored standard subtypes after save/reload;
- multi-line text selection produces canonical 16-value quad geometry for two lines;
- sticky note content/author and FreeText/Ink/Line/Arrow/Square/Circle persistence;
- stable-reference edit and delete while an unrelated Link annotation survives;
- remove-all preserves an AcroForm widget;
- malformed/untrusted metadata normalization is bounded and plain-text only;
- signed-document mutation fails closed;
- command uniqueness/availability and the permanent 125-row ledger remain guarded.

Rendered browser smoke validates the actual workspace separately from engine tests. P3 does not require a Tauri/NSIS rebuild because no native or platform boundary changed.

## Known P3 limitations

- Annotation replies/threaded review, XFDF/FDF import/export and comment summaries are not implemented.
- Stamp, visual-signature and polygon/polyline authoring are not implemented.
- Existing complex annotation appearance streams are preserved but not regenerated unless the subtype is in the editable standard subset.
- Geometry move/resize is deferred.
- FreeText uses a conservative standard-font appearance; full Unicode/system-font embedding belongs with Advanced Editing.
- Saving uses a full document rewrite rather than incremental update.
