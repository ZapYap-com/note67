# Note67

A private, local meeting notes assistant. Capture audio, transcribe locally with Whisper, and generate AI-powered summaries — all on your device.

## Features (Planned)

- Audio capture during meetings
- Local transcription with Whisper (no cloud)
- AI-powered meeting summaries
- Private, on-device processing
- Cross-platform (macOS, Windows, Linux)

## Tech Stack

- **Frontend**: React + TypeScript + Tailwind CSS
- **Backend**: Rust (Tauri v2)
- **State**: Zustand
- **AI**: whisper-rs, llama-cpp-rs (planned)

## Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Rust](https://rustup.rs/)
- [Tauri CLI](https://tauri.app/)

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install Tauri CLI
cargo install tauri-cli
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
| `npm run dev` | Start Vite dev server |
| `npm run tauri dev` | Run Tauri app in dev mode |
| `npm run tauri build` | Build production app |
| `npm run lint` | Run ESLint |
| `npm run format` | Format code with Prettier |

## Project Structure

```
note67/
├── src/                  # React frontend
│   ├── stores/           # Zustand state
│   ├── App.tsx
│   └── main.tsx
├── src-tauri/            # Rust backend
│   ├── src/
│   │   ├── lib.rs        # Tauri commands
│   │   └── main.rs
│   └── Cargo.toml
├── plan/                 # Implementation docs
└── package.json
```

## License

MIT
