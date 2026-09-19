fn main() {
    // Link macOS frameworks for ScreenCaptureKit system audio capture
    #[cfg(target_os = "macos")]
    {
        println!("cargo:rustc-link-lib=framework=CoreMedia");
        println!("cargo:rustc-link-lib=framework=ScreenCaptureKit");
    }

    let mut attributes = tauri_build::Attributes::new();
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let target_env = std::env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default();
    if target_os == "windows" && target_env == "msvc" {
        // tauri-build embeds its app manifest (Common Controls v6, which
        // Tauri's dialogs need) in the app only. Test executables linked
        // without it can't start (STATUS_ENTRYPOINT_NOT_FOUND), so the linker
        // embeds the same manifest, copied from tauri-build, in every
        // executable instead.
        let manifest =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("windows-app-manifest.xml");
        println!("cargo:rerun-if-changed={}", manifest.display());
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
        attributes = attributes
            .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
    }

    if let Err(error) = tauri_build::try_build(attributes) {
        println!("{error:#}");
        std::process::exit(1);
    }
}
