# Nammu PDF P4 — Forms workspace

P1–P3 remain locked. P4 extends the existing `DocumentSession`, `PdfCommandRegistry`, page canvas and bounded history. It adds no route, native subsystem, server, Tauri permission, dependency or alternative document store.

## Annotation/form engine audit

BentoPDF contains two form capability pages:

| Donor surface                       | Actual implementation                                                                                                                                       | License/runtime result                                                                                                                     | P4 decision                                                                                                                              |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Form Creator (`form-creator.ts`)    | Large DOM controller over pdf-lib; supports text, checkbox, radio, dropdown, list box, buttons, signatures and several JavaScript-driven pseudo-field types | Controller/UI is AGPL-3.0-only. pdf-lib is MIT and already installed/local. Date, image and show/hide/print actions inject PDF JavaScript. | No donor controller or UI was copied. Nammu uses a clean adapter over public pdf-lib AcroForm APIs and never authors JavaScript actions. |
| Form Filler (`form-filler-page.ts`) | Loads a separate customized PDF.js viewer in an iframe and delegates saving to that viewer                                                                  | Controller is AGPL. The fragmented iframe/tool-page product model conflicts with Nammu's authoritative DocumentSession.                    | Not embedded. Nammu renders and fills supported widgets inside the persistent workspace.                                                 |
| Bento field extraction              | Maps pdf-lib terminal fields and widgets into page geometry                                                                                                 | AGPL donor implementation; useful for behavioral audit only                                                                                | Reimplemented independently as a typed logical-field/widget model.                                                                       |
| pdf-lib 1.17.1                      | Public creation/value/property APIs plus widget dictionaries                                                                                                | MIT, existing dependency, fully local                                                                                                      | Authoritative form mutation engine.                                                                                                      |
| PDF.js 5.4.624                      | Renders widget appearances and exposes independent Widget annotations                                                                                       | Apache-2.0, existing local worker                                                                                                          | Page rendering and independent interoperability verification. No embedded action execution.                                              |

No BentoPDF source is imported by Nammu at runtime. No new WASM/CDN asset or package was added.

## Architecture

```text
DocumentSession bytes (authoritative)
  ├─ PDF.js render document
  │    └─ page canvas + safe interactive field controls
  ├─ bounded PdfFormModel
  │    └─ logical field → one or more page widgets
  └─ PdfCommandRegistry
       └─ typed Forms command
            └─ pdf-lib AcroForm adapter
                 └─ updated bytes
                      └─ normal reload/history/dirty flow
```

React does not maintain a second form document. The normalized model is rebuilt from saved PDF bytes after every command. A radio group is one logical field with multiple widgets and mutually exclusive export values. Widget identity is separate from logical-field identity, so navigation/properties operate on the field while move/resize targets one widget.

## Workspace and commands

`Forms` is a workspace beside Read, Organize and Comment. The same document remains open.

- The compact toolbar activates Select, Text Field, Checkbox, Radio Group, Dropdown and List Box commands.
- The left panel lists logical fields and navigates to their first widget.
- The center canvas supports field placement, selection, one-operation move and one-operation resize.
- The right inspector exposes only applicable value, name, tooltip, required/read-only, multiline, maximum length, alignment and choice options.
- Read workspace exposes safe controls for filling supported existing AcroForms without entering authoring mode.
- Forms menu, toolbar, command palette and keyboard handling share the same registry entries. Payload-only create/update commands remain hidden from ordinary discovery.

Creation, filling, property edits, move/resize, duplication and deletion each commit one document operation. Pointer movement is transient UI; one completed gesture produces one bounded history entry. The existing dirty marker and close protection cover form changes automatically.

## Interoperability classification

| Field type                 | P4 classification       | Behavior                                                                                                                                             |
| -------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Text                       | `REAL_ACROFORM`         | Create, fill, rename, tooltip, required/read-only, multiline, maximum length, alignment, move/resize, duplicate and delete                           |
| Checkbox                   | `REAL_ACROFORM`         | Create, check/uncheck, properties, move/resize, duplicate and delete                                                                                 |
| Radio group                | `REAL_ACROFORM`         | New groups contain two real option widgets; mutually exclusive value persists; existing multi-widget groups remain logical groups                    |
| Dropdown/combo             | `REAL_ACROFORM`         | Create, replace bounded options, select, properties and geometry                                                                                     |
| List box                   | `REAL_ACROFORM`         | Create, replace bounded options, select and fill multiple selections in Read workspace                                                               |
| Push button                | `READ_ONLY_EXISTING`    | Preserved and listed. Actions are never executed. P4 does not author unsafe URL/print/JavaScript behavior.                                           |
| Signature field            | `READ_ONLY_EXISTING`    | Existing placeholders are inspectable and preserved. P4 does not create signatures or imply cryptographic signing.                                   |
| Unsupported terminal field | `READ_ONLY_EXISTING`    | Preserved without destructive reinterpretation.                                                                                                      |
| XFA                        | `UNSUPPORTED_READ_ONLY` | Raw XFA presence is detected before pdf-lib can remove it from its in-memory form facade. Source bytes remain untouched; form mutations fail closed. |

P4 adds no workspace-only fake form fields and never flattens forms implicitly.

## Safety and fidelity

- The engine independently rejects mutations when raw XFA is present or any `/FT /Sig` dictionary exists, even if UI checks are bypassed.
- Hybrid/XFA documents remain read-only and their bytes are preserved.
- Action-bearing fields (`/A` or `/AA` on the field/widget) are listed but not editable. Nammu never evaluates PDF JavaScript, calculations, submit/reset actions or arbitrary URLs.
- Field content is rendered by React as text/control values, never injected as HTML. Control characters are removed and text/options/counts are bounded.
- Choice fields must retain an option. Field names are bounded and unique; inherited names can be renamed within their existing hierarchy, while hierarchy moves fail closed.
- Existing unknown annotations and non-form objects remain in the PDF; Forms does not flatten or remove them.
- Full-file pdf-lib saves can invalidate signatures, so signed-document form mutations fail closed under the existing fidelity policy.

## Performance and memory

- Form presentation is capped at 10,000 logical fields, 2,000 options per choice field and 16,384 characters per text value.
- Page overlays render only widgets belonging to that page; continuous page rendering remains lazy.
- Pointer move/resize previews do not serialize bytes. Only pointer-up commits a form command.
- Mutations currently perform one full pdf-lib save and one normal PDF.js/session reload. This preserves one truth and bounded undo but is not incremental PDF saving.
- No new runtime, worker, native binary or dependency increases the desktop footprint.

## Verification

Focused tests cover:

- real creation of all five P4 field types;
- logical radio group with two widget annotations;
- value/property/geometry save and reload;
- independent PDF.js recognition of Widget annotations and persisted text values;
- duplicate naming and field deletion;
- inherited-field rename without flattening or moving the hierarchy;
- XFA/hybrid detection and mutation rejection;
- action-bearing field preservation/read-only classification;
- signed-document engine rejection;
- command uniqueness and deny-without-document behavior;
- permanent 125-row capability accounting.

Rendered-browser smoke opens a real PDF, enters Forms, places a text field on the page, observes modified state and returns to Read with an interactive control. Since P4 changes no native/platform boundary, Tauri and NSIS rebuilding are intentionally outside this phase.

## Known limitations

- XFA rendering/filling is not supported and remains explicitly read-only.
- Existing button/signature fields are preserved but not authored.
- PDF JavaScript, calculations, validation expressions, submit/reset actions and external action execution are deliberately unavailable.
- Radio option restructuring and adding/removing individual widgets are not yet exposed in the inspector.
- Cross-page widget movement is not exposed; geometry changes remain on the widget's current page.
- Saving uses a full rewrite rather than incremental updates.
