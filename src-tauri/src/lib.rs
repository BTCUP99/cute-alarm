use chrono::{Datelike, Local};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, State,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Alarm {
    pub id: String,
    pub time: String,
    pub label: String,
    pub enabled: bool,
    pub repeat_days: Vec<u8>,
    pub ringtone: String,
}

#[derive(Default)]
pub struct AlarmState {
    pub alarms: Mutex<Vec<Alarm>>,
}

#[tauri::command]
fn get_alarms(state: State<AlarmState>) -> Vec<Alarm> {
    state.alarms.lock().unwrap().clone()
}

#[tauri::command]
fn add_alarm(alarm: Alarm, state: State<AlarmState>) {
    let mut alarms = state.alarms.lock().unwrap();
    alarms.push(alarm);
}

#[tauri::command]
fn update_alarm(alarm: Alarm, state: State<AlarmState>) {
    let mut alarms = state.alarms.lock().unwrap();
    if let Some(existing) = alarms.iter_mut().find(|a| a.id == alarm.id) {
        *existing = alarm;
    }
}

#[tauri::command]
fn delete_alarm(id: String, state: State<AlarmState>) {
    let mut alarms = state.alarms.lock().unwrap();
    alarms.retain(|a| a.id != id);
}

#[tauri::command]
fn toggle_alarm(id: String, enabled: bool, state: State<AlarmState>) {
    let mut alarms = state.alarms.lock().unwrap();
    if let Some(alarm) = alarms.iter_mut().find(|a| a.id == id) {
        alarm.enabled = enabled;
    }
}

#[tauri::command]
fn check_alarms(state: State<AlarmState>) -> Option<Alarm> {
    let alarms = state.alarms.lock().unwrap();
    let now = Local::now();
    let current_time = now.format("%H:%M").to_string();
    let current_weekday = now.weekday().num_days_from_monday();

    for alarm in alarms.iter() {
        if alarm.enabled && alarm.time == current_time {
            if alarm.repeat_days.is_empty()
                || alarm.repeat_days.contains(&(current_weekday as u8))
            {
                return Some(alarm.clone());
            }
        }
    }
    None
}

fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let show_item = MenuItem::with_id(app, "show", "显示主界面", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

    let icon = app.default_window_icon()
        .cloned()
        .unwrap_or_else(|| Image::new(&[], 32, 32));

    let _tray = TrayIconBuilder::new()
        .icon(icon)
        .menu(&menu)
        .tooltip("Cute Alarm - 可爱闹钟")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .manage(AlarmState::default())
        .setup(|app| {
            setup_tray(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_alarms,
            add_alarm,
            update_alarm,
            delete_alarm,
            toggle_alarm,
            check_alarms
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
