import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureDefinitions, makeFixture } from './fixtures.mjs';
import { percentile, summarize } from './stats.mjs';

test('fixture sizes, media, IDs and explicit wait are fixed and bounded', () => {
  assert.deepEqual(fixtureDefinitions(false).map(f => f.medium), ['ink', 'watercolor', 'oil']);
  assert.equal(fixtureDefinitions(true).length, 1);
  for (const smoke of [true, false]) for (const spec of fixtureDefinitions(smoke)) {
    const doc = makeFixture(spec);
    const withoutWait = makeFixture(spec, { withoutWait: true });
    const revised = makeFixture(spec, { revised: true });
    assert.ok(doc.width * doc.height <= 384 * 256);
    assert.equal(doc.layers.length, 2);
    assert.equal(doc.layers[0].commands.length, withoutWait.layers[0].commands.length + 1);
    assert.equal(doc.layers[0].commands.at(-1).steps, spec.waitSteps);
    assert.equal(doc.layers[1].commands.length, spec.strokes);
    assert.equal(revised.layers[1].commands[0].speed, 1.2);
    assert.equal(doc.layers[1].commands[0].speed, undefined);
    const ids = doc.layers.flatMap(l => [l.id, ...l.commands.map(c => c.id)]);
    assert.equal(ids.length, new Set(ids).size);
    for (const command of doc.layers.flatMap(l => l.commands)) {
      for (const point of command.path ?? command.polygon ?? []) {
        assert.ok(point[0] >= 0 && point[0] <= 1 && point[1] >= 0 && point[1] <= 1);
      }
    }
  }
  assert.throws(() => makeFixture({ ...fixtureDefinitions(false)[0], width: 8192 }), /safety bounds/);
});

test('median, interpolated p95, spread and dispersion are mathematical values', () => {
  assert.equal(percentile([5, 1, 4, 2, 3], 95), 4.8);
  assert.deepEqual(summarize([]), null);
  assert.deepEqual(summarize([1, 2, 3, 4, 5]), {
    n: 5, median: 3, p95: 4.8, min: 1, max: 5,
    mean: 3, sampleStddev: 1.581, medianAbsoluteDeviation: 1, iqr: 2,
  });
});
