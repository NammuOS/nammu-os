# Nammu PDF P8 — OCR and searchable documents

## Scope and donor audit

The authoritative BentoPDF revision exposes one standalone OCR capability: ledger row 058, **OCR PDF** (`src/pages/ocr-pdf.html`, `src/js/logic/ocr-pdf-page.ts`, and `src/js/utils/ocr.ts`). Row 015, Compare PDFs, has optional OCR hooks but remains a separate comparison capability. No separate Image to Text or Make Searchable PDF page exists in the 125-page donor inventory.

The donor uses Tesseract.js 7, PDF.js 5.4.624, pdf-lib 1.17.1, `@pdf-lib/fontkit` 1.1.1, configurable traineddata, PDF page rasterization, optional binarization and invisible word placement. Its application/controller and hOCR transformation code is AGPL-3.0-only and was audited but not copied. Nammu implements an original adapter over the independently licensed upstream engines.

Donor options not claimed by P8 are multi-language selection, arbitrary character whitelists, full-font embedding and orientation/deskew correction as standalone commands. P8 provides English, bounded balanced/high-accuracy rendering, optional deterministic binarization, page scope, force OCR, confidence/results, text export and searchable-copy generation.

## Engine, license, and local assets

| Component | Version / license | Role | Runtime behavior |
| --- | --- | --- | --- |
| Tesseract.js | 7.0.0 / Apache-2.0 | worker orchestration and OCR API | dynamically imported only when OCR runs |
| tesseract.js-core | 7.0.0 / Apache-2.0 | SIMD LSTM WASM recognizer | bundled under `/ocr/tesseract/` |
| English traineddata | vendored from `@tesseract.js-data/eng` 1.0.0 / MIT | English recognition model | bundled uncompressed under `/ocr/tesseract/lang/`; the source package is not retained as a production dependency |
| PDF.js | existing project dependency / Apache-2.0 | page inspection, raster input, independent output verification | existing shared PDF engine |
| pdf-lib | existing project dependency / MIT | clone source and append the real PDF text layer | existing shared PDF engine |
| `@pdf-lib/fontkit` | 1.1.1 / MIT | subsettable Unicode font embedding | dynamically imported for searchable-copy creation |
| Liberation Sans Regular | SIL OFL 1.1 | compact embedded OCR text font | locally bundled and subset per output PDF |

Production OCR makes no public-CDN request. Worker JS, core glue/WASM, English data and font URLs are created from the current same-origin `/ocr/` root. Opening Nammu PDF, reading a normal PDF, or entering another workspace does not import Tesseract or initialize a worker.

English is the only P8 bundled language. Other languages are intentionally absent from the UI until their traineddata and compatible font assets are explicitly packaged and licensed. P8 does not pretend unavailable languages work offline.

The final local OCR asset set is 12,223,526 bytes (11.66 MiB): English traineddata 5,199,098 bytes, SIMD core JS 3,899,472 bytes, SIMD core WASM 2,857,601 bytes, worker JS 111,307 bytes, font 139,512 bytes, and license/source notices. The P8 desktop PDF application chunk is 205.58 kB / 56.23 kB gzip versus the P7 188.49 kB / 51.61 kB gzip baseline. Tesseract's lazy wrapper chunk is 15.90 kB / 6.87 kB gzip; the lazy fontkit chunk is 716.90 kB / 329.81 kB gzip. No additional language pack, native DLL, Rust module, or Tauri permission was added.

## Architecture

`PdfOcrService` is represented by the typed functions and models in `pdfOcr.ts` and `ocrModel.ts`:

1. `resolvePdfPageScope` reuses P2 current/selected/all semantics.
2. PDF.js classifies each page as text-present, mixed, image-only, or unknown.
3. Text-present and mixed pages are skipped unless Force OCR is selected.
4. Eligible pages are rendered sequentially at 144 DPI (Balanced) or 216 DPI (High accuracy).
5. One local Tesseract worker is created for a job, reused across its pages, and terminated on success, cancellation, failure, or app teardown.
6. Engine output is normalized to bounded page/line/word text, confidence, and PDF user-space geometry.
7. Searchable Copy clones the original PDF, embeds a subset font, and adds word-positioned text with PDF text rendering mode 3 (invisible).
8. The result opens as a new dirty `DocumentSession`; the source remains unchanged.

Commands are registered once in `PdfCommandRegistry`: `ocr.recognizePages`, `ocr.makeSearchable`, `ocr.exportText`, `ocr.cancel`, and `ocr.clearResults`. The OCR workspace, toolbar, Tools menu, and command palette reuse these commands.

## Geometry and persistence

Tesseract bitmap boxes are converted with PDF.js `PageViewport.convertToPdfPoint` at all four corners. The resulting min/max PDF coordinates account for render scale and page rotation without assuming a top-left PDF origin. Non-standard page sizes are retained because searchable-copy generation modifies the existing page rather than recreating it.

The generated layer uses real PDF text operators with rendering mode 3, word-level placement, and a subset embedded font. It is not an HTML overlay, sidecar JSON object, white text, or raster replacement. Independent PDF.js reopen/extraction proves the known OCR string remains in saved bytes. Rendered acceptance compares the source scan canvas with the searchable-copy canvas and requires visual equality.

Searchable-copy generation preserves the source page streams and therefore retains existing annotations, AcroForm fields, P5 Nammu-authored content, metadata, and attachments in focused tests. It does not reuse P6 security rasterization. Unknown structures remain subject to the established PDF fidelity model.

Digitally signed PDFs may be inspected and recognized, but the engine rejects searchable-layer mutation because it invalidates signatures. Encrypted documents must already have passed the existing P6 open/decryption boundary; OCR has no password channel and logs no document content.

## Conversion and search integration

P7 Text and best-effort Markdown exports use explicit session OCR results only when the selected scanned page has no normal extractable text. Export never starts OCR implicitly. After Searchable Copy, the existing PDF Find implementation reads the persisted PDF text layer; it does not rely on the source session's OCR JSON.

P8 text export is a typed local artifact. No additional image-OCR capability is claimed because the donor inventory has no such standalone row.

## Safety and lifecycle

- Maximum 500 pages per OCR job.
- Maximum 40,000,000 rendered pixels per page.
- Maximum 50,000 normalized words per page.
- Maximum 5,000,000 normalized OCR characters per document.
- Control/format characters are stripped; UI renders OCR output as React text, never HTML.
- Pages render sequentially; no unbounded canvas fan-out occurs.
- One worker exists per active OCR job and is terminated in `finally`; Abort also requests immediate termination.
- Cancellation never commits a partial searchable PDF as success.
- OCR does not evaluate PDF JavaScript, follow recognized links, upload pages, or execute recognized content.

## P8 acceptance

Focused tests cover local URLs, page classification, rotated coordinate mapping, real invisible text persistence, independent PDF.js extraction, annotation/form/P5 content/metadata/attachment preservation, signed-file rejection, cancellation, malformed references, missing assets, untrusted control text, and P7 Text/Markdown fallback.

The rendered Chromium smoke creates a real image-only PDF, opens it through Nammu PDF, invokes the local worker, recognizes a deterministic sentence, creates a new searchable session, exercises the existing Find UI, saves the result, independently extracts the known word through PDF.js, compares visible page rendering, and rejects browser exceptions.

On the final local Windows acceptance fixture, one scanned page completed recognition in 1,031 ms. A ten-page scanned document completed in 4,291 ms after normal shell startup, and searchable-copy construction took 412 ms. The ten-page run used one worker, then terminated it. Source/output page-one rendering had a changed-pixel fraction of 0 and mean channel difference of 0. These deterministic clean-print fixtures validate the pipeline and lifecycle, not universal OCR accuracy. Browser APIs do not expose a trustworthy cross-worker peak-memory figure, so P8 does not invent one; the implementation bounds canvas pixels/results and retains no worker after the job.

P8 moves only exact ledger row 058 to `VERIFIED`. Capability coverage becomes 20/125 with `UNACCOUNTED` remaining zero.
