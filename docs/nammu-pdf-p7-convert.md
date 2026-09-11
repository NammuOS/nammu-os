# Nammu PDF P7 — Convert & Export

P7 keeps the active `DocumentSession` central and replaces donor mini-sites with one Convert workspace, one command family, and one typed conversion service.

## Complete donor conversion inventory

The exact BentoPDF revision contains these conversion/resource rows in the authoritative 125-row ledger:

- Raster/page export: 071 PDF→BMP, 072 PDF→CBZ, 075 PDF→greyscale, 076 PDF→JPEG, 080 PDF→PNG, 081 PDF→SVG, 083 PDF→TIFF, 084 PDF→WebP.
- Text/data/document export: 073 PDF→CSV, 074 PDF→Excel, 077 PDF→JSON, 078 PDF→Markdown, 082 PDF→Text, 085 PDF→Word.
- Resource/derivative export: 037 Extract Attachments, 038 Extract Images, 039 Extract Pages, 040 Extract Tables, 091 Prepare for AI.
- Image creation: 010 BMP→PDF, 048 HEIC→PDF, 049 Images→PDF, 051 JPEG→PDF, 088 PNG→PDF, 093 PSD→PDF, 109 SVG→PDF, 112 TIFF→PDF, 120 WebP→PDF.
- Structured/text creation: 024 CSV→PDF, 052 JSON→PDF, 054 Markdown→PDF, 114 Text→PDF, 124 XML→PDF.
- Office/OpenDocument creation: 036 Excel→PDF, 059 ODG→PDF, 060 ODP→PDF, 061 ODS→PDF, 062 ODT→PDF, 067 Pages→PDF, 090 PowerPoint→PDF, 094 Publisher→PDF, 104 RTF→PDF, 118 Visio→PDF, 121 Word→PDF, 122 WPD→PDF, 123 WPS→PDF.
- E-book/archive/document creation: 012 CBZ→PDF, 034 Email→PDF, 035 EPUB→PDF, 041 FB2→PDF, 056 MOBI→PDF, 125 XPS→PDF.

No row is collapsed or removed. Extract Pages remains verified by P2 and the other rows retain their explicit ledger state.

## Engine and license matrix

| Capability group | Donor implementation | P7 decision | Fidelity |
| --- | --- | --- | --- |
| PDF→PNG/JPEG/WebP | PDF.js/canvas donor controllers (AGPL) | clean Nammu adapter using existing Apache-2.0 PDF.js and browser codecs | raster, visual fidelity |
| PDF→Text/JSON | PDF.js or PyMuPDF donor controllers | clean Nammu PDF.js text adapter | text extraction, best-effort reading order |
| PDF→Markdown | donor PyMuPDF/simple PDF.js implementations (AGPL) | clean local heuristic over PDF.js | best effort, not semantic reconstruction |
| PNG/JPEG/WebP→PDF | donor controllers plus pdf-lib/PyMuPDF | clean Nammu adapter using existing MIT pdf-lib and browser WebP decode | visual/image preserving, image-only PDF pages |
| Multi-file archive | donor JSZip | lazy `fflate` 0.8.3 (MIT), already present transitively and now declared directly | lossless packaging |
| PDF→SVG/TIFF/BMP/CBZ | PyMuPDF/wasm-vips/canvas/ZIP | retained as engine-ready, adapter-required, or runtime-blocked per exact row | not claimed by P7 |
| Office/OpenDocument | LibreOffice WASM, approximately 75 MB in donor configuration | rejected for P7 pending a dedicated footprint/font/worker decision | potentially structure preserving but format-dependent |
| Native resource/table extraction | PyMuPDF WASM plus XLSX | retained behind runtime/adapter gates | not conflated with page rendering/text extraction |
| E-book/PSD/XPS | PyMuPDF or format-specific parser | retained behind explicit runtime gates | not claimed |

BentoPDF 2.8.8 application/controller code is AGPL and was audited but not copied. P7 adds no PyMuPDF, Ghostscript, PDFium, LibreOffice, wasm-vips, Tesseract, or CPDF runtime.

## Architecture

`DocumentSession.conversion` owns options and operation status. `PdfCommandRegistry` owns workspace selection, six PDF export commands, and Images-to-PDF. `pdfConversion.ts` owns page-scope resolution, text extraction, raster export, archive creation, and image import. React controls do not implement converters.

Outputs are typed as:

- `single-file`
- `multi-file` (saved as ZIP)
- `new-document` (opened as a dirty Nammu PDF tab)

The page scope reuses P2 selection: all, current, or selected pages. The renderer processes one page at a time, reports completed stages, releases page/canvas resources, caps a page at 100 million pixels, and caps a job at 5,000 pages. Cancellation is checked between stages and is explicitly labelled “after current stage”; an active PDF.js canvas render is not falsely advertised as interruptible.

## Product behavior

- PDF→PNG/JPEG/WebP supports 96, 144, and 300 DPI. JPEG/WebP expose real codec quality. Multi-page output becomes one ZIP.
- PDF→Text uses deterministic page separators.
- PDF→Markdown uses page headings and separators and is labelled BEST_EFFORT.
- PDF→JSON emits a versioned `{ version, pages[] }` structure.
- Images→PDF opens a review sheet with reordering, image/A4/Letter page sizing, automatic/portrait/landscape orientation, fit/fill placement, and none/narrow/standard margins. It opens the result as a new unsaved `DocumentSession` rather than forcing a download.
- Desktop and Web both save through `platform.files`; no arbitrary native filesystem access was introduced.

Scanned pages are not silently OCRed. RGB canvas rendering does not preserve CMYK. SVG is not misrepresented as vector output. Native embedded-image extraction is not conflated with rendering pages. Office conversions and font packs were not added.

## Security and memory

PDF JavaScript and actions remain disabled by the existing renderer settings. Conversion does not execute source scripts, Office macros, HTML, or external URLs. Image inputs are bounded and only PNG/JPEG/WebP enter the implemented pipeline. Output names are normalized. Large raster jobs run sequentially rather than retaining every rendered page canvas; resulting artifacts remain until save/archive completion and then become collectible. No new native or network permission exists.

## Runtime footprint

No heavyweight runtime was added. The only direct dependency addition is `fflate` 0.8.3 (MIT), lazy-imported only for multi-file ZIP output. Existing PDF.js/pdf-lib chunks remain shared. Browser-native JPEG/WebP codecs add no shipped binary asset.

## Verification

- PDF text is independently extracted from a two-page fixture; text/Markdown/JSON serialization is validated.
- PNG and JPEG inputs create an ordered real PDF independently reopened through pdf-lib.
- Rendered Edge smoke exports PNG/JPEG/WebP and checks their actual file signatures.
- Rendered Edge smoke feeds those three artifacts back into Images-to-PDF, saves the result, and independently reopens a three-page PDF.
- Page scope, ZIP contents, invalid/empty image inputs, command uniqueness, and ledger completeness are covered by tests.

## Remaining conversion limits

PDF→Markdown does not recover document semantics or tables. There is no OCR fallback in P7. Image-created pages use pixel dimensions as PDF points when “Image size” is selected; physical DPI metadata is not inferred. Batch conversion is represented by bounded sequential page work, not a persistent cross-document job manager. Heavy Office and format-specific runtimes remain deliberately deferred.
