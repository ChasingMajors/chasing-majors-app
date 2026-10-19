const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

// Slice the pure "is a sport chosen?" predicate out of checklists/app.js and
// run it in a vm sandbox (same pattern as tests/checklist-typeahead-scope.test.cjs).
// We verify ONLY the gate decision; DOM wiring and warning rendering are not
// exercised here because there is no DOM in this harness.
const script = fs.readFileSync('checklists/app.js', 'utf8');

function sliceFn(name) {
  const start = script.indexOf(name);
  if (start < 0) throw new Error('could not find ' + name);
  let i = script.indexOf('{', start);
  let depth = 0;
  for (; i < script.length; i++) {
    const ch = script[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return script.slice(start, i + 1);
    }
  }
  throw new Error('unbalanced braces slicing ' + name);
}

const isSportChosen = sliceFn('function isSportChosen_(');

const ctx = {
  STATIC_SPORTS: ['baseball', 'basketball', 'football', 'hockey', 'soccer'],
  lower: s => String(s || '').trim().toLowerCase()
};
vm.createContext(ctx);
vm.runInContext(isSportChosen, ctx);

test('placeholder / unset values are NOT a chosen sport', () => {
  assert.equal(ctx.isSportChosen_(''), false);
  assert.equal(ctx.isSportChosen_(null), false);
  assert.equal(ctx.isSportChosen_(undefined), false);
  assert.equal(ctx.isSportChosen_('nope'), false);
});

test('each real sport is a chosen sport', () => {
  for (const s of ['baseball', 'basketball', 'football', 'hockey', 'soccer']) {
    assert.equal(ctx.isSportChosen_(s), true, s + ' should be chosen');
  }
});

test('"all" is an explicit chosen sport', () => {
  assert.equal(ctx.isSportChosen_('all'), true);
});

test('the predicate is case-insensitive', () => {
  assert.equal(ctx.isSportChosen_('Baseball'), true);
  assert.equal(ctx.isSportChosen_('ALL'), true);
});
