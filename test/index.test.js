import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scoreText, isGenerated, isTextFile, gradeOf, scoreRepo, reasonFor, computePatterns, writeAiignore, walk } from '../src/core.js';
import { MODELS, effectiveTokens, TOKEN_FACTOR } from '../src/pricing.js';
import { extractSkeleton, buildImportGraph, distillRepo, writeSummaries } from '../src/distill.js';

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

test('scoreRepo on an empty repo returns grade N/A, not F', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-readability-empty-'));
  try {
    const result = scoreRepo(tmpDir);
    assert.strictEqual(result.grade, 'N/A');
    assert.strictEqual(result.total, 0);
    assert.strictEqual(result.score, 0);
    assert.deepStrictEqual(result.files, []);
    assert.strictEqual(result.skippedFiles, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ── reasonFor grade guard ─────────────────────────────────────────────────────

test('reasonFor: A-grade file is never flagged as token-hog', () => {
  // value=95 → grade A; tokens=2000/10000 = 20% > threshold
  const file = { file: 'src/big.ts', value: 95, tokens: 2000 };
  assert.equal(reasonFor(file, 10000), null, 'A-grade must not be flagged');
});

test('reasonFor: B-grade file is never flagged as token-hog', () => {
  const file = { file: 'src/medium.ts', value: 80, tokens: 2000 };
  assert.equal(reasonFor(file, 10000), null, 'B-grade must not be flagged');
});

test('reasonFor: C-grade large file IS flagged as token-hog', () => {
  // value=65 → grade C; 20% of total
  const file = { file: 'src/noisy.ts', value: 65, tokens: 2000 };
  assert.ok(reasonFor(file, 10000) !== null, 'C-grade token-hog must be flagged');
});

test('reasonFor: low-signal F-grade file is flagged regardless of size', () => {
  const file = { file: 'src/minified.js', value: 30, tokens: 50 };
  assert.equal(reasonFor(file, 10000), 'low-signal (F)');
});

test('reasonFor: generated file is always flagged regardless of grade', () => {
  // A-grade score but lives in dist/ → generated
  const file = { file: 'dist/bundle.js', value: 95, tokens: 10 };
  assert.equal(reasonFor(file, 10000), 'generated');
});

// ── writeAiignore idempotency ─────────────────────────────────────────────────

test('writeAiignore: second run adds zero lines and file is byte-identical', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-readability-fix-'));
  try {
    // vendor/ is in GEN_DIRS but NOT in the walk SKIP set, so scoreRepo will
    // visit it and reasonFor will return 'generated' for those files.
    const vendorDir = path.join(tmpDir, 'vendor');
    fs.mkdirSync(vendorDir);
    fs.writeFileSync(
      path.join(vendorDir, 'jquery.js'),
      '(function(){var x=1;})();\n'.repeat(200),
    );
    // A clean source file that must NOT be flagged
    fs.writeFileSync(
      path.join(tmpDir, 'index.js'),
      'export function greet(name) {\n  return `Hello, ${name}!`;\n}\n',
    );

    const { total, files } = scoreRepo(tmpDir);
    const patterns = computePatterns(files, total);
    assert.ok(patterns.length > 0, 'fixture must produce at least one pattern');

    const dest = path.join(tmpDir, '.aiignore');

    const added1 = writeAiignore(dest, patterns);
    assert.ok(added1 > 0, 'first run must write patterns');
    const content1 = fs.readFileSync(dest, 'utf8');

    const added2 = writeAiignore(dest, patterns);
    assert.equal(added2, 0, 'second run must add nothing');
    const content2 = fs.readFileSync(dest, 'utf8');

    assert.equal(content1, content2, 'file must be byte-identical after second run');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('writeAiignore: deduplicates and never inserts blank lines', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-readability-dedup-'));
  try {
    const dest = path.join(tmpDir, '.aiignore');
    fs.writeFileSync(dest, 'dist/\n');

    const added = writeAiignore(dest, ['dist/', 'build/']);
    assert.equal(added, 1, 'only the new pattern should be added');

    const content = fs.readFileSync(dest, 'utf8');
    assert.equal(content, 'dist/\nbuild/\n', 'no blank line between existing and new pattern');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ── isTextFile (extensions + extension-less names) ─────────────────────────────

test('isTextFile: recognizes new extensions and extension-less names', () => {
  assert.equal(isTextFile('worker.mjs'), true);
  assert.equal(isTextFile('main.tf'), true);
  assert.equal(isTextFile('schema.proto'), true);
  assert.equal(isTextFile('Dockerfile'), true);
  assert.equal(isTextFile('Makefile'), true);
  assert.equal(isTextFile('photo.png'), false);
  assert.equal(isTextFile('archive.zip'), false);
});

// ── effectiveTokens (cross-tokenizer correction) ───────────────────────────────

test('effectiveTokens: OpenAI is identity, Anthropic/Google scale up', () => {
  const openai    = MODELS.find(m => m.provider === 'OpenAI');
  const anthropic = MODELS.find(m => m.provider === 'Anthropic');
  const google    = MODELS.find(m => m.provider === 'Google');
  assert.equal(effectiveTokens(1000, openai), 1000);
  assert.equal(effectiveTokens(1000, anthropic), Math.round(1000 * TOKEN_FACTOR.Anthropic));
  assert.equal(effectiveTokens(1000, google), Math.round(1000 * TOKEN_FACTOR.Google));
  assert.ok(effectiveTokens(1000, anthropic) > 1000, 'Claude must count more tokens');
});

test('every model carries a positive tokenFactor', () => {
  for (const m of MODELS) {
    assert.ok(typeof m.tokenFactor === 'number' && m.tokenFactor > 0, `${m.name}: tokenFactor`);
  }
});

// ── .gitignore support + glob matching ─────────────────────────────────────────

test('scoreRepo: respectGitignore excludes gitignored files, default keeps them', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-readability-gi-'));
  try {
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'secret.js\n*.log\nbuilt/\n');
    fs.writeFileSync(path.join(tmpDir, 'index.js'), 'export const a = 1;\n');
    fs.writeFileSync(path.join(tmpDir, 'secret.js'), 'export const key = "x";\n');
    fs.writeFileSync(path.join(tmpDir, 'debug.log'), 'noise\n'.repeat(50));
    fs.mkdirSync(path.join(tmpDir, 'built'));
    fs.writeFileSync(path.join(tmpDir, 'built', 'out.js'), 'var x=1;\n');

    const withGi = scoreRepo(tmpDir, { respectGitignore: true });
    const files  = withGi.files.map(f => f.file.replace(/\\/g, '/'));
    assert.ok(files.includes('index.js'), 'kept file present');
    assert.ok(!files.includes('secret.js'), 'gitignored basename excluded');
    assert.ok(!files.includes('debug.log'), 'gitignored glob excluded');
    assert.ok(!files.some(f => f.startsWith('built/')), 'gitignored dir excluded');

    const without = scoreRepo(tmpDir, { respectGitignore: false });
    const all = without.files.map(f => f.file.replace(/\\/g, '/'));
    assert.ok(all.includes('secret.js'), 'default scan keeps gitignored file');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('scoreRepo: maxBytes skips oversized files', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-readability-big-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'small.js'), 'export const a = 1;\n');
    fs.writeFileSync(path.join(tmpDir, 'huge.js'), 'x'.repeat(5000));
    const r = scoreRepo(tmpDir, { maxBytes: 1000 });
    const files = r.files.map(f => f.file.replace(/\\/g, '/'));
    assert.ok(files.includes('small.js'), 'small file kept');
    assert.ok(!files.includes('huge.js'), 'oversized file skipped');
    assert.strictEqual(r.skippedFiles, 1, 'skippedFiles counts the one oversized file');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('walk: **/*.js pattern matches root-level files, not just nested ones', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-readability-globroot-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'index.js'), 'export const a = 1;\n');
    fs.mkdirSync(path.join(tmpDir, 'nested'));
    fs.writeFileSync(path.join(tmpDir, 'nested', 'foo.js'), 'export const b = 2;\n');
    fs.writeFileSync(path.join(tmpDir, 'keep.md'), '# keep\n');
    const out = walk(tmpDir, ['**/*.js']);
    const files = out.map(f => path.relative(tmpDir, f).replace(/\\/g, '/'));
    assert.ok(!files.includes('index.js'), 'root-level index.js excluded by **/*.js');
    assert.ok(!files.includes('nested/foo.js'), 'nested foo.js excluded by **/*.js');
    assert.ok(files.includes('keep.md'), 'non-matching file kept');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('scoreRepo: repeated calls with the same ignore patterns reuse cached regexes and return identical results', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-readability-cache-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'a.js'), 'export const a = 1;\n');
    fs.writeFileSync(path.join(tmpDir, 'a.log'), 'noise\n');
    const patterns = ['*.log', '**/*.test.js'];
    const r1 = scoreRepo(tmpDir, { ignorePatterns: patterns });
    const r2 = scoreRepo(tmpDir, { ignorePatterns: patterns });
    assert.deepStrictEqual(r1.files.map(f => f.file), r2.files.map(f => f.file));
    assert.strictEqual(r1.score, r2.score);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('computePatterns: excludes A/B-grade source files even when large', () => {
  // Synthetic file list: one A-grade large file, one generated file
  const total = 10000;
  const files = [
    { file: 'src/main.ts',    value: 92, tokens: 3000, grade: 'A' }, // 30% but A-grade
    { file: 'dist/bundle.js', value: 80, tokens: 5000, grade: 'B' }, // generated → must be included
  ];
  const patterns = computePatterns(files, total);
  assert.ok(!patterns.includes('src/main.ts'),  'A-grade source file must NOT appear in patterns');
  assert.ok(patterns.includes('dist/'),          'generated dist/ must appear in patterns');
});

// ── distill: skeleton extraction ───────────────────────────────────────────────

test('extractSkeleton (JS): keeps API, drops bodies, skips private members', () => {
  const src = [
    '/** Banner doc. */',
    "import x from './x.js';",
    'export function greet(name) {',
    '  const secret = 42;',
    '  return `hi ${name} ${secret}`;',
    '}',
    'export class Service {',
    '  publicMethod(a) { return a + 1; }',
    '  private hidden() { return 99; }',
    '}',
    'export interface Opts { id: number; name: string; }',
    'function internalHelper() { return 1; }',
  ].join('\n');
  const sk = extractSkeleton(src, '.js');
  assert.ok(sk.includes('export function greet(name)'), 'keeps exported function signature');
  assert.ok(sk.includes('{ … }'), 'replaces body with elision marker');
  assert.ok(!sk.includes('secret = 42'), 'drops implementation detail');
  assert.ok(sk.includes('publicMethod'), 'keeps public method signature');
  assert.ok(!sk.includes('hidden'), 'skips private member');
  assert.ok(sk.includes('id: number'), 'keeps interface body (the contract)');
  assert.ok(sk.includes('Banner doc'), 'keeps banner doc comment');
});

test('buildImportGraph: counts fan-in across relative imports', () => {
  const infos = [
    { rel: 'util.js',  ext: '.js', text: 'export const a = 1;' },
    { rel: 'a.js',     ext: '.js', text: "import { a } from './util.js';" },
    { rel: 'b.js',     ext: '.js', text: "import { a } from './util';" }, // extensionless
    { rel: 'c.js',     ext: '.js', text: "const x = require('./util.js');" },
  ];
  const fanIn = buildImportGraph(infos);
  assert.equal(fanIn.get('util.js'), 3, 'util.js imported by three files');
});

test('distillRepo: ranks high-fan-in files and reports savings', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-readability-distill-'));
  try {
    // A central util imported by two others, padded so it is worth summarizing.
    const body = Array.from({ length: 40 }, (_, i) => `  step${i}(); // work line ${i}`).join('\n');
    fs.writeFileSync(path.join(tmpDir, 'util.js'),
      '/** Core util. */\nexport function run() {\n' + body + '\n}\nexport const VERSION = 1;\n');
    fs.writeFileSync(path.join(tmpDir, 'a.js'), "import { run } from './util.js';\nrun();\n");
    fs.writeFileSync(path.join(tmpDir, 'b.js'), "import { run } from './util.js';\nrun();\n");

    const result = distillRepo(tmpDir, { minFanIn: 2, minTokens: 50 });
    const util = result.candidates.find(c => c.file === 'util.js');
    assert.ok(util, 'util.js is a candidate');
    assert.equal(util.fanIn, 2, 'fan-in is 2');
    assert.ok(util.savedTokens > 0, 'summary saves tokens');
    assert.ok(util.skeleton.includes('export function run'), 'skeleton keeps the export');
    assert.ok(result.totals.savedPct > 0, 'totals report a saving');

    const w = writeSummaries(tmpDir, result.candidates);
    assert.ok(fs.existsSync(path.join(tmpDir, '.ai', 'summaries', 'CONTEXT_MAP.md')), 'writes CONTEXT_MAP.md');
    assert.ok(fs.existsSync(path.join(tmpDir, '.ai', 'summaries', 'util.js.md')), 'writes per-file summary');
    assert.equal(w.written, result.candidates.length, 'reports written count');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
