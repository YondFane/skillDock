use skilldock_core::{
    AppError, ApplyResult, ChangePreview, Compatibility, CreateInput, EditInput, Operation,
    Overview, ResourceDetail, Settings, Store,
};
use std::{path::PathBuf, sync::Mutex};
use tauri::{Manager, State};

struct AppState {
    store: Mutex<Store>,
}
type Result<T> = std::result::Result<T, AppError>;

fn with_store<T>(state: State<'_, AppState>, f: impl FnOnce(&mut Store) -> Result<T>) -> Result<T> {
    let mut store = state
        .store
        .lock()
        .map_err(|_| AppError::new("state", "本地服务状态异常，请重启应用。"))?;
    f(&mut store)
}

#[tauri::command(async)]
fn get_overview(state: State<'_, AppState>) -> Result<Overview> {
    with_store(state, |store| store.overview())
}

#[tauri::command(async)]
fn get_resource(
    state: State<'_, AppState>,
    id: String,
    relative_path: Option<String>,
) -> Result<ResourceDetail> {
    with_store(state, |store| {
        store.resource_detail(&id, relative_path.as_deref())
    })
}

#[tauri::command(async)]
fn preview_create(state: State<'_, AppState>, input: CreateInput) -> Result<ChangePreview> {
    with_store(state, |store| store.preview_create(input))
}

#[tauri::command(async)]
fn preview_edit(state: State<'_, AppState>, input: EditInput) -> Result<ChangePreview> {
    with_store(state, |store| store.preview_edit(input))
}

#[tauri::command(async)]
fn preview_delete(
    state: State<'_, AppState>,
    id: String,
    expected_fingerprint: String,
) -> Result<ChangePreview> {
    with_store(state, |store| {
        store.preview_delete(&id, &expected_fingerprint)
    })
}

#[tauri::command(async)]
fn preview_import(
    state: State<'_, AppState>,
    path: String,
    compatibility: Compatibility,
) -> Result<ChangePreview> {
    with_store(state, |store| store.preview_import(&path, compatibility))
}

#[tauri::command(async)]
fn preview_adopt(state: State<'_, AppState>, id: String) -> Result<ChangePreview> {
    with_store(state, |store| store.preview_adopt(&id))
}

#[tauri::command(async)]
fn apply_changes(state: State<'_, AppState>, preview_id: String) -> Result<ApplyResult> {
    with_store(state, |store| store.apply(&preview_id))
}

#[tauri::command(async)]
fn get_history(state: State<'_, AppState>) -> Result<Vec<Operation>> {
    with_store(state, |store| store.history())
}

#[tauri::command(async)]
fn preview_restore(state: State<'_, AppState>, operation_id: String) -> Result<ChangePreview> {
    with_store(state, |store| store.preview_restore(&operation_id))
}

#[tauri::command(async)]
fn add_project(state: State<'_, AppState>, path: String) -> Result<Overview> {
    with_store(state, |store| store.add_project(&path))
}

#[tauri::command(async)]
fn remove_project(state: State<'_, AppState>, id: String) -> Result<Overview> {
    with_store(state, |store| store.remove_project(&id))
}

#[tauri::command(async)]
fn save_settings(state: State<'_, AppState>, settings: Settings) -> Result<Overview> {
    with_store(state, |store| store.save_settings(settings))
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let data = std::env::var_os("SKILLDOCK_DATA_DIR")
                .map(PathBuf::from)
                .unwrap_or(app.path().app_data_dir()?);
            let home = std::env::var_os("SKILLDOCK_HOME_DIR")
                .map(PathBuf::from)
                .unwrap_or(app.path().home_dir()?);
            app.manage(AppState {
                store: Mutex::new(Store::open(&data, &home)?),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_overview,
            get_resource,
            preview_create,
            preview_edit,
            preview_delete,
            preview_import,
            preview_adopt,
            apply_changes,
            get_history,
            preview_restore,
            add_project,
            remove_project,
            save_settings
        ])
        .run(tauri::generate_context!())
        .expect("SkillDock failed to start");
}
