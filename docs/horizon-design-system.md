# Horizon design system

Horizon is the default NammuOS visual system. It adapts the licensed desktop design foundation in
the local `umbrel/` donor checkout to Nammu's existing React window manager, applications, platform
services, and web/desktop runtimes. Horizon is a Nammu product name; the donor project is not
embedded or launched as a separate runtime.

## Design rules

- Inter Variable is the primary interface face, bundled locally for offline desktop startup.
- The default desktop uses the licensed atmospheric wallpaper 23 and its warm orange accent.
- Windows use a 40 px material recipe where space permits: black tint, 40 px blur, 150% saturation,
  70% brightness, a half-pixel edge, subtle inset highlights, and a deep soft shadow.
- Menus, popovers, and dialogs use 20–24 px radii with a lighter 20 px blur material.
- Controls are compact, pill-shaped, and use translucent fills with inset highlights.
- The taskbar is presented as a floating dock without replacing Nammu's taskbar behavior, ordering,
  system tray, or React-managed application lifecycle.
- Reduced-transparency and unsupported-backdrop-filter fallbacks use opaque materials.
- Motion is limited to compositor-friendly opacity and transform transitions and respects the
  existing reduced-motion setting.

## Theme and wallpaper behavior

Fresh profiles use `horizon`. The former Cyber Glow, MacOS, Obsidian, and Midnight themes remain
selectable. Existing profiles on the temporary pre-release theme id are migrated once to Horizon;
explicit legacy selections remain intact.

The 25 Horizon wallpapers are bundled as AVIF assets. Selecting one applies its associated accent
while Horizon is active. Synth Rain, Chaos Flow, and existing Nammu wallpapers remain available.

## Architectural boundary

This work changes presentation and interaction styling only. It does not replace the Nammu window
manager, application registry, Files architecture, WebView2 surfaces, Tauri capability boundary,
backend, persistence contracts, or standalone application routes.

Every trusted system app and tool renders inside a semantic `nammu-app-surface` boundary. The
Horizon application layer translates historical Nammu colors, type tiers, controls, tables,
dialogs, and panels into shared tokens without changing application behavior. Files, Cloud, Notes,
Calendar, Settings, Projects, Browser-family chrome, the persistent Music workspace, and the
general utility suite use that contract. Maps, Nammu PDF, and Subdomain Inspector additionally
provide focused CSS-module adaptations because their specialist workspaces own local design tokens.

Terminal/editor code content intentionally keeps the local IBM Plex Mono face. Remote pages inside
Browser, WhatsApp, Telegram, and YouTube Music retain the website's own styling; the surrounding
Nammu host chrome follows Horizon.

The old cyan kernel/app-opening interstitials are not part of Horizon. Startup and lazy loading use
quiet structural placeholders so waiting never looks like a second OS boot.

## Source and licensing

The visual foundation and wallpaper assets are adapted from the locally licensed donor checkout at
`umbrel/`. The repository credit remains listed in Nammu Settings. The checkout is intentionally
excluded from Nammu's TypeScript, lint, test, formatting, and packaging inputs; Nammu consumes only
the deliberately adapted source and selected runtime assets committed to this repository.
