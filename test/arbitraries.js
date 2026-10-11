// Shared fast-check arbitraries: model catalogs shaped like real dsh routes.
import fc from 'fast-check';

export const PROVIDERS = ['anthropic', 'providerproxy', 'openai-codex', 'zai', 'gpu-local', 'deepseek'];
const STEMS = ['claude', 'opus', 'sonnet', 'haiku', 'fable', 'gpt', 'luna', 'sol', 'terra', 'glm', 'flash', 'mini', 'pro', 'deepseek', 'chat'];
const REAL_IDS = [
  'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5-20251001', 'claude-fable-5-1',
  'gpt-5.5', 'gpt-5.6-sol', 'gpt-5.6-luna', 'gpt-6.1-sol', 'glm-5.3-flash', 'deepseek-flash',
];

const generatedId = fc
  .tuple(fc.constantFrom(...STEMS), fc.array(fc.oneof(fc.constantFrom(...STEMS), fc.nat({ max: 12 }).map(String)), { minLength: 0, maxLength: 3 }))
  .map(([head, rest]) => [head, ...rest].join('-'));

export const modelId = fc.oneof({ weight: 2, arbitrary: fc.constantFrom(...REAL_IDS) }, { weight: 3, arbitrary: generatedId });

function titleCase(id) {
  return id.split(/[-.]/u).map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part)).join(' ');
}

/** { providers: LlmProviderInfo[], models: LlmModelInfo[] } with unique provider/id. */
export const catalog = fc
  .uniqueArray(fc.constantFrom(...PROVIDERS), { minLength: 1, maxLength: 4 })
  .chain((providerIds) => fc
    .tuple(...providerIds.map((provider) => fc.uniqueArray(modelId, { minLength: 0, maxLength: 9 })
      .map((ids) => ids.map((id) => ({ provider, id, name: titleCase(id) })))))
    .map((lists) => ({
      providers: providerIds.map((id) => ({ id, name: id === 'providerproxy' ? 'ProviderProxy (GPU)' : id })),
      models: lists.flat(),
    })));

export const selectorOf = (m) => `${m.provider}/${m.id}`;

/** A full scenario: catalog, live route, starred refs (some phantom), terminal. */
export const scenario = catalog.chain(({ providers, models }) => fc.record({
  providers: fc.constant(providers),
  models: fc.constant(models),
  current: models.length === 0 ? fc.constant(undefined) : fc.option(fc.constantFrom(...models), { nil: undefined, freq: 5 }),
  starred: models.length === 0 ? fc.constant([]) : fc.subarray(models, { maxLength: Math.min(6, models.length) }),
  phantomStars: fc.array(fc.record({ provider: fc.constantFrom('gone', 'zai'), id: modelId }), { maxLength: 2 }),
  recents: models.length === 0 ? fc.constant([]) : fc.subarray(models, { maxLength: Math.min(4, models.length) }),
  working: fc.oneof({ weight: 7, arbitrary: fc.constant(false) }, { weight: 3, arbitrary: fc.constant(true) }),
  cols: fc.integer({ min: 90, max: 170 }),
  rows: fc.integer({ min: 16, max: 40 }),
}));

/** Characters a user plausibly types into the search box (no space: space stars). */
export const queryChar = fc.constantFrom(...'abcdefghiklmnoprstuy0123456789.-/');
