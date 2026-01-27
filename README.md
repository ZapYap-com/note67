# [![Note67](public/logo-readme.png)](https://note67.com)

[Visit Website](https://note67.com)

<a href="https://www.producthunt.com/products/note67-private-meeting-notes-assistant?utm_source=badge-follow&utm_medium=badge&utm_souce=badge-note67" target="_blank"><img src="https://api.producthunt.com/widgets/embed-image/v1/follow.svg?product_id=763215&theme=light" alt="Note67 - Private meeting notes assistant | Product Hunt" style="width: 250px; height: 54px;" width="250" height="54" /></a>

**🚀 We're on Product Hunt!** If you find Note67 useful, please consider [upvoting us on Product Hunt](https://www.producthunt.com/products/note67-private-meeting-notes-assistant) — it helps others discover the project!

A private, local meeting notes assistant. Capture audio, transcribe locally with Whisper, and generate AI-powered summaries — all on your device.

## Features

- [x] Meeting management (create, end, delete)
- [x] SQLite database for local storage
- [x] Audio recording (microphone)
- [x] Local transcription with Whisper
- [x] Speaker distinction (You vs Others) on macOS
- [x] Echo deduplication for speaker usage
- [x] Live transcription during recording
- [x] Auto-retranscribe after recording for improved accuracy
- [x] Pause/Resume recording
- [x] Continue recording on existing notes (Listen)
- [x] Upload external audio files for transcription
- [x] Download and delete audio files
- [x] Reorder audio files with up/down controls
- [x] Retranscribe audio with different Whisper model
- [x] Voice Activity Detection (VAD) for mic input
- [x] Automatic filtering of blank/noise segments
- [x] Transcript viewer with search and speaker filter
- [x] AI-powered summaries via Ollama
- [x] Export to Markdown
- [x] Settings with Profile, Whisper, Ollama, System tabs
- [x] Dark mode support
- [x] Custom context menus
- [x] System tray support
- [x] Cross-platform system audio (Windows via WASAPI)
- [ ] Linux system audio support

## Screenshots

| Light Mode | Dark Mode | Settings |
|------------|-----------|----------|
| ![Main view - Light](public/screenshots/main-light.png) | ![Main view - Dark](public/screenshots/main-dark.png) | ![Settings](public/screenshots/settings.png) |

**AI Summary**

![Note with AI Summary](public/screenshots/note-summary.png)

## Speaker Distinction

Note67 can distinguish between your voice and other meeting participants:

| Source | Speaker Label | How it works |
|--------|---------------|--------------|
| Microphone | "You" | Your voice via mic input |
| System Audio | "Others" | Meeting participants via system audio capture |

### macOS Requirements
- macOS 13.0 (Ventura) or later
- Screen Recording permission (System Settings → Privacy & Security → Screen Recording)
- Microphone permission

### Windows Requirements
- Windows 10 or later
- Microphone permission
- No additional permissions needed for system audio (WASAPI loopback)

## Echo Handling

When using speakers instead of headphones, your microphone picks up audio from your speakers, causing duplicate transcriptions. Note67 handles this with a multi-layer approach:

**How it works:**
1. **Voice Activity Detection (VAD)** - Mic audio is only transcribed if RMS energy exceeds threshold, filtering silence and ambient noise
2. **Echo Deduplication** - Mic transcripts are compared against a 30-second rolling history of system audio segments
3. **Text Similarity Matching** - If mic text shares 3+ words with overlapping system audio, it's filtered as echo

**For best results:**
- Headphones are still recommended for optimal quality
- Works automatically when system audio capture is enabled

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18 + TypeScript + Tailwind CSS v4 |
| Backend | Rust (Tauri v2) |
| State | Zustand |
| Database | SQLite (rusqlite) |
| Transcription | whisper-rs (local Whisper models) |
| AI Summaries | Ollama (local LLMs) |
| System Audio | ScreenCaptureKit (macOS), WASAPI loopback (Windows) |
| Echo Handling | VAD + post-processing deduplication |

## Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Rust](https://rust-lang.org/)
- [Ollama](https://ollama.ai/) (for AI summaries)

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install Tauri CLI
cargo install tauri-cli

# Install Ollama and pull a model
brew install ollama
ollama pull llama3.2
```

## Development

```bash
# Install dependencies
npm install

# Run dev server (opens app window)
npm run tauri dev

# Build for production
npm run tauri build
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run tauri dev` | Run Tauri app in dev mode |
| `npm run tauri build` | Build production app |
| `npm run lint` | Run ESLint |
| `npm run format` | Format code with Prettier |

## Permissions

### macOS

| Permission | Purpose | When prompted |
|------------|---------|---------------|
| Microphone | Record your voice | First recording |
| Screen Recording | Capture system audio (others' voices) | When enabling speaker distinction |

### Windows

| Permission | Purpose | When prompted |
|------------|---------|---------------|
| Microphone | Record your voice | First recording |

Note: Windows system audio capture via WASAPI loopback does not require additional permissions.

## License

AGPL-3.0
