function runForgetting(db, agentId, decayDays = 7, importanceThreshold = 2, dryRun = false) {
  // decayDays=0 means no age requirement — forget any matching memories immediately
  // decayDays>0 means memories must be strictly older than the decay period
  const op = decayDays === 0 ? '>=' : '>';

  const stmt = db.prepare(`
    SELECT id FROM memories
    WHERE agent_id = ?
      AND pinned = 0
      AND importance <= ?
      AND datetime('now') ${op} datetime(created_at, '+' || ? || ' days')
  `);

  const candidates = stmt.all(agentId, importanceThreshold, decayDays);

  if (dryRun) return candidates.length;

  let deleted = 0;
  for (const c of candidates) {
    db.prepare('DELETE FROM embeddings WHERE memory_id = ?').run(c.id);
    db.prepare('DELETE FROM memories WHERE id = ?').run(c.id);
    deleted++;
  }

  return deleted;
}

module.exports = { runForgetting };
