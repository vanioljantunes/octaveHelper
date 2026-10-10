// Run with: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matlabify, cellsToScript, toFileText } from '../src/matlabify.mjs';

const conv = (src) => matlabify(src).code;
const rules = (src) => matlabify(src).notes.map((n) => n.rule);

test('comment markers', () => {
  assert.equal(conv('# a note'), '% a note');
  assert.equal(conv('x = 1; # trailing'), 'x = 1; % trailing');
  assert.equal(conv('% already fine'), '% already fine');
});

test('block comment markers', () => {
  assert.equal(conv('#{\nbody\n#}'), '%{\nbody\n%}');
});

test('text inside a block comment is left alone', () => {
  // The body of a block comment is prose, not code: a != inside it must not
  // become ~=, or the comment changes meaning.
  assert.equal(conv('#{\na != b\n#}'), '%{\na != b\n%}');
});

test('block terminators collapse to end', () => {
  assert.equal(conv('if x\n  y = 1;\nendif'), 'if x\n  y = 1;\nend');
  assert.equal(conv('for i = 1:3\nendfor'), 'for i = 1:3\nend');
  assert.equal(conv('while x\nendwhile'), 'while x\nend');
  assert.equal(conv('switch x\nendswitch'), 'switch x\nend');
  assert.equal(conv('function f()\nendfunction'), 'function f()\nend');
  assert.equal(conv('try\ncatch\nend_try_catch'), 'try\ncatch\nend');
});

test('operators', () => {
  assert.equal(conv('if a != b'), 'if a ~= b');
  assert.equal(conv('if !done'), 'if ~done');
  assert.equal(conv('if !(a && b)'), 'if ~(a && b)');
});

test('increment and compound assignment', () => {
  assert.equal(conv('i++;'), 'i = i + 1;');
  assert.equal(conv('i--;'), 'i = i - 1;');
  assert.equal(conv('total += x;'), 'total = total + x;');
  assert.equal(conv('scale *= 2;'), 'scale = scale * 2;');
  assert.equal(conv('v /= n;'), 'v = v / n;');
});

test('compound assignment is not confused with comparison', () => {
  // `a <= b`, `a >= b` and `a == b` must survive untouched.
  assert.equal(conv('if a <= b && c >= d && e == f'), 'if a <= b && c >= d && e == f');
});

test('printf family', () => {
  assert.equal(conv('printf("%d\\n", x);'), 'fprintf("%d\\n", x);');
});

test('strings are never rewritten', () => {
  assert.equal(conv("msg = 'a != b';"), "msg = 'a != b';");
  assert.equal(conv('msg = "i++";'), 'msg = "i++";');
  assert.equal(conv("s = 'use # for comments';"), "s = 'use # for comments';");
});

test('transpose is not read as a string', () => {
  assert.equal(conv("b = A' * x;"), "b = A' * x;");
  assert.equal(conv("y = x(2)' + 1;"), "y = x(2)' + 1;");
  assert.equal(conv("z = [1 2 3]' != 0;"), "z = [1 2 3]' ~= 0;");
});

test('doubled quotes inside a string', () => {
  assert.equal(conv("s = 'it''s fine != here';"), "s = 'it''s fine != here';");
});

test('behaviour changes are reported, not applied', () => {
  assert.ok(
    rules('unwind_protect\nx = 1;\nunwind_protect_cleanup\nend_unwind_protect').includes('unwind-protect'),
  );
  assert.ok(rules('n = rows(A);').includes('octave-only'));
  assert.ok(rules('s = "line\\n";').includes('double-quote-escape'));
  assert.ok(rules('!ls -l').includes('shell-escape'));
  assert.ok(rules('function y = f(x)\ny = x;\nend').includes('function-position'));
});

test('a shell escape line is not turned into a negation', () => {
  assert.equal(conv('!ls -l'), '!ls -l');
});

test('notes carry the line number', () => {
  const { notes } = matlabify('x = 1;\ny = 2;\nif a != b\nend');
  const hit = notes.find((n) => n.rule === 'not-equal');
  assert.equal(hit.line, 3);
});

test('clean MATLAB source passes through unchanged and silent', () => {
  const src = ['% already MATLAB', 'A = [1 2; 3 4];', 'b = A \\ [1; 2];', 'disp(b)'].join('\n');
  const { code, notes } = matlabify(src);
  assert.equal(code, src);
  assert.deepEqual(notes, []);
});

test('cells become %% sections in document order', () => {
  const { code } = cellsToScript([
    { type: 'markdown', source: '# Setup\nWhy this matters' },
    { type: 'code', source: 'A = [1 2; 3 4];' },
    { type: 'code', source: 'disp(A * A)' },
  ]);
  const lines = code.split('\n').filter(Boolean);
  assert.equal(lines[0], '%% Setup');
  assert.ok(lines.includes('%% Cell 2'));
  assert.ok(lines.indexOf('A = [1 2; 3 4];') < lines.indexOf('disp(A * A)'));
});

test('empty cells are dropped', () => {
  const { code } = cellsToScript([
    { type: 'code', source: 'x = 1;' },
    { type: 'code', source: '   \n  ' },
    { type: 'code', source: 'y = 2;' },
  ]);
  assert.ok(!code.includes('Cell 2'));
  assert.ok(code.includes('x = 1;'));
  assert.ok(code.includes('y = 2;'));
});

test('cell conversion still applies the syntax rules', () => {
  const { code } = cellsToScript([{ type: 'code', source: 'if a != b\n  printf("hi");\nendif' }]);
  assert.ok(code.includes('a ~= b'));
  assert.ok(code.includes('fprintf("hi")'));
  assert.ok(code.includes('\nend'));
});

test('file text is CRLF with exactly one trailing newline', () => {
  assert.equal(toFileText('a\nb'), 'a\r\nb\r\n');
  assert.equal(toFileText('a\nb\n'), 'a\r\nb\r\n');
});
