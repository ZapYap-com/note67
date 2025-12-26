# Note67

A private, local meeting notes assistant. Capture audio, transcribe locally with Whisper, and generate AI-powered summaries — all on your device.

## Features

- [x] Meeting management (create, end, delete)
- [x] SQLite database for local storage
- [x] Audio recording (microphone)
- [x] Local transcription with Whisper
- [x] Speaker distinction (You vs Others) on macOS
- [x] Acoustic Echo Cancellation (AEC) for speaker usage
- [x] Live transcription during recording
- [x] Automatic filtering of blank/noise segments
- [x] Transcript viewer with search and speaker filter
- [x] AI-powered summaries via Ollama
- [x] Export to Markdown
- [x] Settings with Profile, Whisper, Ollama, System tabs
- [x] Dark mode support
- [x] Custom context menus
- [x] System tray support
- [ ] Cross-platform system audio (Windows, Linux)

## Speaker Distinction (macOS)

On macOS 13+, Note67 can distinguish between your voice and other meeting participants:

| Source | Speaker Label | How it works |
|--------|---------------|--------------|
| Microphone | "You" | Your voice via mic input |
| System Audio | "Others" | Meeting participants via ScreenCaptureKit |

**Requirements:**
- macOS 13.0 (Ventura) or later
- Screen Recording permission (System Settings → Privacy & Security → Screen Recording)
- Microphone permission

## Acoustic Echo Cancellation (AEC)

When using speakers instead of headphones, your microphone picks up audio from your speakers, causing duplicate transcriptions. Note67 includes built-in AEC to handle this:

**How it works:**
1. System audio is captured as the "reference signal"
2. Microphone input contains your voice + speaker echo
3. NLMS adaptive filter subtracts the reference from mic input
4. Result: clean voice signal without echo

**For best results:**
- Headphones are still recommended for optimal quality
- AEC handles up to 150ms of echo delay
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
| System Audio | ScreenCaptureKit (macOS), objc2 bindings |
| Echo Cancellation | NLMS adaptive filter |

## Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Rust](https://rustup.rs/)
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

## Project Structure

```
note67/
├── src/                      # React frontend
│   ├── api/                  # Tauri invoke wrappers
│   ├── components/           # React components
│   ├── hooks/                # React hooks
│   ├── stores/               # Zustand state
│   ├── types/                # TypeScript interfaces
│   └── App.tsx
├── src-tauri/                # Rust backend
│   ├── src/
│   │   ├── audio/            # Audio recording, system capture & AEC
│   │   │   ├── aec.rs        # Acoustic echo cancellation
│   │   │   ├── macos.rs      # ScreenCaptureKit integration
│   │   │   └── recorder.rs   # Microphone recording
│   │   ├── commands/         # Tauri commands
│   │   ├── db/               # SQLite database
│   │   ├── transcription/    # Whisper integration & live transcription
│   │   └── lib.rs
│   ├── Info.plist            # macOS permission descriptions
│   ├── entitlements.plist    # macOS app entitlements
│   └── Cargo.toml
└── package.json
```

## macOS Permissions

Note67 requires the following permissions on macOS:

| Permission | Purpose | When prompted |
|------------|---------|---------------|
| Microphone | Record your voice | First recording |
| Screen Recording | Capture system audio (others' voices) | When enabling speaker distinction |

## License

AGPL-3.0
