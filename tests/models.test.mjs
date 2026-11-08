import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_MODELS, chatModelsFrom, mergeModels, modelLabel } from '../js/models.js';
import { DEFAULT_MODEL } from '../js/settings.js';

test('initial list has the 7 requested models with sonnet first as default', () => {
  assert.deepEqual(INITIAL_MODELS.map((m) => m.id), [
    'claude-sonnet-5-5', 'gpt-6.1-sol', 'gpt-6.1-terra', 'claude-haiku-5-5', 'claude-opus-5-5',
    'gemini-4-argon', 'gemini-3.8-flash',
  ]);
  assert.equal(INITIAL_MODELS[0].id, DEFAULT_MODEL);
  assert.match(INITIAL_MODELS[0].label, /기본/);
});

test('slow gemini pro preview is labeled when loaded from the full list', () => {
  assert.match(modelLabel('gemini-3.1-pro-preview'), /매우 느림/);
});

test('chatModelsFrom keeps current chat-capable text models only', () => {
  const raw = [
    { id: 'a', owned_by: 'openai', lifecycle: 'current', endpoints: ['/v1/gateway/chat/completions/'] },
    { id: 'b', owned_by: 'openai', lifecycle: 'legacy', endpoints: ['/v1/gateway/chat/completions/'] },
    { id: 'c', owned_by: 'openai', lifecycle: 'current', endpoints: ['/v1/gateway/responses/'] },
    { id: 'gpt-audio-1.5', owned_by: 'openai', lifecycle: 'current', endpoints: ['/v1/gateway/chat/completions/'] },
    { id: 'd', owned_by: 'claude', lifecycle: 'current', endpoints: ['/v1/gateway/chat/completions/'] },
  ];
  assert.deepEqual(chatModelsFrom(raw), [{ id: 'a', provider: 'openai' }, { id: 'd', provider: 'claude' }]);
});

test('mergeModels keeps initial order, appends new ones grouped by provider, no duplicates', () => {
  const merged = mergeModels(INITIAL_MODELS, [
    { id: 'claude-sonnet-5-5', provider: 'claude' },
    { id: 'grok-4.7', provider: 'xai' },
    { id: 'claude-fable-5-1', provider: 'claude' },
  ]);
  assert.deepEqual(merged.slice(0, 7).map((m) => m.id), INITIAL_MODELS.map((m) => m.id));
  assert.deepEqual(merged.slice(7).map((m) => m.id), ['claude-fable-5-1', 'grok-4.7']);
  assert.equal(new Set(merged.map((m) => m.id)).size, merged.length);
});

test('modelLabel falls back to the id', () => {
  assert.equal(modelLabel('grok-4.7'), 'grok-4.7');
  assert.match(modelLabel('claude-sonnet-5-5'), /Sonnet 5\.5/);
});
