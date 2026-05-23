#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ipc;
mod pty;
mod session;
mod snapshot;

fn main() {
    tauri::Builder::default()
        .manage(ipc::AppState::default())
        .invoke_handler(tauri::generate_handler![
            ipc::start_session,
            ipc::send_input,
            ipc::resize_pty,
            ipc::kill_session,
        ])
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error running stained-glass");
}
