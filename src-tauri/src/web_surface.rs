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

use crate::trusted_shell::require_trusted_shell;

#[cfg(windows)]
use webview2_com::{
    IsDocumentPlayingAudioChangedEventHandler, IsMutedChangedEventHandler,
    Microsoft::Web::WebView2::Win32::{ICoreWebView2, ICoreWebView2_25, ICoreWebView2_8},
    ShowSaveAsUICompletedHandler,
};
#[cfg(windows)]
use windows::core::Interface;

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
    Integration,
}

impl WebSurfaceOwner {
    fn profile_directory(self) -> &'static str {
        match self {
            Self::Browser => "browser",
            Self::Whatsapp => "whatsapp",
            Self::Telegram => "telegram",
            Self::YoutubeMusic => "youtube-music",
            Self::Integration => "integration",
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
            Self::Integration => false,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebSurfaceNavigationPolicy {
    allow_public_web: bool,
    #[serde(default)]
    allowed_origins: Vec<String>,
}

impl WebSurfaceNavigationPolicy {
    fn validate(&self) -> Result<Self, String> {
        if self.allowed_origins.len() > 32 {
            return Err("Too many native web-surface origins were declared.".to_string());
        }
        let mut normalized = Vec::with_capacity(self.allowed_origins.len());
        for raw in &self.allowed_origins {
            let url = Url::parse(raw)
                .map_err(|_| "A native web-surface origin is invalid.".to_string())?;
            if !matches!(url.scheme(), "http" | "https")
                || url.host_str().is_none()
                || !url.username().is_empty()
                || url.password().is_some()
                || url.path() != "/"
                || url.query().is_some()
                || url.fragment().is_some()
                || url.origin().ascii_serialization() != *raw
                || normalized.contains(raw)
            {
                return Err("A native web-surface origin is invalid or duplicated.".to_string());
            }
            let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
            if host == "localhost"
                || host.ends_with(".localhost")
                || host == "127.0.0.1"
                || host == "0.0.0.0"
                || host == "::1"
            {
                return Err(
                    "Local origins cannot be granted to a packaged web surface.".to_string()
                );
            }
            normalized.push(raw.clone());
        }
        if !self.allow_public_web && normalized.is_empty() {
            return Err("A restricted native web surface requires an approved origin.".to_string());
        }
        Ok(Self {
            allow_public_web: self.allow_public_web,
            allowed_origins: normalized,
        })
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
    Find,
    FindNext,
    FindPrevious,
    ClearFind,
    Print,
    SavePage,
    EnableTrackingProtection,
    DisableTrackingProtection,
    BlockAutoplay,
    AllowAutoplay,
}

#[derive(Debug, Clone)]
struct SurfacePolicy {
    frontend_origin: String,
    local_service_origin: String,
}

impl SurfacePolicy {
    fn validate_url(
        &self,
        owner: WebSurfaceOwner,
        integration_policy: Option<&WebSurfaceNavigationPolicy>,
        raw: &str,
    ) -> Result<Url, String> {
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

        if owner == WebSurfaceOwner::Integration
            && (host == "localhost"
                || host.ends_with(".localhost")
                || host == "127.0.0.1"
                || host == "0.0.0.0"
                || host == "::1")
        {
            return Err("Packaged web surfaces cannot navigate to local origins.".to_string());
        }

        let allowed = if owner == WebSurfaceOwner::Integration {
            let policy = integration_policy.ok_or_else(|| {
                "A packaged web surface requires an explicit navigation policy.".to_string()
            })?;
            policy.allow_public_web || policy.allowed_origins.iter().any(|item| item == &origin)
        } else {
            owner.allows_host(&host)
        };
        if !allowed {
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

fn persistent_profile_directory(
    root: &std::path::Path,
    owner: WebSurfaceOwner,
    profile_key: &str,
    partition_key: Option<&str>,
) -> PathBuf {
    let owner_root = root.join(owner.profile_directory());
    let profile = if profile_key == "default" {
        owner_root
    } else {
        owner_root.join(profile_key)
    };
    partition_key.map_or(profile.clone(), |partition| profile.join(partition))
}

#[derive(Debug, Clone)]
struct SurfaceEntry {
    label: String,
    host_label: String,
    profile_directory: PathBuf,
    snapshot: WebSurfaceSnapshot,
    navigation_policy: Option<WebSurfaceNavigationPolicy>,
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

    pub(crate) fn profile_root(&self) -> &std::path::Path {
        &self.profile_root
    }

    pub(crate) fn profile_is_active(&self, profile: &std::path::Path) -> Result<bool, String> {
        Ok(self.lock()?.values().any(|entry| {
            entry.profile_directory == profile
                || entry.profile_directory.starts_with(profile)
                || profile.starts_with(&entry.profile_directory)
        }))
    }

    pub(crate) fn integration_namespace_is_active(
        &self,
        app_namespace: &str,
    ) -> Result<bool, String> {
        let integration_root = self.profile_root.join("integration");
        Ok(self.lock()?.values().any(|entry| {
            entry
                .profile_directory
                .strip_prefix(&integration_root)
                .ok()
                .and_then(|relative| relative.components().next())
                .map(|component| {
                    component
                        .as_os_str()
                        .to_string_lossy()
                        .starts_with(&format!("{app_namespace}-"))
                })
                .unwrap_or(false)
        }))
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
    require_trusted_shell(caller)
}

fn require_surface_owner(
    caller: &Webview,
    state: &WebSurfaceState,
    id: &str,
) -> Result<SurfaceEntry, String> {
    require_trusted_caller(caller)?;
    let entry = state.entry(id)?;
    if entry.host_label != caller.label() {
        return Err("The native web surface belongs to another Nammu window.".to_string());
    }
    Ok(entry)
}

fn random_id(bytes: usize) -> Result<String, String> {
    let mut value = vec![0_u8; bytes];
    getrandom::fill(&mut value)
        .map_err(|_| "A secure native web surface identity could not be generated.".to_string())?;
    Ok(value.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn emit_snapshot(app: &AppHandle, snapshot: &WebSurfaceSnapshot) {
    let Some(state) = app.try_state::<WebSurfaceState>() else {
        return;
    };
    let Ok(entry) = state.entry(&snapshot.id) else {
        return;
    };
    let _ = app.emit_to(entry.host_label, WEB_SURFACE_EVENT, snapshot);
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
    partition_key: Option<String>,
    private_session: bool,
    url: String,
    bounds: WebSurfaceBounds,
    visible: bool,
    navigation_policy: Option<WebSurfaceNavigationPolicy>,
    app: AppHandle,
    caller: Webview,
    state: State<'_, WebSurfaceState>,
) -> Result<WebSurfaceSnapshot, String> {
    require_trusted_caller(&caller)?;
    let host_label = caller.label().to_string();
    let host_window = caller.window().clone();
    let bounds = bounds.validate()?;
    let navigation_policy = if owner == WebSurfaceOwner::Integration {
        Some(
            navigation_policy
                .ok_or_else(|| {
                    "A packaged web surface requires an explicit navigation policy.".to_string()
                })?
                .validate()?,
        )
    } else {
        if navigation_policy.is_some() {
            return Err(
                "Legacy native web surfaces cannot override their navigation policy.".to_string(),
            );
        }
        None
    };
    let initial_url = state
        .policy
        .validate_url(owner, navigation_policy.as_ref(), &url)?;
    let profile_key = validate_profile_key(&profile_key)?;
    let partition_key = partition_key
        .as_deref()
        .map(validate_profile_key)
        .transpose()?;
    if owner != WebSurfaceOwner::Integration && partition_key.is_some() {
        return Err("Only packaged integration surfaces may declare a partition.".to_string());
    }

    if state.lock()?.len() >= MAX_WEB_SURFACES {
        return Err("The native web surface limit has been reached.".to_string());
    }

    let id = random_id(16)?;
    let label = format!("native-{}-{}", owner.profile_directory(), random_id(8)?);
    let policy = state.policy.clone();
    let navigation_policy_for_navigation = navigation_policy.clone();
    let navigation_owner = owner;
    let app_for_load = app.clone();
    let id_for_load = id.clone();
    let app_for_title = app.clone();
    let id_for_title = id.clone();
    let app_for_popup = app.clone();
    let id_for_popup = id.clone();
    let label_for_popup = label.clone();
    let host_label_for_popup = host_label.clone();
    let popup_policy = state.policy.clone();
    let navigation_policy_for_popup = navigation_policy.clone();
    let popup_owner = owner;
    // Omitted partitions preserve every pre-T0 profile path byte-for-byte.
    let profile_directory =
        persistent_profile_directory(&state.profile_root, owner, profile_key, partition_key);
    std::fs::create_dir_all(&profile_directory)
        .map_err(|error| format!("The native browser profile could not be opened: {error}"))?;

    let mut builder = WebviewBuilder::new(label.clone(), WebviewUrl::External(initial_url.clone()))
        .data_directory(profile_directory.clone())
        .incognito(private_session)
        .enable_clipboard_access()
        .disable_drag_drop_handler()
        .zoom_hotkeys_enabled(false)
        .devtools(cfg!(debug_assertions))
        .on_navigation(move |candidate| {
            policy
                .validate_url(
                    navigation_owner,
                    navigation_policy_for_navigation.as_ref(),
                    candidate.as_str(),
                )
                .is_ok()
        })
        .on_new_window(move |candidate, _| {
            if popup_policy
                .validate_url(
                    popup_owner,
                    navigation_policy_for_popup.as_ref(),
                    candidate.as_str(),
                )
                .is_err()
            {
                return NewWindowResponse::Deny;
            }
            if popup_owner == WebSurfaceOwner::Browser {
                let _ = app_for_popup.emit_to(
                    &host_label_for_popup,
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
            host_label,
            profile_directory,
            snapshot: snapshot.clone(),
            navigation_policy,
        },
    );

    let webview = match host_window.add_child(
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
    require_surface_owner(&caller, &state, &id)?;
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
    let entry = require_surface_owner(&caller, &state, &id)?;
    let owner = entry.snapshot.owner;
    let target = state
        .policy
        .validate_url(owner, entry.navigation_policy.as_ref(), &url)?;
    get_surface(&app, &state, &id)?
        .navigate(target)
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn control_web_surface(
    id: String,
    control: WebSurfaceControl,
    query: Option<String>,
    app: AppHandle,
    caller: Webview,
    state: State<'_, WebSurfaceState>,
) -> Result<(), String> {
    require_surface_owner(&caller, &state, &id)?;
    let webview = get_surface(&app, &state, &id)?;
    match control {
        WebSurfaceControl::Reload => webview.reload().map_err(|error| error.to_string())?,
        WebSurfaceControl::Print => webview.print().map_err(|error| error.to_string())?,
        WebSurfaceControl::Find | WebSurfaceControl::FindNext | WebSurfaceControl::FindPrevious => {
            let query = query.ok_or_else(|| "A find query is required.".to_string())?;
            if query.is_empty()
                || query.len() > 512
                || query.chars().any(|character| character.is_control())
            {
                return Err("The find query is invalid.".to_string());
            }
            let query = serde_json::to_string(&query)
                .map_err(|_| "The find query could not be encoded.".to_string())?;
            let backwards = matches!(control, WebSurfaceControl::FindPrevious);
            webview
                .eval(format!(
                    "window.find({query}, false, {backwards}, true, false, false, false);"
                ))
                .map_err(|error| error.to_string())?;
        }
        WebSurfaceControl::ClearFind => webview
            .eval("window.getSelection()?.removeAllRanges();")
            .map_err(|error| error.to_string())?,
        WebSurfaceControl::SavePage => {
            #[cfg(windows)]
            webview
                .with_webview(|platform| {
                    let controller = platform.controller();
                    if let Ok(core) = unsafe { controller.CoreWebView2() } {
                        if let Ok(save_as) = core.cast::<ICoreWebView2_25>() {
                            let completed =
                                ShowSaveAsUICompletedHandler::create(Box::new(|_, _| Ok(())));
                            let _ = unsafe { save_as.ShowSaveAsUI(&completed) };
                        }
                    }
                })
                .map_err(|error| error.to_string())?;

            #[cfg(not(windows))]
            return Err(
                "Save Page is currently implemented only for the Windows WebView2 surface."
                    .to_string(),
            );
        }
        WebSurfaceControl::EnableTrackingProtection
        | WebSurfaceControl::DisableTrackingProtection
        | WebSurfaceControl::BlockAutoplay
        | WebSurfaceControl::AllowAutoplay => {
            return Err(
                "This Gecko profile preference is unavailable for the Desktop WebView2 surface."
                    .to_string(),
            );
        }
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
                                WebSurfaceControl::Reload
                                | WebSurfaceControl::Find
                                | WebSurfaceControl::FindNext
                                | WebSurfaceControl::FindPrevious
                                | WebSurfaceControl::ClearFind
                                | WebSurfaceControl::Print
                                | WebSurfaceControl::SavePage
                                | WebSurfaceControl::EnableTrackingProtection
                                | WebSurfaceControl::DisableTrackingProtection
                                | WebSurfaceControl::BlockAutoplay
                                | WebSurfaceControl::AllowAutoplay => unreachable!(),
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
    require_surface_owner(&caller, &state, &id)?;
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
    require_surface_owner(&caller, &state, &id)?;
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
    require_surface_owner(&caller, &state, &id)?;
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
    require_surface_owner(&caller, &state, &id)?;
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
    Ok(require_surface_owner(&caller, &state, &id)?.snapshot)
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
            .validate_url(
                WebSurfaceOwner::Browser,
                None,
                "https://example.com/path?q=1"
            )
            .is_ok());
        assert!(policy()
            .validate_url(WebSurfaceOwner::Browser, None, "http://example.com/")
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
                    .validate_url(WebSurfaceOwner::Browser, None, candidate)
                    .is_err(),
                "allowed {candidate}"
            );
        }
    }

    #[test]
    fn application_owners_are_restricted_to_approved_navigation() {
        assert!(policy()
            .validate_url(WebSurfaceOwner::Whatsapp, None, "https://web.whatsapp.com/")
            .is_ok());
        assert!(policy()
            .validate_url(WebSurfaceOwner::Whatsapp, None, "https://example.com/")
            .is_err());
        assert!(policy()
            .validate_url(
                WebSurfaceOwner::Telegram,
                None,
                "https://web.telegram.org/a/"
            )
            .is_ok());
        assert!(policy()
            .validate_url(WebSurfaceOwner::Telegram, None, "https://example.com/")
            .is_err());
        assert!(policy()
            .validate_url(
                WebSurfaceOwner::YoutubeMusic,
                None,
                "https://accounts.google.com/"
            )
            .is_ok());
        assert!(policy()
            .validate_url(WebSurfaceOwner::YoutubeMusic, None, "https://example.com/")
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
    fn partition_paths_are_isolated_without_moving_existing_browser_profiles() {
        let root = PathBuf::from("C:/Nammu/web-surfaces");
        assert_eq!(
            persistent_profile_directory(&root, WebSurfaceOwner::Browser, "default", None),
            root.join("browser")
        );
        assert_eq!(
            persistent_profile_directory(
                &root,
                WebSurfaceOwner::Integration,
                "pkg-0123456789abcdef01234567-telegram",
                Some("account-a")
            ),
            root.join("integration")
                .join("pkg-0123456789abcdef01234567-telegram")
                .join("account-a")
        );
    }

    #[test]
    fn integration_policy_is_explicit_and_rejects_local_origins() {
        let restricted = WebSurfaceNavigationPolicy {
            allow_public_web: false,
            allowed_origins: vec!["https://example.com".to_string()],
        }
        .validate()
        .unwrap();
        assert!(policy()
            .validate_url(
                WebSurfaceOwner::Integration,
                Some(&restricted),
                "https://example.com/path"
            )
            .is_ok());
        assert!(policy()
            .validate_url(
                WebSurfaceOwner::Integration,
                Some(&restricted),
                "https://other.example/"
            )
            .is_err());
        assert!(policy()
            .validate_url(
                WebSurfaceOwner::Integration,
                Some(&restricted),
                "http://127.0.0.1:60123/api/health"
            )
            .is_err());
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
