import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { scoreText, isGenerated, gradeOf, scoreRepo } from '../src/core.js';
import { MODELS } from '../src/pricing.js';

// ── grade determinism ─────────────────────────────────────────────────────────

test('scoreText is deterministic on a fixed string', () => {
  const src = 'function hello() {\n  return "world";\n}\n';
  const a = scoreText(src);
  const b = scoreText(src);
  assert.equal(a.value, b.value);
  assert.equal(a.grade, b.grade);
  assert.equal(a.tokens, b.tokens);
});

test('scoreText returns expected shape', () => {
  const r = scoreText('const x = 1;\n');
  assert.ok(typeof r.value    === 'number', 'value is number');
  assert.ok(typeof r.tokens   === 'number', 'tokens is number');
  assert.ok(typeof r.signal   === 'number', 'signal is number');
  assert.ok(typeof r.structure === 'number', 'structure is number');
  assert.ok(typeof r.redundancy === 'number', 'redundancy is number');
  assert.ok(['A','B','C','D','F'].includes(r.grade), 'grade is valid');
});

// ── gradeOf boundaries ────────────────────────────────────────────────────────

test('gradeOf A boundary: 90 → A, 89 → B', () => {
  assert.equal(gradeOf(90), 'A');
  assert.equal(gradeOf(89), 'B');
});

test('gradeOf B boundary: 75 → B, 74 → C', () => {
  assert.equal(gradeOf(75), 'B');
  assert.equal(gradeOf(74), 'C');
});

test('gradeOf C boundary: 60 → C, 59 → D', () => {
  assert.equal(gradeOf(60), 'C');
  assert.equal(gradeOf(59), 'D');
});

test('gradeOf D boundary: 45 → D, 44 → F', () => {
  assert.equal(gradeOf(45), 'D');
  assert.equal(gradeOf(44), 'F');
});

// ── isGenerated ───────────────────────────────────────────────────────────────

test('isGenerated: dist/ directory', () => {
  assert.equal(isGenerated('dist/bundle.js'), true);
  assert.equal(isGenerated('dist/subdir/file.js'), true);
});

test('isGenerated: build/ directory', () => {
  assert.equal(isGenerated('build/index.js'), true);
});

test('isGenerated: *.lock files', () => {
  assert.equal(isGenerated('package-lock.json'), true);
  assert.equal(isGenerated('yarn.lock'), true);
  assert.equal(isGenerated('pnpm-lock.yaml'), true);
});

test('isGenerated: *.min.js files', () => {
  assert.equal(isGenerated('app.min.js'), true);
  assert.equal(isGenerated('vendor/jquery.min.css'), true);
});

test('isGenerated: source map files', () => {
  assert.equal(isGenerated('app.js.map'), true);
});

test('isGenerated: .bundle.js files', () => {
  assert.equal(isGenerated('app.bundle.js'), true);
});

test('isGenerated: normal source files are NOT generated', () => {
  assert.equal(isGenerated('src/index.js'), false);
  assert.equal(isGenerated('README.md'), false);
  assert.equal(isGenerated('package.json'), false);
  assert.equal(isGenerated('src/utils/helper.ts'), false);
});

// ── cost calc math ────────────────────────────────────────────────────────────

test('cost calc: Claude Opus 4.8 at 1M tokens = $5.00', () => {
  const m = MODELS.find(m => m.name === 'Claude Opus 4.8');
  assert.ok(m, 'Claude Opus 4.8 not found in MODELS');
  assert.equal(1_000_000 / 1e6 * m.usdPerMTok, 5.0);
});

test('cost calc: GPT-4.1 at 1M tokens = $2.00', () => {
  const m = MODELS.find(m => m.name === 'GPT-4.1');
  assert.ok(m, 'GPT-4.1 not found in MODELS');
  assert.equal(1_000_000 / 1e6 * m.usdPerMTok, 2.0);
});

test('cost calc: linear scaling holds', () => {
  const m = MODELS.find(m => m.name === 'Gemini 2.0 Flash');
  assert.ok(m, 'Gemini 2.0 Flash not found in MODELS');
  const cost500k = 500_000 / 1e6 * m.usdPerMTok;
  const cost1m   = 1_000_000 / 1e6 * m.usdPerMTok;
  assert.equal(cost1m, cost500k * 2);
});

test('all MODELS have required fields with valid values', () => {
  for (const m of MODELS) {
    assert.ok(typeof m.name     === 'string' && m.name,     `model missing name`);
    assert.ok(typeof m.provider === 'string' && m.provider, `${m.name}: missing provider`);
    assert.ok(typeof m.ctx      === 'number' && m.ctx > 0,  `${m.name}: ctx must be positive`);
    assert.ok(typeof m.usdPerMTok === 'number' && m.usdPerMTok >= 0, `${m.name}: usdPerMTok must be >= 0`);
  }
});

test('MODELS covers all three expected providers', () => {
  const providers = new Set(MODELS.map(m => m.provider));
  assert.ok(providers.has('Anthropic'), 'missing Anthropic models');
  assert.ok(providers.has('OpenAI'),    'missing OpenAI models');
  assert.ok(providers.has('Google'),    'missing Google models');
});

// ── scoreRepo (library API) ───────────────────────────────────────────────────

test('scoreRepo on its own src/ returns a valid result object', () => {
  const result = scoreRepo(fileURLToPath(new URL('../src', import.meta.url)));
  assert.ok(typeof result.total   === 'number', 'total is number');
  assert.ok(typeof result.score   === 'number', 'score is number');
  assert.ok(typeof result.grade   === 'string', 'grade is string');
  assert.ok(Array.isArray(result.files),        'files is array');
  assert.ok(result.files.length > 0,            'found at least one file');
  assert.ok(result.scannedAt,                   'scannedAt is set');
});
