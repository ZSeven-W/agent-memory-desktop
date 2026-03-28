// Input validation utilities

const VALID_RELATION_TYPES = ['related', 'parent', 'child', 'depends_on', 'supports', 'contrasts', 'see_also'];

const VALIDATION_ERROR = 'VALIDATION_ERROR';
const NOT_FOUND = 'NOT_FOUND';
const DB_ERROR = 'DB_ERROR';

function validateAgentName(name) {
  if (!name || typeof name !== 'string') {
    return { valid: false, error: 'name is required', code: VALIDATION_ERROR };
  }
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 100) {
    return { valid: false, error: 'name must be 1-100 characters', code: VALIDATION_ERROR };
  }
  if (!/^[\w\s\-'.]+$/u.test(trimmed)) {
    return { valid: false, error: 'name contains invalid characters', code: VALIDATION_ERROR };
  }
  return { valid: true, value: trimmed };
}

function validateMemoryContent(content) {
  if (!content || typeof content !== 'string') {
    return { valid: false, error: 'content is required', code: VALIDATION_ERROR };
  }
  const trimmed = content.trim();
  if (trimmed.length < 1 || trimmed.length > 10000) {
    return { valid: false, error: 'content must be 1-10000 characters', code: VALIDATION_ERROR };
  }
  return { valid: true, value: trimmed };
}

function validateImportance(importance) {
  const val = parseInt(importance, 10);
  if (isNaN(val) || val < 1 || val > 5) {
    return { valid: false, error: 'importance must be an integer 1-5', code: VALIDATION_ERROR };
  }
  return { valid: true, value: val };
}

function validateTags(tags) {
  if (!tags || tags === '') return { valid: true, value: '' };
  if (typeof tags !== 'string') {
    return { valid: false, error: 'tags must be a comma-separated string', code: VALIDATION_ERROR };
  }
  const tagList = tags.split(',').map(t => t.trim()).filter(Boolean);
  if (tagList.length > 20) {
    return { valid: false, error: 'maximum 20 tags allowed', code: VALIDATION_ERROR };
  }
  for (const tag of tagList) {
    if (tag.length > 50) {
      return { valid: false, error: 'each tag must be 50 characters or less', code: VALIDATION_ERROR };
    }
  }
  return { valid: true, value: tagList.join(',') };
}

function validateRelationType(type) {
  if (!type) return { valid: true, value: 'related' };
  if (!VALID_RELATION_TYPES.includes(type)) {
    return { valid: false, error: `relationType must be one of: ${VALID_RELATION_TYPES.join(', ')}`, code: VALIDATION_ERROR };
  }
  return { valid: true, value: type };
}

function validateReminder(req) {
  const { remindAt, message } = req.body || {};
  if (!remindAt) {
    return { valid: false, error: 'remindAt is required', code: VALIDATION_ERROR };
  }
  const date = new Date(remindAt);
  if (isNaN(date.getTime())) {
    return { valid: false, error: 'remindAt must be a valid ISO 8601 date', code: VALIDATION_ERROR };
  }
  if (date <= new Date()) {
    return { valid: false, error: 'remindAt must be in the future', code: VALIDATION_ERROR };
  }
  const msg = (message || '').trim();
  if (msg.length > 500) {
    return { valid: false, error: 'message must be 500 characters or less', code: VALIDATION_ERROR };
  }
  return { valid: true, value: { remindAt: date.toISOString(), message: msg } };
}

module.exports = {
  validateAgentName,
  validateMemoryContent,
  validateImportance,
  validateTags,
  validateRelationType,
  validateReminder,
  VALID_RELATION_TYPES,
  VALIDATION_ERROR,
  NOT_FOUND,
  DB_ERROR
};
