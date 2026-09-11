# Nammu PDF P6 — Protect & Redaction

P6 adds a document-centric Protect workspace without changing the locked P1–P5 session, command, Files, or native boundaries.

## Engine and license audit

- BentoPDF 2.8.8 is AGPL-3.0-only. Its controllers were audited but not copied.
- BentoPDF's redaction controller draws an opaque rectangle with pdf-lib. The original content remains recoverable, so Nammu rejects that implementation as redaction.
- `@neslinesli93/qpdf-wasm` 0.3.0 is an ISC wrapper around qpdf. Its package contains a 1,334,286-byte WASM asset (about 1.27 MiB) and a 43,376-byte loader. The upstream qpdf project is available under Apache-2.0 or Artistic License 2.0 terms; the wrapper is integrated independently and loaded only when encryption/decryption is requested.
- PyMuPDF, Ghostscript and the donor PDFium package remain unsuitable for P6: their donor paths are AGPL/license-bound, substantially larger, or network/runtime-bound. CPDF was not added. P6 adds exactly one engine.
- PDF.js remains the renderer/text-geometry source (Apache-2.0). pdf-lib remains the object writer (MIT).

## Architecture and guarantees

`DocumentSession.protection` owns bounded security inspection results, real pending `/Redact` annotations, and selection. `PdfCommandRegistry` owns every Protect action. The right inspector displays detected facts rather than a fabricated score.

Redaction is deliberately two-stage:

1. Mark creates a real `/Redact` annotation. Text selections retain quad geometry; region marks retain PDF coordinates.
2. Review keeps marks editable/removable and clearly pending. No source content changes.
3. Apply rasterizes only affected pages at 144 DPI into a new page image, paints the selected regions into pixels, copies unaffected pages, and verifies no pending marks remain before committing bytes.

This Apply mode removes the original content objects for affected pages, including text, image pixels and nested Form XObjects. Its explicit cost is loss of selectable text, forms, links, annotations, accessibility and vector fidelity on affected pages. It is never performed silently. The general BentoPDF Rasterize capability is not claimed.

Sanitization is scoped and transactional. It can remove:

- the Info dictionary and XMP metadata reference;
- Names/JavaScript, OpenAction, AA, and active JavaScript/Launch/remote/submit/import actions found within a bounded 100,000-object traversal;
- embedded-file name-tree references, FileAttachment annotations, FileSpec dictionaries and orphaned EmbeddedFile streams.

The output is re-inspected before it replaces session bytes. Failure retains the original document. This is not presented as complete malware cleaning.

Encryption creates a new Save As copy using qpdf AES-256. Open and owner passwords remain in password-input/operation memory only, are never persisted or logged by Nammu, and never cross the native/local-server boundary. The source session remains open and unchanged. Decryption is engine-tested but not exposed because the current locked session loader cannot represent an encrypted unopened document without a separate intake design.

Signed PDFs remain inspection-only. Redaction, sanitization and encryption controls fail closed because any rewrite would invalidate the signature. Signature presence is detected; certificate validation is not claimed.

## Runtime and performance

qpdf is lazy-loaded and does not affect Nammu or PDF startup. It runs synchronously inside its WASM call once invoked; the UI shows indeterminate busy state and does not claim cancellation or fake progress. A future worker boundary is appropriate if large-file measurements show visible blocking. Redaction rendering is deliberate page-local work, never pointer-move work.

Limits: 5,000 redaction marks, 2,048 Unicode code points per reason, 32,768 quad-point values, and 100,000 inspected indirect objects. Embedded scripts are treated as opaque hostile data and never executed.

## Known limitations

- Search-and-redact and mark move/resize are not complete.
- General annotation/form flattening is not complete and is not conflated with deletion or rasterization.
- Encrypted-document intake, remove-password and change-password UX remain gated by the current session loader.
- General permissions editing is not exposed yet.
- Sanitization does not claim removal of every external reference, layer, font, structure tree or hostile construct.
- Pending redaction marks are real PDF objects, but Apply is an explicit destructive raster workflow rather than content-operator surgery.
