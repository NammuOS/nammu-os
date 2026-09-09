use std::{collections::HashMap, path::PathBuf, sync::Mutex};

use serde::Serialize;
use tauri::{AppHandle, Manager, State, Webview, WebviewUrl, WebviewWindowBuilder, WindowEvent};

use crate::trusted_shell::{require_trusted_shell, MAIN_SHELL_LABEL, STANDALONE_SHELL_PREFIX};

const MAX_TITLE_LENGTH: usize = 120;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StandaloneRoute {
    kind: &'static str,
    id: String,
}

#[derive(Default)]
pub struct StandaloneWindowState {
    routes: Mutex<HashMap<String, StandaloneRoute>>,
}

impl StandaloneWindowState {
    fn insert(&self, label: String, route: StandaloneRoute) -> Result<(), String> {
        self.routes
            .lock()
            .map_err(|_| "The standalone-window registry is unavailable.".to_string())?
            .insert(label, route);
        Ok(())
    }

    fn get(&self, label: &str) -> Result<Option<StandaloneRoute>, String> {
        Ok(self
            .routes
            .lock()
            .map_err(|_| "The standalone-window registry is unavailable.".to_string())?
            .get(label)
            .cloned())
    }

    fn remove(&self, label: &str) {
        if let Ok(mut routes) = self.routes.lock() {
            routes.remove(label);
        }
    }
}

fn parse_route(value: &str) -> Result<StandaloneRoute, String> {
    if value == "/browser" {
        return Ok(StandaloneRoute {
            kind: "app",
            id: "browser".to_string(),
        });
    }

    let (kind, id) = if let Some(id) = value.strip_prefix("/apps/") {
        ("app", id)
    } else if let Some(id) = value.strip_prefix("/tools/") {
        ("tool", id)
    } else {
        return Err("The standalone Nammu route is invalid.".to_string());
    };

    if id.is_empty()
        || id.len() > 80
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
    {
        return Err("The standalone Nammu route is invalid.".to_string());
    }

    Ok(StandaloneRoute {
        kind,
        id: id.to_string(),
    })
}

fn validate_title(value: &str) -> Result<&str, String> {
    let title = value.trim();
    if title.is_empty() || title.len() > MAX_TITLE_LENGTH || title.chars().any(char::is_control) {
        return Err("The standalone Nammu window title is invalid.".to_string());
    }
    Ok(title)
}

fn random_window_label() -> Result<String, String> {
    let mut value = [0_u8; 8];
    getrandom::fill(&mut value)
        .map_err(|_| "A standalone Nammu window identity could not be generated.".to_string())?;
    Ok(format!(
        "{STANDALONE_SHELL_PREFIX}{}",
        value
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    ))
}

#[tauri::command]
pub fn get_standalone_bootstrap(
    caller: Webview,
    state: State<'_, StandaloneWindowState>,
) -> Result<Option<StandaloneRoute>, String> {
    require_trusted_shell(&caller)?;
    if caller.label() == MAIN_SHELL_LABEL {
        return Ok(None);
    }

    state
        .get(caller.label())?
        .map(Some)
        .ok_or_else(|| "The standalone Nammu window lost its launch context.".to_string())
}

#[tauri::command]
pub async fn open_standalone_window(
    url: String,
    title: String,
    app: AppHandle,
    caller: Webview,
    state: State<'_, StandaloneWindowState>,
) -> Result<(), String> {
    require_trusted_shell(&caller)?;
    let route = parse_route(&url)?;
    let title = validate_title(&title)?;
    let label = random_window_label()?;

    // This command must remain asynchronous. WebView2 can deadlock during dynamic
    // WebviewWindow creation from Tauri's synchronous command dispatcher, leaving
    // a visible native window permanently parked at about:blank.
    //
    // Register before the local entry loads so the new WebView can deterministically
    // resolve its route even when startup is faster than the builder returns.
    state.insert(label.clone(), route)?;

    let window = match WebviewWindowBuilder::new(
        &app,
        label.clone(),
        WebviewUrl::App(PathBuf::from("index.html")),
    )
    .title(format!("{title} — Nammu OS"))
    .inner_size(1180.0, 760.0)
    .min_inner_size(720.0, 500.0)
    .center()
    .resizable(true)
    .decorations(false)
    .build()
    {
        Ok(window) => window,
        Err(error) => {
            state.remove(&label);
            return Err(format!(
                "The standalone Nammu window could not be created: {error}"
            ));
        }
    };

    let app_for_destroy = app.clone();
    let label_for_destroy = label.clone();
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed) {
            if let Some(state) = app_for_destroy.try_state::<StandaloneWindowState>() {
                state.remove(&label_for_destroy);
            }
        }
    });

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{parse_route, validate_title, StandaloneRoute, StandaloneWindowState};

    #[test]
    fn accepts_only_local_nammu_application_and_tool_routes() {
        assert_eq!(
            parse_route("/browser"),
            Ok(StandaloneRoute {
                kind: "app",
                id: "browser".to_string()
            })
        );
        assert_eq!(
            parse_route("/apps/youtube-music"),
            Ok(StandaloneRoute {
                kind: "app",
                id: "youtube-music".to_string()
            })
        );
        assert_eq!(
            parse_route("/tools/img-compress"),
            Ok(StandaloneRoute {
                kind: "tool",
                id: "img-compress".to_string()
            })
        );
        assert!(parse_route("https://example.com").is_err());
        assert!(parse_route("/apps/../../secret").is_err());
        assert!(parse_route("/apps/browser?remote=true").is_err());
    }

    #[test]
    fn rejects_untrusted_window_titles() {
        assert_eq!(validate_title("  Browser  "), Ok("Browser"));
        assert!(validate_title("").is_err());
        assert!(validate_title("Bad\nTitle").is_err());
        assert!(validate_title(&"x".repeat(121)).is_err());
    }

    #[test]
    fn route_registry_is_deterministic_and_releases_destroyed_windows() {
        let state = StandaloneWindowState::default();
        let route = StandaloneRoute {
            kind: "app",
            id: "youtube-music".to_string(),
        };

        state
            .insert("standalone-0123456789abcdef".to_string(), route.clone())
            .unwrap();
        assert_eq!(state.get("standalone-0123456789abcdef"), Ok(Some(route)));
        state.remove("standalone-0123456789abcdef");
        assert_eq!(state.get("standalone-0123456789abcdef"), Ok(None));
    }
}
