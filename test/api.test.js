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

  // Test 18: Search history - store
  const { addSearchHistory, getSearchHistory, deleteSearchHistory } = require('../src/db');
  const searchId = addSearchHistory(db, agentId, 'test query', 5);
  assert(searchId !== undefined);
  console.log('✓ Search history store works');

  // Test 19: Search history - retrieve
  const history = getSearchHistory(db, agentId);
  assert(Array.isArray(history));
  assert(history.length >= 1);
  assert(history[0].query === 'test query');
  assert(history[0].results_count === 5);
  console.log('✓ Search history retrieve works');

  // Test 20: Search history - delete
  const before = getSearchHistory(db, agentId).length;
  deleteSearchHistory(db, searchId);
  const after = getSearchHistory(db, agentId).length;
  assert(before > after);
  console.log('✓ Search history delete works');

  // Test 21: Reminders - create (use a surviving memory)
  const { createReminder, getRemindersForMemory, deleteReminder, getDueReminders, getReminderCount } = require('../src/db');
  // memIds[3] is pinned with imp=4, it survives forgetting
  const futureDate = new Date(Date.now() + 86400000).toISOString();
  const reminder = createReminder(db, memIds[3], futureDate, 'Review this');
  assert(reminder !== undefined);
  assert(reminder.message === 'Review this');
  console.log('✓ Reminder creation works');

  // Test 22: Reminders - list for memory
  const reminders = getRemindersForMemory(db, memIds[3]);
  assert(Array.isArray(reminders));
  assert(reminders.length >= 1);
  console.log('✓ Reminder list works');

  // Test 23: Reminders - delete
  deleteReminder(db, reminder.id);
  const afterDelete = getRemindersForMemory(db, memIds[3]);
  assert(afterDelete.length === 0);
  console.log('✓ Reminder delete works');

  // Test 24: Reminders - due (past reminder on surviving memory)
  const pastDate = new Date(Date.now() - 86400000).toISOString();
  createReminder(db, memIds[3], pastDate, 'Past reminder');
  const due = getDueReminders(db, agentId);
  assert(Array.isArray(due));
  assert(due.length >= 1);
  console.log('✓ Due reminders works');

  // Test 25: Reminder count in stats
  const count = getReminderCount(db, agentId);
  assert(typeof count === 'number');
  assert(count >= 1);
  console.log('✓ Reminder count works');

  // Test 26: Validation - agent name required
  const { validateAgentName } = require('../src/validate');
  const r1 = validateAgentName('');
  assert(!r1.valid && r1.code === 'VALIDATION_ERROR');
  const r2 = validateAgentName('  ');
  assert(!r2.valid);
  console.log('✓ Agent name validation works');

  // Test 27: Validation - agent name length
  const r3 = validateAgentName('a'.repeat(101));
  assert(!r3.valid);
  console.log('✓ Agent name length validation works');

  // Test 28: Validation - valid agent name
  const r4 = validateAgentName('Valid Agent 123');
  assert(r4.valid && r4.value === 'Valid Agent 123');
  console.log('✓ Valid agent name passes');

  // Test 29: Validation - importance bounds
  const { validateImportance } = require('../src/validate');
  assert(!validateImportance(0).valid);
  assert(!validateImportance(6).valid);
  assert(!validateImportance('abc').valid);
  assert(validateImportance(3).valid);
  console.log('✓ Importance validation works');

  // Test 30: Validation - tags limit
  const { validateTags } = require('../src/validate');
  const manyTags = Array(21).fill('tag').map((t, i) => t + i).join(',');
  assert(!validateTags(manyTags).valid);
  assert(!validateTags('').valid === false); // empty is valid
  console.log('✓ Tags validation works');

  // Test 31: Validation - relation type
  const { validateRelationType } = require('../src/validate');
  assert(!validateRelationType('invalid_type').valid);
  assert(validateRelationType('parent').valid);
  assert(validateRelationType('').valid); // default
  console.log('✓ Relation type validation works');

  console.log('\n✅ All 31 tests passed!');
} catch (err) {
  console.error('❌ Test failed:', err.message, err.stack);
  process.exit(1);
} finally {
  try { db.close(); } catch {}
  const files = fs.readdirSync(TEST_DIR);
  for (const f of files) fs.unlinkSync(path.join(TEST_DIR, f));
  fs.rmdirSync(TEST_DIR);
}
