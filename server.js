const express = require('express');
const path = require('path');
const { initDb } = require('./src/db');
const { getEmbedding, searchByEmbedding } = require('./src/embed');
const { runForgetting } = require('./src/forget');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');

// Initialize DB
const db = initDb(DATA_DIR);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Agents ───────────────────────────────────────────────────────────────────
app.get('/api/agents', (req, res) => {
  try {
    const agents = db.prepare('SELECT * FROM agents ORDER BY created_at DESC').all();
    res.json(agents);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/agents', (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const id = require('uuid').v4();
    db.prepare('INSERT INTO agents (id, name, description) VALUES (?, ?, ?)').run(id, name, description || '');
    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(id);
    res.status(201).json(agent);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/agents/:id', (req, res) => {
  try {
    const { id } = req.params;
    db.prepare('DELETE FROM memories WHERE agent_id = ?').run(id);
    db.prepare('DELETE FROM embeddings WHERE agent_id = ?').run(id);
    db.prepare('DELETE FROM agents WHERE id = ?').run(id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Memories ─────────────────────────────────────────────────────────────────
app.get('/api/agents/:agentId/memories', (req, res) => {
  try {
    const { agentId } = req.params;
    const { importance, pinned, tag, limit, offset } = req.query;
    let sql = 'SELECT * FROM memories WHERE agent_id = ?';
    const params = [agentId];

    if (importance) { sql += ' AND importance >= ?'; params.push(parseInt(importance)); }
    if (pinned !== undefined) { sql += ' AND pinned = ?'; params.push(pinned === 'true' ? 1 : 0); }
    if (tag) { sql += ' AND tags LIKE ?'; params.push(`%${tag}%`); }

    sql += ' ORDER BY created_at DESC';
    if (limit) { sql += ' LIMIT ?'; params.push(parseInt(limit)); }
    if (offset) { sql += ' OFFSET ?'; params.push(parseInt(offset)); }

    const memories = db.prepare(sql).all(...params);
    res.json(memories);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/agents/:agentId/memories', async (req, res) => {
  try {
    const { agentId } = req.params;
    const { content, importance = 3, tags = '', pinned = false } = req.body;
    if (!content) return res.status(400).json({ error: 'content required' });

    const id = require('uuid').v4();
    db.prepare(
      'INSERT INTO memories (id, agent_id, content, importance, tags, pinned) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, agentId, content, importance, tags, pinned ? 1 : 0);

    // Get embedding async
    getEmbedding(content).then(embedding => {
      if (embedding) {
        db.prepare(
          'INSERT OR REPLACE INTO embeddings (id, agent_id, memory_id, embedding) VALUES (?, ?, ?, ?)'
        ).run(require('uuid').v4(), agentId, id, JSON.stringify(embedding));
      }
    }).catch(() => {});

    const memory = db.prepare('SELECT * FROM memories WHERE id = ?').get(id);
    res.status(201).json(memory);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/memories/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { content, importance, tags, pinned } = req.body;
    const existing = db.prepare('SELECT * FROM memories WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'not found' });

    db.prepare(
      'UPDATE memories SET content = ?, importance = ?, tags = ?, pinned = ? WHERE id = ?'
    ).run(
      content !== undefined ? content : existing.content,
      importance !== undefined ? importance : existing.importance,
      tags !== undefined ? tags : existing.tags,
      pinned !== undefined ? (pinned ? 1 : 0) : existing.pinned,
      id
    );

    const memory = db.prepare('SELECT * FROM memories WHERE id = ?').get(id);
    res.json(memory);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/memories/:id', (req, res) => {
  try {
    const { id } = req.params;
    db.prepare('DELETE FROM embeddings WHERE memory_id = ?').run(id);
    db.prepare('DELETE FROM memories WHERE id = ?').run(id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Search ───────────────────────────────────────────────────────────────────
app.get('/api/agents/:agentId/memories/search', async (req, res) => {
  try {
    const { agentId } = req.params;
    const { q, limit = 10, importance, pinned } = req.query;
    if (!q) return res.status(400).json({ error: 'q query param required' });

    // Try vector search first
    const results = await searchByEmbedding(q, agentId, parseInt(limit), db);

    // Filter by importance/pinned
    let filtered = results;
    if (importance) filtered = filtered.filter(m => m.importance >= parseInt(importance));
    if (pinned !== undefined) filtered = filtered.filter(m => m.pinned === (pinned === 'true' ? 1 : 0));

    res.json(filtered);
  } catch (err) {
    // Fallback to keyword search
    try {
      const { agentId } = req.params;
      const { q, limit = 10 } = req.query;
      const like = `%${q}%`;
      const memories = db.prepare(
        'SELECT * FROM memories WHERE agent_id = ? AND content LIKE ? ORDER BY created_at DESC LIMIT ?'
      ).all(agentId, like, parseInt(limit));
      res.json(memories.map(m => ({ ...m, score: 1.0 })));
    } catch (err2) {
      res.status(500).json({ error: err2.message });
    }
  }
});

// ─── Stats ────────────────────────────────────────────────────────────────────
app.get('/api/agents/:agentId/stats', (req, res) => {
  try {
    const { agentId } = req.params;
    const total = db.prepare('SELECT COUNT(*) as count FROM memories WHERE agent_id = ?').get(agentId);
    const oldest = db.prepare('SELECT MIN(created_at) as oldest FROM memories WHERE agent_id = ?').get(agentId);
    const newest = db.prepare('SELECT MAX(created_at) as newest FROM memories WHERE agent_id = ?').get(agentId);
    const pinned = db.prepare('SELECT COUNT(*) as count FROM memories WHERE agent_id = ? AND pinned = 1').get(agentId);
    const avgImportance = db.prepare('SELECT AVG(importance) as avg FROM memories WHERE agent_id = ?').get(agentId);

    // Forgetting candidates (old + low importance)
    const candidates = db.prepare(
      "SELECT COUNT(*) as count FROM memories WHERE agent_id = ? AND pinned = 0 AND importance <= 2 AND date('now') > date(created_at, '+7 days')"
    ).get(agentId);

    // Memories per day (last 30 days)
    const byDay = db.prepare(
      "SELECT date(created_at) as day, COUNT(*) as count FROM memories WHERE agent_id = ? AND created_at >= date('now', '-30 days') GROUP BY day ORDER BY day"
    ).all(agentId);

    res.json({
      total: total.count,
      oldest: oldest.oldest,
      newest: newest.newest,
      pinned: pinned.count,
      avgImportance: avgImportance.avg ? parseFloat(avgImportance.avg.toFixed(1)) : 0,
      forgettingCandidates: candidates.count,
      byDay
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Forgetting ───────────────────────────────────────────────────────────────
app.post('/api/agents/:agentId/memories/forget', (req, res) => {
  try {
    const { agentId } = req.params;
    const { decayDays = 7, importanceThreshold = 2, dryRun = false } = req.body;

    const deleted = runForgetting(db, agentId, parseInt(decayDays), parseInt(importanceThreshold), dryRun);
    res.json({ deleted, message: dryRun ? 'Dry run - no memories deleted' : `${deleted} memories forgotten` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Import/Export ─────────────────────────────────────────────────────────────
app.get('/api/export/:agentId', (req, res) => {
  try {
    const { agentId } = req.params;
    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
    if (!agent) return res.status(404).json({ error: 'agent not found' });

    const memories = db.prepare('SELECT * FROM memories WHERE agent_id = ? ORDER BY created_at').all(agentId);
    res.json({ agent, memories, exportedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/import/:agentId', (req, res) => {
  try {
    const { agentId } = req.params;
    const { memories } = req.body;
    if (!memories || !Array.isArray(memories)) return res.status(400).json({ error: 'memories array required' });

    let imported = 0;
    for (const m of memories) {
      const id = require('uuid').v4();
      db.prepare(
        'INSERT INTO memories (id, agent_id, content, importance, tags, pinned, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(id, agentId, m.content, m.importance || 3, m.tags || '', m.pinned ? 1 : 0, m.created_at || new Date().toISOString());
      imported++;
    }
    res.json({ imported });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Settings ─────────────────────────────────────────────────────────────────
app.get('/api/settings', (req, res) => {
  try {
    const settings = db.prepare("SELECT * FROM settings WHERE id = 'global'").get();
    res.json(settings || { ollamaUrl: 'http://localhost:11434', decayDays: 7, importanceThreshold: 2 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/settings', (req, res) => {
  try {
    const { ollamaUrl, decayDays, importanceThreshold } = req.body;
    db.prepare(
      "INSERT OR REPLACE INTO settings (id, ollama_url, decay_days, importance_threshold) VALUES ('global', ?, ?, ?)"
    ).run(ollamaUrl || 'http://localhost:11434', decayDays || 7, importanceThreshold || 2);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`AgentMemory Desktop running at http://localhost:${PORT}`);
});
