const assert = require('assert');
const { initDb, createMemoryLink, getMemoryLinks, deleteMemoryLink, getLinkStats,
  getAllTags, renameTag, mergeTags, getImportanceDistribution, getForgettingTimeline } = require('../src/db');
const { runForgetting } = require('../src/forget');
const path = require('path');
const fs = require('fs');

const TEST_DIR = '/tmp/agent-memory-test-' + Date.now();
fs.mkdirSync(TEST_DIR, { recursive: true });

let db;
try {
  db = initDb(TEST_DIR);

  // Test 1: Database initialization
  console.log('✓ Database initialized');

  // Test 2: Create agents
  const uuid = require('uuid');
  const agentId = uuid.v4();
  db.prepare('INSERT INTO agents (id, name, description) VALUES (?, ?, ?)').run(agentId, 'TestAgent', 'A test agent');
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
  assert(agent.name === 'TestAgent');
  console.log('✓ Agent creation works');

  // Test 3: Insert memories
  const memIds = [];
  for (let i = 0; i < 5; i++) {
    const memId = uuid.v4();
    db.prepare('INSERT INTO memories (id, agent_id, content, importance, pinned, tags) VALUES (?, ?, ?, ?, ?, ?)')
      .run(memId, agentId, `Memory ${i}`, i + 1, i === 4 ? 1 : 0, i % 2 === 0 ? 'tagA,tagB' : 'tagA');
    memIds.push(memId);
  }
  const memories = db.prepare('SELECT * FROM memories WHERE agent_id = ?').all(agentId);
  assert(memories.length === 5);
  console.log('✓ Memory creation works');

  // Test 4: Filter by importance
  const high = db.prepare('SELECT * FROM memories WHERE agent_id = ? AND importance >= 4').all(agentId);
  assert(high.length === 2);
  console.log('✓ Importance filtering works');

  // Test 5: Tag management - getAllTags
  const tags = getAllTags(db, agentId);
  assert(tags.find(t => t.name === 'tagA')?.count === 5);
  assert(tags.find(t => t.name === 'tagB')?.count === 3);
  console.log('✓ Tag management works');

  // Test 6: Tag rename
  const renamed = renameTag(db, agentId, 'tagB', 'tagC');
  assert(renamed === 3);
  const tags2 = getAllTags(db, agentId);
  assert(!tags2.find(t => t.name === 'tagB'));
  assert(tags2.find(t => t.name === 'tagC')?.count === 3);
  console.log('✓ Tag rename works');

  // Test 7: Tag merge
  const merged = mergeTags(db, agentId, 'tagC', 'tagA');
  assert(merged === 3);
  const tags3 = getAllTags(db, agentId);
  assert(!tags3.find(t => t.name === 'tagC'));
  const tagA = tags3.find(t => t.name === 'tagA');
  assert(tagA?.count === 5); // All memories now have tagA
  console.log('✓ Tag merge works');

  // Test 8: Memory linking
  const link1 = createMemoryLink(db, memIds[0], memIds[1], 'related');
  assert(link1.from_memory_id === memIds[0]);
  assert(link1.to_memory_id === memIds[1]);
  assert(link1.relation_type === 'related');
  console.log('✓ Memory link creation works');

  const link2 = createMemoryLink(db, memIds[0], memIds[2], 'parent');
  assert(link2.relation_type === 'parent');
  console.log('✓ Multiple link types work');

  // Test 9: Get memory links (bidirectional)
  const links = getMemoryLinks(db, memIds[0]);
  assert(links.length === 2); // links FROM mem[0] to mem[1] and mem[2]
  console.log('✓ Get memory links works');

  // Test 10: Link stats
  const linkStats = getLinkStats(db, agentId);
  assert(linkStats.total === 2);
  assert(linkStats.mostLinked.length > 0);
  assert(linkStats.mostLinked[0].id === memIds[0]); // mem[0] has most links
  console.log('✓ Link stats works');

  // Test 11: Delete memory link
  const deleted = deleteMemoryLink(db, link1.id);
  const linksAfter = getMemoryLinks(db, memIds[0]);
  assert(linksAfter.length === 1);
  console.log('✓ Delete memory link works');

  // Test 12: Importance distribution
  const dist = getImportanceDistribution(db, agentId);
  assert(dist[1] === 1);
  assert(dist[5] === 1);
  assert(dist[3] === 1);
  console.log('✓ Importance distribution works');

  // Test 13: Forgetting timeline
  const timeline = getForgettingTimeline(db, agentId);
  assert(Array.isArray(timeline));
  console.log('✓ Forgetting timeline works');

  // Test 14: Forgetting dry run
  const forgotten = runForgetting(db, agentId, 0, 3, true);
  // mem[0]=imp1, mem[1]=imp2, mem[2]=imp3, mem[3]=imp4(pinned), mem[4]=imp5
  // decay=0, threshold=3: importance <= 3 and not pinned: mem[0], mem[1], mem[2] = 3 candidates
  assert(forgotten === 3);
  console.log('✓ Forgetting dry run works');

  // Test 15: Forgetting actually deletes
  const deleted2 = runForgetting(db, agentId, 0, 3, false);
  const remaining = db.prepare('SELECT COUNT(*) as c FROM memories WHERE agent_id = ?').get(agentId);
  assert(remaining.c === 2); // Only mem[3] and mem[4] should remain
  console.log('✓ Forgetting deletion works');

  // Test 16: Pinned memory excluded from forgetting
  const pinned = db.prepare('SELECT * FROM memories WHERE agent_id = ? AND pinned = 1').get(agentId);
  assert(pinned !== undefined);
  console.log('✓ Pinned memories preserved');

  // Test 17: Old memory becomes forgetting candidate
  const oldMemId = uuid.v4();
  const oldDate = new Date(Date.now() - 10 * 86400000).toISOString();
  db.prepare('INSERT INTO memories (id, agent_id, content, importance, pinned, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(oldMemId, agentId, 'Old memory', 2, 0, oldDate);
  const oldCandidates = runForgetting(db, agentId, 7, 3, true);
  assert(oldCandidates >= 1);
  console.log('✓ Old memories become forgetting candidates');

  console.log('\n✅ All 17 tests passed!');
} catch (err) {
  console.error('❌ Test failed:', err.message, err.stack);
  process.exit(1);
} finally {
  try { db.close(); } catch {}
  const files = fs.readdirSync(TEST_DIR);
  for (const f of files) fs.unlinkSync(path.join(TEST_DIR, f));
  fs.rmdirSync(TEST_DIR);
}
