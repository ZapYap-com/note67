# Note67

A private, local meeting notes assistant. Capture audio, transcribe locally with Whisper, and generate AI-powered summaries — all on your device.

## Features

- [x] Meeting management (create, end, delete)
- [x] SQLite database for local storage
- [x] Transcript viewer with search
- [x] AI-powered summaries via Ollama
- [x] Settings with Profile, Whisper, Ollama, Best Practices tabs
- [x] Custom context menus
- [ ] Audio capture during meetings
- [ ] Local transcription with Whisper
- [ ] Cross-platform (macOS, Windows, Linux)

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18 + TypeScript + Tailwind CSS v4 |
| Backend | Rust (Tauri v2) |
| State | Zustand |
| Database | SQLite (rusqlite) |
| AI | Ollama (local LLMs), whisper-rs (planned) |

## Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Rust](https://rustup.rs/)

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
│   ├── utils/                # Utilities (seeder, etc.)
│   └── App.tsx
├── src-tauri/                # Rust backend
│   ├── src/
│   │   ├── commands/         # Tauri commands
│   │   ├── db/               # SQLite database
│   │   └── lib.rs
│   └── Cargo.toml
└── package.json
```

## License

AGPL-3.0
