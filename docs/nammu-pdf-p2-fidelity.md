# Nammu PDF P2 fidelity boundary

P2 deliberately retains the P1 `pdf-lib` adapter. It adds no BentoPDF code, qpdf, PDFium, PyMuPDF, WASM runtime, CDN dependency, or native permission.

`pdf-lib` is suitable for the P2 page-management slice, but a load/mutate/save cycle is not represented as semantically lossless for every PDF feature. Nammu inspects the document before mutation, blocks signed-document structural rewrites, and requires explicit acknowledgement for detected non-signature risks.

| PDF feature               | P2 classification            | Detection / behavior                                                                                             |
| ------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| AcroForms                 | NOT GUARANTEED               | `/AcroForm` is detected; warning before structural rewrite.                                                      |
| Digital signatures        | INVALIDATED BY DESIGN        | `/FT /Sig` is detected; structural page commands are disabled. Extraction remains non-destructive to the source. |
| Annotations               | NOT GUARANTEED               | Page `/Annots` entries are detected; warning before rewrite.                                                     |
| Bookmarks/outlines        | NOT GUARANTEED               | Catalog `/Outlines` is detected; destinations may become stale after page reorder/delete.                        |
| Attachments               | NOT GUARANTEED               | `/Names/EmbeddedFiles` is detected; warning before rewrite.                                                      |
| XFA                       | UNSUPPORTED                  | `/AcroForm/XFA` is detected; warned and not claimed as preserved.                                                |
| Incremental updates       | INVALIDATED BY DESIGN        | Multiple `startxref` sections are detected; save consolidates revision history.                                  |
| Encryption                | UNSUPPORTED                  | Encrypted/password PDFs are rejected by the existing typed open error path.                                      |
| Unusual object structures | NOT TESTED                   | Operation is transactional: transformed bytes must reload in both engines before replacing the valid session.    |
| Basic metadata            | PRESERVED BY CURRENT ADAPTER | Standard title/author/subject fields are loaded with metadata updates disabled.                                  |
| Extended XMP metadata     | NOT GUARANTEED               | Catalog `/Metadata` is detected; warning before rewrite.                                                         |
| Page labels               | NOT GUARANTEED               | Catalog `/PageLabels` is detected; labels may not follow reordered pages.                                        |

## Commit model

Selection is UI-only and never rewrites bytes. A structural command produces new bytes, reloads and validates them, and only then commits the new render proxy/session revision. Failure leaves the previous session and PDF.js proxy intact.

The first detected risky structural operation in a session opens a Nammu-native warning. A user may cancel without changing the document. Signed documents fail closed rather than asking the user to accept silent signature invalidation.

## Engine decision

P2 does not justify a new engine. qpdf could improve selected structural workflows and repair/encryption capability, but it would add a WASM asset, worker/packaging decisions, license review, and a second document mutation model. That evaluation remains attached to the relevant ledger rows. It is not required to deliver professional selection, block reorder, duplicate/delete/rotate, extraction, and insertion in P2.
