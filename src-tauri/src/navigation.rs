//! Keeps the window on the app. A link clicked in a summary, or HTML a model
//! wrote into one (`<meta http-equiv="refresh">`, the notes in its URL), used
//! to load another site in the app's own window: the app was gone until it
//! was restarted, and the page could take the notes with it. A CSP can't stop
//! a navigation, so every one is checked here.

use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Manager, Runtime, Url};

pub fn guard<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("stay-in-app")
        .on_navigation(|webview, url| {
            let dev_url = if tauri::is_dev() {
                webview.config().build.dev_url.as_ref()
            } else {
                None
            };
            let allowed = is_app_url(url, dev_url);
            if !allowed {
                // The origin only: the rest of the URL may be the notes.
                eprintln!(
                    "[navigation] refused {}",
                    url.origin().ascii_serialization()
                );
            }
            allowed
        })
        .build()
}

/// The app's own pages: `tauri://localhost` (macOS, Linux),
/// `http(s)://tauri.localhost` (Windows), the dev server in development, and
/// `about:blank`/`about:srcdoc` frames.
fn is_app_url(url: &Url, dev_url: Option<&Url>) -> bool {
    match url.scheme() {
        "tauri" => url.host_str() == Some("localhost"),
        "about" => true,
        "http" | "https" => {
            url.host_str() == Some("tauri.localhost")
                || dev_url.is_some_and(|dev| dev.origin() == url.origin())
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Url {
        s.parse().unwrap()
    }

    #[test]
    fn the_app_s_own_pages_load() {
        for page in [
            "tauri://localhost/",
            "tauri://localhost/index.html",
            "http://tauri.localhost/",
            "https://tauri.localhost/assets/index.js",
            "about:blank",
            "about:srcdoc",
        ] {
            assert!(is_app_url(&url(page), None), "{page}");
        }
    }

    #[test]
    fn everything_else_is_refused() {
        for page in [
            "https://example.com/leak?notes=pricing+is+%2412",
            "http://localhost:1420/",
            "http://tauri.localhost.example.com/",
            "https://example.com/?tauri.localhost",
            "tauri://example.com/",
            "http://asset.localhost/recording.wav",
            "file:///etc/hosts",
            "data:text/html,<h1>hi</h1>",
            "blob:tauri://localhost/5d4c",
            "javascript:alert(1)",
        ] {
            assert!(!is_app_url(&url(page), None), "{page}");
        }
    }

    #[test]
    fn the_dev_server_loads_only_in_development() {
        let dev = url("http://localhost:1420/");
        assert!(is_app_url(
            &url("http://localhost:1420/src/main.tsx"),
            Some(&dev)
        ));
        assert!(!is_app_url(&url("http://localhost:8080/"), Some(&dev)));
        assert!(!is_app_url(&url("http://localhost:1420/"), None));
    }
}
