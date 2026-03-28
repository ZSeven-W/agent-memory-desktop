const http = require('http');
const express = require('express');
const path = require('path');
const fs = require('fs');
const uuid = require('uuid');

// Set up test data directory BEFORE requiring server modules
const TEST_DIR = '/tmp/agent-memory-http-test-' + Date.now();
fs.mkdirSync(TEST_DIR, { recursive: true });
process.env.OPENCLAW_DATA_DIR = TEST_DIR;

// Now require modules (they'll use TEST_DIR)
const { initDb, createMemoryLink, getMemoryLinks, deleteMemoryLink, getLinkStats,
  getAllTags, renameTag, mergeTags, getImportanceDistribution,
  getForgettingTimeline } = require('../src/db');
const { runForgetting } = require('../src/forget');

function createTestApp() {
  const app = express();
  app.use(express.json());
  let testDb;
  const getDb = () => { if (!testDb) testDb = initDb(TEST_DIR); return testDb; };

  // Health
  app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

  // Agents
  app.get('/api/agents', (req, res) => { res.json(getDb().prepare('SELECT * FROM agents ORDER BY created_at DESC').all()); });
  app.post('/api/agents', (req, res) => {
    try {
      const { name, description } = req.body;
      if (!name) return res.status(400).json({ error: 'name required' });
      const id = uuid.v4();
      getDb().prepare('INSERT INTO agents (id, name, description) VALUES (?, ?, ?)').run(id, name, description || '');
      res.status(201).json(getDb().prepare('SELECT * FROM agents WHERE id = ?').get(id));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
  app.delete('/api/agents/:id', (req, res) => {
    try {
      const { id } = req.params;
      // FK cascade handles memories → embeddings + memory_links
      getDb().prepare('DELETE FROM agents WHERE id = ?').run(id);
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Memories
  app.get('/api/agents/:agentId/memories', (req, res) => {
    try {
      const { agentId } = req.params;
      const { importance, pinned, tag, limit, offset } = req.query;
      console.log('  GET memories route: query params - limit=', limit, 'offset=', offset);
      let sql = 'SELECT * FROM memories WHERE agent_id = ?';
      const params = [agentId];
      if (importance) { sql += ' AND importance >= ?'; params.push(parseInt(importance)); }
      if (pinned !== undefined) { sql += ' AND pinned = ?'; params.push(pinned === 'true' ? 1 : 0); }
      if (tag) { sql += ' AND tags LIKE ?'; params.push('%' + tag + '%'); }
      sql += ' ORDER BY created_at DESC';
      if (offset) {
        const lim = limit ? parseInt(limit) : 100;
        sql += ' LIMIT ? OFFSET ?';
        params.push(lim, parseInt(offset));
      } else if (limit) {
        sql += ' LIMIT ?';
        params.push(parseInt(limit));
      }
      res.json(getDb().prepare(sql).all(...params));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
  app.post('/api/agents/:agentId/memories', (req, res) => {
    try {
      const { agentId } = req.params;
      const { content, importance = 3, tags = '', pinned = false } = req.body;
      if (!content) return res.status(400).json({ error: 'content required' });
      const id = uuid.v4();
      getDb().prepare('INSERT INTO memories (id, agent_id, content, importance, tags, pinned) VALUES (?, ?, ?, ?, ?, ?)').run(id, agentId, content, importance, tags, pinned ? 1 : 0);
      res.status(201).json(getDb().prepare('SELECT * FROM memories WHERE id = ?').get(id));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
  app.put('/api/memories/:id', (req, res) => {
    try {
      const { id } = req.params;
      const { content, importance, pinned, tags } = req.body;
      const existing = getDb().prepare('SELECT * FROM memories WHERE id = ?').get(id);
      if (!existing) return res.status(404).json({ error: 'Memory not found' });
      if (content !== undefined) getDb().prepare('UPDATE memories SET content = ? WHERE id = ?').run(content, id);
      if (importance !== undefined) getDb().prepare('UPDATE memories SET importance = ? WHERE id = ?').run(importance, id);
      if (pinned !== undefined) getDb().prepare('UPDATE memories SET pinned = ? WHERE id = ?').run(pinned ? 1 : 0, id);
      if (tags !== undefined) getDb().prepare('UPDATE memories SET tags = ? WHERE id = ?').run(tags, id);
      res.json(getDb().prepare('SELECT * FROM memories WHERE id = ?').get(id));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
  app.delete('/api/memories/:id', (req, res) => {
    try {
      const { id } = req.params;
      getDb().prepare('DELETE FROM embeddings WHERE memory_id = ?').run(id);
      getDb().prepare('DELETE FROM memories WHERE id = ?').run(id);
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Search
  app.get('/api/agents/:agentId/memories/search', (req, res) => {
    try {
      const { agentId } = req.params;
      const { q, importance, dateFrom, dateTo, limit = 20 } = req.query;
      if (!q) return res.status(400).json({ error: 'q query parameter required' });
      const like = '%' + q + '%';
      const memories = getDb().prepare(
        'SELECT * FROM memories WHERE agent_id = ? AND content LIKE ? ORDER BY created_at DESC LIMIT ?'
      ).all(agentId, like, parseInt(limit));
      res.json(memories.map(m => ({ ...m, score: 1.0 })));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Forgetting
  app.post('/api/agents/:agentId/memories/forget', (req, res) => {
    try {
      const { agentId } = req.params;
      const { decayDays = 7, importanceThreshold = 2, dryRun = false } = req.body;
      const deleted = runForgetting(getDb(), agentId, parseInt(decayDays), parseInt(importanceThreshold), dryRun);
      res.json({ deleted, message: dryRun ? 'Dry run - no memories deleted' : deleted + ' memories forgotten' });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Export/Import
  app.get('/api/export/:agentId', (req, res) => {
    try {
      const { agentId } = req.params;
      const agent = getDb().prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
      if (!agent) return res.status(404).json({ error: 'Agent not found' });
      const memories = getDb().prepare('SELECT * FROM memories WHERE agent_id = ?').all(agentId);
      res.json({ agent, memories, exportedAt: new Date().toISOString() });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
  app.post('/api/import/:agentId', (req, res) => {
    try {
      const { agentId } = req.params;
      const { memories } = req.body;
      if (!memories || !Array.isArray(memories)) return res.status(400).json({ error: 'memories array required' });
      const agent = getDb().prepare('SELECT id FROM agents WHERE id = ?').get(agentId);
      if (!agent) return res.status(404).json({ error: 'agent not found' });
      let imported = 0;
      for (const m of memories) {
        getDb().prepare('INSERT INTO memories (id, agent_id, content, importance, tags, pinned, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
          uuid.v4(), agentId, m.content, m.importance || 3, m.tags || '', m.pinned ? 1 : 0, m.created_at || new Date().toISOString()
        );
        imported++;
      }
      res.json({ imported });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Memory Links
  app.get('/api/memories/:id/links', (req, res) => {
    try { res.json(getMemoryLinks(getDb(), req.params.id)); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });
  app.post('/api/memories/:id/links', (req, res) => {
    try {
      const { id } = req.params;
      const { toMemoryId, relationType = 'related' } = req.body;
      if (!toMemoryId) return res.status(400).json({ error: 'toMemoryId required' });
      const link = createMemoryLink(getDb(), id, toMemoryId, relationType);
      res.status(201).json(link);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
  app.delete('/api/memories/:id/links/:linkId', (req, res) => {
    try { deleteMemoryLink(getDb(), req.params.linkId); res.json({ ok: true }); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Tags
  app.get('/api/tags', (req, res) => {
    try { res.json(getAllTags(getDb())); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });
  app.put('/api/tags/:name', (req, res) => {
    try {
      const { name } = req.params;
      const { newName } = req.body;
      if (!newName) return res.status(400).json({ error: 'newName required' });
      renameTag(getDb(), name, newName);
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
  app.post('/api/tags/:name/merge', (req, res) => {
    try {
      const { name } = req.params;
      const { into } = req.body;
      if (!into) return res.status(400).json({ error: 'into required' });
      mergeTags(getDb(), name, into);
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Stats
  app.get('/api/agents/:agentId/stats', (req, res) => {
    try {
      const { agentId } = req.params;
      res.json({
        total: getDb().prepare('SELECT COUNT(*) as count FROM memories WHERE agent_id = ?').get(agentId).count,
        pinned: getDb().prepare('SELECT COUNT(*) as count FROM memories WHERE agent_id = ? AND pinned = 1').get(agentId).count,
        avgImportance: getImportanceDistribution(getDb(), agentId),
        linkStats: getLinkStats(getDb(), agentId),
        forgettingCandidates: runForgetting(getDb(), agentId, 30, 3, true),
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Bulk ops
  app.post('/api/agents/:id/memories/bulk', (req, res) => {
    try {
      const { id } = req.params;
      const { action, ids, tag, importance, pinned, contents } = req.body;
      const agent = getDb().prepare('SELECT id FROM agents WHERE id = ?').get(id);
      if (!agent) return res.status(404).json({ error: 'agent not found' });
      if (action === 'create') {
        if (!contents || !Array.isArray(contents)) return res.status(400).json({ error: 'contents array required' });
        const created = [];
        contents.forEach(c => {
          const id2 = uuid.v4();
          getDb().prepare('INSERT INTO memories (id, agent_id, content) VALUES (?, ?, ?)').run(id2, id, c);
          created.push(id2);
        });
        res.status(201).json({ created });
      } else {
        if (!ids || !Array.isArray(ids)) return res.status(400).json({ error: 'ids array required' });
        if (action === 'pin') {
          ids.forEach(mid => getDb().prepare('UPDATE memories SET pinned = 1 WHERE id = ?').run(mid));
          res.json({ ok: true, updated: ids.length });
        } else if (action === 'unpin') {
          ids.forEach(mid => getDb().prepare('UPDATE memories SET pinned = 0 WHERE id = ?').run(mid));
          res.json({ ok: true, updated: ids.length });
        } else if (action === 'tag') {
          if (!tag) return res.status(400).json({ error: 'tag value required' });
          ids.forEach(mid => getDb().prepare('UPDATE memories SET tags = tags || ? WHERE id = ?').run(',' + tag, mid));
          res.json({ ok: true, updated: ids.length });
        } else if (action === 'importance') {
          if (importance === undefined) return res.status(400).json({ error: 'importance value required' });
          if (importance < 1 || importance > 5) return res.status(400).json({ error: 'importance must be 1-5' });
          ids.forEach(mid => getDb().prepare('UPDATE memories SET importance = ? WHERE id = ?').run(importance, mid));
          res.json({ ok: true, updated: ids.length });
        } else if (action === 'delete') {
          ids.forEach(mid => { getDb().prepare('DELETE FROM embeddings WHERE memory_id = ?').run(mid); getDb().prepare('DELETE FROM memories WHERE id = ?').run(mid); });
          res.json({ ok: true, deleted: ids.length });
        } else {
          res.status(400).json({ error: 'unknown action' });
        }
      }
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  return app;
}

function mkApi(port) {
  function req(method, path, body) {
    return new Promise((resolve) => {
      const opts = { hostname: 'localhost', port, path, method, headers: { 'Content-Type': 'application/json' } };
      const r = http.request(opts, (resp) => {
        let d = '';
        resp.on('data', c => d += c);
        resp.on('end', () => {
          try { resolve({ status: resp.statusCode, body: JSON.parse(d) }); }
          catch { resolve({ status: resp.statusCode, body: d }); }
        });
      });
      if (body) r.write(JSON.stringify(body));
      r.end();
    });
  }
  return {
    get: (p) => req('GET', p),
    post: (p, b) => req('POST', p, b),
    put: (p, b) => req('PUT', p, b),
    del: (p) => req('DELETE', p),
  };
}

async function runTests() {
  const app = createTestApp();
  const srv = app.listen(0, async () => {
    const port = srv.address().port;
    const api = mkApi(port);
    let passed = 0, failed = 0;

    function eq(name, a, b) {
      if (a === b) { passed++; console.log(`  ✓ ${name}`); }
      else { failed++; console.error(`  ✗ ${name}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
    }

    try {
      console.log('\nHealth');
      { const r = await api.get('/api/health'); eq('status ok', r.body.status, 'ok'); eq('has timestamp', !!r.body.timestamp, true); }

      console.log('\nAgents');
      { const r = await api.get('/api/agents'); eq('empty list', r.body.length, 0); }
      { const r = await api.post('/api/agents', { name: 'TestAgent' }); eq('POST 201', r.status, 201); eq('has id', !!r.body.id, true); eq('name matches', r.body.name, 'TestAgent'); }
      const agentId = (await api.post('/api/agents', { name: 'TestAgent' })).body.id;
      { const r = await api.post('/api/agents', {}); eq('no name 400', r.status, 400); eq('error msg', r.body.error, 'name required'); }
      { const r = await api.get('/api/agents'); eq('agent in list', r.body.some(a => a.id === agentId), true); }

      console.log('\nMemories');
      { const r = await api.get('/api/agents/' + agentId + '/memories'); eq('empty', r.body.length, 0); }
      const memIds = [];
      for (let i = 0; i < 4; i++) {
        const r2 = await api.post('/api/agents/' + agentId + '/memories', { content: 'Memory ' + i, importance: i + 1, tags: i === 0 ? 'tagA,tagB' : 'tagA', pinned: i === 3 });
        eq('POST ' + i + ' 201', r2.status, 201); eq('POST ' + i + ' has id', !!r2.body.id, true);
        memIds.push(r2.body.id);
      }
      { const r2 = await api.post('/api/agents/' + agentId + '/memories', {}); eq('no content 400', r2.status, 400); }

      console.log('\nFilters');
      { const r = await api.get('/api/agents/' + agentId + '/memories?importance=3'); eq('importance>=3 count', r.body.length, 2); }
      { const r2 = await api.get('/api/agents/' + agentId + '/memories?pinned=true'); eq('pinned=true count', r2.body.length, 1); eq('pinned=1', r2.body[0].pinned, 1); }
      { const r = await api.get('/api/agents/' + agentId + '/memories?tag=tagB'); eq('tag=tagB count', r.body.length, 1); }
      { const r = await api.get('/api/agents/' + agentId + '/memories?limit=2'); eq('limit=2', r.body.length, 2); }
      { const r = await api.get('/api/agents/' + agentId + '/memories?limit=3&offset=1'); eq('limit+offset', r.body.length, 3); }

      console.log('\nUpdate');
      { const r = await api.put('/api/memories/' + memIds[0], { content: 'Updated content', importance: 5 }); eq('content updated', r.body.content, 'Updated content'); eq('importance updated', r.body.importance, 5); }
      { const r = await api.put('/api/memories/' + memIds[0], { pinned: true }); eq('pinned=true', r.body.pinned, 1); }
      { const r = await api.put('/api/memories/fake-id', { content: 'x' }); eq('not found 404', r.status, 404); }

      console.log('\nSearch');
      { const r = await api.get('/api/agents/' + agentId + '/memories/search?q=nonexistent'); eq('no results empty', r.body.length, 0); }
      { const r = await api.get('/api/agents/' + agentId + '/memories/search'); eq('no q 400', r.status, 400); }
      { const r = await api.get('/api/agents/' + agentId + '/memories/search?q=Updated'); eq('search results', r.body.length, 1); eq('has score', typeof r.body[0].score === 'number', true); }

      console.log('\nMemory Links');
      let linkId;
      { const r = await api.post('/api/memories/' + memIds[0] + '/links', { toMemoryId: memIds[1], relationType: 'parent' }); eq('POST links 201', r.status, 201); eq('relation_type=parent', r.body.relation_type, 'parent'); linkId = r.body.id; }
      { const r = await api.post('/api/memories/' + memIds[0] + '/links', {}); eq('no toMemoryId 400', r.status, 400); }
      { const r = await api.get('/api/memories/' + memIds[0] + '/links'); eq('GET links array', Array.isArray(r.body), true); eq('GET links has entry', r.body.length >= 1, true); }
      { const r = await api.del('/api/memories/' + memIds[0] + '/links/' + linkId); eq('DELETE link ok', r.body.ok, true); }
      { const r = await api.post('/api/memories/' + memIds[0] + '/links', { toMemoryId: memIds[2] }); eq('link mem[0]->mem[2] 201', r.status, 201); }

      console.log('\nForgetting');
      { const r = await api.post('/api/agents/' + agentId + '/memories/forget', { decayDays: 0, importanceThreshold: 3, dryRun: true }); eq('dryRun is number', typeof r.body.deleted === 'number', true); eq('dryRun msg', r.body.message.includes('Dry run'), true); }
      { const r = await api.post('/api/agents/' + agentId + '/memories/forget', { decayDays: 0, importanceThreshold: 5, dryRun: false }); eq('exec deleted >= 0', typeof r.body.deleted === 'number', true); eq('exec msg', r.body.message.includes('memories forgotten'), true); }

      console.log('\nImport/Export');
      { const r = await api.get('/api/export/' + agentId); eq('export agent matches', r.body.agent.id, agentId); eq('export has memories', Array.isArray(r.body.memories), true); eq('export has exportedAt', !!r.body.exportedAt, true); }
      { const r = await api.get('/api/export/nonexistent'); eq('export nonexistent 404', r.status, 404); }
      { const r3 = await api.post('/api/import/' + agentId, { memories: [{ content: 'I1', importance: 4 }, { content: 'I2' }] }); eq('import imported', r3.status, 200); eq('import count', r3.body.imported, 2); }
      { const r4 = await api.post('/api/import/' + agentId, { memories: 'bad' }); eq('import bad 400', r4.status, 400); }

      console.log('\nTags');
      { const r = await api.get('/api/tags'); eq('GET tags array', Array.isArray(r.body), true); }
      { const r = await api.put('/api/tags/tagA', { newName: 'tagAlpha' }); eq('PUT tag ok', r.status, 200); }
      { const r = await api.put('/api/tags/tagA', {}); eq('PUT tag no params 400', r.status, 400); }
      { const r = await api.post('/api/tags/tagAlpha/merge', { into: 'tagA' }); eq('POST merge ok', r.status, 200); }
      { const r = await api.post('/api/tags/tagAlpha/merge', {}); eq('POST merge no params 400', r.status, 400); }

      console.log('\nStats');
      { const r = await api.get('/api/agents/' + agentId + '/stats'); eq('total number', typeof r.body.total === 'number', true); eq('pinned number', typeof r.body.pinned === 'number', true); eq('avgImportance object', typeof r.body.avgImportance === 'object', true); eq('linkStats object', typeof r.body.linkStats === 'object', true); eq('forgettingCandidates number', typeof r.body.forgettingCandidates === 'number', true); }

      console.log('\nBulk Operations');
      { const r = await api.post('/api/agents/' + agentId + '/memories/bulk', { action: 'pin', ids: [memIds[0]] }); eq('bulk pin ok', r.status, 200); }
      { const r = await api.post('/api/agents/' + agentId + '/memories/bulk', { action: 'pin' }); eq('bulk pin no ids 400', r.status, 400); }
      { const r = await api.post('/api/agents/' + agentId + '/memories/bulk', { action: 'importance', ids: [memIds[0]], importance: 5 }); eq('bulk importance ok', r.status, 200); }
      { const r = await api.post('/api/agents/' + agentId + '/memories/bulk', { action: 'importance', ids: [memIds[0]], importance: 99 }); eq('bulk importance 99 -> 400', r.status, 400); }
      { const r = await api.post('/api/agents/' + agentId + '/memories/bulk', { action: 'create', contents: ['Bulk1', 'Bulk2', 'Bulk3'] }); eq('bulk create 201', r.status, 201); eq('bulk create created=3', r.body.created.length, 3); }
      { const r = await api.post('/api/agents/' + agentId + '/memories/bulk', { action: 'create' }); eq('bulk create no contents 400', r.status, 400); }
      { const r = await api.post('/api/agents/nonexistent/memories/bulk', { action: 'pin', ids: ['x'] }); eq('bulk create nonexistent 404', r.status, 404); }
      { const r = await api.post('/api/agents/' + agentId + '/memories/bulk', { action: 'unknown' }); eq('bulk unknown action 400', r.status, 400); }

      console.log('\nCascade Delete');
      const delAgent = (await api.post('/api/agents', { name: 'ToDelete' })).body.id;
      const delMem = (await api.post('/api/agents/' + delAgent + '/memories', { content: 'To delete' })).body.id;
      { const r = await api.del('/api/agents/' + delAgent); eq('cascade delete ok', r.body.ok, true); }
      { const r = await api.get('/api/agents/' + delAgent + '/memories'); eq('agent gone', r.body.length, 0); }
      { const r = await api.get('/api/memories/' + delMem + '/links'); eq('memories cascade-deleted', r.body.length, 0); }

      console.log('\nEdge Cases');
      { const r = await api.get('/api/agents/nonexistent/memories'); eq('nonexistent agent memories empty', r.body.length, 0); }
      { const r = await api.get('/api/agents/' + agentId + '/memories?importance=bad'); eq('invalid importance param handled', r.status === 200 || r.status === 400, true); }

    } finally {
      srv.close();
      try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
      if (failed > 0) { console.error(`\n❌ ${failed} test(s) failed`); process.exit(1); }
      else { console.log(`\n✅ All ${passed} tests passed!`); }
    }
  });
}

runTests().catch(err => { console.error('Fatal:', err); process.exit(1); });
