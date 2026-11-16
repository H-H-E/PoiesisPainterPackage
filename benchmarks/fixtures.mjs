/** Fixed, intentionally small workloads. Do not silently increase dimensions/counts. */
const media = [
  { id: 'ink-lines', medium: 'ink', color: '#263b48', ground: '#8299a0' },
  { id: 'watercolor-wash', medium: 'watercolor', color: '#356d94', ground: '#bed2cc' },
  { id: 'oil-strokes', medium: 'oil', color: '#37556b', ground: '#9ca6a1' },
];

export function fixtureDefinitions(smoke = false) {
  const selected = smoke ? media.slice(1, 2) : media;
  return selected.map(({ id, medium, color, ground }) => ({
    id, medium, color, ground, seed: 6901,
    width: smoke ? 160 : 384,
    height: smoke ? 112 : 256,
    strokes: smoke ? 3 : 7,
    waitSteps: smoke ? 2 : 3,
    layers: 2,
    revision: { commandId: 'stroke-0', patch: { speed: 1.2 } },
  }));
}

export function makeFixture(spec, { withoutWait = false, revised = false } = {}) {
  if (!Number.isInteger(spec.width) || !Number.isInteger(spec.height) ||
      spec.width < 1 || spec.height < 1 || spec.width > 384 || spec.height > 256 ||
      !Number.isInteger(spec.strokes) || spec.strokes < 1 || spec.strokes > 7 ||
      !Number.isInteger(spec.waitSteps) || spec.waitSteps < 0 || spec.waitSteps > 3 ||
      !media.some(item => item.id === spec.id && item.medium === spec.medium)) {
    throw new Error('Fixture outside benchmark safety bounds');
  }
  const strokes = Array.from({ length: spec.strokes }, (_, index) => {
    const y = 0.13 + index * 0.105;
    return {
      id: `stroke-${index}`, op: 'stroke', material: 'line',
      path: [[0.1, y + 0.07, 0.15], [0.48, y, 0.9], [0.88, y + 0.04, 0.2]],
      ...(revised && index === 0 ? spec.revision.patch : {}),
    };
  });
  return {
    version: '1.0', width: spec.width, height: spec.height, seed: spec.seed,
    background: '#eee9e0', paper: { texture: 0.32, absorbency: 0.55 },
    materials: {
      ground: { medium: spec.medium, color: spec.ground, size: 0.065, opacity: 0.55, bristles: 8 },
      line: { medium: spec.medium, color: spec.color, size: 0.028, load: 0.8, bristles: 12 },
    },
    layers: [
      { id: 'ground-layer', commands: [
        { id: 'ground-fill', op: 'fill', material: 'ground', polygon: [[0.04, 0.06], [0.96, 0.06], [0.96, 0.93], [0.04, 0.93]] },
        ...(!withoutWait && spec.waitSteps > 0 ? [{ id: 'drying-wait', op: 'wait', steps: spec.waitSteps }] : []),
      ] },
      { id: 'marks-layer', commands: strokes },
    ],
  };
}
