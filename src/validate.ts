import validateGenerated from './validator.generated.js';
import type { PaintingDocument, Command, Material, Intent } from './types.generated.js';
import { resolveMaterial } from './presets.js';

export interface ValidationIssue {
  path: string;
  code: string;
  message: string;
  suggestion: string;
}

export interface WorkloadEstimate {
  pixels: number;
  layerPixels: number;
  commands: number;
  expandedMarks: number;
  expandedPoints: number;
  simulationSteps: number;
  simulationCellSteps: number;
  ribbonVertices: number;
  rasterPixels: number;
}

export type ValidationResult =
  | { valid: true; errors: []; workload: WorkloadEstimate }
  | { valid: false; errors: ValidationIssue[]; workload?: WorkloadEstimate };

/** Global limits supplement structural bounds in the authoritative JSON Schema. */
export const WORKLOAD_LIMITS = Object.freeze({
  pixels: 24_000_000,
  layerPixels: 64_000_000,
  commands: 10_000,
  expandedMarks: 20_000,
  expandedPoints: 1_000_000,
  simulationSteps: 2_000,
  simulationCellSteps: 1_000_000_000,
  ribbonVertices: 80_000_000,
  rasterPixels: 2_000_000_000,
});

interface SchemaError {
  instancePath: string;
  keyword: string;
  params: Record<string, unknown>;
  message?: string;
  schemaPath: string;
}

const validateSchema = validateGenerated as ((value: unknown) => boolean) & { errors?: SchemaError[] | null };

const reserved = new Set(['__proto__', 'prototype', 'constructor']);
const escapePointer = (key: string) => key.replaceAll('~', '~0').replaceAll('/', '~1');

function schemaIssue(error: SchemaError): ValidationIssue {
  const params = error.params;
  const field = error.keyword === 'required' ? params.missingProperty
    : error.keyword === 'additionalProperties' ? params.additionalProperty
    : error.keyword === 'propertyNames' ? params.propertyName
    : undefined;
  const path = error.instancePath + (typeof field === 'string' ? '/' + escapePointer(field) : error.keyword === 'discriminator' ? '/op' : '');
  const value = (key: string) => JSON.stringify(params[key]);
  const allowed = (values: unknown) => Array.isArray(values) ? values.map(item => JSON.stringify(item)).join(', ') : 'the schema values';
  let suggestion: string;
  switch (error.keyword) {
    case 'required': suggestion = `Add ${value('missingProperty')} with the required value/type for this operation.`; break;
    case 'additionalProperties': suggestion = `Remove unsupported field ${value('additionalProperty')}; choose only properties defined for this operation.`; break;
    case 'propertyNames': suggestion = 'Rename this material key to an ASCII ID beginning with a letter (max 64 characters); avoid __proto__, prototype and constructor.'; break;
    case 'type': suggestion = `Use a JSON ${String(params.type)} here; numeric values must be finite.`; break;
    case 'enum': suggestion = `Choose exactly one of: ${allowed(params.allowedValues)}.`; break;
    case 'const': suggestion = `Replace with ${value('allowedValue')}.`; break;
    case 'pattern': suggestion = path.endsWith('/color') || path === '/background'
      ? 'Use a six-digit opaque hexadecimal color, for example "#183142".'
      : 'Use a stable ASCII ID beginning with a letter, followed only by letters, digits, _, ., : or - (max 64 characters).'; break;
    case 'minimum': suggestion = `Use a number >= ${String(params.limit)}.`; break;
    case 'maximum': suggestion = `Use a number <= ${String(params.limit)}.`; break;
    case 'minItems': suggestion = `Supply at least ${String(params.limit)} items; paths need two points, polygons three, and points two coordinates.`; break;
    case 'maxItems': suggestion = `Supply at most ${String(params.limit)} items; a point is [x,y] or [x,y,pressure].`; break;
    case 'minProperties': suggestion = `Supply at least ${String(params.limit)} material recipes.`; break;
    case 'maxProperties': suggestion = `Supply at most ${String(params.limit)} material recipes.`; break;
    case 'discriminator': suggestion = 'Set op to exactly one of: "stroke", "fill", "hatch", "family", "wait"; do not invent new operations.'; break;
    default: suggestion = 'Match src/schema.json; unsupported commands and attributes are rejected, not ignored.';
  }
  const message = error.keyword === 'discriminator'
    ? 'Command needs a supported op discriminator'
    : error.keyword === 'propertyNames'
      ? `Invalid material ID ${value('propertyName')}`
      : (error.message ?? 'Invalid value');
  return { path: path || '/', code: error.keyword, message, suggestion };
}

/** Estimate upper bounds without expanding families or allocating render surfaces. */
export function estimateWorkload(document: PaintingDocument): WorkloadEstimate {
  const workload: WorkloadEstimate = { pixels: document.width * document.height, layerPixels: document.width * document.height * document.layers.length, commands: 0, expandedMarks: 0, expandedPoints: 0, simulationSteps: 0, simulationCellSteps: 0, ribbonVertices: 0, rasterPixels: 0 };
  const dimensions = (points: readonly (readonly number[])[]) => {
    let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
    for (const point of points) { left = Math.min(left, point[0]); right = Math.max(right, point[0]); top = Math.min(top, point[1]); bottom = Math.max(bottom, point[1]); }
    return { width: (right - left) * document.width, height: (bottom - top) * document.height };
  };
  const strokeCost = (points: readonly (readonly number[])[], recipe: Material, intent?: Intent) => {
    const material = resolveMaterial(recipe), spacing = Math.max(.8, Math.min(document.width, document.height) / 640);
    const maxPerSegment = Math.max(1, Math.floor(16384 / Math.max(1, points.length - 1)));
    let samples = 1, longestChord = 0;
    for (let i = 1; i < points.length; i++) {
      const length = Math.hypot((points[i][0] - points[i - 1][0]) * document.width, (points[i][1] - points[i - 1][1]) * document.height);
      longestChord = Math.max(longestChord, length);
      samples += Math.min(maxPerSegment, Math.max(1, Math.ceil(length / spacing)));
    }
    const dry = material.medium === 'graphite' || (material.medium !== 'marker' && material.load < .4);
    const grooved = material.medium === 'oil' || material.medium === 'knife' || dry;
    const ribbons = 1 + material.bristles + (grooved ? Math.max(2, Math.round(material.bristles / 6)) : 0);
    // Ordered oil chunks repeat their boundary sample; 2x covers this overlap.
    const chunks = material.medium === 'oil' || material.medium === 'knife' ? 2 : 1;
    const box = dimensions(points);
    const widthScale = (1 - (intent?.restraint ?? 0) * .38) * (.85 + (intent?.force ?? .5) * .3);
    const margin = material.size * Math.min(document.width, document.height) * widthScale * 1.3 + longestChord * .5 + 4;
    // Conservative bounding-box estimate including brush and curve overshoot;
    // not a measured allocator/GPU-memory figure or hard duration prediction.
    const rasterPixels = Math.min(document.width, box.width + margin) * Math.min(document.height, box.height + margin) * chunks;
    return { ribbonVertices: samples * 2 * ribbons * chunks, rasterPixels: Math.ceil(rasterPixels) };
  };
  for (const layer of document.layers) for (const command of layer.commands) {
    workload.commands++;
    if (command.op === 'wait') { workload.simulationSteps += command.steps; continue; }
    if (command.op === 'family') {
      workload.expandedMarks += command.count;
      workload.expandedPoints += command.count * command.path.length;
      const cost = strokeCost(command.path, document.materials[command.material], command.intent);
      workload.ribbonVertices += cost.ribbonVertices * command.count;
      workload.rasterPixels += cost.rasterPixels * command.count;
    } else if (command.op === 'stroke') {
      workload.expandedMarks++;
      workload.expandedPoints += command.path.length;
      const cost = strokeCost(command.path, document.materials[command.material], command.intent);
      workload.ribbonVertices += cost.ribbonVertices;
      workload.rasterPixels += cost.rasterPixels;
    } else if (command.op === 'fill') {
      workload.expandedMarks++;
      workload.expandedPoints += command.polygon.length;
      const box = dimensions(command.polygon);
      workload.rasterPixels += Math.ceil(Math.min(document.width, box.width + 4) * Math.min(document.height, box.height + 4));
    } else {
      const xs = command.polygon.map(point => point[0]);
      const ys = command.polygon.map(point => point[1]);
      const diagonal = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
      const lines = Math.ceil(diagonal / command.spacing) + 1;
      // Concave polygons may produce several clipped segments on one hatch line.
      workload.expandedMarks += lines * Math.floor(command.polygon.length / 2);
      workload.expandedPoints += lines * command.polygon.length;
      const segments = lines * Math.floor(command.polygon.length / 2);
      const cost = strokeCost([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], document.materials[command.material]);
      workload.ribbonVertices += cost.ribbonVertices * segments;
      workload.rasterPixels += cost.rasterPixels * segments;
    }
  }
  workload.simulationCellSteps = workload.pixels * workload.simulationSteps;
  return workload;
}

/** Validate without mutating input or allocating canvas/material fields. */
export function validatePainting(value: unknown): ValidationResult {
  if (!validateSchema(value)) {
    const raw = (validateSchema.errors ?? []) as SchemaError[];
    const deduplicated = new Map<string, ValidationIssue>();
    // Ajv reports "not" and "propertyNames" for reserved material keys;
    // prefer the actionable property-name issue to a vague parent issue.
    const badPropertyPaths = new Set(raw.filter(error => error.keyword === 'propertyNames').map(error => error.instancePath));
    for (const error of raw) {
      if (error.keyword === 'not' && badPropertyPaths.has(error.instancePath)) continue;
      const issue = schemaIssue(error);
      deduplicated.set(issue.path + ':' + issue.code + ':' + issue.message, issue);
    }
    return { valid: false, errors: [...deduplicated.values()].slice(0, 40) };
  }
  const document = value as PaintingDocument;
  const errors: ValidationIssue[] = [];
  const seen = new Map<string, string>();
  const checkId = (id: string, path: string) => {
    if (reserved.has(id)) errors.push({ path, code: 'reserved-id', message: `ID ${id} is reserved`, suggestion: 'Choose a descriptive ID such as sky-wash instead of a JavaScript prototype name.' });
    const first = seen.get(id);
    if (first) errors.push({ path, code: 'duplicate-id', message: `ID ${id} already appears at ${first}`, suggestion: `Rename the later ID at ${path}; command and layer IDs must be globally unique.` });
    else seen.set(id, path);
  };
  document.layers.forEach((layer, layerIndex) => {
    checkId(layer.id, `/layers/${layerIndex}/id`);
    layer.commands.forEach((command: Command, commandIndex: number) => {
      const path = `/layers/${layerIndex}/commands/${commandIndex}`;
      checkId(command.id, path + '/id');
      if (command.op !== 'wait' && !Object.hasOwn(document.materials, command.material)) errors.push({ path: path + '/material', code: 'missing-material', message: `Material ${JSON.stringify(command.material)} is not defined`, suggestion: `Use an existing material ID (${Object.keys(document.materials).slice(0, 8).map(id => JSON.stringify(id)).join(', ')}) or add that key and recipe to /materials.` });
    });
  });
  if (errors.length) return { valid: false, errors };
  // Cheap gate before per-path geometry estimates on structurally valid but
  // oversized scores (schema allows 32 layers * 10,000 commands per layer).
  const commandCount = document.layers.reduce((sum, layer) => sum + layer.commands.length, 0);
  if (commandCount > WORKLOAD_LIMITS.commands) {
    return { valid: false, errors: [{ path: '/layers', code: 'workload-commands', message: `Total commands ${commandCount} exceed ${WORKLOAD_LIMITS.commands}`, suggestion: 'Remove commands across layers or use a bounded family for repeated marks.' }] };
  }
  const workload = estimateWorkload(document);
  const repairs: Record<keyof WorkloadEstimate, [string, string]> = {
    pixels: ['/width', 'Reduce width and/or height until width * height is within the budget.'],
    layerPixels: ['/layers', 'Reduce layer count or canvas dimensions until width * height * layer count fits.'],
    commands: ['/layers', 'Reduce the total command count across all layers.'],
    expandedMarks: ['/layers', 'Lower family.count or hatch polygon complexity / line density.'],
    expandedPoints: ['/layers', 'Reduce family.count, path length or hatch polygon complexity.'],
    simulationSteps: ['/layers', 'Reduce the sum of wait.steps across all layers.'],
    simulationCellSteps: ['/layers', 'Reduce wait.steps or canvas width and height.'],
    ribbonVertices: ['/layers', 'Reduce bristles, family.count, long paths or canvas dimensions.'],
    rasterPixels: ['/layers', 'Reduce brush size, mark coverage, family.count or canvas dimensions.'],
  };
  for (const key of Object.keys(WORKLOAD_LIMITS) as (keyof typeof WORKLOAD_LIMITS)[]) {
    if (workload[key] > WORKLOAD_LIMITS[key]) {
      const [path, suggestion] = repairs[key];
      errors.push({ path, code: 'workload-' + key, message: `${key} estimate ${workload[key]} exceeds ${WORKLOAD_LIMITS[key]}`, suggestion });
    }
  }
  return errors.length ? { valid: false, errors, workload } : { valid: true, errors: [], workload };
}

export class PaintingValidationError extends Error {
  readonly errors: ValidationIssue[];
  constructor(errors: ValidationIssue[]) {
    super(errors.map(error => `${error.path}: ${error.message}. ${error.suggestion}`).join('\n'));
    this.name = 'PaintingValidationError';
    this.errors = errors;
  }
}

export function assertPainting(value: unknown): asserts value is PaintingDocument {
  const result = validatePainting(value);
  if (!result.valid) throw new PaintingValidationError(result.errors);
}
