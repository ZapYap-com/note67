//! Meeting detection module for detecting when meeting apps start
//! Supports browser-based meetings (Google Meet, etc.) via window title monitoring

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// Patterns to detect active meetings (not just app/page open)
const MEETING_PATTERNS: &[(&str, &str)] = &[
    // Google Meet - only when actually in a meeting (has meeting code)
    // Format when in meeting: "Meet - abc-defg-hij"
    ("Meet – ", "Google Meet"), // Note: this is an en-dash in actual titles
    ("Meet - ", "Google Meet"),
    // Zoom - only when in actual meeting
    ("Zoom Meeting", "Zoom"),
    (" - Zoom Meeting", "Zoom"),
    // Microsoft Teams - when in a call/meeting
    // Format: "Microsoft Teams meeting | Microsoft Teams" or "Chat | Name | Microsoft Teams🔊"
    ("Microsoft Teams meeting", "Microsoft Teams"),
    ("Teams meeting", "Microsoft Teams"),
    // Other meeting apps
    ("Discord | ", "Discord"),
];

/// Patterns that indicate active audio/call (speaker icon in title)
const AUDIO_ACTIVE_INDICATOR: &str = "🔊";

/// App names to check for audio indicator
const AUDIO_APPS: &[(&str, &str)] = &[
    ("Microsoft Teams", "Microsoft Teams"),
    ("Slack", "Slack"),
];

/// Patterns that indicate app is open but NOT in a meeting (to filter out false positives)
const NOT_IN_MEETING_PATTERNS: &[&str] = &[
    "New meeting",
    "Join a meeting",
    "Start a meeting",
    "Schedule a meeting",
    "Home | Microsoft Teams",
    "Chat | Microsoft Teams",
    "Teams | Microsoft Teams",
    "Calendar | Microsoft Teams",
];

#[derive(Debug, Clone, Serialize)]
pub struct MeetingDetected {
    pub app_name: String,
    pub bundle_id: Option<String>,
    pub is_browser: bool,
}

/// State for meeting detection
pub struct MeetingDetectionState {
    enabled: AtomicBool,
    running: AtomicBool,
}

impl Default for MeetingDetectionState {
    fn default() -> Self {
        Self {
            enabled: AtomicBool::new(true),
            running: AtomicBool::new(false),
        }
    }
}

impl MeetingDetectionState {
    pub fn set_enabled(&self, enabled: bool) {
        self.enabled.store(enabled, Ordering::SeqCst);
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled.load(Ordering::SeqCst)
    }
}

/// Start meeting detection (call from setup)
pub fn start_meeting_detection(app: &AppHandle) {
    let state = app.state::<Arc<MeetingDetectionState>>();

    if state.running.swap(true, Ordering::SeqCst) {
        // Already running
        return;
    }

    // Start window title monitoring for meetings
    #[cfg(target_os = "macos")]
    start_window_title_detection(app.clone());
}

#[cfg(target_os = "macos")]
fn start_window_title_detection(app: AppHandle) {
    use core_foundation::array::CFArray;
    use core_foundation::base::{CFGetTypeID, TCFType};
    use core_foundation::string::{CFString, CFStringGetTypeID};
    use core_graphics::display::{
        kCGNullWindowID, kCGWindowListOptionOnScreenOnly, CGWindowListCopyWindowInfo,
    };

    let detected_meetings: Arc<std::sync::Mutex<std::collections::HashSet<String>>> =
        Arc::new(std::sync::Mutex::new(std::collections::HashSet::new()));

    thread::spawn(move || {
        loop {
            let state = app.try_state::<Arc<MeetingDetectionState>>();
            if state.is_none() || !state.unwrap().is_enabled() {
                thread::sleep(Duration::from_secs(5));
                continue;
            }

            // Get all on-screen windows
            let windows_ptr = unsafe {
                CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly, kCGNullWindowID)
            };

            if !windows_ptr.is_null() {
                let windows: CFArray<*const std::ffi::c_void> =
                    unsafe { CFArray::wrap_under_create_rule(windows_ptr) };

                for i in 0..windows.len() {
                    // Get window dictionary
                    let window_dict = windows.get(i);
                    if window_dict.is_none() {
                        continue;
                    }
                    let window_dict = window_dict.unwrap();

                    // Get window title
                    let name_key = CFString::new("kCGWindowName");
                    let name_ptr = unsafe {
                        core_foundation::dictionary::CFDictionaryGetValue(
                            *window_dict as *const _,
                            name_key.as_concrete_TypeRef() as *const _,
                        )
                    };

                    if !name_ptr.is_null() {
                        let type_id = unsafe { CFGetTypeID(name_ptr) };
                        if type_id == unsafe { CFStringGetTypeID() } {
                            let window_title: CFString =
                                unsafe { CFString::wrap_under_get_rule(name_ptr as *const _) };
                            let title_str = window_title.to_string();

                            // Debug: print window titles to help diagnose detection
                            if !title_str.is_empty()
                                && (title_str.to_lowercase().contains("meet")
                                    || title_str.to_lowercase().contains("zoom")
                                    || title_str.to_lowercase().contains("teams"))
                            {
                                println!("[meeting-detection] Found window: '{}'", title_str);
                            }

                            // Skip if this matches a "not in meeting" pattern
                            let is_not_meeting = NOT_IN_MEETING_PATTERNS
                                .iter()
                                .any(|p| title_str.contains(p));
                            if is_not_meeting {
                                continue;
                            }

                            // Check for meeting patterns in window title
                            let mut detected_app: Option<&str> = None;

                            // First check explicit meeting patterns
                            for (pattern, meeting_name) in MEETING_PATTERNS {
                                if title_str.contains(pattern) {
                                    detected_app = Some(*meeting_name);
                                    break;
                                }
                            }

                            // If no explicit pattern, check for audio indicator (🔊)
                            if detected_app.is_none() && title_str.contains(AUDIO_ACTIVE_INDICATOR)
                            {
                                for (app_pattern, meeting_name) in AUDIO_APPS {
                                    if title_str.contains(app_pattern) {
                                        detected_app = Some(*meeting_name);
                                        break;
                                    }
                                }
                            }

                            if let Some(meeting_name) = detected_app {
                                let mut detected = detected_meetings.lock().unwrap();
                                // Use title without emoji as key (emoji changes during call)
                                let key = title_str.replace(AUDIO_ACTIVE_INDICATOR, "").trim().to_string();

                                if !detected.contains(&key) {
                                    detected.insert(key.clone());

                                    println!(
                                        "[meeting-detection] Detected {} meeting: '{}'",
                                        meeting_name, title_str
                                    );

                                    let meeting = MeetingDetected {
                                        app_name: meeting_name.to_string(),
                                        bundle_id: None,
                                        is_browser: true,
                                    };

                                    let _ = app.emit("meeting-detected", &meeting);

                                    // Remove from detected after 5 minutes to allow re-detection
                                    let detected_clone = detected_meetings.clone();
                                    let key_clone = key.clone();
                                    thread::spawn(move || {
                                        thread::sleep(Duration::from_secs(300));
                                        detected_clone.lock().unwrap().remove(&key_clone);
                                    });
                                }
                            }
                        }
                    }
                }
            }

            thread::sleep(Duration::from_secs(3));
        }
    });
}

/// Tauri command to enable/disable meeting detection
#[tauri::command]
pub fn set_meeting_detection_enabled(
    state: tauri::State<Arc<MeetingDetectionState>>,
    enabled: bool,
) {
    state.set_enabled(enabled);
}

/// Tauri command to check if meeting detection is enabled
#[tauri::command]
pub fn is_meeting_detection_enabled(state: tauri::State<Arc<MeetingDetectionState>>) -> bool {
    state.is_enabled()
}
