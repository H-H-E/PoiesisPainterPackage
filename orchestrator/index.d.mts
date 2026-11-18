import type { PaintingDocument, Layer } from '../src/types.generated.js';
import type { CanvasFactory, CanvasSurface, RenderReport } from '../src/index.js';

export type CapabilityLevel = 'none' | 'approximate' | 'native';
export type CapabilityTable = Record<string, CapabilityLevel>;
export interface EngineCapabilities {
  transparent: true;
  media: CapabilityTable;
  operations: CapabilityTable;
  features: CapabilityTable;
  notes?: string;
}
export interface LayerInput {
  score: PaintingDocument;
  layer: Layer;
  canvas: CanvasSurface;
  signal?: AbortSignal;
  canvasFactory: CanvasFactory;
}
export interface PaintingAdapter {
  id: string;
  label?: string;
  priority?: number;
  capabilities: EngineCapabilities;
  available?: () => boolean | string;
  renderLayer(input: LayerInput): Promise<unknown> | unknown;
}
export interface Candidate {
  id: string;
  eligible: boolean;
  failed: string[];
  warnings: string[];
  priority: number;
}
export interface RoutingDecision {
  id: string;
  engine: string;
  requirements: { media: string[]; operations: string[]; features: string[] };
  warnings: string[];
  reason: string;
  candidates: Candidate[];
}
export interface RouteOptions {
  pins?: Record<string, string>;
  minimum?: 'approximate' | 'native';
}
export interface RenderOptions extends RouteOptions {
  signal?: AbortSignal;
  onLayer?: (report: LayerRun) => void | Promise<void>;
}
export interface PaintingPlan { version: '1.0'; policy: { minimum: string; pins: Record<string, string> }; layers: RoutingDecision[] }
export interface LayerRun { id: string; engine: string; elapsedMs: number; warnings: string[] }
export interface OrchestrationReport { plan: PaintingPlan; layers: LayerRun[]; elapsedMs: number; measured: true }
export class PaintingOrchestrator {
  constructor(input: { adapters: PaintingAdapter[]; validatePainting: (value: unknown) => { valid: boolean; errors?: Array<{ path: string; message: string }> }; canvasFactory?: CanvasFactory });
  capabilities(): Array<{ id: string; label: string; capabilities: EngineCapabilities; priority: number; available: boolean }>;
  plan(score: PaintingDocument, options?: RouteOptions): PaintingPlan;
  render(score: PaintingDocument, target: CanvasSurface, options?: RenderOptions): Promise<OrchestrationReport>;
}
export function createPoiesisAdapter(input: { Painter: new (canvas: CanvasSurface, options?: { canvasFactory?: CanvasFactory; historyLimit?: number }) => { render(score: unknown, options?: { signal?: AbortSignal; transparentBackground?: boolean }): Promise<RenderReport>; dispose(): void }; canvasFactory?: CanvasFactory }): PaintingAdapter;
export function createCanvasReferenceAdapter(): PaintingAdapter;
export function createP5BrushAdapter(input?: { brush?: Record<string, (...args: any[]) => any>; brushName?: string }): PaintingAdapter;
export function createPerfectFreehandAdapter(input?: { getStroke?: (points: number[][], options: Record<string, number | boolean>) => number[][] }): PaintingAdapter;
export function comparisonScore(): PaintingDocument;
