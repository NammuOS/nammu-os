# Desktop native-webview performance acceptance

Date: 2026-09-04  
Build: Nammu OS 4.1.0, optimized Windows x64 Tauri release

## Measured result

The old packaged three-application Gecko/WASM workload measured approximately 5.34 GB working
set and 7.27 GB private memory. The final native workload opened one Browser website, WhatsApp,
and YouTube Music simultaneously and measured the complete Nammu process tree after stabilization.

| Metric                      |                Old three-Gecko release | Native WebView2 release |                              Change |
| --------------------------- | -------------------------------------: | ----------------------: | ----------------------------------: |
| Working set                 |                              ~5,468 MB |             2,164.55 MB |                        ~60.4% lower |
| Private memory              |                              ~7,444 MB |             1,190.23 MB |                        ~84.0% lower |
| Idle CPU, 10-second sample  | not retained for the old three-app run |       0.281 CPU-seconds |            2.81% of one logical CPU |
| Gecko application instances |                                      3 |                       0 |                          eliminated |
| Gecko workers               |                                     3+ |                       0 |                          eliminated |
| Managed remote surfaces     |                   3 Gecko applications |       3 native surfaces |                 one per application |
| WebView2 processes          |        included shell plus Gecko hosts |                      26 | expected Chromium process isolation |

The native run used Browser on Wikipedia, WhatsApp at its persisted application session, and
YouTube Music at its persisted application session. Authentication-specific messaging and active
music playback remain manual acceptance items; those outcomes are not inferred from the memory
measurement.

Telegram was added after this controlled three-application baseline. It uses the same native
surface architecture but is intentionally excluded from these figures; the recorded values remain
comparable to the original three-Gecko workload rather than mixing a fourth remote application
into the result.

With all remote applications closed, the shell, music-player workspace, Synth Rain wallpaper,
packaged Node server, and main WebView2 process tree measured 630.32 MB working set / 361.82 MB
private memory. Closing all three applications removed every remote surface and returned the shell
DOM to zero iframes.

Warm native surface attachment measured 22 ms for WhatsApp, 22 ms for YouTube Music, and 24 ms for
a Browser website. These numbers measure Nammu surface creation/attachment, not completion of a
remote service's network load.

## Package result

| Artifact                               | Previous Gecko Desktop build | Native Desktop build |                           Change |
| -------------------------------------- | ---------------------------: | -------------------: | -------------------------------: |
| Desktop frontend assets (uncompressed) |                    ~71.82 MB |             15.30 MB |                ~56.52 MB removed |
| Release EXE                            |             79,748,608 bytes |     25,147,392 bytes | 54,601,216 bytes / 68.5% smaller |
| NSIS installer                         |            137,250,674 bytes |     81,547,215 bytes | 55,703,459 bytes / 40.6% smaller |

The repository and Web build retain Firefox-WASM. The Desktop Vite build excludes its entire
asset tree. The packaged Desktop Node runtime excludes `@mercuryworkshop/wisp-js`, and the Desktop
server rejects WebSocket upgrades instead of exposing a tunnel.

## Runtime evidence

- Actual release executable launched from `src-tauri/target/release/nammu-os.exe`.
- One packaged Node child bound one OS-selected numeric `127.0.0.1` port.
- Browser navigation and Back/Forward reconciliation passed on Wikipedia and Example Domain.
- Browser, WhatsApp, and YouTube Music produced three distinct 32-byte managed surface IDs.
- Profile roots were Browser, WhatsApp account, and YouTube Music specific.
- Shell DOM contained zero iframes and no `firefox-wasm` resource entries.
- A second EXE exited with code 0; one host and one Node child remained.
- Normal window close removed every tracked descendant.
- Forced host termination also left zero tracked descendants.

## Interpretation

WebView2 intentionally uses browser, renderer, GPU, network, storage, and crash-handler processes.
The count is not evidence of duplicate Nammu runtimes. The acceptance invariant is one managed
surface per expected application/tab and no surface remaining after its owning Nammu application
closes.
