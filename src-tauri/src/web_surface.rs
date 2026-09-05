use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Mutex, MutexGuard},
};
use tauri::{
    webview::{NewWindowResponse, PageLoadEvent, WebviewBuilder},
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, State, Url, Webview, WebviewUrl,
};

#[cfg(windows)]
use webview2_com::{
    IsDocumentPlayingAudioChangedEventHandler, IsMutedChangedEventHandler,
    Microsoft::Web::WebView2::Win32::{ICoreWebView2, ICoreWebView2_8},
};
#[cfg(windows)]
use windows::core::Interface;

const TRUSTED_WEBVIEW_LABEL: &str = "main";
const WEB_SURFACE_EVENT: &str = "nammu://web-surface-state";
const WEB_SURFACE_OPEN_REQUEST_EVENT: &str = "nammu://web-surface-open-request";
const MAX_WEB_SURFACES: usize = 32;
const MAX_URL_LENGTH: usize = 8_192;
const MAX_SURFACE_DIMENSION: f64 = 16_384.0;
const YOUTUBE_MUSIC_INITIALIZATION_SCRIPT: &str = r#"
(() => {
  if (window.__nammuMusicGuardsInstalled) return;
  window.__nammuMusicGuardsInstalled = true;
  const prune = (value) => {
    if (!value || typeof value !== 'object') return value;
    try {
      delete value.playerAds;
      delete value.adPlacements;
      delete value.adSlots;
      for (const key of ['playerResponse', 'ytInitialPlayerResponse']) {
        const nested = value[key];
        if (!nested || typeof nested !== 'object') continue;
        delete nested.playerAds;
        delete nested.adPlacements;
        delete nested.adSlots;
      }
    } catch {}
    return value;
  };
  const originalParse = JSON.parse;
  JSON.parse = function () {
    return prune(Reflect.apply(originalParse, this, arguments));
  };
  const originalJson = Response.prototype.json;
  Response.prototype.json = function () {
    return Reflect.apply(originalJson, this, arguments).then(prune);
  };
  const suppressPlayerAds = () => {
    document.querySelectorAll('.ytp-ad-skip-button, .ytp-skip-ad-button, [id*=ad-skip]').forEach((button) => button.click());
    const player = document.querySelector('#movie_player');
    const video = document.querySelector('video');
    if (player?.classList.contains('ad-showing') && video) {
      video.muted = true;
      if (Number.isFinite(video.duration)) video.currentTime = Math.max(0, video.duration - 0.05);
    }
  };
  addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style');
    style.textContent = '.ytp-ad-module,.ytmusic-mealbar-promo-renderer,tp-yt-paper-dialog:has(.ytmusic-mealbar-promo-renderer){display:none!important}';
    document.documentElement.appendChild(style);
    new MutationObserver(suppressPlayerAds).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    suppressPlayerAds();
  }, { once: true });
})();
"#;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum WebSurfaceOwner {
    Browser,
    Whatsapp,
    Telegram,
    YoutubeMusic,
}

impl WebSurfaceOwner {
    fn profile_directory(self) -> &'static str {
        match self {
            Self::Browser => "browser",
            Self::Whatsapp => "whatsapp",
            Self::Telegram => "telegram",
            Self::YoutubeMusic => "youtube-music",
        }
    }

    fn allows_host(self, host: &str) -> bool {
        match self {
            Self::Browser => true,
            Self::Whatsapp => {
                host == "web.whatsapp.com"
                    || host == "whatsapp.com"
                    || host.ends_with(".whatsapp.com")
                    || host == "wa.me"
            }
            Self::Telegram => {
                host == "web.telegram.org"
                    || host == "telegram.org"
                    || host.ends_with(".telegram.org")
                    || host == "t.me"
            }
            Self::YoutubeMusic => {
                host == "youtube.com"
                    || host.ends_with(".youtube.com")
                    || host == "google.com"
                    || host.ends_with(".google.com")
                    || host == "googleusercontent.com"
                    || host.ends_with(".googleusercontent.com")
            }
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WebSurfaceBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl WebSurfaceBounds {
    fn validate(self) -> Result<Self, String> {
        let values = [self.x, self.y, self.width, self.height];
        if values.iter().any(|value| !value.is_finite())
            || self.x < 0.0
            || self.y < 0.0
            || self.width < 1.0
            || self.height < 1.0
            || self.x > MAX_SURFACE_DIMENSION
            || self.y > MAX_SURFACE_DIMENSION
            || self.width > MAX_SURFACE_DIMENSION
            || self.height > MAX_SURFACE_DIMENSION
        {
            return Err("The native web surface bounds are invalid.".to_string());
        }
        Ok(self)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebSurfaceSnapshot {
    pub id: String,
    pub owner: WebSurfaceOwner,
    pub url: String,
    pub title: String,
    pub is_loading: bool,
    pub can_go_back: bool,
    pub can_go_forward: bool,
    pub is_audio_playing: bool,
    pub is_muted: bool,
    pub visible: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WebSurfaceOpenRequest {
    source_id: String,
    owner: WebSurfaceOwner,
    url: String,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum WebSurfaceControl {
    Reload,
    Stop,
    GoBack,
    GoForward,
    Mute,
    Unmute,
}

#[derive(Debug, Clone)]
struct SurfacePolicy {
    frontend_origin: String,
    local_service_origin: String,
}

impl SurfacePolicy {
    fn validate_url(&self, owner: WebSurfaceOwner, raw: &str) -> Result<Url, String> {
        if raw.is_empty()
            || raw.len() > MAX_URL_LENGTH
            || raw.chars().any(|character| character.is_control())
        {
            return Err("The native browser URL is invalid.".to_string());
        }

        let url = Url::parse(raw).map_err(|_| "The native browser URL is invalid.".to_string())?;
        if !matches!(url.scheme(), "http" | "https")
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err("Only credential-free HTTP and HTTPS URLs are allowed.".to_string());
        }

        let origin = url.origin().ascii_serialization();
        let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
        if origin == self.frontend_origin
            || origin == self.local_service_origin
            || host == "tauri.localhost"
            || host == "ipc.localhost"
        {
            return Err(
                "Nammu's trusted local origins cannot be opened in a remote web surface."
                    .to_string(),
            );
        }

        if !owner.allows_host(&host) {
            return Err(
                "This remote application cannot navigate outside its approved sites.".to_string(),
            );
        }

        Ok(url)
    }
}

fn validate_profile_key(profile_key: &str) -> Result<&str, String> {
    if profile_key.is_empty()
        || profile_key.len() > 80
        || !profile_key
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
    {
        return Err("The native web surface profile key is invalid.".to_string());
    }
    Ok(profile_key)
}

#[derive(Debug, Clone)]
struct SurfaceEntry {
    label: String,
    snapshot: WebSurfaceSnapshot,
}

pub struct WebSurfaceState {
    policy: SurfacePolicy,
    profile_root: PathBuf,
    surfaces: Mutex<HashMap<String, SurfaceEntry>>,
}

impl WebSurfaceState {
    pub fn new(
        frontend_origin: String,
        local_service_origin: String,
        profile_root: PathBuf,
    ) -> Result<Self, String> {
        std::fs::create_dir_all(&profile_root).map_err(|error| {
            format!("The native browser profile directory could not be created: {error}")
        })?;
        Ok(Self {
            policy: SurfacePolicy {
                frontend_origin,
                local_service_origin,
            },
            profile_root,
            surfaces: Mutex::new(HashMap::new()),
        })
    }

    fn lock(&self) -> Result<MutexGuard<'_, HashMap<String, SurfaceEntry>>, String> {
        self.surfaces
            .lock()
            .map_err(|_| "The native web surface registry is unavailable.".to_string())
    }

    fn entry(&self, id: &str) -> Result<SurfaceEntry, String> {
        self.lock()?
            .get(id)
            .cloned()
            .ok_or_else(|| "The native web surface does not exist.".to_string())
    }

    fn update<F>(&self, id: &str, update: F) -> Result<WebSurfaceSnapshot, String>
    where
        F: FnOnce(&mut WebSurfaceSnapshot),
    {
        let mut surfaces = self.lock()?;
        let entry = surfaces
            .get_mut(id)
            .ok_or_else(|| "The native web surface does not exist.".to_string())?;
        update(&mut entry.snapshot);
        Ok(entry.snapshot.clone())
    }
}

fn require_trusted_caller(caller: &Webview) -> Result<(), String> {
    if caller.label() != TRUSTED_WEBVIEW_LABEL || caller.window().label() != TRUSTED_WEBVIEW_LABEL {
        return Err("This native operation is restricted to the trusted Nammu shell.".to_string());
    }
    Ok(())
}

fn random_id(bytes: usize) -> Result<String, String> {
    let mut value = vec![0_u8; bytes];
    getrandom::fill(&mut value)
        .map_err(|_| "A secure native web surface identity could not be generated.".to_string())?;
    Ok(value.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn emit_snapshot(app: &AppHandle, snapshot: &WebSurfaceSnapshot) {
    let _ = app.emit_to(TRUSTED_WEBVIEW_LABEL, WEB_SURFACE_EVENT, snapshot);
}

#[cfg(windows)]
fn read_audio_state(core: &ICoreWebView2) -> Option<(bool, bool)> {
    let audio = core.cast::<ICoreWebView2_8>().ok()?;
    let mut is_audio_playing = windows::core::BOOL(0);
    let mut is_muted = windows::core::BOOL(0);
    unsafe {
        audio.IsDocumentPlayingAudio(&mut is_audio_playing).ok()?;
        audio.IsMuted(&mut is_muted).ok()?;
    }
    Some((is_audio_playing.as_bool(), is_muted.as_bool()))
}

#[cfg(windows)]
fn update_audio_snapshot(app: &AppHandle, surface_id: &str, core: &ICoreWebView2) {
    let Some((is_audio_playing, is_muted)) = read_audio_state(core) else {
        return;
    };
    let Some(state) = app.try_state::<WebSurfaceState>() else {
        return;
    };
    if let Ok(snapshot) = state.update(surface_id, |snapshot| {
        snapshot.is_audio_playing = is_audio_playing;
        snapshot.is_muted = is_muted;
    }) {
        emit_snapshot(app, &snapshot);
    }
}

fn update_navigation_state(app: AppHandle, surface_id: String, webview: Webview) {
    #[cfg(windows)]
    {
        let app_for_callback = app.clone();
        let _ = webview.with_webview(move |platform| {
            let mut can_go_back = windows::core::BOOL(0);
            let mut can_go_forward = windows::core::BOOL(0);
            let controller = platform.controller();
            let result = unsafe { controller.CoreWebView2() };
            if let Ok(core) = result {
                let _ = unsafe { core.CanGoBack(&mut can_go_back) };
                let _ = unsafe { core.CanGoForward(&mut can_go_forward) };
                update_audio_snapshot(&app_for_callback, &surface_id, &core);
            }
            if let Some(state) = app_for_callback.try_state::<WebSurfaceState>() {
                if let Ok(snapshot) = state.update(&surface_id, |snapshot| {
                    snapshot.can_go_back = can_go_back.as_bool();
                    snapshot.can_go_forward = can_go_forward.as_bool();
                }) {
                    emit_snapshot(&app_for_callback, &snapshot);
                }
            }
        });
    }

    #[cfg(not(windows))]
    {
        let _ = (app, surface_id, webview);
    }
}

#[cfg(windows)]
fn register_audio_state_handlers(
    app: &AppHandle,
    surface_id: &str,
    webview: &Webview,
) -> Result<(), String> {
    let app_for_playback = app.clone();
    let id_for_playback = surface_id.to_string();
    let app_for_mute = app.clone();
    let id_for_mute = surface_id.to_string();
    webview
        .with_webview(move |platform| {
            let Ok(core) = (unsafe { platform.controller().CoreWebView2() }) else {
                return;
            };
            let Ok(audio) = core.cast::<ICoreWebView2_8>() else {
                return;
            };
            let app_for_initial = app_for_playback.clone();
            let id_for_initial = id_for_playback.clone();

            let playback_handler =
                IsDocumentPlayingAudioChangedEventHandler::create(Box::new(move |sender, _| {
                    if let Some(sender) = sender {
                        update_audio_snapshot(&app_for_playback, &id_for_playback, &sender);
                    }
                    Ok(())
                }));
            let mute_handler = IsMutedChangedEventHandler::create(Box::new(move |sender, _| {
                if let Some(sender) = sender {
                    update_audio_snapshot(&app_for_mute, &id_for_mute, &sender);
                }
                Ok(())
            }));
            let mut playback_token = 0;
            let mut mute_token = 0;
            unsafe {
                let _ =
                    audio.add_IsDocumentPlayingAudioChanged(&playback_handler, &mut playback_token);
                let _ = audio.add_IsMutedChanged(&mute_handler, &mut mute_token);
            }
            update_audio_snapshot(&app_for_initial, &id_for_initial, &core);
        })
        .map_err(|error| error.to_string())
}

fn get_surface(app: &AppHandle, state: &WebSurfaceState, id: &str) -> Result<Webview, String> {
    let entry = state.entry(id)?;
    app.get_webview(&entry.label)
        .ok_or_else(|| "The native web surface is no longer available.".to_string())
}

#[tauri::command]
pub async fn create_web_surface(
    owner: WebSurfaceOwner,
    profile_key: String,
    private_session: bool,
    url: String,
    bounds: WebSurfaceBounds,
    visible: bool,
    app: AppHandle,
    caller: Webview,
    state: State<'_, WebSurfaceState>,
) -> Result<WebSurfaceSnapshot, String> {
    require_trusted_caller(&caller)?;
    let bounds = bounds.validate()?;
    let initial_url = state.policy.validate_url(owner, &url)?;
    let profile_key = validate_profile_key(&profile_key)?;

    if state.lock()?.len() >= MAX_WEB_SURFACES {
        return Err("The native web surface limit has been reached.".to_string());
    }

    let id = random_id(16)?;
    let label = format!("native-{}-{}", owner.profile_directory(), random_id(8)?);
    let policy = state.policy.clone();
    let navigation_owner = owner;
    let app_for_load = app.clone();
    let id_for_load = id.clone();
    let app_for_title = app.clone();
    let id_for_title = id.clone();
    let app_for_popup = app.clone();
    let id_for_popup = id.clone();
    let label_for_popup = label.clone();
    let popup_policy = state.policy.clone();
    let popup_owner = owner;
    let owner_profile_root = state.profile_root.join(owner.profile_directory());
    let profile_directory = if profile_key == "default" {
        // Preserve the original Browser profile location and keep the common
        // one-profile application case shallow and stable across upgrades.
        owner_profile_root
    } else {
        owner_profile_root.join(profile_key)
    };
    std::fs::create_dir_all(&profile_directory)
        .map_err(|error| format!("The native browser profile could not be opened: {error}"))?;

    let mut builder = WebviewBuilder::new(label.clone(), WebviewUrl::External(initial_url.clone()))
        .data_directory(profile_directory)
        .incognito(private_session)
        .enable_clipboard_access()
        .disable_drag_drop_handler()
        .zoom_hotkeys_enabled(false)
        .devtools(cfg!(debug_assertions))
        .on_navigation(move |candidate| {
            policy
                .validate_url(navigation_owner, candidate.as_str())
                .is_ok()
        })
        .on_new_window(move |candidate, _| {
            if popup_policy
                .validate_url(popup_owner, candidate.as_str())
                .is_err()
            {
                return NewWindowResponse::Deny;
            }
            if popup_owner == WebSurfaceOwner::Browser {
                let _ = app_for_popup.emit_to(
                    TRUSTED_WEBVIEW_LABEL,
                    WEB_SURFACE_OPEN_REQUEST_EVENT,
                    WebSurfaceOpenRequest {
                        source_id: id_for_popup.clone(),
                        owner: popup_owner,
                        url: candidate.to_string(),
                    },
                );
            } else {
                // Application-owned authentication/navigation popups stay in
                // the same isolated profile instead of creating uncontrolled
                // native windows. The owner allowlist was checked above.
                let scheduler = app_for_popup.clone();
                let runtime = app_for_popup.clone();
                let target = candidate.clone();
                let label = label_for_popup.clone();
                let _ = scheduler.run_on_main_thread(move || {
                    if let Some(webview) = runtime.get_webview(&label) {
                        let _ = webview.navigate(target);
                    }
                });
            }
            NewWindowResponse::Deny
        })
        .on_page_load(move |webview, payload| {
            if let Some(surface_state) = app_for_load.try_state::<WebSurfaceState>() {
                let is_loading = payload.event() == PageLoadEvent::Started;
                if let Ok(snapshot) = surface_state.update(&id_for_load, |snapshot| {
                    snapshot.url = payload.url().to_string();
                    snapshot.is_loading = is_loading;
                }) {
                    emit_snapshot(&app_for_load, &snapshot);
                }
            }
            update_navigation_state(app_for_load.clone(), id_for_load.clone(), webview);
        })
        .on_document_title_changed(move |_, title| {
            if let Some(surface_state) = app_for_title.try_state::<WebSurfaceState>() {
                if let Ok(snapshot) =
                    surface_state.update(&id_for_title, |snapshot| snapshot.title = title)
                {
                    emit_snapshot(&app_for_title, &snapshot);
                }
            }
        })
        .on_download(|_, _| true);
    if owner == WebSurfaceOwner::YoutubeMusic {
        builder = builder.initialization_script(YOUTUBE_MUSIC_INITIALIZATION_SCRIPT);
    }

    let window = app
        .get_window(TRUSTED_WEBVIEW_LABEL)
        .ok_or_else(|| "The Nammu host window is unavailable.".to_string())?;
    let snapshot = WebSurfaceSnapshot {
        id: id.clone(),
        owner,
        url: initial_url.to_string(),
        title: String::new(),
        is_loading: true,
        can_go_back: false,
        can_go_forward: false,
        is_audio_playing: false,
        is_muted: false,
        visible,
    };
    state.lock()?.insert(
        id.clone(),
        SurfaceEntry {
            label: label.clone(),
            snapshot: snapshot.clone(),
        },
    );

    let webview = match window.add_child(
        builder,
        LogicalPosition::new(bounds.x, bounds.y),
        LogicalSize::new(bounds.width, bounds.height),
    ) {
        Ok(webview) => webview,
        Err(error) => {
            let _ = state.lock().map(|mut surfaces| surfaces.remove(&id));
            return Err(error.to_string());
        }
    };

    let visibility_result = if visible {
        webview.show()
    } else {
        webview.hide()
    };
    if let Err(error) = visibility_result {
        let _ = state.lock().map(|mut surfaces| surfaces.remove(&id));
        let _ = webview.close();
        return Err(error.to_string());
    }

    #[cfg(windows)]
    if let Err(error) = register_audio_state_handlers(&app, &id, &webview) {
        let _ = state.lock().map(|mut surfaces| surfaces.remove(&id));
        let _ = webview.close();
        return Err(error);
    }

    emit_snapshot(&app, &snapshot);
    Ok(snapshot)
}

#[tauri::command]
pub fn destroy_web_surface(
    id: String,
    app: AppHandle,
    caller: Webview,
    state: State<'_, WebSurfaceState>,
) -> Result<(), String> {
    require_trusted_caller(&caller)?;
    let entry = state
        .lock()?
        .remove(&id)
        .ok_or_else(|| "The native web surface does not exist.".to_string())?;
    if let Some(webview) = app.get_webview(&entry.label) {
        webview.close().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn navigate_web_surface(
    id: String,
    url: String,
    app: AppHandle,
    caller: Webview,
    state: State<'_, WebSurfaceState>,
) -> Result<(), String> {
    require_trusted_caller(&caller)?;
    let owner = state.entry(&id)?.snapshot.owner;
    let target = state.policy.validate_url(owner, &url)?;
    get_surface(&app, &state, &id)?
        .navigate(target)
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn control_web_surface(
    id: String,
    control: WebSurfaceControl,
    app: AppHandle,
    caller: Webview,
    state: State<'_, WebSurfaceState>,
) -> Result<(), String> {
    require_trusted_caller(&caller)?;
    let webview = get_surface(&app, &state, &id)?;
    match control {
        WebSurfaceControl::Reload => webview.reload().map_err(|error| error.to_string())?,
        WebSurfaceControl::GoBack
        | WebSurfaceControl::GoForward
        | WebSurfaceControl::Stop
        | WebSurfaceControl::Mute
        | WebSurfaceControl::Unmute => {
            #[cfg(windows)]
            webview
                .with_webview(move |platform| {
                    let controller = platform.controller();
                    if let Ok(core) = unsafe { controller.CoreWebView2() } {
                        let _ = unsafe {
                            match control {
                                WebSurfaceControl::GoBack => core.GoBack(),
                                WebSurfaceControl::GoForward => core.GoForward(),
                                WebSurfaceControl::Stop => core.Stop(),
                                WebSurfaceControl::Mute | WebSurfaceControl::Unmute => {
                                    core.cast::<ICoreWebView2_8>().and_then(|audio| {
                                        audio.SetIsMuted(matches!(control, WebSurfaceControl::Mute))
                                    })
                                }
                                WebSurfaceControl::Reload => unreachable!(),
                            }
                        };
                    }
                })
                .map_err(|error| error.to_string())?;

            #[cfg(not(windows))]
            return Err(
                "This native browser control is currently implemented only on Windows.".to_string(),
            );

            if matches!(control, WebSurfaceControl::Mute | WebSurfaceControl::Unmute) {
                if let Ok(snapshot) = state.update(&id, |snapshot| {
                    snapshot.is_muted = matches!(control, WebSurfaceControl::Mute)
                }) {
                    emit_snapshot(&app, &snapshot);
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn set_web_surface_bounds(
    id: String,
    bounds: WebSurfaceBounds,
    app: AppHandle,
    caller: Webview,
    state: State<'_, WebSurfaceState>,
) -> Result<(), String> {
    require_trusted_caller(&caller)?;
    let bounds = bounds.validate()?;
    let webview = get_surface(&app, &state, &id)?;
    webview
        .set_position(LogicalPosition::new(bounds.x, bounds.y))
        .map_err(|error| error.to_string())?;
    webview
        .set_size(LogicalSize::new(bounds.width, bounds.height))
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn set_web_surface_visibility(
    id: String,
    visible: bool,
    app: AppHandle,
    caller: Webview,
    state: State<'_, WebSurfaceState>,
) -> Result<(), String> {
    require_trusted_caller(&caller)?;
    let webview = get_surface(&app, &state, &id)?;
    if visible {
        webview.show().map_err(|error| error.to_string())?;
    } else {
        webview.hide().map_err(|error| error.to_string())?;
    }
    if let Ok(snapshot) = state.update(&id, |snapshot| snapshot.visible = visible) {
        emit_snapshot(&app, &snapshot);
    }
    Ok(())
}

#[tauri::command]
pub fn focus_web_surface(
    id: String,
    app: AppHandle,
    caller: Webview,
    state: State<'_, WebSurfaceState>,
) -> Result<(), String> {
    require_trusted_caller(&caller)?;
    get_surface(&app, &state, &id)?
        .set_focus()
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn set_web_surface_zoom(
    id: String,
    zoom: f64,
    app: AppHandle,
    caller: Webview,
    state: State<'_, WebSurfaceState>,
) -> Result<(), String> {
    require_trusted_caller(&caller)?;
    if !zoom.is_finite() || !(0.5..=2.0).contains(&zoom) {
        return Err("The native browser zoom value is invalid.".to_string());
    }
    get_surface(&app, &state, &id)?
        .set_zoom(zoom)
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_web_surface_state(
    id: String,
    caller: Webview,
    state: State<'_, WebSurfaceState>,
) -> Result<WebSurfaceSnapshot, String> {
    require_trusted_caller(&caller)?;
    Ok(state.entry(&id)?.snapshot)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn policy() -> SurfacePolicy {
        SurfacePolicy {
            frontend_origin: "http://127.0.0.1:1420".to_string(),
            local_service_origin: "http://127.0.0.1:60123".to_string(),
        }
    }

    #[test]
    fn browser_policy_allows_public_http_and_https() {
        assert!(policy()
            .validate_url(WebSurfaceOwner::Browser, "https://example.com/path?q=1")
            .is_ok());
        assert!(policy()
            .validate_url(WebSurfaceOwner::Browser, "http://example.com/")
            .is_ok());
    }

    #[test]
    fn browser_policy_rejects_privileged_and_dangerous_origins() {
        for candidate in [
            "file:///C:/Windows/win.ini",
            "javascript:alert(1)",
            "data:text/html,hello",
            "tauri://localhost",
            "http://tauri.localhost/",
            "http://ipc.localhost/",
            "http://127.0.0.1:1420/",
            "http://127.0.0.1:60123/api/health",
            "https://user:secret@example.com/",
        ] {
            assert!(
                policy()
                    .validate_url(WebSurfaceOwner::Browser, candidate)
                    .is_err(),
                "allowed {candidate}"
            );
        }
    }

    #[test]
    fn application_owners_are_restricted_to_approved_navigation() {
        assert!(policy()
            .validate_url(WebSurfaceOwner::Whatsapp, "https://web.whatsapp.com/")
            .is_ok());
        assert!(policy()
            .validate_url(WebSurfaceOwner::Whatsapp, "https://example.com/")
            .is_err());
        assert!(policy()
            .validate_url(WebSurfaceOwner::Telegram, "https://web.telegram.org/a/")
            .is_ok());
        assert!(policy()
            .validate_url(WebSurfaceOwner::Telegram, "https://example.com/")
            .is_err());
        assert!(policy()
            .validate_url(
                WebSurfaceOwner::YoutubeMusic,
                "https://accounts.google.com/"
            )
            .is_ok());
        assert!(policy()
            .validate_url(WebSurfaceOwner::YoutubeMusic, "https://example.com/")
            .is_err());
    }

    #[test]
    fn profile_keys_cannot_escape_the_application_profile_root() {
        assert_eq!(
            validate_profile_key("wa-account-123").unwrap(),
            "wa-account-123"
        );
        for candidate in ["", "../browser", "A", "account_1", "account/1"] {
            assert!(
                validate_profile_key(candidate).is_err(),
                "allowed {candidate}"
            );
        }
    }

    #[test]
    fn bounds_are_finite_positive_and_bounded() {
        assert!(WebSurfaceBounds {
            x: 10.0,
            y: 20.0,
            width: 800.0,
            height: 600.0,
        }
        .validate()
        .is_ok());
        assert!(WebSurfaceBounds {
            x: 0.0,
            y: 0.0,
            width: f64::NAN,
            height: 10.0,
        }
        .validate()
        .is_err());
    }
}
