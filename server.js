const express = require('express');
const path = require('path');
const { initDb, createMemoryLink, getMemoryLinks, deleteMemoryLink, getLinkStats,
  getAllTags, renameTag, mergeTags, getTagCloud,
  getImportanceDistribution, getForgettingTimeline,
  addSearchHistory, getSearchHistory, deleteSearchHistory,
  createReminder, getRemindersForMemory, deleteReminder, getDueReminders, getReminderCount } = require('./src/db');
const { getEmbedding, searchByEmbedding } = require('./src/embed');
const { runForgetting } = require('./src/forget');
const { validateAgentName, validateMemoryContent, validateImportance,
  validateTags, validateRelationType, validateReminder,
  VALIDATION_ERROR, NOT_FOUND, DB_ERROR } = require('./src/validate');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');

const db = initDb(DATA_DIR);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Global error handler wrapper ─────────────────────────────────────────────
function wrap(fn) {
  return (req, res, next) => {
    try { fn(req, res, next); }
    catch (err) { res.status(500).json({ error: err.message, code: DB_ERROR }); }
  };
}

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Agents ───────────────────────────────────────────────────────────────────
app.get('/api/agents', wrap((req, res) => {
  const agents = db.prepare('SELECT * FROM agents ORDER BY created_at DESC').all();
  res.json(agents);
}));

app.post('/api/agents', wrap((req, res) => {
  const nameResult = validateAgentName(req.body.name);
  if (!nameResult.valid) return res.status(400).json({ error: nameResult.error, code: VALIDATION_ERROR });
  const description = (req.body.description || '').toString().slice(0, 500);
  const id = require('uuid').v4();
  db.prepare('INSERT INTO agents (id, name, description) VALUES (?, ?, ?)').run(id, nameResult.value, description);
  res.status(201).json(db.prepare('SELECT * FROM agents WHERE id = ?').get(id));
}));

app.delete('/api/agents/:id', wrap((req, res) => {
  const { id } = req.params;
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(id);
  if (!agent) return res.status(404).json({ error: 'agent not found', code: NOT_FOUND });
  db.prepare('DELETE FROM agents WHERE id = ?').run(id);
  res.json({ ok: true });
}));

// ─── Memories ─────────────────────────────────────────────────────────────────
app.get('/api/agents/:agentId/memories', wrap((req, res) => {
  const { agentId } = req.params;
  const { importance, pinned, tag, limit, offset } = req.query;
  let sql = 'SELECT * FROM memories WHERE agent_id = ?';
  const params = [agentId];

  if (importance) { sql += ' AND importance >= ?'; params.push(parseInt(importance)); }
  if (pinned !== undefined) { sql += ' AND pinned = ?'; params.push(pinned === 'true' ? 1 : 0); }
  if (tag) { sql += ' AND tags LIKE ?'; params.push(`%${tag}%`); }

  sql += ' ORDER BY created_at DESC';
  if (offset) {
    const lim = limit ? parseInt(limit) : 100;
    sql += ' LIMIT ? OFFSET ?';
    params.push(lim, parseInt(offset));
  } else if (limit) {
    sql += ' LIMIT ?';
    params.push(parseInt(limit));
  }

  const memories = db.prepare(sql).all(...params);
  res.json(memories);
}));

app.post('/api/agents/:agentId/memories', wrap((req, res) => {
  const { agentId } = req.params;
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
  if (!agent) return res.status(404).json({ error: 'agent not found', code: NOT_FOUND });

  const contentResult = validateMemoryContent(req.body.content);
  if (!contentResult.valid) return res.status(400).json({ error: contentResult.error, code: VALIDATION_ERROR });

  const importanceResult = validateImportance(req.body.importance || 3);
  if (!importanceResult.valid) return res.status(400).json({ error: importanceResult.error, code: VALIDATION_ERROR });

  const tagsResult = validateTags(req.body.tags || '');
  if (!tagsResult.valid) return res.status(400).json({ error: tagsResult.error, code: VALIDATION_ERROR });

  const pinned = req.body.pinned ? 1 : 0;
  const id = require('uuid').v4();
  db.prepare(
    'INSERT INTO memories (id, agent_id, content, importance, tags, pinned) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, agentId, contentResult.value, importanceResult.value, tagsResult.value, pinned);

  getEmbedding(contentResult.value).then(embedding => {
    if (embedding) {
      db.prepare(
        'INSERT OR REPLACE INTO embeddings (id, agent_id, memory_id, embedding) VALUES (?, ?, ?, ?)'
      ).run(require('uuid').v4(), agentId, id, JSON.stringify(embedding));
    }
  }).catch(() => {});

  res.status(201).json(db.prepare('SELECT * FROM memories WHERE id = ?').get(id));
}));

app.put('/api/memories/:id', wrap((req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT * FROM memories WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'memory not found', code: NOT_FOUND });

  if (req.body.content !== undefined) {
    const r = validateMemoryContent(req.body.content);
    if (!r.valid) return res.status(400).json({ error: r.error, code: VALIDATION_ERROR });
  }
  if (req.body.importance !== undefined) {
    const r = validateImportance(req.body.importance);
    if (!r.valid) return res.status(400).json({ error: r.error, code: VALIDATION_ERROR });
  }
  if (req.body.tags !== undefined) {
    const r = validateTags(req.body.tags);
    if (!r.valid) return res.status(400).json({ error: r.error, code: VALIDATION_ERROR });
  }

  db.prepare(
    'UPDATE memories SET content = ?, importance = ?, tags = ?, pinned = ? WHERE id = ?'
  ).run(
    req.body.content !== undefined ? req.body.content : existing.content,
    req.body.importance !== undefined ? req.body.importance : existing.importance,
    req.body.tags !== undefined ? req.body.tags : existing.tags,
    req.body.pinned !== undefined ? (req.body.pinned ? 1 : 0) : existing.pinned,
    id
  );

  res.json(db.prepare('SELECT * FROM memories WHERE id = ?').get(id));
}));

app.delete('/api/memories/:id', wrap((req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT * FROM memories WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'memory not found', code: NOT_FOUND });
  db.prepare('DELETE FROM embeddings WHERE memory_id = ?').run(id);
  db.prepare('DELETE FROM memories WHERE id = ?').run(id);
  res.json({ ok: true });
}));

// ─── Search ───────────────────────────────────────────────────────────────────
app.get('/api/agents/:agentId/memories/search', async (req, res) => {
  try {
    const { agentId } = req.params;
    const { q, limit = 10, importance, pinned } = req.query;
    if (!q) return res.status(400).json({ error: 'q query param required', code: VALIDATION_ERROR });

    const results = await searchByEmbedding(q, agentId, parseInt(limit), db);

    let filtered = results;
    if (importance) filtered = filtered.filter(m => m.importance >= parseInt(importance));
    if (pinned !== undefined) filtered = filtered.filter(m => m.pinned === (pinned === 'true' ? 1 : 0));

    // Store search history
    addSearchHistory(db, agentId, q, filtered.length);

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
      addSearchHistory(db, agentId, q, memories.length);
      res.json(memories.map(m => ({ ...m, score: 1.0 })));
    } catch (err2) {
      res.status(500).json({ error: err2.message, code: DB_ERROR });
    }
  }
});

// ─── Search History ────────────────────────────────────────────────────────────
app.get('/api/agents/:agentId/search-history', wrap((req, res) => {
  const { agentId } = req.params;
  const history = getSearchHistory(db, agentId);
  res.json(history);
}));

app.delete('/api/agents/:agentId/search-history/:searchId', wrap((req, res) => {
  const { searchId } = req.params;
  deleteSearchHistory(db, searchId);
  res.json({ ok: true });
}));

// ─── Reminders ────────────────────────────────────────────────────────────────
app.post('/api/memories/:id/reminders', wrap((req, res) => {
  const { id } = req.params;
  const memory = db.prepare('SELECT * FROM memories WHERE id = ?').get(id);
  if (!memory) return res.status(404).json({ error: 'memory not found', code: NOT_FOUND });

  const r = validateReminder(req);
  if (!r.valid) return res.status(400).json({ error: r.error, code: VALIDATION_ERROR });

  const reminder = createReminder(db, id, r.value.remindAt, r.value.message);
  res.status(201).json(reminder);
}));

app.get('/api/memories/:id/reminders', wrap((req, res) => {
  const { id } = req.params;
  const memory = db.prepare('SELECT * FROM memories WHERE id = ?').get(id);
  if (!memory) return res.status(404).json({ error: 'memory not found', code: NOT_FOUND });
  res.json(getRemindersForMemory(db, id));
}));

app.delete('/api/reminders/:id', wrap((req, res) => {
  const { id } = req.params;
  const reminder = db.prepare('SELECT * FROM reminders WHERE id = ?').get(id);
  if (!reminder) return res.status(404).json({ error: 'reminder not found', code: NOT_FOUND });
  deleteReminder(db, id);
  res.json({ ok: true });
}));

app.get('/api/agents/:agentId/reminders/due', wrap((req, res) => {
  const { agentId } = req.params;
  res.json(getDueReminders(db, agentId));
}));

// ─── Forgetting ───────────────────────────────────────────────────────────────
app.post('/api/agents/:agentId/memories/forget', wrap((req, res) => {
  const { agentId } = req.params;
  const { decayDays = 7, importanceThreshold = 2, dryRun = false } = req.body;
  const deleted = runForgetting(db, agentId, parseInt(decayDays), parseInt(importanceThreshold), dryRun);
  res.json({ deleted, message: dryRun ? 'Dry run - no memories deleted' : `${deleted} memories forgotten` });
}));

// ─── Import/Export ─────────────────────────────────────────────────────────────
app.get('/api/export/:agentId', (req, res) => {
  const { agentId } = req.params;
  const { format = 'json' } = req.query;
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
  if (!agent) return res.status(404).json({ error: 'agent not found', code: NOT_FOUND });

  const memories = db.prepare('SELECT * FROM memories WHERE agent_id = ? ORDER BY created_at').all(agentId);

  if (format === 'csv') {
    const header = 'id,content,importance,tags,pinned,created_at\n';
    const rows = memories.map(m => {
      const escaped = m.content.replace(/"/g, '""');
      return `"${m.id}","${escaped}",${m.importance},"${m.tags}",${m.pinned},"${m.created_at}"`;
    }).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${agent.name}-memories.csv"`);
    return res.send(header + rows);
  }

  res.json({ agent, memories, exportedAt: new Date().toISOString() });
});

app.post('/api/import/:agentId', wrap((req, res) => {
  const { agentId } = req.params;
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
  if (!agent) return res.status(404).json({ error: 'agent not found', code: NOT_FOUND });

  const { memories } = req.body;
  if (!memories || !Array.isArray(memories)) {
    return res.status(400).json({ error: 'memories array required', code: VALIDATION_ERROR });
  }

  let imported = 0;
  for (const m of memories) {
    const id = require('uuid').v4();
    db.prepare(
      'INSERT INTO memories (id, agent_id, content, importance, tags, pinned, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, agentId, m.content || '', m.importance || 3, m.tags || '', m.pinned ? 1 : 0, m.created_at || new Date().toISOString());
    imported++;
  }
  res.json({ imported });
}));

// ─── Memory Links ─────────────────────────────────────────────────────────────
app.get('/api/memories/:id/links', wrap((req, res) => {
  const { id } = req.params;
  const links = getMemoryLinks(db, id);
  res.json(links);
}));

app.post('/api/memories/:id/links', wrap((req, res) => {
  const { id } = req.params;
  const { toMemoryId } = req.body;
  if (!toMemoryId) return res.status(400).json({ error: 'toMemoryId required', code: VALIDATION_ERROR });

  const rt = validateRelationType(req.body.relationType);
  if (!rt.valid) return res.status(400).json({ error: rt.error, code: VALIDATION_ERROR });

  const fromMem = db.prepare('SELECT * FROM memories WHERE id = ?').get(id);
  const toMem = db.prepare('SELECT * FROM memories WHERE id = ?').get(toMemoryId);
  if (!fromMem || !toMem) return res.status(404).json({ error: 'memory not found', code: NOT_FOUND });

  const link = createMemoryLink(db, id, toMemoryId, rt.value);
  res.status(201).json(link);
}));

app.delete('/api/memories/:id/links/:linkId', wrap((req, res) => {
  const { linkId } = req.params;
  deleteMemoryLink(db, linkId);
  res.json({ ok: true });
}));

// ─── Tags ─────────────────────────────────────────────────────────────────────
app.get('/api/tags', wrap((req, res) => {
  const { agentId } = req.query;
  if (!agentId) return res.status(400).json({ error: 'agentId query param required', code: VALIDATION_ERROR });
  res.json(getAllTags(db, agentId));
}));

app.put('/api/tags/:name', wrap((req, res) => {
  const { name } = req.params;
  const { newName, agentId } = req.body;
  if (!newName || !agentId) return res.status(400).json({ error: 'newName and agentId required', code: VALIDATION_ERROR });
  const updated = renameTag(db, agentId, name, newName);
  res.json({ ok: true, updated });
}));

app.post('/api/tags/:name/merge', wrap((req, res) => {
  const { name } = req.params;
  const { intoTag, agentId } = req.body;
  if (!intoTag || !agentId) return res.status(400).json({ error: 'intoTag and agentId required', code: VALIDATION_ERROR });
  const updated = mergeTags(db, agentId, name, intoTag);
  res.json({ ok: true, updated });
}));

// ─── Enhanced Stats ───────────────────────────────────────────────────────────
app.get('/api/agents/:agentId/stats', wrap((req, res) => {
  const { agentId } = req.params;
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
  if (!agent) return res.status(404).json({ error: 'agent not found', code: NOT_FOUND });

  const total = db.prepare('SELECT COUNT(*) as count FROM memories WHERE agent_id = ?').get(agentId);
  const oldest = db.prepare('SELECT MIN(created_at) as oldest FROM memories WHERE agent_id = ?').get(agentId);
  const newest = db.prepare('SELECT MAX(created_at) as newest FROM memories WHERE agent_id = ?').get(agentId);
  const pinned = db.prepare('SELECT COUNT(*) as count FROM memories WHERE agent_id = ? AND pinned = 1').get(agentId);
  const avgImportance = db.prepare('SELECT AVG(importance) as avg FROM memories WHERE agent_id = ?').get(agentId);

  const candidates = db.prepare(
    "SELECT COUNT(*) as count FROM memories WHERE agent_id = ? AND pinned = 0 AND importance <= 2 AND date('now') > date(created_at, '+7 days')"
  ).get(agentId);

  const byDay = db.prepare(
    "SELECT date(created_at) as day, COUNT(*) as count FROM memories WHERE agent_id = ? AND created_at >= date('now', '-30 days') GROUP BY day ORDER BY day"
  ).all(agentId);

  const tagCloud = getTagCloud(db, agentId);
  const importanceDist = getImportanceDistribution(db, agentId);
  const forgettingTimeline = getForgettingTimeline(db, agentId);
  const linkStats = getLinkStats(db, agentId);
  const remindersDue = getReminderCount(db, agentId);

  res.json({
    total: total.count,
    oldest: oldest.oldest,
    newest: newest.newest,
    pinned: pinned.count,
    avgImportance: avgImportance.avg ? parseFloat(avgImportance.avg.toFixed(1)) : 0,
    forgettingCandidates: candidates.count,
    remindersDue,
    byDay,
    tagCloud,
    importanceDist,
    forgettingTimeline,
    linkStats
  });
}));

// ─── Settings ─────────────────────────────────────────────────────────────────
app.get('/api/settings', wrap((req, res) => {
  const settings = db.prepare("SELECT * FROM settings WHERE id = 'global'").get();
  res.json(settings || { ollamaUrl: 'http://localhost:11434', decayDays: 7, importanceThreshold: 2 });
}));

app.put('/api/settings', wrap((req, res) => {
  const { ollamaUrl, decayDays, importanceThreshold } = req.body;
  db.prepare(
    "INSERT OR REPLACE INTO settings (id, ollama_url, decay_days, importance_threshold) VALUES ('global', ?, ?, ?)"
  ).run(ollamaUrl || 'http://localhost:11434', decayDays || 7, importanceThreshold || 2);
  res.json({ ok: true });
}));

// ─── 404 handler ──────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'endpoint not found', code: NOT_FOUND });
});

app.listen(PORT, () => {
  console.log(`AgentMemory Desktop running at http://localhost:${PORT}`);
});
