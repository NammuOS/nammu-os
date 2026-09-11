# Nammu PDF P5 — Advanced Editing Workspace

## Engine and license decision

BentoPDF's complete editor is built around `bentopdf-pdfium`, `editcore.wasm`, and EditCore controllers. The donor application and packaged PDFium editor are AGPL-3.0-only. Nammu therefore does not copy, import, iframe, or redistribute those controllers or that runtime.

P5 uses only Nammu's existing local dependencies:

- PDF.js (Apache-2.0) for independent rendering/text extraction.
- pdf-lib (MIT) for parsing, resource embedding, and standards-compliant PDF content streams.
- Original Nammu TypeScript for the session, command, model, and UI adapters.

No dependency, remote asset, server route, native permission, or Tauri capability was added.

## Product architecture

The existing `DocumentSession` remains authoritative. P5 extends it with one content-edit model containing stable descriptors for Nammu-authored content. It does not create a second document or an overlay-only save format.

```text
Edit workspace / menu / command palette
  → PdfCommandRegistry (`content.*`)
  → pdfContentEditing adapter
  → tagged real PDF page content stream
  → reload through DocumentSession
  → PDF.js canvas
```

Each authored object is stored in its own PDF content stream. The stream paints real text or an image XObject and carries bounded Nammu metadata (`NammuEditId`, `NammuEditData`). That identity makes the exact stream editable after save/reopen. Unknown/malformed metadata is ignored without removing the underlying stream.

## Implemented P5 slice

- Persistent Edit workspace in the existing Nammu PDF shell.
- Add real text by selecting Text and clicking a page.
- Add real embedded PNG/JPEG content through the platform file picker.
- Select Nammu-authored content directly on the page or from the inspector.
- Move content by dragging once per committed gesture.
- Edit position, dimensions, rotation, opacity, text, font size, and text color.
- Replace an authored image without changing its geometry.
- Delete authored content.
- Save/reload discovery through stable content-stream identity.
- Existing bounded byte-history undo/redo and dirty-close behavior.
- Signed-document fail-closed gate in both UI and engine boundary.
- Command-registry availability for toolbar, menu, palette, and shortcuts.

Text and image objects are real page content, not annotations, form widgets, DOM overlays, or flattened screenshots.

## Honest capability boundary

Arbitrary content already present in an external PDF is preserved and rendered, but is inspection-only in P5. Reliably rewriting arbitrary text operators, font encodings, clipping paths, nested Form XObjects, transparency groups, and reflow requires a compatible object-editing engine. BentoPDF's donor implementation cannot be used under the current license boundary. P5 never labels React selection rectangles as content editing.

Standard Helvetica authoring is WinAnsi-only. Unsupported Unicode input fails before serialization instead of substituting characters. A future Unicode-font phase should bundle/subset an approved local font rather than fetch one from a CDN.

## Fidelity and safety

- Signature fields block all content mutations at the adapter boundary.
- Existing annotations and AcroForm fields are preserved by focused regression tests.
- Content metadata is parsed as untrusted JSON, bounded, normalized, and never injected as HTML.
- JavaScript/actions in PDFs are never executed by this adapter.
- Image input is limited to PNG/JPEG decoding by pdf-lib.
- Full-document byte snapshots remain bounded by the existing five-entry/64 MiB history policy; pointer motion does not serialize intermediate PDF versions.
- Large documents keep one canonical session byte array plus bounded history; operations still require a pdf-lib rewrite and are therefore queued through the existing busy state.

## Runtime classification

P5 is fully local in Web and Desktop. Desktop uses the existing native picker adapter; Web uses the browser picker fallback. All rendering, embedding, serialization, and reload behavior is local. There are no CDN/WASM/network requirements introduced by P5.
