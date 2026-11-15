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
  const key = error.keyword === 'required' ? error.params.missingProperty : error.keyword === 'additionalProperties' ? error.params.additionalProperty : undefined;
  const path = error.instancePath + (typeof key === 'string' ? '/' + escapePointer(key) : error.keyword === 'discriminator' ? '/op' : '');
  const suggestions: Record<string, string> = {
    additionalProperties: 'Remove this field; consult src/schema.json for supported controls.',
    required: 'Add the required field shown in the path.',
    type: 'Use the required JSON type and finite numeric values.',
    enum: 'Choose one of the values listed in the schema.',
    const: 'Use the supported version or command operation.',
    pattern: 'Use #rrggbb colors or a stable ASCII ID starting with a letter, as appropriate.',
    minimum: 'Increase the value to the documented minimum.',
    maximum: 'Reduce the value to the documented maximum.',
    minItems: 'Add the required number of coordinates or points.',
    maxItems: 'Reduce the array length to the documented limit.',
    discriminator: 'Use op: stroke, fill, hatch, family or wait.',
  };
  return { path: path || '/', code: error.keyword, message: error.message ?? 'Invalid value', suggestion: suggestions[error.keyword] ?? 'Match the supported document schema; unknown commands are not ignored.' };
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
    for (const error of raw) {
      const issue = schemaIssue(error);
      deduplicated.set(issue.path + ':' + issue.code + ':' + issue.message, issue);
    }
    return { valid: false, errors: [...deduplicated.values()].slice(0, 40) };
  }
  const document = value as PaintingDocument;
  const errors: ValidationIssue[] = [];
  const seen = new Set<string>();
  const checkId = (id: string, path: string) => {
    if (reserved.has(id)) errors.push({ path, code: 'reserved-id', message: `ID ${id} is reserved`, suggestion: 'Use a descriptive ID such as reeds or sky-wash.' });
    if (seen.has(id)) errors.push({ path, code: 'duplicate-id', message: `ID ${id} already exists`, suggestion: 'Give every layer and command a unique stable ID.' });
    seen.add(id);
  };
  document.layers.forEach((layer, layerIndex) => {
    checkId(layer.id, `/layers/${layerIndex}/id`);
    layer.commands.forEach((command: Command, commandIndex: number) => {
      const path = `/layers/${layerIndex}/commands/${commandIndex}`;
      checkId(command.id, path + '/id');
      if (command.op !== 'wait' && !Object.hasOwn(document.materials, command.material)) errors.push({ path: path + '/material', code: 'missing-material', message: `Material ${command.material} is not defined`, suggestion: 'Add this recipe to materials or select an existing material ID.' });
    });
  });
  if (errors.length) return { valid: false, errors };
  const workload = estimateWorkload(document);
  for (const key of Object.keys(WORKLOAD_LIMITS) as (keyof typeof WORKLOAD_LIMITS)[]) {
    if (workload[key] > WORKLOAD_LIMITS[key]) errors.push({ path: '/', code: 'workload-' + key, message: `${key} estimate ${workload[key]} exceeds ${WORKLOAD_LIMITS[key]}`, suggestion: key === 'pixels' || key === 'layerPixels' ? 'Reduce export dimensions or the number of layers.' : 'Reduce family counts, path points, hatch density, commands or simulation steps.' });
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
