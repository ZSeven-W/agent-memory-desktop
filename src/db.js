const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

function initDb(dataDir) {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const dbPath = path.join(dataDir, 'agentmemory.db');
  const db = new Database(dbPath);

  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      content TEXT NOT NULL,
      importance INTEGER DEFAULT 3 CHECK (importance BETWEEN 1 AND 5),
      tags TEXT DEFAULT '',
      pinned INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS embeddings (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      memory_id TEXT NOT NULL,
      embedding TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      id TEXT PRIMARY KEY DEFAULT 'global',
      ollama_url TEXT DEFAULT 'http://localhost:11434',
      decay_days INTEGER DEFAULT 7,
      importance_threshold INTEGER DEFAULT 2
    );

    CREATE INDEX IF NOT EXISTS idx_memories_agent ON memories(agent_id);
    CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at);
    CREATE INDEX IF NOT EXISTS idx_embeddings_agent ON embeddings(agent_id);
    CREATE INDEX IF NOT EXISTS idx_embeddings_memory ON embeddings(memory_id);
  `);

  return db;
}

module.exports = { initDb };
