//! Meeting detection: notices when a call starts and offers to record it.
//! Works from on-screen window titles (Google Meet, Zoom, Teams, Slack
//! huddles), which macOS only exposes with Screen Recording permission.

// Elsewhere nothing polls, so the detector is compiled (and tested) unused.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

use crate::audio::RecordingPhase;
use crate::commands::AudioState;
use crate::db::Database;

/// Settings key for the on/off switch. Absent means on, the default.
const ENABLED_SETTING: &str = "meeting_detection_enabled";

/// How long an app must show no meeting window before its meeting counts as
/// over: the prompt for it goes away, and a new meeting in it prompts again.
const ABSENT_BEFORE_ENDED: Duration = Duration::from_secs(120);

/// Window titles that mean an app is in a meeting (not just open).
const MEETING_PATTERNS: &[(&str, &str)] = &[
    // Google Meet in a meeting: "Meet – abc-defg-hij" (en dash) or a hyphen
    ("Meet – ", "Google Meet"),
    ("Meet - ", "Google Meet"),
    ("Zoom Meeting", "Zoom"),
    ("Microsoft Teams meeting", "Microsoft Teams"),
    ("Teams meeting", "Microsoft Teams"),
    // "Huddle: #channel – Workspace – Slack 🎤"
    ("Huddle:", "Slack Huddle"),
];

/// Shown in a title while the app is playing call audio.
const AUDIO_ACTIVE_INDICATOR: &str = "🔊";

/// Apps that count as in a meeting only while their title carries 🔊. Teams'
/// "| Personal |" and any "Discord | " window used to count on their own, so
/// merely having Teams or Discord open prompted to record.
const AUDIO_APPS: &[(&str, &str)] = &[
    ("Microsoft Teams", "Microsoft Teams"),
    ("Slack", "Slack"),
    ("Discord", "Discord"),
];

/// Titles of an app that is open but not in a meeting.
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

/// The meeting app a window title belongs to, if the window is a meeting.
fn meeting_app(title: &str) -> Option<&'static str> {
    if NOT_IN_MEETING_PATTERNS.iter().any(|p| title.contains(p)) {
        return None;
    }
    if let Some((_, app)) = MEETING_PATTERNS.iter().find(|(p, _)| title.contains(p)) {
        return Some(app);
    }
    if title.contains(AUDIO_ACTIVE_INDICATOR) {
        return AUDIO_APPS
            .iter()
            .find(|(p, _)| title.contains(p))
            .map(|(_, app)| *app);
    }
    None
}

/// Decides when a meeting starts and ends: once per meeting, keyed by app.
///
/// Detections used to be keyed by the full window title, which changes during
/// a call (a browser tab switch, the 🔊 and 🎤 indicators), so the same call
/// prompted again. A meeting window also drops out of the on-screen list
/// whenever its tab is in the background or its window is minimized, so an
/// app's meeting ends only after it has shown no meeting window for
/// `ABSENT_BEFORE_ENDED`. Start and end share that one clock: a prompt taken
/// down as the meeting ended comes back if the meeting does, and a dismissed
/// prompt stays dismissed until then.
#[derive(Default)]
struct PromptGate {
    last_seen: HashMap<&'static str, Instant>,
}

#[derive(Default)]
struct Tick {
    /// Apps whose meeting just started.
    started: Vec<&'static str>,
    /// Apps whose meeting just ended.
    gone: Vec<&'static str>,
}

impl PromptGate {
    fn tick(&mut self, now: Instant, in_meeting: &HashSet<&'static str>) -> Tick {
        let mut gone = Vec::new();
        self.last_seen.retain(|app, seen| {
            let ongoing = now.duration_since(*seen) < ABSENT_BEFORE_ENDED;
            if !ongoing {
                gone.push(*app);
            }
            ongoing
        });
        let mut started = Vec::new();
        for app in in_meeting {
            if self.last_seen.insert(app, now).is_none() {
                started.push(*app);
            }
        }
        Tick { started, gone }
    }
}

/// State for meeting detection
pub struct MeetingDetectionState {
    enabled: AtomicBool,
    running: AtomicBool,
    gate: Mutex<PromptGate>,
}

impl Default for MeetingDetectionState {
    fn default() -> Self {
        Self {
            enabled: AtomicBool::new(true),
            running: AtomicBool::new(false),
            gate: Mutex::new(PromptGate::default()),
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

    /// One poll. `window_titles` runs only when detection is on: while it is
    /// off, no window is read at all.
    fn poll(&self, now: Instant, window_titles: impl FnOnce() -> Vec<String>) -> Tick {
        if !self.is_enabled() {
            return Tick::default();
        }
        let current: HashSet<&'static str> = window_titles()
            .iter()
            .filter_map(|t| meeting_app(t))
            .collect();
        self.gate.lock().unwrap().tick(now, &current)
    }
}

/// Whether detection is switched on in settings (absent = on).
fn enabled_in_settings(db: &Database) -> bool {
    db.get_setting(ENABLED_SETTING).ok().flatten().as_deref() != Some("false")
}

/// Start meeting detection (call from setup)
pub fn start_meeting_detection(app: &AppHandle) {
    let state = app.state::<Arc<MeetingDetectionState>>();

    if state.running.swap(true, Ordering::SeqCst) {
        // Already running
        return;
    }
    if let Some(db) = app.try_state::<Database>() {
        state.set_enabled(enabled_in_settings(&db));
    }

    // Window titles are only readable this way on macOS.
    #[cfg(target_os = "macos")]
    {
        let app = app.clone();
        std::thread::spawn(move || {
            loop {
                if let Some(state) = app.try_state::<Arc<MeetingDetectionState>>() {
                    let tick = state.poll(Instant::now(), macos::window_titles);
                    report(&app, tick);
                }
                std::thread::sleep(Duration::from_secs(3));
            }
        });
    }
}

/// Tell the frontend about meetings that started or ended.
fn report(app: &AppHandle, tick: Tick) {
    for app_name in tick.gone {
        let _ = app.emit("meeting-ended", app_name);
    }
    // Never while a session is open: the meeting is probably the one being
    // recorded, and a second recording can't start anyway.
    let session_open = app
        .try_state::<AudioState>()
        .is_some_and(|audio| audio.recording.get_phase() != RecordingPhase::Idle);
    if session_open {
        return;
    }
    for app_name in tick.started {
        // Once per meeting, and without the window title: titles name the
        // meeting and whoever is in it.
        println!("[meeting-detection] Detected a {} meeting", app_name);
        let meeting = MeetingDetected {
            app_name: app_name.to_string(),
            bundle_id: None,
            is_browser: true,
        };
        let _ = app.emit("meeting-detected", &meeting);
        // The prompt lives in the main window, which is usually hidden in the
        // tray during a call; show it (without stealing focus).
        crate::reveal_main_window(app);
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use core_foundation::array::CFArray;
    use core_foundation::base::{CFGetTypeID, TCFType};
    use core_foundation::string::{CFString, CFStringGetTypeID};
    use core_graphics::display::{
        CGWindowListCopyWindowInfo, kCGNullWindowID, kCGWindowListOptionOnScreenOnly,
    };

    /// Titles of all on-screen windows. Other apps' titles are withheld
    /// without Screen Recording permission, so detection then finds nothing.
    pub fn window_titles() -> Vec<String> {
        let windows_ptr =
            unsafe { CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly, kCGNullWindowID) };
        if windows_ptr.is_null() {
            return Vec::new();
        }
        let windows: CFArray<*const std::ffi::c_void> =
            unsafe { CFArray::wrap_under_create_rule(windows_ptr) };
        let name_key = CFString::new("kCGWindowName");

        let mut titles = Vec::new();
        for i in 0..windows.len() {
            let Some(window_dict) = windows.get(i) else {
                continue;
            };
            let name_ptr = unsafe {
                core_foundation::dictionary::CFDictionaryGetValue(
                    *window_dict as *const _,
                    name_key.as_concrete_TypeRef() as *const _,
                )
            };
            if name_ptr.is_null()
                || unsafe { CFGetTypeID(name_ptr) } != unsafe { CFStringGetTypeID() }
            {
                continue;
            }
            let title: CFString = unsafe { CFString::wrap_under_get_rule(name_ptr as *const _) };
            titles.push(title.to_string());
        }
        titles
    }
}

/// Turn meeting detection on or off; the choice is saved.
#[tauri::command]
pub fn set_meeting_detection_enabled(
    state: tauri::State<Arc<MeetingDetectionState>>,
    db: tauri::State<Database>,
    enabled: bool,
) -> Result<(), String> {
    db.set_setting(ENABLED_SETTING, if enabled { "true" } else { "false" })
        .map_err(|e| e.to_string())?;
    state.set_enabled(enabled);
    Ok(())
}

/// Tauri command to check if meeting detection is enabled
#[tauri::command]
pub fn is_meeting_detection_enabled(state: tauri::State<Arc<MeetingDetectionState>>) -> bool {
    state.is_enabled()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn meetings_are_recognised_from_window_titles() {
        assert_eq!(meeting_app("Meet – abc-defg-hij"), Some("Google Meet"));
        assert_eq!(meeting_app("Zoom Meeting"), Some("Zoom"));
        assert_eq!(
            meeting_app("Huddle: #design – Acme – Slack 🎤"),
            Some("Slack Huddle")
        );
        assert_eq!(
            meeting_app("🔊 Weekly | Microsoft Teams"),
            Some("Microsoft Teams")
        );

        assert_eq!(meeting_app("Home | Microsoft Teams"), None);
        assert_eq!(meeting_app("Meet - Join a meeting"), None);
        // An open app is not a call.
        assert_eq!(
            meeting_app("Jane | Personal | jane@acme.com | Microsoft Teams"),
            None
        );
        assert_eq!(meeting_app("Discord | #general | Friends"), None);
        assert_eq!(meeting_app("🔊 Discord | #voice"), Some("Discord"));
    }

    fn apps(list: &[&'static str]) -> HashSet<&'static str> {
        list.iter().copied().collect()
    }

    #[test]
    fn a_meeting_prompts_once_even_as_its_title_changes() {
        let state = MeetingDetectionState::default();
        let t0 = Instant::now();
        let started = |at: Instant, titles: &[&str]| {
            let titles: Vec<String> = titles.iter().map(|t| t.to_string()).collect();
            state.poll(at, || titles).started
        };

        assert_eq!(started(t0, &["Meet – abc-defg-hij"]), ["Google Meet"]);
        // Same call, different title (tab switch, speaking indicator).
        assert!(started(t0 + Duration::from_secs(3), &["Meet – abc-defg-hij 🔊"]).is_empty());
        // Gone for a minute, then back: still the same meeting.
        assert!(started(t0 + Duration::from_secs(6), &[]).is_empty());
        assert!(started(t0 + Duration::from_secs(66), &["Meet - abc-defg-hij"]).is_empty());
        // Gone for over two minutes: a new meeting prompts again.
        assert!(started(t0 + Duration::from_secs(69), &[]).is_empty());
        assert_eq!(
            started(t0 + Duration::from_secs(69 + 125), &["Meet – xyz-abcd-efg"]),
            ["Google Meet"]
        );
    }

    #[test]
    fn a_meeting_ends_after_two_minutes_without_its_window() {
        let state = MeetingDetectionState::default();
        let t0 = Instant::now();
        let gone = |at: Instant, titles: &[&str]| {
            let titles: Vec<String> = titles.iter().map(|t| t.to_string()).collect();
            state.poll(at, || titles).gone
        };

        assert!(gone(t0, &["Meet – abc-defg-hij"]).is_empty());
        // Another tab in front hides the meeting's title: that's not the end.
        assert!(gone(t0 + Duration::from_secs(3), &["Inbox - Gmail"]).is_empty());
        assert!(gone(t0 + Duration::from_secs(119), &["Inbox - Gmail"]).is_empty());
        assert_eq!(gone(t0 + Duration::from_secs(122), &[]), ["Google Meet"]);
        // Reported once.
        assert!(gone(t0 + Duration::from_secs(125), &[]).is_empty());
    }

    #[test]
    fn a_meeting_that_ended_prompts_again_when_it_returns() {
        let state = MeetingDetectionState::default();
        let t0 = Instant::now();
        let zoom = || vec!["Zoom Meeting".to_string()];
        assert_eq!(state.poll(t0, zoom).started, ["Zoom"]);
        assert_eq!(
            state.poll(t0 + Duration::from_secs(123), Vec::new).gone,
            ["Zoom"]
        );
        assert_eq!(
            state.poll(t0 + Duration::from_secs(126), zoom).started,
            ["Zoom"]
        );

        // Back in the very poll that ends it: that is both an end and a new
        // start, reported in that order, so the prompt comes back.
        let tick = state.poll(t0 + Duration::from_secs(126 + 120), zoom);
        assert_eq!(tick.gone, ["Zoom"]);
        assert_eq!(tick.started, ["Zoom"]);
    }

    #[test]
    fn when_off_no_window_is_read() {
        let state = MeetingDetectionState::default();
        state.set_enabled(false);
        let tick = state.poll(Instant::now(), || panic!("read windows while off"));
        assert!(tick.started.is_empty());
    }

    #[test]
    fn the_setting_round_trips_and_defaults_to_on() {
        let db = Database::in_memory();
        assert!(enabled_in_settings(&db));
        db.set_setting(ENABLED_SETTING, "false").unwrap();
        assert!(!enabled_in_settings(&db));
        db.set_setting(ENABLED_SETTING, "true").unwrap();
        assert!(enabled_in_settings(&db));
    }

    #[test]
    fn the_gate_forgets_apps_only_after_two_minutes_away() {
        let mut gate = PromptGate::default();
        let t0 = Instant::now();
        assert_eq!(gate.tick(t0, &apps(&["Zoom"])).started, ["Zoom"]);
        assert!(
            gate.tick(t0 + Duration::from_secs(119), &apps(&["Zoom"]))
                .started
                .is_empty()
        );
        assert_eq!(
            gate.tick(t0 + Duration::from_secs(119 + 121), &apps(&["Zoom"]))
                .started,
            ["Zoom"]
        );
    }
}
