# 🧠 AgentMemory-Desktop

> AI Agent long-term memory management with semantic search and adaptive forgetting strategies.

[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Overview

AgentMemory-Desktop is a local desktop application for managing the long-term memory of AI agents. It provides:

- **Multi-Agent Memory Isolation** — Create separate agents, each with fully isolated memory stores
- **Semantic Search** — Vector similarity search powered by Ollama embeddings, with automatic fallback to keyword search
- **Adaptive Forgetting** — Configurable time + importance decay that automatically removes low-value memories
- **Memory Dashboard** — Visual stats: total memories, pinned count, avg importance, forgetting candidates, 30-day activity chart
- **Import/Export** — JSON backup and restore per agent

## Tech Stack

- **Electron** — Desktop wrapper
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

### Run tests

```bash
npm test
```

## Features

### 🗂️ Multi-Agent Management
Create as many agents as you need. Each agent has completely isolated memories — perfect for managing different AI agents, projects, or personas.

### 🔍 Semantic Search
Ask natural language questions and find semantically relevant memories using Ollama's `nomic-embed-text` embeddings. The system gracefully falls back to keyword matching if Ollama is unavailable.

### 🧹 Adaptive Forgetting
Configure when memories should fade:
- **Decay days** — How old before a memory becomes a forgetting candidate
- **Importance threshold** — How low can importance go before eligible for forgetting
- **Pinned memories** — Always preserved, even if old and low importance

### 📊 Dashboard
Visual overview of your agent's memory state — total count, importance distribution, forgetting candidates, and a 30-day activity chart.

### 💾 Import/Export
Export any agent's entire memory as JSON for backup or migration. Import into another agent or restore later.

## Screenshots

The app features a dark-themed UI with:
- Left sidebar for agent list management
- Tabbed main area: Memories / Search / Dashboard / Settings
- Semantic search powered by vector embeddings
- Activity chart showing memory creation over time

## License

MIT © ZSeven-W
