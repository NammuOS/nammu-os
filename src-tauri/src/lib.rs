mod integration_profiles;
mod local_server;
mod native_archive;
mod native_directory_watcher;
mod native_file_clipboard;
mod native_file_drag_drop;
mod native_file_operations;
mod native_file_preview;
mod native_file_properties;
mod native_file_search;
mod native_filesystem;
mod native_pdf_preview;
mod native_recycle_bin;
mod native_video_preview;
mod standalone_window;
mod trusted_shell;
mod web_surface;
#[cfg(windows)]
mod windows_job;
#[cfg(windows)]
mod windows_vault;

use local_server::{LocalServerState, LocalServerSupervisor};
use tauri::{Manager, RunEvent, State};
use web_surface::WebSurfaceState;

fn configured_frontend_origin(app: &tauri::App) -> Result<String, String> {
    if cfg!(debug_assertions) {
        let url =
            app.config().build.dev_url.as_ref().ok_or_else(|| {
                "The Tauri development frontend URL is not configured.".to_string()
            })?;
        let origin = url.origin().ascii_serialization();
        if origin == "null" || (url.scheme() != "http" && url.scheme() != "https") {
            return Err("The Tauri development frontend must use an HTTP origin.".to_string());
        }
        return Ok(origin);
    }

    #[cfg(windows)]
    {
        let window = app
            .config()
            .app
            .windows
            .iter()
            .find(|window| window.label == "main")
            .ok_or_else(|| "The main Tauri window is not configured.".to_string())?;
        let scheme = if window.use_https_scheme {
            "https"
        } else {
            "http"
        };
        Ok(format!("{scheme}://tauri.localhost"))
    }

    #[cfg(not(windows))]
    {
        Ok("tauri://localhost".to_string())
    }
}

#[tauri::command]
fn get_local_service_info(
    state: State<'_, LocalServerState>,
) -> Result<local_server::LocalServiceInfo, String> {
    state.service_info()
}

#[tauri::command]
fn authorize_local_request(
    method: String,
    path_and_query: String,
    state: State<'_, LocalServerState>,
) -> Result<local_server::LocalRequestAuthorization, String> {
    state.authorize_request(&method, &path_and_query)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        // This must remain the first plugin so a second process cannot start a
        // competing local server or SQLite writer.
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            get_local_service_info,
            authorize_local_request,
            standalone_window::open_standalone_window,
            standalone_window::get_standalone_bootstrap,
            native_filesystem::list_native_file_roots,
            native_filesystem::list_native_directory,
            native_filesystem::stat_native_file,
            native_file_clipboard::read_native_file_clipboard,
            native_file_clipboard::write_native_file_clipboard,
            native_file_clipboard::complete_native_file_clipboard,
            native_file_clipboard::get_native_file_clipboard_diagnostics,
            native_file_drag_drop::refresh_native_file_drop_targets,
            native_file_drag_drop::release_native_file_drop_targets,
            native_file_drag_drop::start_native_file_drag,
            native_file_drag_drop::set_native_file_drop_effect,
            native_file_drag_drop::get_native_file_drag_drop_diagnostics,
            native_file_operations::create_native_directory,
            native_file_operations::create_native_file,
            native_file_operations::rename_native_file,
            native_file_operations::start_native_copy,
            native_file_operations::start_native_move,
            native_file_operations::start_native_duplicate,
            native_file_operations::get_native_file_operation,
            native_file_operations::cancel_native_file_operation,
            native_file_properties::get_native_file_properties,
            native_file_properties::start_native_directory_measurement,
            native_file_properties::get_native_directory_measurement,
            native_file_properties::cancel_native_directory_measurement,
            native_file_properties::release_native_directory_measurement,
            native_file_properties::get_native_directory_measurement_diagnostics,
            native_recycle_bin::start_native_trash,
            native_recycle_bin::start_native_permanent_delete,
            native_recycle_bin::start_native_restore,
            native_recycle_bin::get_native_deletion_operation,
            native_recycle_bin::cancel_native_deletion_operation,
            native_directory_watcher::start_native_directory_watch,
            native_directory_watcher::stop_native_directory_watch,
            native_directory_watcher::get_native_directory_watch_diagnostics,
            native_file_search::start_native_file_search,
            native_file_search::get_native_file_search,
            native_file_search::cancel_native_file_search,
            native_file_search::release_native_file_search,
            native_file_search::get_native_file_search_diagnostics,
            native_file_preview::start_native_file_preview,
            native_file_preview::get_native_file_preview,
            native_file_preview::take_native_file_preview_bytes,
            native_file_preview::cancel_native_file_preview,
            native_file_preview::release_native_file_preview,
            native_file_preview::get_native_file_preview_diagnostics,
            native_archive::open_native_archive,
            native_archive::get_native_archive_entries,
            native_archive::release_native_archive,
            native_archive::start_native_archive_extract,
            native_archive::start_native_zip_create,
            native_archive::get_native_archive_operation,
            native_archive::cancel_native_archive_operation,
            native_archive::release_native_archive_operation,
            native_archive::get_native_archive_diagnostics,
            web_surface::create_web_surface,
            web_surface::destroy_web_surface,
            web_surface::navigate_web_surface,
            web_surface::control_web_surface,
            web_surface::set_web_surface_bounds,
            web_surface::set_web_surface_visibility,
            web_surface::focus_web_surface,
            web_surface::set_web_surface_zoom,
            web_surface::get_web_surface_state,
            integration_profiles::adopt_integration_profile,
            integration_profiles::purge_integration_profiles
        ])
        .setup(|app| {
            let frontend_origin = configured_frontend_origin(app)?;
            let supervisor = LocalServerSupervisor::start(app.handle(), &frontend_origin)?;
            let web_surface_profile_root = app
                .path()
                .app_local_data_dir()
                .map_err(|error| {
                    format!("The native web-surface data directory is unavailable: {error}")
                })?
                .join("web-surfaces");
            let web_surface_state = WebSurfaceState::new(
                frontend_origin,
                supervisor.origin().to_string(),
                web_surface_profile_root,
            )?;
            eprintln!(
                "[nammu-local] ready on {} for instance {}",
                supervisor.origin(),
                supervisor.instance_id()
            );
            app.manage(LocalServerState::new(supervisor));
            app.manage(standalone_window::StandaloneWindowState::default());
            app.manage(native_file_operations::NativeFileOperationState::default());
            app.manage(native_file_drag_drop::NativeFileDragDropState::default());
            app.manage(native_file_properties::NativeFilePropertiesState::default());
            app.manage(native_recycle_bin::NativeRecycleBinState::default());
            app.manage(native_directory_watcher::NativeDirectoryWatchState::default());
            app.manage(native_file_search::NativeFileSearchState::default());
            app.manage(native_file_preview::NativeFilePreviewState::default());
            app.manage(native_archive::NativeArchiveState::default());
            app.manage(web_surface_state);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build the Nammu OS desktop runtime");

    app.run(|app_handle, event| {
        if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
            if let Some(state) =
                app_handle.try_state::<native_file_drag_drop::NativeFileDragDropState>()
            {
                state.shutdown();
            }
            if let Some(state) = app_handle.try_state::<LocalServerState>() {
                state.shutdown();
            }
        }
    });
}
