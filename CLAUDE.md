# AgentMemory-Desktop

AI Agent long-term memory management with semantic search and adaptive forgetting strategies.

## Architecture
- **Backend:** Node.js + Express (`server.js`)
- **Frontend:** Plain HTML/CSS/JS (`public/index.html`)
- **Database:** SQLite via better-sqlite3 (`data/agentmemory.db`)
- **Embeddings:** Ollama API (`src/embed.js`)
- **Forgetting:** Time + importance decay (`src/forget.js`)
- **Main:** Electron (`main.js`, `preload.js`)

## Running
```bash
npm install
npm start      # Launch Electron app (opens http://localhost:3000)
npm test       # Run API tests
```

## Features
1. **Multi-Agent Memory Isolation** — Create agents, each with isolated memory stores
2. **Memory Storage** — Store memories with content, importance (1-5), tags, pinned status
3. **Semantic Search** — Vector similarity via Ollama (`nomic-embed-text`), falls back to keyword search
4. **Adaptive Forgetting** — Auto-removes low-importance old memories (configurable decay days + importance threshold)
5. **Memory Dashboard** — Stats: total, pinned, avg importance, forgetting candidates, activity chart
6. **Import/Export** — JSON backup/restore per agent

## API Endpoints
- `GET/POST /api/agents` — List/create agents
- `DELETE /api/agents/:id` — Delete agent + all memories
- `GET/POST /api/agents/:id/memories` — List/create memories (supports ?importance, ?pinned, ?tag, ?limit, ?offset)
- `PUT /api/memories/:id` — Update memory
- `DELETE /api/memories/:id` — Delete memory
- `GET /api/agents/:id/memories/search?q=query&limit=10` — Semantic/keyword search
- `GET /api/agents/:id/stats` — Dashboard stats + 30-day activity
- `POST /api/agents/:id/memories/forget` — Trigger forgetting (body: { decayDays, importanceThreshold, dryRun })
- `GET /api/export/:agentId` — Export agent + memories as JSON
- `POST /api/import/:agentId` — Import memories from JSON
- `GET/PUT /api/settings` — Global settings (ollamaUrl, decayDays, importanceThreshold)
- `GET /api/health` — Health check

## Data Model
### Agent
```json
{ "id": "uuid", "name": "string", "description": "string", "created_at": "ISO" }
```
### Memory
```json
{ "id": "uuid", "agent_id": "uuid", "content": "string", "importance": 1-5, "tags": "csv", "pinned": 0|1, "created_at": "ISO" }
```

## Ollama Setup
```bash
ollama pull nomic-embed-text
ollama serve
```
Semantic search requires Ollama running at `http://localhost:11434`. Falls back to keyword search automatically.
