const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Agents
  getAgents: () => fetch('/api/agents').then(r => r.json()),
  createAgent: (data) => fetch('/api/agents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  }).then(r => r.json()),
  deleteAgent: (id) => fetch(`/api/agents/${id}`, { method: 'DELETE' }).then(r => r.json()),

  // Memories
  getMemories: (agentId, filters) => {
    const params = new URLSearchParams(filters || {});
    return fetch(`/api/agents/${agentId}/memories?${params}`).then(r => r.json());
  },
  createMemory: (agentId, data) => fetch(`/api/agents/${agentId}/memories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  }).then(r => r.json()),
  updateMemory: (id, data) => fetch(`/api/memories/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  }).then(r => r.json()),
  deleteMemory: (id) => fetch(`/api/memories/${id}`, { method: 'DELETE' }).then(r => r.json()),

  // Search
  searchMemories: (agentId, q, limit) => {
    return fetch(`/api/agents/${agentId}/memories/search?q=${encodeURIComponent(q)}&limit=${limit || 10}`).then(r => r.json());
  },

  // Stats
  getStats: (agentId) => fetch(`/api/agents/${agentId}/stats`).then(r => r.json()),

  // Forgetting
  runForgetting: (agentId) => fetch(`/api/agents/${agentId}/memories/forget`, {
    method: 'POST'
  }).then(r => r.json()),

  // Import/Export
  exportAgent: (agentId) => fetch(`/api/export/${agentId}`).then(r => r.json()),
  importAgent: (agentId, data) => fetch(`/api/import/${agentId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  }).then(r => r.json()),

  // Health
  health: () => fetch('/api/health').then(r => r.json())
});
