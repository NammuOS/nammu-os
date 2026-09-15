# Browser B1 product-parity closeout

Baseline: built-in Browser at Core commit `171bb5c`.

Current product: independent `os.nammu.browser` package at `v1.0.1`
(`37e2482`). Core remains the authority for Gecko/Wisp, WebView2, WebSurface
ownership and privileged host operations.

## Feature matrix

| Pre-extraction behavior | Independent Browser equivalent | Result |
| --- | --- | --- |
| Create, close and switch tabs | Package-owned tab model and opaque WebSurface per remote tab | Preserved and verified |
| Multiple and pinned tabs | Package tab strip; pinned tabs retain compact treatment | Preserved and verified |
| Productive new-tab workspace | Package-owned workspaces, boards, bookmarks, recent items and settings | Preserved and verified |
| Navigate, Back, Forward, Reload/Stop | Typed WebSurface navigation and control operations | Preserved and verified |
| URL, title and loading updates | Ownership-scoped WebSurface state events | Preserved and verified |
| Bookmark bar/library, groups, import/export | Package-owned bookmark model and user-mediated file capabilities | Preserved and verified |
| Bookmark open/edit/copy/delete context actions | Package context menu and editor | Restored in `v1.0.1` |
| History and persistence | Package settings storage, capped history and reopen restoration | Preserved and verified |
| Browser preferences and persistence | Package settings storage with reopen restoration | Preserved and verified |
| Tracking protection preference | Typed Gecko profile preference; explicit unsupported result on Desktop | Restored in `v1.0.1`, runtime-qualified |
| Autoplay preference | Typed Gecko profile preference; explicit unsupported result on Desktop | Restored in `v1.0.1`, runtime-qualified |
| Default zoom | Typed per-surface zoom plus persisted package preference | Preserved and verified |
| Private tabs | Private-session intent passed at surface creation; host owns isolated profile | Preserved and verified |
| Proxy manager | Named proxy services and Web Gecko route controls | Preserved on Web; intentionally unsupported on Desktop WebView2 |
| Popup/new-window handling | Ownership-scoped open-request event creates a package tab | Preserved and verified |
| Find in Page | Typed `find`, next, previous and clear controls | Restored in `v1.0.1` |
| Print | Typed host `print` control | Restored in `v1.0.1` |
| Save Page | Typed host `save-page` control; WebView2 uses its native Save As UI | Restored in `v1.0.1` |
| Fullscreen | Package workspace Fullscreen API | Restored in `v1.0.1` |
| Duplicate tab | Package tab command | Restored in `v1.0.1` |
| Close Other Tabs / Close Tabs to Right | Package tab commands | Restored in `v1.0.1` |
| Pin/unpin, mute/unmute, reload and copy URL tab actions | Package context commands; host surface controls where required | Restored in `v1.0.1` |
| Reopen closed tab | Bounded package closed-tab state | Preserved and verified |
| Website file input | Host-owned WebView2/Gecko surface; package receives no native path | Preserved; packaged WebView2 handoff verified |
| Website downloads | Host surface owns remote downloads; package cannot read download bytes | Preserved security boundary |
| New-tab/bookmark JSON import/export | Existing approved picker/save capabilities | Preserved and verified |
| Downloads view | Honest host-managed status rather than fabricated package download records | Intentional difference |
| Gecko password/add-on/config internal pages | No package privilege to host profile internals | Intentionally removed |
| Legacy in-app DevTools/log inspector | No general evaluation or privileged inspection capability | Intentionally removed |
| Split-view chrome | No complete working pre-extraction product contract | Not migrated; no regression claimed |
| Session/tab restore after complete app restart | Not implemented by the baseline as a durable session contract | Still unsupported |

## Acceptance evidence

- Browser package tests verify navigation reconciliation, the typed restored
  command path, bounded bookmark import, history/preferences persistence,
  productive new-tab state and package/Core separation.
- The Web sandbox acceptance launches two logical tabs through one pooled Gecko
  package/profile session, then verifies teardown and reopen.
- The native boundary suite rejects cross-instance WebSurface ownership and
  keeps surface handles opaque.
- The packaged Windows acceptance installs/opens the signed Browser, navigates a
  real public page in WebView2, binds a selected disposable file to a website
  file input without exposing its path to package JavaScript, observes zero
  Desktop Gecko instances and exits cleanly.
- The remote Store lifecycle uses immutable public `v1.0.0` and `v1.0.1`
  artifacts to prove update, rollback, forward update, repair, data-retaining
  uninstall, remote reinstall and recovered Browser data.

The automated file-input check drives the WebView2 target through its test-only
CDP endpoint. It proves host-mediated file binding and isolation; it does not
claim automated visual interaction with the native Windows picker. Save Page is
covered by the typed package-to-host contract and native WebView2 implementation;
the modal Windows Save As interaction remains user-mediated by design.

## Intentional security differences

The package cannot access Gecko chrome objects, WebView2 handles, Wisp URLs,
native paths, arbitrary evaluation, password storage, add-on management or
advanced Gecko configuration. Protection settings apply where the host exposes
a safe compatible implementation; Desktop reports them unsupported instead of
pretending that WebView2 accepted Gecko preferences.

No Browser-specific application-ID bypass was introduced. Every restored
operation uses the same finite, ownership-checked WebSurface contract available
to an appropriately permissioned package.

## Release decision

`v1.0.0` remains immutable but is not the final parity release. The real
regressions found in the audit required `v1.0.1`. The authoritative Browser
product release is therefore `v1.0.1`; no further Browser migration phase is
required.
