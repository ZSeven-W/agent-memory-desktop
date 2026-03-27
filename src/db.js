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

    CREATE TABLE IF NOT EXISTS memory_links (
      id TEXT PRIMARY KEY,
      from_memory_id TEXT NOT NULL,
      to_memory_id TEXT NOT NULL,
      relation_type TEXT DEFAULT 'related',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (from_memory_id) REFERENCES memories(id) ON DELETE CASCADE,
      FOREIGN KEY (to_memory_id) REFERENCES memories(id) ON DELETE CASCADE
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
    CREATE INDEX IF NOT EXISTS idx_links_from ON memory_links(from_memory_id);
    CREATE INDEX IF NOT EXISTS idx_links_to ON memory_links(to_memory_id);
  `);

  return db;
}

// ─── Memory Links ──────────────────────────────────────────────────────────────
function createMemoryLink(db, fromId, toId, relationType = 'related') {
  const id = require('uuid').v4();
  db.prepare(
    'INSERT INTO memory_links (id, from_memory_id, to_memory_id, relation_type) VALUES (?, ?, ?, ?)'
  ).run(id, fromId, toId, relationType);
  return db.prepare('SELECT * FROM memory_links WHERE id = ?').get(id);
}

function getMemoryLinks(db, memoryId) {
  return db.prepare(
    `SELECT ml.*,
       m.content as to_content, m.importance as to_importance, m.tags as to_tags, m.created_at as to_created_at
     FROM memory_links ml
     JOIN memories m ON m.id = ml.to_memory_id
     WHERE ml.from_memory_id = ? OR ml.to_memory_id = ?
     ORDER BY ml.created_at DESC`
  ).all(memoryId, memoryId);
}

function deleteMemoryLink(db, linkId) {
  return db.prepare('DELETE FROM memory_links WHERE id = ?').run(linkId);
}

function getLinkStats(db, agentId) {
  const total = db.prepare(
    `SELECT COUNT(*) as count FROM memory_links ml
     JOIN memories m ON m.id = ml.from_memory_id WHERE m.agent_id = ?`
  ).get(agentId);
  const mostLinked = db.prepare(
    `SELECT m.id, m.content, COUNT(ml.id) as link_count
     FROM memories m
     LEFT JOIN memory_links ml ON ml.from_memory_id = m.id OR ml.to_memory_id = m.id
     WHERE m.agent_id = ?
     GROUP BY m.id ORDER BY link_count DESC LIMIT 5`
  ).all(agentId);
  return { total: total.count, mostLinked };
}

// ─── Tags ──────────────────────────────────────────────────────────────────────
function getAllTags(db, agentId) {
  const memories = db.prepare(
    "SELECT tags FROM memories WHERE agent_id = ? AND tags != ''"
  ).all(agentId);
  const tagCounts = {};
  for (const row of memories) {
    const tags = row.tags.split(',').map(t => t.trim()).filter(Boolean);
    for (const tag of tags) {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    }
  }
  return Object.entries(tagCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

function renameTag(db, agentId, oldName, newName) {
  const memories = db.prepare(
    "SELECT id, tags FROM memories WHERE agent_id = ? AND tags LIKE ? AND tags != ''"
  ).all(agentId, `%${oldName}%`);
  let updated = 0;
  for (const m of memories) {
    const tags = m.tags.split(',').map(t => t.trim());
    const idx = tags.indexOf(oldName);
    if (idx !== -1) {
      tags[idx] = newName;
      db.prepare('UPDATE memories SET tags = ? WHERE id = ?').run(tags.join(','), m.id);
      updated++;
    }
  }
  return updated;
}

function mergeTags(db, agentId, fromTag, intoTag) {
  const memories = db.prepare(
    "SELECT id, tags FROM memories WHERE agent_id = ? AND tags LIKE ? AND tags != ''"
  ).all(agentId, `%${fromTag}%`);
  let updated = 0;
  for (const m of memories) {
    const tags = m.tags.split(',').map(t => t.trim());
    const idx = tags.indexOf(fromTag);
    if (idx !== -1) {
      // Remove old tag, add new one (avoid duplicates)
      tags.splice(idx, 1);
      if (!tags.includes(intoTag)) tags.push(intoTag);
      db.prepare('UPDATE memories SET tags = ? WHERE id = ?').run(tags.join(','), m.id);
      updated++;
    }
  }
  return updated;
}

function getTagCloud(db, agentId) {
  return getAllTags(db, agentId);
}

function getImportanceDistribution(db, agentId) {
  const rows = db.prepare(
    'SELECT importance, COUNT(*) as count FROM memories WHERE agent_id = ? GROUP BY importance ORDER BY importance'
  ).all(agentId);
  // Fill in missing importance levels
  const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const row of rows) dist[row.importance] = row.count;
  return dist;
}

function getForgettingTimeline(db, agentId) {
  return db.prepare(
    `SELECT date(created_at) as day, COUNT(*) as count,
            SUM(CASE WHEN pinned=0 AND importance<=2 THEN 1 ELSE 0 END) as at_risk
     FROM memories WHERE agent_id = ? AND created_at >= date('now', '-30 days')
     GROUP BY day ORDER BY day`
  ).all(agentId);
}

module.exports = {
  initDb,
  createMemoryLink, getMemoryLinks, deleteMemoryLink, getLinkStats,
  getAllTags, renameTag, mergeTags, getTagCloud,
  getImportanceDistribution, getForgettingTimeline
};
