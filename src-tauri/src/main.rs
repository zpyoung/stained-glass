#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod pty;
mod session;
mod snapshot;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error running stained-glass");
}
