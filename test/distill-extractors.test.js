import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { extractSkeleton } from '../src/distill.js';

const fixturesDir = fileURLToPath(new URL('./fixtures', import.meta.url));
const read = (...p) => fs.readFileSync(path.join(fixturesDir, ...p), 'utf8');

// ── Python ──────────────────────────────────────────────────────────────────

test('extractSkeleton (Python): keeps module/class/def docstrings, decorators, and signatures', () => {
  const skeleton = extractSkeleton(read('python', 'service.py'), '.py');

  assert.match(skeleton, /"""User account service/, 'module docstring kept');
  assert.match(skeleton, /@dataclass/, 'decorator kept');
  assert.match(skeleton, /class Account:/, 'class signature kept');
  assert.match(skeleton, /"""A user account record\."""/, 'class docstring kept');
  assert.match(skeleton, /class AccountService:/);
  assert.match(skeleton, /def __init__\(self, db\):/, 'method signature kept');
  assert.match(skeleton, /def create_account\(self, email, password\):/);
  assert.match(skeleton, /"""Create a new account, hashing the password before storage\."""/, 'method docstring kept');
  assert.match(skeleton, /@staticmethod/);
  assert.match(skeleton, /def validate_email\(email\):/);
  assert.match(skeleton, /@property/);
  assert.match(skeleton, /def upgrade_plan\(account, plan\):/, 'module-level function kept');
});

test('extractSkeleton (Python): drops function/method bodies', () => {
  const skeleton = extractSkeleton(read('python', 'service.py'), '.py');

  assert.doesNotMatch(skeleton, /hashlib\.sha256/, 'body statement dropped');
  assert.doesNotMatch(skeleton, /self\.db\.insert/, 'body statement dropped');
  assert.doesNotMatch(skeleton, /"@" in email/, 'body statement dropped');
  assert.doesNotMatch(skeleton, /raise ValueError/, 'body statement dropped');
});

test('extractSkeleton (Python): handles async def and keeps its docstring', () => {
  const skeleton = extractSkeleton(read('python', 'utils.py'), '.py');

  assert.match(skeleton, /def slugify\(text\):/);
  assert.match(skeleton, /"""Convert text to a lowercase, hyphen-separated slug\."""/);
  assert.match(skeleton, /async def fetch_with_retry\(client, url, attempts=3\):/);
  assert.match(skeleton, /"""Fetch a URL, retrying on failure up to `attempts` times\."""/);
  assert.doesNotMatch(skeleton, /last_error/, 'body statement dropped');
  assert.doesNotMatch(skeleton, /for _ in range/, 'body statement dropped');
});

// ── Go ──────────────────────────────────────────────────────────────────────

test('extractSkeleton (Go): keeps doc comments, struct fields, interface methods, and func signatures', () => {
  const skeleton = extractSkeleton(read('go', 'server.go'), '.go');

  assert.match(skeleton, /\/\/ Widget represents a single item in the catalog\./);
  assert.match(skeleton, /type Widget struct \{/);
  assert.match(skeleton, /ID\s+string/, 'struct field kept');
  assert.match(skeleton, /type Store interface \{/);
  assert.match(skeleton, /Get\(id string\) \(\*Widget, error\)/, 'interface method kept');
  assert.match(skeleton, /func NewServer\(store Store\) \*Server \{ … \}/, 'func signature kept, body dropped');
  assert.match(skeleton, /func \(s \*Server\) ServeHTTP\(w http\.ResponseWriter, r \*http\.Request\) \{ … \}/, 'method with receiver kept');
});

test('extractSkeleton (Go): drops func bodies', () => {
  const skeleton = extractSkeleton(read('go', 'server.go'), '.go');

  assert.doesNotMatch(skeleton, /http\.Error/, 'body statement dropped');
  assert.doesNotMatch(skeleton, /json\.NewEncoder/, 'body statement dropped');
  assert.doesNotMatch(skeleton, /price \* 0\.9/, 'body statement dropped');
});

test('extractSkeleton (Go): handles multiple funcs and a plain (non-receiver) struct type', () => {
  const skeleton = extractSkeleton(read('go', 'util.go'), '.go');

  assert.match(skeleton, /func Slugify\(text string\) string \{ … \}/);
  assert.match(skeleton, /type RetryConfig struct \{/);
  assert.match(skeleton, /Attempts int/);
  assert.match(skeleton, /func FetchWithRetry\(url string, cfg RetryConfig\) \(string, error\) \{ … \}/);
  assert.doesNotMatch(skeleton, /lastErr/, 'body statement dropped');
});

// ── Java ────────────────────────────────────────────────────────────────────

test('extractSkeleton (Java): keeps class javadoc, public method signatures, drops private members and bodies', () => {
  const skeleton = extractSkeleton(read('java', 'Calculator.java'), '.java');

  assert.match(skeleton, /A simple calculator supporting basic arithmetic/, 'class javadoc kept');
  assert.match(skeleton, /public class Calculator \{/);
  assert.match(skeleton, /public Calculator\(\) \{ … \}/, 'constructor kept');
  assert.match(skeleton, /Adds a value to the running total/, 'method javadoc kept');
  assert.match(skeleton, /public double add\(double value\) \{ … \}/);
  assert.match(skeleton, /public double subtract\(double value\) \{ … \}/);
  assert.match(skeleton, /public double getTotal\(\) \{ … \}/);

  assert.doesNotMatch(skeleton, /applyRounding/, 'private method dropped entirely');
  assert.doesNotMatch(skeleton, /this\.total \+= value/, 'body statement dropped');
  assert.doesNotMatch(skeleton, /Math\.round/, 'private method body dropped');
});

test('extractSkeleton (Java): keeps interface method signatures (no bodies to drop)', () => {
  const skeleton = extractSkeleton(read('java', 'PaymentGateway.java'), '.java');

  assert.match(skeleton, /Contract implemented by all payment providers/);
  assert.match(skeleton, /public interface PaymentGateway \{/);
  assert.match(skeleton, /boolean charge\(String accountId, long amountCents\);/);
  assert.match(skeleton, /void refund\(String transactionId\);/);
  assert.match(skeleton, /enum PaymentStatus \{/);
});

// ── Kotlin ──────────────────────────────────────────────────────────────────

test('extractSkeleton (Kotlin): keeps data class, class kdoc, public fun signatures, drops private members and bodies', () => {
  const skeleton = extractSkeleton(read('kotlin', 'Repository.kt'), '.kt');

  assert.match(skeleton, /A user record fetched from storage/, 'kdoc kept');
  assert.match(skeleton, /data class User\(val id: String, val email: String, val active: Boolean = true\)/, 'one-line data class kept whole');
  assert.match(skeleton, /class UserRepository\(private val db: Database\) \{/);
  assert.match(skeleton, /Returns the user with the given id/, 'method kdoc kept');
  assert.match(skeleton, /fun findById\(id: String\): User\? \{ … \}/);
  assert.match(skeleton, /fun invalidate\(id: String\) \{ … \}/);

  assert.doesNotMatch(skeleton, /logAccess/, 'private method dropped entirely');
  assert.doesNotMatch(skeleton, /cache\[id\]/, 'body statement dropped');
  assert.doesNotMatch(skeleton, /mutableMapOf/, 'private property dropped');
});

test('extractSkeleton (Kotlin): keeps interface/object/top-level fun signatures', () => {
  const skeleton = extractSkeleton(read('kotlin', 'Notifier.kt'), '.kt');

  assert.match(skeleton, /interface NotificationChannel \{/);
  assert.match(skeleton, /object EmailChannel : NotificationChannel \{/);
  assert.match(skeleton, /override fun send\(message: String\): Boolean \{ … \}/);
  assert.match(skeleton, /fun buildGreeting\(name: String\): String \{ … \}/);
  assert.doesNotMatch(skeleton, /emailing:/, 'body statement dropped');
});
