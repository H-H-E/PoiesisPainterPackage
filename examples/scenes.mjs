/** Original compositions. All materials and generated commands are serialized. */
export const sceneNames = ['landscape', 'ink', 'watercolor', 'oil', 'studies'];
export const sceneInfo = {
  landscape: { title: 'A small warmth, far away', medium: 'Shared landscape', description: 'Pale overcast sky, three receding ridges, dark water, reeds and a single ochre interruption.' },
  ink: { title: 'The wind keeps its distance', medium: 'Restrained ink', description: 'A bending river holds a wide silence between the tree and the far bank.' },
  watercolor: { title: 'Rain beyond the estuary', medium: 'Transparent watercolor', description: 'Low weather dissolves the headland; one warm roof gives the distance a scale.' },
  oil: { title: 'The last stone holds the light', medium: 'Oil & palette knife', description: 'Heavy directional marks build a cold inlet around a rust-colored headland.' },
  studies: { title: 'Six ways a mark can change', medium: 'Material studies', description: 'Pressure, depletion, crossing wet strokes, oil overlap, watery edges and dry graphite.' },
};

const material = (medium, color, size, options = {}) => ({ medium, color, size, ...options });
const stroke = (id, material, path, extra = {}) => ({ id, op: 'stroke', material, path, ...extra });
const fill = (id, material, polygon) => ({ id, op: 'fill', material, polygon });
const family = (id, material, path, count, spread, jitter = 0.008, extra = {}) => ({ id, op: 'family', material, path, count, spread, jitter, ...extra });
const wait = (id, steps) => ({ id, op: 'wait', steps });
const layer = (id, commands, extra = {}) => ({ id, commands, ...extra });
const base = (materials, layers, background = '#e5e7e0', seed = 97) => ({ version: '1.0', width: 1152, height: 768, seed, background, paper: { texture: 0.36, absorbency: 0.6 }, materials, layers });

function landscape() {
  return base({
    sky: material('watercolor', '#b8c5c7', 0.12, { opacity: 0.25, wetness: 0.7, granulation: 0.25 }),
    far: material('watercolor', '#8e9fa6', 0.05, { opacity: 0.6, wetness: 0.5 }),
    middle: material('watercolor', '#546c7a', 0.04, { opacity: 0.72, wetness: 0.36 }),
    near: material('ink', '#283e4e', 0.025, { opacity: 0.85, load: 0.85, roughness: 0.4 }),
    lake: material('watercolor', '#233c50', 0.1, { opacity: 0.9, wetness: 0.4, granulation: 0.5 }),
    reflection: material('ink', '#adc0c6', 0.003, { opacity: 0.35, load: 0.65, roughness: 0.45 }),
    current: material('ink', '#0e2435', 0.004, { opacity: 0.52, load: 0.65 }),
    bank: material('ink', '#0b1a26', 0.06, { load: 0.9, roughness: 0.45 }),
    reed: material('ink', '#102332', 0.0038, { load: 0.75, roughness: 0.25 }),
    gold: material('oil', '#b58b54', 0.008, { load: 0.85, roughness: 0.2, bristles: 12 }),
  }, [
    layer('weather', [fill('sky-wash', 'sky', [[0, 0], [1, 0], [1, 0.52], [0, 0.48]]), fill('distant-ridge', 'far', [[0, 0.42], [0.13, 0.39], [0.22, 0.3], [0.39, 0.43], [0.57, 0.33], [0.73, 0.39], [0.88, 0.34], [1, 0.4], [1, 0.62], [0, 0.62]]), wait('weather-settle', 12)]),
    layer('ridges', [fill('middle-ridge', 'middle', [[0, 0.49], [0.12, 0.47], [0.26, 0.4], [0.39, 0.49], [0.51, 0.47], [0.66, 0.42], [0.81, 0.48], [1, 0.44], [1, 0.63], [0, 0.63]]), fill('near-ridge', 'near', [[0, 0.56], [0.12, 0.51], [0.25, 0.54], [0.34, 0.49], [0.46, 0.56], [0.56, 0.55], [0.7, 0.52], [0.83, 0.54], [1, 0.49], [1, 0.66], [0, 0.66]])]),
    layer('water', [fill('lake-body', 'lake', [[0, 0.57], [0.4, 0.585], [0.72, 0.56], [1, 0.57], [1, 1], [0, 1]]), wait('lake-settle', 8), family('light-ripples', 'reflection', [[0.1, 0.62, 0.2], [0.25, 0.619, 0.8], [0.48, 0.624, 0.1]], 36, [0.29, 0.29], 0.06), family('dark-ripples', 'current', [[0.01, 0.69, 0.2], [0.21, 0.688, 0.9], [0.4, 0.694, 0.15]], 28, [0.4, 0.24], 0.07)]),
    layer('foreground', [stroke('left-bank', 'bank', [[-0.03, 0.95, 0.7], [0.12, 0.91, 1], [0.29, 0.96, 0.65], [0.48, 1.02, 0.2]]), stroke('right-bank', 'bank', [[0.73, 1.02, 0.3], [0.89, 0.96, 0.7], [1.04, 0.91, 1]]), family('reeds-left', 'reed', [[0.04, 0.97, 1], [0.058, 0.85, 0.58], [0.092, 0.74, 0.08]], 35, [0.24, 0.025], 0.08, { intent: { hesitation: 0.12 } }), family('reeds-right', 'reed', [[0.82, 1.02, 1], [0.84, 0.9, 0.5], [0.855, 0.79, 0.05]], 17, [0.16, -0.01], 0.055), stroke('warm-far-window', 'gold', [[0.741, 0.558, 0.3], [0.753, 0.556, 0.8], [0.766, 0.56, 0.3]]), stroke('warm-reflection', 'gold', [[0.742, 0.611, 0.07], [0.764, 0.611, 0.1]])]),
  ]);
}

function ink() {
  return base({
    haze: material('ink', '#87928f', 0.015, { opacity: 0.16, load: 0.5, roughness: 0.5 }),
    distant: material('ink', '#485c60', 0.015, { opacity: 0.3, load: 0.5, roughness: 0.55 }),
    black: material('ink', '#14252b', 0.016, { load: 0.86, roughness: 0.52, bristles: 36 }),
    branch: material('ink', '#15262c', 0.008, { load: 0.7, roughness: 0.6, bristles: 24 }),
    fine: material('ink', '#1b3035', 0.0022, { load: 0.56, roughness: 0.62 }),
    reed: material('ink', '#1a2d31', 0.003, { load: 0.62, roughness: 0.48 }),
  }, [
    layer('distance', [fill('far-bank-shape', 'haze', [[0.04, 0.54], [0.22, 0.47], [0.36, 0.51], [0.49, 0.45], [0.64, 0.5], [0.81, 0.45], [0.97, 0.53], [0.97, 0.55], [0.04, 0.57]]), stroke('far-bank-line', 'distant', [[0.46, 0.57, 0.1], [0.68, 0.55, 0.6], [0.94, 0.57, 0.2]]), stroke('near-bank-curve', 'black', [[-0.03, 0.88, 0.8], [0.21, 0.82, 0.55], [0.37, 0.74, 0.3], [0.61, 0.68, 0.02]])]),
    layer('river', [family('quiet-water', 'fine', [[0.43, 0.62, 0.01], [0.57, 0.62, 0.4], [0.74, 0.623, 0.02]], 15, [-0.05, 0.23], 0.045), stroke('current-bend', 'distant', [[0.93, 0.64, 0.03], [0.7, 0.69, 0.2], [0.59, 0.83, 0.04]])]),
    layer('tree-and-reeds', [stroke('trunk', 'black', [[0.13, 0.86, 1], [0.17, 0.68, 0.8], [0.15, 0.49, 0.6], [0.21, 0.29, 0.26], [0.19, 0.18, 0.03]]), stroke('branch-east', 'branch', [[0.16, 0.53, 0.9], [0.25, 0.45, 0.6], [0.35, 0.42, 0.3], [0.41, 0.34, 0.03]]), stroke('branch-west', 'branch', [[0.17, 0.61, 0.6], [0.1, 0.47, 0.4], [0.07, 0.3, 0.03]]), stroke('branch-top', 'fine', [[0.2, 0.35, 1], [0.29, 0.28, 0.7], [0.32, 0.2, 0.01]]), family('west-twigs', 'fine', [[0.086, 0.42, 0.7], [0.04, 0.37, 0.02]], 6, [0.09, -0.16], 0.02), family('east-twigs', 'fine', [[0.27, 0.44, 0.7], [0.32, 0.36, 0.02]], 7, [0.085, -0.06], 0.02), family('bank-reeds', 'reed', [[0.01, 0.88, 0.7], [0.025, 0.75, 0.4], [0.04, 0.7, 0.01]], 19, [0.3, -0.03], 0.06), stroke('bird-left', 'fine', [[0.71, 0.29, 0.1], [0.721, 0.298, 0.7], [0.735, 0.29, 0.1]]), stroke('bird-right', 'fine', [[0.753, 0.32, 0.1], [0.763, 0.327, 0.7], [0.777, 0.316, 0.1]])]),
  ], '#edece3', 314);
}

function watercolor() {
  return base({
    sky: material('watercolor', '#aebfc7', 0.2, { opacity: 0.24, load: 0.7, wetness: 0.9, granulation: 0.35 }),
    cloud: material('watercolor', '#788c9b', 0.07, { opacity: 0.17, wetness: 0.83, granulation: 0.4 }),
    far: material('watercolor', '#748b9a', 0.04, { opacity: 0.44, wetness: 0.8, granulation: 0.5 }),
    headland: material('watercolor', '#3a6975', 0.05, { opacity: 0.63, wetness: 0.64, granulation: 0.72 }),
    lake: material('watercolor', '#80a6b0', 0.1, { opacity: 0.43, wetness: 0.84, granulation: 0.45 }),
    reflection: material('watercolor', '#466f82', 0.008, { opacity: 0.22, load: 0.45, wetness: 0.6, granulation: 0.6 }),
    grass: material('watercolor', '#536b62', 0.006, { opacity: 0.7, load: 0.6, wetness: 0.3, roughness: 0.65 }),
    roof: material('watercolor', '#ba7450', 0.007, { opacity: 0.88, wetness: 0.25, granulation: 0.3 }),
  }, [
    layer('wet-atmosphere', [fill('sky-water', 'sky', [[0, 0], [1, 0], [1, 0.64], [0, 0.64]]), stroke('cloud-west', 'cloud', [[-0.1, 0.18, 0.5], [0.2, 0.2, 1], [0.53, 0.16, 0.08]]), stroke('cloud-east', 'cloud', [[0.55, 0.26, 0.03], [0.78, 0.22, 0.7], [1.06, 0.24, 0.8]]), fill('soft-far-land', 'far', [[0, 0.53], [0.18, 0.44], [0.31, 0.49], [0.51, 0.4], [0.68, 0.5], [0.85, 0.43], [1, 0.46], [1, 0.63], [0, 0.63]]), wait('atmosphere-diffusion', 18)]),
    layer('estuary', [fill('water-wash', 'lake', [[0, 0.59], [0.42, 0.58], [0.73, 0.59], [1, 0.57], [1, 1], [0, 1]]), fill('left-headland', 'headland', [[-0.02, 0.5], [0.14, 0.48], [0.29, 0.55], [0.44, 0.58], [0.37, 0.62], [0.13, 0.64], [0, 0.72]]), fill('right-headland', 'far', [[0.6, 0.58], [0.76, 0.54], [0.86, 0.56], [1, 0.51], [1, 0.63], [0.74, 0.6]]), wait('estuary-diffusion', 12), family('water-colour-ripples', 'reflection', [[0.36, 0.65, 0.07], [0.52, 0.65, 0.6], [0.73, 0.65, 0.06]], 26, [-0.08, 0.26], 0.065)]),
    layer('close-notes', [family('wet-grasses', 'grass', [[0.02, 1.01, 0.8], [0.07, 0.89, 0.45], [0.08, 0.79, 0.01]], 21, [0.2, 0.01], 0.075), family('grass-lean', 'grass', [[0.91, 1.04, 0.8], [0.89, 0.91, 0.45], [0.87, 0.85, 0.01]], 10, [0.1, 0], 0.04), fill('warm-roof', 'roof', [[0.743, 0.544], [0.756, 0.531], [0.771, 0.546]]), stroke('roof-reflection', 'roof', [[0.745, 0.639, 0.08], [0.768, 0.64, 0.12]])]),
  ], '#ece9dc', 802);
}

function oil() {
  return base({
    sky: material('oil', '#a7b8b9', 0.16, { load: 0.95, roughness: 0.4, bristles: 48, viscosity: 0.7 }),
    pale: material('knife', '#d6d4bc', 0.032, { load: 0.85, roughness: 0.28, bristles: 18, viscosity: 0.86 }),
    cloud: material('oil', '#788e98', 0.06, { load: 0.7, roughness: 0.5, bristles: 36, viscosity: 0.8 }),
    ridge: material('knife', '#314e5e', 0.085, { load: 0.9, roughness: 0.4, viscosity: 0.8 }),
    sea: material('oil', '#163a48', 0.1, { load: 0.95, roughness: 0.4, bristles: 48, viscosity: 0.7 }),
    surf: material('knife', '#77989c', 0.012, { load: 0.65, roughness: 0.35, viscosity: 0.9 }),
    deep: material('oil', '#112a35', 0.02, { load: 0.8, roughness: 0.6, bristles: 24 }),
    rust: material('knife', '#9d5b3c', 0.05, { load: 0.9, roughness: 0.45, viscosity: 0.9 }),
    light: material('knife', '#c19b6a', 0.018, { load: 0.9, roughness: 0.34, viscosity: 0.9 }),
    rock: material('oil', '#182c30', 0.075, { load: 0.8, roughness: 0.55, bristles: 42 }),
  }, [
    layer('painted-sky', [fill('sky-ground', 'sky', [[0, 0], [1, 0], [1, 0.6], [0, 0.6]]), family('sky-scrapes', 'pale', [[-0.05, 0.07, 0.6], [0.35, 0.075, 0.9], [0.78, 0.05, 0.2]], 12, [0.2, 0.32], 0.06), stroke('cloud-weight', 'cloud', [[-0.05, 0.34, 0.6], [0.3, 0.32, 1], [0.6, 0.36, 0.1]]), fill('ridge-ground', 'ridge', [[0, 0.51], [0.11, 0.44], [0.22, 0.49], [0.34, 0.39], [0.52, 0.51], [0.66, 0.46], [0.82, 0.49], [1, 0.43], [1, 0.64], [0, 0.64]])]),
    layer('worked-water', [fill('sea-ground', 'sea', [[0, 0.57], [1, 0.57], [1, 1], [0, 1]]), family('sea-knife-marks', 'surf', [[0.03, 0.62, 0.1], [0.24, 0.62, 0.8], [0.5, 0.61, 0.06]], 36, [0.26, 0.3], 0.08), family('deep-water-marks', 'deep', [[0.12, 0.68, 0.1], [0.36, 0.675, 0.8], [0.61, 0.68, 0.1]], 19, [0.2, 0.26], 0.06), stroke('single-bright-current', 'pale', [[0.12, 0.82, 0.03], [0.29, 0.81, 0.22], [0.49, 0.82, 0.03]])]),
    layer('stone-headland', [fill('right-rock-ground', 'rock', [[0.72, 0.73], [0.79, 0.62], [0.9, 0.61], [1, 0.55], [1, 1], [0.61, 1]]), stroke('rust-face', 'rust', [[0.82, 0.68, 0.6], [0.9, 0.67, 1], [1.02, 0.61, 0.8]]), family('rock-facets', 'rust', [[0.76, 0.77, 0.2], [0.82, 0.71, 0.9], [0.87, 0.73, 0.2]], 9, [0.2, 0.17], 0.035), stroke('lit-rock-edge', 'light', [[0.77, 0.735, 0.2], [0.83, 0.674, 0.9], [0.92, 0.67, 0.3], [1.03, 0.606, 0.05]]), stroke('rock-shadow', 'rock', [[0.73, 0.87, 0.5], [0.85, 0.86, 0.9], [1.02, 0.78, 0.8]]), stroke('front-stone', 'rock', [[-0.03, 0.97, 0.6], [0.09, 0.94, 1], [0.25, 1.01, 0.3]])]),
  ], '#bac0b4', 2701);
}

function studies() {
  return base({
    ink: material('ink', '#203548', 0.027, { load: 0.86, roughness: 0.3, bristles: 36 }),
    dry: material('ink', '#203548', 0.031, { load: 0.4, roughness: 0.8, bristles: 48 }),
    waterBlue: material('watercolor', '#315c93', 0.045, { opacity: 0.72, wetness: 0.9, granulation: 0.7 }),
    waterOchre: material('watercolor', '#b98e43', 0.045, { opacity: 0.75, wetness: 0.9, granulation: 0.6 }),
    oilBlue: material('oil', '#315683', 0.045, { load: 0.94, bristles: 32, viscosity: 0.7 }),
    oilOchre: material('oil', '#c69951', 0.045, { load: 0.94, bristles: 32, viscosity: 0.7 }),
    wash: material('watercolor', '#607f96', 0.06, { opacity: 0.7, wetness: 0.92, granulation: 0.9 }),
    graphite: material('graphite', '#2d3338', 0.012, { load: 0.65, roughness: 0.9, bristles: 16 }),
  }, [
    layer('pressure-direction', [stroke('pressure-ribbon', 'ink', [[0.06, 0.19, 0.05], [0.12, 0.11, 0.4], [0.2, 0.21, 1], [0.28, 0.14, 0.05]]), stroke('pressure-return', 'ink', [[0.06, 0.29, 0.1], [0.18, 0.26, 0.9], [0.27, 0.32, 0.05]])]),
    layer('loaded-to-dry', [stroke('loaded-drying', 'dry', [[0.38, 0.13, 1], [0.62, 0.15, 1], [0.4, 0.24, 0.8], [0.61, 0.31, 0.45]], { intent: { hesitation: 0.1 } })]),
    layer('crossing-wet', [stroke('cross-blue', 'waterBlue', [[0.72, 0.12, 0.8], [0.93, 0.31, 0.8]]), stroke('cross-ochre', 'waterOchre', [[0.73, 0.31, 0.8], [0.92, 0.13, 0.8]]), wait('cross-mix', 24)]),
    layer('oil-overlap', [stroke('oil-blue', 'oilBlue', [[0.07, 0.58, 0.8], [0.28, 0.73, 0.8]]), stroke('oil-ochre', 'oilOchre', [[0.08, 0.76, 0.8], [0.26, 0.58, 0.8]])]),
    layer('watery-edge', [fill('edge-pool', 'wash', [[0.39, 0.59], [0.48, 0.54], [0.59, 0.59], [0.61, 0.74], [0.51, 0.8], [0.4, 0.74]]), wait('edge-dry', 36)]),
    layer('dry-surface', [stroke('graphite-ribbon', 'graphite', [[0.71, 0.56, 0.2], [0.8, 0.59, 0.6], [0.93, 0.55, 0.9]]), { id: 'graphite-hatching', op: 'hatch', material: 'graphite', polygon: [[0.72, 0.64], [0.93, 0.64], [0.9, 0.8], [0.75, 0.78]], spacing: 0.012, angle: 28 }]),
  ], '#e9e6dc', 981);
}

export const scenes = { landscape, ink, watercolor, oil, studies };
export function createScene(name = 'landscape', width = 1152, height = 768) {
  if (!Object.hasOwn(scenes, name)) throw new Error(`Unknown scene ${name}; choose ${sceneNames.join(', ')}`);
  return { ...scenes[name](), width, height };
}
