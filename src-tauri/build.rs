fn main() {
    // Link macOS frameworks for ScreenCaptureKit system audio capture
    #[cfg(target_os = "macos")]
    {
        println!("cargo:rustc-link-lib=framework=CoreMedia");
        println!("cargo:rustc-link-lib=framework=ScreenCaptureKit");
    }

    tauri_build::build()
}
