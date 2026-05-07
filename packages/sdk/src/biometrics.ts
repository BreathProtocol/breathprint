/**
 * BreathPrint — Browser-side biometric extraction
 *
 * All biometric processing happens client-side. Raw face data NEVER leaves
 * the device — only the Poseidon hash of a quantized 256-bit template
 * goes on-chain via the ZK proof.
 *
 * Pipeline:
 *   ImageData[] → MediaPipe Face Mesh / Pose → ArcFace / FFT
 *                → 512-dim face + 64-dim breath vectors
 *                → LSH random hyperplane projection (fixed seed)
 *                → 256-bit template (8 × uint32 chunks)
 */

import {
  FaceLandmarker,
  PoseLandmarker,
  FilesetResolver,
} from "@mediapipe/tasks-vision";
import * as ort from "onnxruntime-web";

// ── Constants ─────────────────────────────────────────────────────

const FACE_EMBED_DIM = 512;     // ArcFace output
const BREATH_DIM = 64;          // FFT(16) + windows(16) + autocorr(36) - actually = 68; trim/pad to 64
const FACE_BITS = 192;
const BREATH_BITS = 64;
const TOTAL_BITS = FACE_BITS + BREATH_BITS; // 256
const CHUNK_COUNT = 8;
const LSH_SEED = 424242;        // fixed seed → deterministic projection across captures
const LIVENESS_THRESHOLD = 0.85;

// Path defaults — override via init() options.
const DEFAULTS = {
  arcfaceModelUrl: "/models/arcface.onnx",
  faceLandmarkerUrl:
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
  poseLandmarkerUrl:
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
  visionWasmUrl:
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm",
};

// ── Types ─────────────────────────────────────────────────────────

export interface BiometricInitOptions {
  arcfaceModelUrl?: string;
  faceLandmarkerUrl?: string;
  poseLandmarkerUrl?: string;
  visionWasmUrl?: string;
}

export interface QuantizedTemplate {
  /** 8 × 32-bit chunks, ready to feed into the circom circuit. */
  chunks: bigint[];
  /** Same data as a 32-byte Uint8Array (big-endian per chunk). */
  bytes: Uint8Array;
}

// ── Module state ──────────────────────────────────────────────────

let arcfaceSession: ort.InferenceSession | null = null;
let faceLandmarker: FaceLandmarker | null = null;
let poseLandmarker: PoseLandmarker | null = null;

let projectionFace: Float32Array[] | null = null;   // FACE_BITS × FACE_EMBED_DIM
let projectionBreath: Float32Array[] | null = null; // BREATH_BITS × BREATH_DIM

// ── Public API ────────────────────────────────────────────────────

export async function init(options: BiometricInitOptions = {}): Promise<void> {
  const opts = { ...DEFAULTS, ...options };

  // ArcFace ONNX model
  arcfaceSession = await ort.InferenceSession.create(opts.arcfaceModelUrl, {
    executionProviders: ["wasm"],
  });

  // MediaPipe Vision (Face + Pose)
  const fileset = await FilesetResolver.forVisionTasks(opts.visionWasmUrl);
  faceLandmarker = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: opts.faceLandmarkerUrl },
    runningMode: "IMAGE",
    numFaces: 1,
  });
  poseLandmarker = await PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: opts.poseLandmarkerUrl },
    runningMode: "IMAGE",
    numPoses: 1,
  });

  // Build deterministic LSH projections
  projectionFace = buildProjection(FACE_BITS, FACE_EMBED_DIM, LSH_SEED);
  projectionBreath = buildProjection(BREATH_BITS, BREATH_DIM, LSH_SEED + 1);
}

/**
 * Run ArcFace on each frame, take the median embedding for stability,
 * then L2-normalize.
 *
 * @returns 512-dim Float32Array
 */
export async function extractFaceEmbedding(
  frames: ImageData[]
): Promise<Float32Array> {
  ensureInit();
  if (frames.length === 0) throw new Error("extractFaceEmbedding: no frames");

  const embeddings: Float32Array[] = [];
  for (const frame of frames) {
    const detection = faceLandmarker!.detect(imageDataToImageBitmap(frame));
    if (!detection.faceLandmarks?.length) continue;

    const crop = cropFaceFromLandmarks(frame, detection.faceLandmarks[0]);
    const tensor = imageDataToTensor(crop, 112, 112); // ArcFace input 112×112
    const result = await arcfaceSession!.run({ [arcfaceSession!.inputNames[0]]: tensor });
    const out = result[arcfaceSession!.outputNames[0]].data as Float32Array;
    embeddings.push(new Float32Array(out));
  }

  if (embeddings.length === 0) throw new Error("extractFaceEmbedding: no faces detected");

  // Median across frames per dim
  const median = new Float32Array(FACE_EMBED_DIM);
  for (let d = 0; d < FACE_EMBED_DIM; d++) {
    const col = embeddings.map((e) => e[d]).sort((a, b) => a - b);
    median[d] = col[Math.floor(col.length / 2)];
  }

  return l2Normalize(median);
}

/**
 * Extract breathing signature from chest/shoulder oscillation.
 *   - 16 FFT magnitudes (top frequency bins)
 *   - 4 windows × 4 stats each = 16 features (mean, std, amplitude, peak-rate)
 *   - 36-lag autocorrelation
 * Total = 68, trimmed to 64 → L2 normalized.
 */
export async function extractBreathSignature(
  frames: ImageData[]
): Promise<Float32Array> {
  ensureInit();
  if (frames.length < 30) {
    throw new Error("extractBreathSignature: need ≥30 frames (~1s @ 30fps)");
  }

  // Track shoulder Y-coordinate per frame (left+right average)
  const yTrack: number[] = [];
  for (const frame of frames) {
    const detection = poseLandmarker!.detect(imageDataToImageBitmap(frame));
    const lm = detection.landmarks?.[0];
    if (!lm) {
      yTrack.push(yTrack.length ? yTrack[yTrack.length - 1] : 0);
      continue;
    }
    // MediaPipe Pose: index 11 = left shoulder, 12 = right shoulder
    const y = (lm[11].y + lm[12].y) / 2;
    yTrack.push(y);
  }

  const detrended = detrend(yTrack);

  const fftMag = fftMagnitudes(detrended, 16);
  const windowStats = windowFeatures(detrended, 4);
  const autocorr = autocorrelate(detrended, 36);

  const combined = new Float32Array(BREATH_DIM);
  let i = 0;
  for (const v of fftMag) combined[i++] = v;
  for (const v of windowStats) combined[i++] = v;
  for (const v of autocorr) {
    if (i >= BREATH_DIM) break;
    combined[i++] = v;
  }

  return l2Normalize(combined);
}

/**
 * Quantize face + breath vectors to a 256-bit template.
 * Uses fixed-seed random hyperplane LSH so the same biometric → same template.
 */
export function quantizeToBinary(
  face: Float32Array,
  breath: Float32Array
): QuantizedTemplate {
  ensureInit();
  if (face.length !== FACE_EMBED_DIM)
    throw new Error(`face must be ${FACE_EMBED_DIM}-dim`);
  if (breath.length !== BREATH_DIM)
    throw new Error(`breath must be ${BREATH_DIM}-dim`);

  const bits = new Uint8Array(TOTAL_BITS);
  for (let i = 0; i < FACE_BITS; i++) {
    bits[i] = dot(face, projectionFace![i]) >= 0 ? 1 : 0;
  }
  for (let i = 0; i < BREATH_BITS; i++) {
    bits[FACE_BITS + i] = dot(breath, projectionBreath![i]) >= 0 ? 1 : 0;
  }

  // Pack into 8 × uint32 chunks (big-endian within each chunk)
  const chunks: bigint[] = [];
  const bytes = new Uint8Array(32);
  for (let c = 0; c < CHUNK_COUNT; c++) {
    let chunk = 0n;
    for (let b = 0; b < 32; b++) {
      const bit = bits[c * 32 + b];
      chunk = (chunk << 1n) | BigInt(bit);
    }
    chunks.push(chunk);
    // bytes for sanity / external comparison
    bytes[c * 4 + 0] = Number((chunk >> 24n) & 0xffn);
    bytes[c * 4 + 1] = Number((chunk >> 16n) & 0xffn);
    bytes[c * 4 + 2] = Number((chunk >> 8n) & 0xffn);
    bytes[c * 4 + 3] = Number(chunk & 0xffn);
  }

  return { chunks, bytes };
}

/**
 * Heuristic liveness score 0–1.
 *   - Bbox micro-movement variance (rejects static photos)
 *   - Laplacian texture variance (rejects screen captures)
 *   - Score ≥ LIVENESS_THRESHOLD considered live.
 */
export async function computeLivenessScore(frames: ImageData[]): Promise<number> {
  ensureInit();
  if (frames.length < 5) return 0;

  // Bbox movement
  const centers: Array<[number, number]> = [];
  let totalLap = 0;
  for (const frame of frames) {
    const detection = faceLandmarker!.detect(imageDataToImageBitmap(frame));
    const lm = detection.faceLandmarks?.[0];
    if (!lm) continue;
    const cx = lm.reduce((s, p) => s + p.x, 0) / lm.length;
    const cy = lm.reduce((s, p) => s + p.y, 0) / lm.length;
    centers.push([cx, cy]);
    totalLap += laplacianVariance(frame);
  }
  if (centers.length < 3) return 0;

  const movement = stdDev(centers.map((c) => c[0])) + stdDev(centers.map((c) => c[1]));
  const movementScore = clamp01(movement * 200); // empirical
  const textureScore = clamp01(totalLap / centers.length / 500);

  return 0.6 * movementScore + 0.4 * textureScore;
}

export const constants = {
  FACE_EMBED_DIM,
  BREATH_DIM,
  FACE_BITS,
  BREATH_BITS,
  TOTAL_BITS,
  CHUNK_COUNT,
  LSH_SEED,
  LIVENESS_THRESHOLD,
};

// ── Internals ─────────────────────────────────────────────────────

function ensureInit() {
  if (!arcfaceSession || !faceLandmarker || !poseLandmarker || !projectionFace) {
    throw new Error("biometrics.init() must be called first");
  }
}

/** Mulberry32 — small deterministic PRNG. */
function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Build `rows` random unit-norm hyperplanes of length `cols`. */
function buildProjection(rows: number, cols: number, seed: number): Float32Array[] {
  const rand = mulberry32(seed);
  const out: Float32Array[] = [];
  for (let r = 0; r < rows; r++) {
    const row = new Float32Array(cols);
    // Box-Muller for Gaussian
    for (let c = 0; c < cols; c += 2) {
      const u1 = Math.max(rand(), 1e-9);
      const u2 = rand();
      const mag = Math.sqrt(-2 * Math.log(u1));
      row[c] = mag * Math.cos(2 * Math.PI * u2);
      if (c + 1 < cols) row[c + 1] = mag * Math.sin(2 * Math.PI * u2);
    }
    out.push(l2Normalize(row));
  }
  return out;
}

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function l2Normalize(v: Float32Array): Float32Array {
  let s = 0;
  for (const x of v) s += x * x;
  const n = Math.sqrt(s) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

function stdDev(arr: number[]): number {
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const v = arr.reduce((s, x) => s + (x - mean) ** 2, 0) / arr.length;
  return Math.sqrt(v);
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function detrend(v: number[]): Float32Array {
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  return new Float32Array(v.map((x) => x - mean));
}

/** Magnitudes of the first `count` non-DC FFT bins. */
function fftMagnitudes(v: Float32Array, count: number): number[] {
  // Naive DFT — fine for 60–300 sample windows.
  const n = v.length;
  const out: number[] = [];
  for (let k = 1; k <= count; k++) {
    let re = 0;
    let im = 0;
    for (let t = 0; t < n; t++) {
      const angle = (-2 * Math.PI * k * t) / n;
      re += v[t] * Math.cos(angle);
      im += v[t] * Math.sin(angle);
    }
    out.push(Math.sqrt(re * re + im * im) / n);
  }
  return out;
}

/** Mean / std / amplitude / peak-rate per window, total = 4 × 4 = 16. */
function windowFeatures(v: Float32Array, windows: number): number[] {
  const out: number[] = [];
  const winSize = Math.floor(v.length / windows);
  for (let w = 0; w < windows; w++) {
    const slice = v.subarray(w * winSize, (w + 1) * winSize);
    const arr = Array.from(slice);
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const std = stdDev(arr);
    const amp = Math.max(...arr) - Math.min(...arr);
    let peaks = 0;
    for (let i = 1; i < arr.length - 1; i++) {
      if (arr[i] > arr[i - 1] && arr[i] > arr[i + 1] && arr[i] - mean > std * 0.5) peaks++;
    }
    out.push(mean, std, amp, peaks / arr.length);
  }
  return out;
}

function autocorrelate(v: Float32Array, maxLag: number): number[] {
  const out: number[] = [];
  for (let lag = 1; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i < v.length - lag; i++) s += v[i] * v[i + lag];
    out.push(s / (v.length - lag));
  }
  return out;
}

/** Approximate Laplacian variance via 3×3 kernel on luma. */
function laplacianVariance(img: ImageData): number {
  const { data, width, height } = img;
  const luma = new Float32Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    luma[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const c = luma[y * width + x];
      const lap =
        -4 * c +
        luma[y * width + (x - 1)] +
        luma[y * width + (x + 1)] +
        luma[(y - 1) * width + x] +
        luma[(y + 1) * width + x];
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

function imageDataToImageBitmap(img: ImageData): ImageBitmap {
  // MediaPipe accepts ImageBitmap-like; for SSR safety, return as any cast.
  // In a browser context, callers typically pass the ImageData directly to
  // detect() via the canvas the frame came from. This wrapper exists to
  // keep the call sites uniform.
  return img as unknown as ImageBitmap;
}

/** Crop a tight bounding box around face landmarks, return new ImageData. */
function cropFaceFromLandmarks(
  img: ImageData,
  landmarks: { x: number; y: number }[]
): ImageData {
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  for (const p of landmarks) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const margin = 0.1;
  const x0 = Math.max(0, Math.floor((minX - margin) * img.width));
  const y0 = Math.max(0, Math.floor((minY - margin) * img.height));
  const x1 = Math.min(img.width, Math.ceil((maxX + margin) * img.width));
  const y1 = Math.min(img.height, Math.ceil((maxY + margin) * img.height));
  const w = x1 - x0;
  const h = y1 - y0;

  const canvas =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(w, h)
      : (() => {
          const c = document.createElement("canvas");
          c.width = w;
          c.height = h;
          return c;
        })();
  const ctx = canvas.getContext("2d") as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D;
  ctx.putImageData(img, -x0, -y0);
  return ctx.getImageData(0, 0, w, h);
}

/** Resize ImageData to size×size and convert to NCHW float32 tensor. */
function imageDataToTensor(img: ImageData, w: number, h: number): ort.Tensor {
  const canvas =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(w, h)
      : (() => {
          const c = document.createElement("canvas");
          c.width = w;
          c.height = h;
          return c;
        })();
  const ctx = canvas.getContext("2d") as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D;

  // Draw via temporary canvas to scale
  const src =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(img.width, img.height)
      : (() => {
          const c = document.createElement("canvas");
          c.width = img.width;
          c.height = img.height;
          return c;
        })();
  (src.getContext("2d") as CanvasRenderingContext2D).putImageData(img, 0, 0);
  ctx.drawImage(src as unknown as CanvasImageSource, 0, 0, w, h);

  const resized = ctx.getImageData(0, 0, w, h);
  const tensorData = new Float32Array(3 * w * h);
  for (let p = 0; p < w * h; p++) {
    tensorData[p] = (resized.data[p * 4] - 127.5) / 127.5;             // R
    tensorData[p + w * h] = (resized.data[p * 4 + 1] - 127.5) / 127.5; // G
    tensorData[p + 2 * w * h] = (resized.data[p * 4 + 2] - 127.5) / 127.5; // B
  }
  return new ort.Tensor("float32", tensorData, [1, 3, h, w]);
}
