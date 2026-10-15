use skilldock_core::{
    AddProjectsResult, AppError, ApplyResult, ChangePreview, Compatibility, CreateInput,
    EditFilesInput, EditInput, Operation, Overview, ResourceDetail, Settings, Store,
};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::{Emitter, Manager, State};

struct AppState {
    store: Mutex<Store>,
    exit_listener_ready: AtomicBool,
    exit_authorized: AtomicBool,
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
fn preview_edit_files(state: State<'_, AppState>, input: EditFilesInput) -> Result<ChangePreview> {
    with_store(state, |store| store.preview_edit_files(input))
}

#[tauri::command]
fn workspace_ready(state: State<'_, AppState>) {
    state.exit_listener_ready.store(true, Ordering::SeqCst);
}

#[tauri::command]
fn exit_workspace(app: tauri::AppHandle, state: State<'_, AppState>) {
    state.exit_authorized.store(true, Ordering::SeqCst);
    app.exit(0);
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
fn create_workspace(state: State<'_, AppState>, name: String) -> Result<Overview> {
    with_store(state, |store| store.create_workspace(&name))
}

#[tauri::command(async)]
fn rename_workspace(state: State<'_, AppState>, id: String, name: String) -> Result<Overview> {
    with_store(state, |store| store.rename_workspace(&id, &name))
}

#[tauri::command(async)]
fn delete_workspace(state: State<'_, AppState>, id: String) -> Result<Overview> {
    with_store(state, |store| store.delete_workspace(&id))
}

#[tauri::command(async)]
fn add_projects_to_workspace(
    state: State<'_, AppState>,
    workspace_id: String,
    paths: Vec<String>,
) -> Result<AddProjectsResult> {
    with_store(state, |store| {
        store.add_projects_to_workspace(&workspace_id, paths)
    })
}

#[tauri::command(async)]
fn remove_project_from_workspace(
    state: State<'_, AppState>,
    workspace_id: String,
    project_id: String,
) -> Result<Overview> {
    with_store(state, |store| {
        store.remove_project_from_workspace(&workspace_id, &project_id)
    })
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
                exit_listener_ready: AtomicBool::new(false),
                exit_authorized: AtomicBool::new(false),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_overview,
            get_resource,
            preview_create,
            preview_edit,
            preview_edit_files,
            workspace_ready,
            exit_workspace,
            preview_delete,
            preview_import,
            preview_adopt,
            apply_changes,
            get_history,
            preview_restore,
            add_project,
            remove_project,
            create_workspace,
            rename_workspace,
            delete_workspace,
            add_projects_to_workspace,
            remove_project_from_workspace,
            save_settings
        ])
        .build(tauri::generate_context!())
        .expect("SkillDock failed to start")
        .run(|app, event| {
            let state = app.state::<AppState>();
            if !state.exit_listener_ready.load(Ordering::SeqCst)
                || state.exit_authorized.load(Ordering::SeqCst)
            {
                return;
            }
            match event {
                tauri::RunEvent::WindowEvent {
                    event: tauri::WindowEvent::CloseRequested { api, .. },
                    ..
                } => {
                    api.prevent_close();
                    let _ = app.emit("workspace-exit-requested", ());
                }
                tauri::RunEvent::ExitRequested { api, code, .. }
                    if code != Some(tauri::RESTART_EXIT_CODE) =>
                {
                    api.prevent_exit();
                    let _ = app.emit("workspace-exit-requested", ());
                }
                _ => {}
            }
        });
}
