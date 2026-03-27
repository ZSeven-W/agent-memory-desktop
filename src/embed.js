const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';

async function getEmbedding(text, model = 'nomic-embed-text') {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(`${OLLAMA_URL}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: text }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) return null;
    const data = await response.json();
    return data.embedding || null;
  } catch {
    return null;
  }
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function searchByEmbedding(query, agentId, limit, db) {
  const queryEmbedding = await getEmbedding(query);
  if (!queryEmbedding) return [];

  const rows = db.prepare(
    'SELECT e.embedding, m.* FROM embeddings e JOIN memories m ON e.memory_id = m.id WHERE e.agent_id = ?'
  ).all(agentId);

  const scored = rows.map(row => {
    const embedding = JSON.parse(row.embedding);
    const score = cosineSimilarity(queryEmbedding, embedding);
    return { ...row, score: parseFloat(score.toFixed(4)) };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

module.exports = { getEmbedding, searchByEmbedding, cosineSimilarity };
