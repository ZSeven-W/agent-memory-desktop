# 🧠 AgentMemory-Desktop

> AI Agent long-term memory management with semantic search and adaptive forgetting strategies.

[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Overview

AgentMemory-Desktop is a local desktop application for managing the long-term memory of AI agents. It provides:

- **Multi-Agent Memory Isolation** — Create separate agents, each with fully isolated memory stores
- **Semantic Search** — Vector similarity search powered by Ollama embeddings, with automatic fallback to keyword search
- **Adaptive Forgetting** — Configurable time + importance decay that automatically removes low-value memories
- **Memory Dashboard** — Visual stats: tag cloud, importance distribution, forgetting timeline, activity chart
- **Import/Export** — JSON backup and restore per agent
- **Memory Linking** — Link memories to each other with relation types (parent, child, supports, etc.)
- **Bulk Operations** — Multi-select memories for bulk pin/tag/delete/importance change
- **Tag Management** — Browse all tags, rename, and merge tags across memories
- **Memory Templates** — Quick-add templates for Tasks, Ideas, Meetings, Code Snippets, etc.
- **System Tray** — Runs in background, right-click menu
- **Global Hotkey** — `Ctrl/Cmd+Shift+M` opens quick memory capture from anywhere

## Tech Stack

- **Electron** — Desktop wrapper (system tray, global hotkeys)
- **Express** — REST API server
- **SQLite** (better-sqlite3) — Local database
- **Ollama** — Semantic embeddings (optional, falls back gracefully)

## Getting Started

```bash
npm install
npm start
```

The app will open at `http://localhost:3000`.

### Ollama (for semantic search)

```bash
ollama pull nomic-embed-text
ollama serve
```

If Ollama is not available, the app automatically falls back to keyword search.

### System Tray & Global Hotkey

- The app minimizes to system tray instead of closing
- Right-click tray icon: Open, Quick Add Memory, Quit
- `Ctrl+Shift+M` (Windows/Linux) or `Cmd+Shift+M` (macOS) opens quick memory capture popup

### Run tests

```bash
npm test
```

## Features

### 🗂️ Multi-Agent Management
Create as many agents as you need. Each agent has completely isolated memories — perfect for managing different AI agents, projects, or personas.

### 🔍 Semantic Search
Ask natural language questions and find semantically relevant memories using Ollama's `nomic-embed-text` embeddings. The system gracefully falls back to keyword matching if Ollama is unavailable. Filter by date range, minimum importance, and sort by relevance, date, or importance.

### 🧹 Adaptive Forgetting
Configure when memories should fade:
- **Decay days** — How old before a memory becomes a forgetting candidate
- **Importance threshold** — How low can importance go before eligible for forgetting
- **Pinned memories** — Always preserved, even if old and low importance

### 📊 Enhanced Dashboard
Visual overview of your agent's memory state:
- Total memories, pinned count, avg importance, forgetting candidates
- Tag cloud (tags sized by frequency)
- Importance distribution chart (bar chart)
- 30-day forgetting timeline (total + at-risk memories per day)
- Memory linking stats (total links, most-linked memories)
- Activity chart showing memory creation over time

### 🔗 Memory Linking
Link memories to each other with relation types: Related, Parent, Child, Depends On, Supports, Contrasts With, See Also. Links are bidirectional and appear in both memories' detail views.

### 🏷️ Tag Management
Browse all tags across memories with counts. Rename tags (updates all memories) or merge one tag into another.

### 📝 Memory Templates
Quick-add templates for common memory types:
- General Note, Task, Idea, Meeting, Code Snippet, URL/Link, Question

### 💾 Import/Export
Export any agent's entire memory as JSON for backup or migration. Import into another agent or restore later.

## Architecture

```
┌─────────────────────────────────────────┐
│            Electron Main Process        │
│  (Tray, Global Hotkey, Window Mgmt)   │
└─────────────────┬───────────────────────┘
                  │ IPC
┌─────────────────▼───────────────────────┐
│        Express REST API (port 3000)    │
│  /api/agents, /api/memories, /api/tags │
│  /api/search, /api/stats, /api/settings │
└─────────────────┬───────────────────────┘
                  │
        ┌─────────▼──────────┐
        │  SQLite (WAL mode) │
        │  agents, memories  │
        │  memory_links,     │
        │  embeddings,       │
        │  settings          │
        └────────────────────┘
                  │
        ┌─────────▼──────────┐
        │  Ollama API        │
        │  (nomic-embed-text)│
        └────────────────────┘
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/health | Health check |
| GET | /api/agents | List agents |
| POST | /api/agents | Create agent |
| DELETE | /api/agents/:id | Delete agent + memories + links |
| GET | /api/agents/:id/memories | List memories (filters) |
| POST | /api/agents/:id/memories | Create memory |
| PUT | /api/memories/:id | Update memory |
| DELETE | /api/memories/:id | Delete memory |
| GET | /api/memories/:id/links | Get memory links |
| POST | /api/memories/:id/links | Create memory link |
| DELETE | /api/memories/:id/links/:linkId | Delete link |
| GET | /api/agents/:id/memories/search | Semantic search + filters |
| GET | /api/agents/:id/stats | Enhanced stats (dashboard) |
| POST | /api/agents/:id/memories/forget | Trigger forgetting |
| GET | /api/tags?agentId= | Get all tags with counts |
| PUT | /api/tags/:name | Rename tag |
| POST | /api/tags/:name/merge | Merge tag |
| GET | /api/export/:agentId | Export JSON |
| POST | /api/import/:agentId | Import JSON |
| GET/PUT | /api/settings | Global settings |

## Troubleshooting

**App won't start**: Make sure port 3000 is not in use by another application.

**Semantic search returns no results**: Ollama may not be running. The app automatically falls back to keyword search. Start Ollama with `ollama serve` and pull the model: `ollama pull nomic-embed-text`.

**System tray not showing**: On some Linux distros you may need a tray icon package installed (e.g., `libappindicator3-dev` on Ubuntu).

**Global hotkey not working**: Make sure no other application is using `Ctrl/Cmd+Shift+M`.

**Database errors**: Delete `data/agentmemory.db` to reset the database (this will lose all data).

## License

MIT © ZSeven-W
