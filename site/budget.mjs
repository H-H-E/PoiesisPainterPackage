/** Site-specific guardrails, stricter than the package's authoritative schema. */
export const SITE_LIMITS = Object.freeze({
  width: 960, height: 960, pixels: 640_000, layerPixels: 2_600_000,
  commands: 240, expandedMarks: 1_200, expandedPoints: 200_000,
  simulationSteps: 160, simulationCellSteps: 60_000_000,
  ribbonVertices: 12_000_000, rasterPixels: 200_000_000,
  scoreCharacters: 200_000
});
const repairs = {
  pixels: 'Reduce width or height.',
  layerPixels: 'Reduce the canvas size or layer count.',
  commands: 'Use fewer commands or a bounded family.',
  expandedMarks: 'Reduce family.count or hatch density.',
  expandedPoints: 'Reduce paths, hatch complexity or family.count.',
  simulationSteps: 'Reduce wait.steps.',
  simulationCellSteps: 'Reduce wait steps, canvas size or layer count.',
  ribbonVertices: 'Reduce brush bristles, size or stroke complexity.',
  rasterPixels: 'Reduce brush width, mark coverage or family.count.'
};
const issue = (path, code, message, suggestion) => ({ path, code, message, suggestion });
export function checkSiteBudget(document, workload, sourceCharacters = 0) {
  const errors = [];
  if (sourceCharacters > SITE_LIMITS.scoreCharacters) errors.push(issue('/', 'site-score-size', 'JSON score exceeds the site editor limit', 'Use at most 200,000 characters.'));
  for (const key of ['width', 'height']) if (document[key] > SITE_LIMITS[key]) errors.push(issue('/' + key, 'site-' + key, key + ' exceeds playground limit ' + SITE_LIMITS[key], 'Use a smaller native render size (up to 960 per dimension).'));
  for (const [key, fix] of Object.entries(repairs)) if (workload[key] > SITE_LIMITS[key]) {
    errors.push(issue(key === 'pixels' ? '/width' : '/layers', 'site-' + key, key + ' estimate ' + workload[key] + ' exceeds playground limit ' + SITE_LIMITS[key], fix));
  }
  return errors;
}
export function parseScore(text) {
  if (text.length > SITE_LIMITS.scoreCharacters) return { ok: false, errors: [issue('/', 'site-score-size', 'The editor is over 200,000 characters', 'Reduce score size before validating.')] };
  try { return { ok: true, value: JSON.parse(text) }; }
  catch (error) { return { ok: false, errors: [issue('/', 'json-syntax', error instanceof Error ? error.message : 'Invalid JSON', 'Check quotes, commas and brackets. JSON does not support comments or trailing commas.')] }; }
}
export function validSeed(value) {
  return Number.isInteger(value) && value >= 0 && value <= 4294967295;
}
