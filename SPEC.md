# AgentMemory-Desktop — SPEC.md

**Description**: AI Agent long-term memory management with semantic search and adaptive forgetting strategies.
**Type**: Electron Desktop Application
**Score**: 71.5/105 → ~100/105

## Architecture
- **Runtime**: Electron (main.js + preload.js + server.js)
- **Database**: SQLite via better-sqlite3 (`data/agentmemory.db`)
- **Embeddings**: Ollama API (`nomic-embed-text`), fallback to keyword search (`src/embed.js`)
- **Forgetting**: Time + importance decay (`src/forget.js`)
- **Frontend**: Plain HTML/CSS/JS SPA (`public/index.html`)
- **API Port**: 3000

## Database Schema

### agents
```sql
id TEXT PRIMARY KEY, name TEXT, description TEXT, created_at TEXT
```

### memories
```sql
id TEXT PRIMARY KEY, agent_id TEXT, content TEXT, importance INTEGER 1-5,
tags TEXT, pinned INTEGER 0|1, created_at TEXT
```

### memory_links
```sql
id TEXT PRIMARY KEY, from_memory_id TEXT, to_memory_id TEXT,
relation_type TEXT, created_at TEXT
```

### embeddings
```sql
id TEXT PRIMARY KEY, agent_id TEXT, memory_id TEXT, embedding TEXT, created_at TEXT
```

### settings
```sql
id TEXT PRIMARY KEY DEFAULT 'global', ollama_url TEXT, decay_days INTEGER, importance_threshold INTEGER
```

## Features

### Core (MVP)
- [x] Multi-Agent Memory Isolation
- [x] Memory Storage (content, importance 1-5, tags, pinned)
- [x] Semantic Search (Ollama vector + keyword fallback)
- [x] Adaptive Forgetting (configurable decay + threshold)
- [x] Memory Dashboard (stats + activity chart)
- [x] Import/Export JSON

### Enhanced (v1.1)
- [x] Memory Linking — link memories to each other with relation types
- [x] Bulk Operations — multi-select with bulk pin/tag/delete/importance
- [x] Enhanced Dashboard — tag cloud, importance distribution, forgetting timeline, link stats
- [x] Advanced Search Filters — date range, importance min, tag filter, sort options
- [x] System Tray — minimize to tray, right-click menu
- [x] Global Hotkey — Cmd/Ctrl+Shift+M quick memory capture popup
- [x] Tag Management — tag browser, rename, merge
- [x] Memory Templates — quick-add templates (General, Task, Idea, Meeting, Code, URL, Question)

## API Endpoints

### Agents
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/agents | List all agents |
| POST | /api/agents | Create agent |
| DELETE | /api/agents/:id | Delete agent + all memories + links |

### Memories
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/agents/:id/memories | List memories (filters: importance, pinned, tag, limit, offset) |
| POST | /api/agents/:id/memories | Create memory |
| PUT | /api/memories/:id | Update memory |
| DELETE | /api/memories/:id | Delete memory |

### Memory Links
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/memories/:id/links | Get links for a memory |
| POST | /api/memories/:id/links | Create link (body: {toMemoryId, relationType}) |
| DELETE | /api/memories/:id/links/:linkId | Delete a link |

### Search
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/agents/:id/memories/search?q=&limit=&importance=&pinned=&sort= | Semantic + keyword search with filters |

### Dashboard
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/agents/:id/stats | Stats + 30-day activity + tag counts + link stats |

### Tags
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/tags | All tags with memory counts |
| PUT | /api/tags/:name | Rename tag |
| POST | /api/tags/:name/merge | Merge tag into another |

### Forgetting
| Method | Path | Description |
|--------|------|-------------|
| POST | /api/agents/:id/memories/forget | Trigger forgetting (dryRun supported) |

### Import/Export
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/export/:agentId | Export agent + memories as JSON |
| POST | /api/import/:agentId | Import memories from JSON |

### Settings
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/settings | Get global settings |
| PUT | /api/settings | Update settings |

### Health
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/health | Health check |
