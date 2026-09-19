//! What the frontend can reach on disk, checked against the real capability
//! file and tauri.conf.json. A script injected into the page (say, through a
//! note's content) gets exactly this: read the recordings, write only where
//! the user chose in a save dialog, and load recordings and pasted images
//! through the asset protocol. Not the database, the models or anything else
//! in app data, which the fs and asset scopes used to cover in full.
//!
//! Every path probed outside the allowed set doesn't exist, so a scope that
//! is too broad fails the test with a "not found" instead of touching real
//! data.

use std::path::{Path, PathBuf};

use tauri::http::{HeaderMap, HeaderValue};
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{INVOKE_KEY, MockRuntime, get_ipc_response, mock_builder};
use tauri::webview::InvokeRequest;
use tauri::{App, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_fs::FsExt;

fn app() -> App<MockRuntime> {
    let app = mock_builder()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .build(crate::app_context())
        .expect("the app builds on the mock runtime");
    // The window the capability is granted to. The mock builder doesn't open
    // the config's windows.
    WebviewWindowBuilder::new(&app, "main", WebviewUrl::default())
        .build()
        .expect("the main window");
    app
}

fn app_data(app: &App<MockRuntime>) -> PathBuf {
    app.path().app_data_dir().unwrap()
}

/// Sends an fs command from the main window, as the frontend would.
fn invoke(
    app: &App<MockRuntime>,
    cmd: &str,
    body: InvokeBody,
    headers: HeaderMap,
) -> Result<(), String> {
    let webview = app.get_webview_window("main").expect("the main window");
    let request = InvokeRequest {
        cmd: cmd.into(),
        callback: CallbackFn(0),
        error: CallbackFn(1),
        url: if cfg!(windows) {
            "http://tauri.localhost"
        } else {
            "tauri://localhost"
        }
        .parse()
        .unwrap(),
        body,
        headers,
        invoke_key: INVOKE_KEY.to_string(),
    };
    get_ipc_response(&webview, request)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

fn read(app: &App<MockRuntime>, path: &Path) -> Result<(), String> {
    let body = InvokeBody::Json(serde_json::json!({ "path": path }));
    invoke(app, "plugin:fs|read_file", body, HeaderMap::new())
}

fn write(app: &App<MockRuntime>, path: &Path) -> Result<(), String> {
    let mut headers = HeaderMap::new();
    headers.insert(
        "path",
        HeaderValue::from_str(&path.to_string_lossy()).unwrap(),
    );
    invoke(
        app,
        "plugin:fs|write_file",
        InvokeBody::Raw(b"# Notes".to_vec()),
        headers,
    )
}

/// Sends an opener command. Every probe is refused before anything opens,
/// and names nothing that exists, in case it isn't.
fn opener(app: &App<MockRuntime>, cmd: &str, args: serde_json::Value) -> Result<(), String> {
    invoke(
        app,
        &format!("plugin:opener|{cmd}"),
        InvokeBody::Json(args),
        HeaderMap::new(),
    )
}

fn forbidden(result: &Result<(), String>) -> bool {
    matches!(result, Err(e) if e.contains("forbidden path"))
}

#[test]
fn the_frontend_reads_only_recordings() {
    let app = app();
    let data = app_data(&app);

    // Allowed, so it gets as far as the disk, which says the file isn't there.
    let recording = read(&app, &data.join("recordings/probe-missing.wav"));
    assert!(
        matches!(&recording, Err(e) if e.contains("os error") && !e.contains("forbidden")),
        "{recording:?}"
    );

    for path in [
        data.join("probe-missing.db"),
        data.join("models/probe-missing.bin"),
        data.join("attachments/n1/probe-missing.png"),
        std::env::temp_dir().join("probe-missing.txt"),
    ] {
        let result = read(&app, &path);
        assert!(
            forbidden(&result),
            "{} was readable: {result:?}",
            path.display()
        );
    }
}

#[test]
fn the_frontend_writes_only_where_the_user_chose() {
    let app = app();
    let dir = std::fs::canonicalize(std::env::temp_dir())
        .unwrap()
        .join(format!("note67-access-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let export = dir.join("Weekly sync.md");

    assert!(forbidden(&write(&app, &export)));
    for path in [
        app_data(&app).join("probe-missing/note67.db"),
        app_data(&app).join("recordings/probe-missing/call.wav"),
    ] {
        let result = write(&app, &path);
        assert!(
            forbidden(&result),
            "{} was writable: {result:?}",
            path.display()
        );
    }

    // What the save dialog does with the path the user picked.
    app.fs_scope().allow_file(&export).unwrap();
    write(&app, &export).unwrap();
    assert_eq!(std::fs::read(&export).unwrap(), b"# Notes");

    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn the_asset_protocol_serves_only_recordings_and_images() {
    let app = app();
    let data = app_data(&app);
    let scope = app.asset_protocol_scope();

    assert!(scope.is_allowed(data.join("recordings/n1_playback.wav")));
    assert!(scope.is_allowed(data.join("attachments/n1/pasted.png")));
    assert!(!scope.is_allowed(data.join("note67.db")));
    assert!(!scope.is_allowed(data.join("models/ggml-base.en.bin")));
}

#[test]
fn links_open_only_as_web_or_mail_links_in_the_default_browser() {
    let app = app();
    // Refused by the URL scope, so the command itself is granted.
    let refused_url = |result: &Result<(), String>| matches!(result, Err(e) if e.contains("Not allowed to open url"));

    for url in ["file:///note67-probe-missing.txt", "note67-probe://open"] {
        let result = opener(&app, "open_url", serde_json::json!({ "url": url }));
        assert!(refused_url(&result), "{url}: {result:?}");
    }
    // Not even a web link, with a program other than the default browser.
    let result = opener(
        &app,
        "open_url",
        serde_json::json!({ "url": "https://example.com/", "with": "note67-probe-no-such-app" }),
    );
    assert!(refused_url(&result), "{result:?}");

    // Opening files, or showing them in Finder, isn't granted at all.
    for (cmd, args) in [
        (
            "open_path",
            serde_json::json!({ "path": "/note67-probe-missing.txt" }),
        ),
        (
            "reveal_item_in_dir",
            serde_json::json!({ "paths": ["/note67-probe-missing.txt"] }),
        ),
    ] {
        let result = opener(&app, cmd, args);
        assert!(
            matches!(&result, Err(e) if e.contains(&format!("opener.{cmd} not allowed"))),
            "{cmd}: {result:?}"
        );
    }
}
