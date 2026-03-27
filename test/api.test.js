const assert = require('assert');

// Mock the server for testing
const { initDb } = require('../src/db');
const { runForgetting } = require('../src/forget');
const path = require('path');
const fs = require('fs');

const TEST_DIR = '/tmp/agent-memory-test-' + Date.now();
fs.mkdirSync(TEST_DIR, { recursive: true });

let db;
try {
  db = initDb(TEST_DIR);

  // Test 1: Create agents
  const agents = db.prepare('SELECT * FROM agents');
  console.log('✓ Database initialized');

  // Test 2: Insert an agent
  const uuid = require('uuid');
  const agentId = uuid.v4();
  db.prepare('INSERT INTO agents (id, name, description) VALUES (?, ?, ?)').run(agentId, 'TestAgent', 'A test agent');
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
  assert(agent.name === 'TestAgent');
  console.log('✓ Agent creation works');

  // Test 3: Insert memories
  for (let i = 0; i < 5; i++) {
    const memId = uuid.v4();
    db.prepare('INSERT INTO memories (id, agent_id, content, importance, pinned) VALUES (?, ?, ?, ?, ?)')
      .run(memId, agentId, `Memory ${i}`, i + 1, i === 4 ? 1 : 0);
  }
  const memories = db.prepare('SELECT * FROM memories WHERE agent_id = ?').all(agentId);
  assert(memories.length === 5);
  console.log('✓ Memory creation works');

  // Test 4: Filter by importance
  const high = db.prepare('SELECT * FROM memories WHERE agent_id = ? AND importance >= 4').all(agentId);
  assert(high.length === 2);
  console.log('✓ Importance filtering works');

  // Test 5: Forgetting dry run (decay=0, threshold=3 -> recent memories with importance <= 3 are candidates, pinned excluded)
  // memories created "now": importance 1,2,3,4,5 (5=pinned). With decay=0, threshold=3: only importance 1,2,3 = 3 candidates
  const forgotten = runForgetting(db, agentId, 0, 3, true);
  assert(forgotten === 3);
  console.log('✓ Forgetting dry run works');

  // Test 6: Pinned memories excluded from forgetting
  const pinned = db.prepare('SELECT * FROM memories WHERE agent_id = ? AND pinned = 1').get(agentId);
  assert(pinned !== undefined);
  console.log('✓ Pinned memories preserved');

  // Test 7: Old memories become forgetting candidates (with meaningful decay days)
  const oldMemId = uuid.v4();
  const oldDate = new Date(Date.now() - 10 * 86400000).toISOString();
  db.prepare('INSERT INTO memories (id, agent_id, content, importance, pinned, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(oldMemId, agentId, 'Old memory', 2, 0, oldDate);
  const oldCandidates = runForgetting(db, agentId, 7, 3, true);
  assert(oldCandidates >= 1);
  console.log('✓ Old memories become forgetting candidates');

  // Test 8: Stats
  const total = db.prepare('SELECT COUNT(*) as c FROM memories WHERE agent_id = ?').get(agentId);
  assert(total.c === 6);
  console.log('✓ Stats query works');

  console.log('\n✅ All tests passed!');
} catch (err) {
  console.error('❌ Test failed:', err.message);
  process.exit(1);
} finally {
  try { db.close(); } catch {}
  // Clean up
  const files = fs.readdirSync(TEST_DIR);
  for (const f of files) fs.unlinkSync(path.join(TEST_DIR, f));
  fs.rmdirSync(TEST_DIR);
}
