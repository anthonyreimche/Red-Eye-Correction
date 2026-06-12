// SafeLight Red Eye Correction extension.
// Detects red-eye blobs in the active photo and corrects them with
// non-destructive radial masks (desaturate + darken), so every fix is
// editable, undoable, and survives in the normal edit history.
//
// No bundled dependencies: React, components, and stores come from the
// SafelightAPI. This file IS the prebuilt ESM bundle (manifest "main").

const EXT_ID = "redeye";
const NAME_PREFIX = "Red Eye";
const APP_MAX_MASKS = 8; // mirrors MAX_MASKS in src/catalog/types.ts

// ---------------------------------------------------------------------------
// Settings (edited via the ⚙ dialog in the Extensions panel)
// ---------------------------------------------------------------------------

const DEFAULTS = {
  sensitivity: 60, // 0..100, higher = more aggressive detection
  minPupil: 0.3, // min pupil radius, % of image height
  maxPupil: 4, // max pupil radius, % of image height
  maxDetections: 6, // cap per detection run (app caps total masks at 8)
  radiusScale: 135, // mask radius as % of detected blob radius
  feather: 40, // default mask edge feather, %
  strength: 85, // default desaturation, %
  darken: 55, // default darkening, 0..100 -> 0..-2.5 EV
  analyzeEdge: "1200", // analysis resolution (long edge, px)
  autoCommit: true, // write a history snapshot after detection
};

const SETTINGS_FIELDS = [
  { key: "sensitivity", label: "Detection sensitivity", type: "number", default: DEFAULTS.sensitivity, min: 0, max: 100, step: 1, hint: "Higher finds fainter red eyes but risks false positives" },
  { key: "minPupil", label: "Min pupil size (% of height)", type: "number", default: DEFAULTS.minPupil, min: 0.05, max: 10, step: 0.05 },
  { key: "maxPupil", label: "Max pupil size (% of height)", type: "number", default: DEFAULTS.maxPupil, min: 0.5, max: 20, step: 0.5 },
  { key: "maxDetections", label: "Max detections per run", type: "number", default: DEFAULTS.maxDetections, min: 1, max: APP_MAX_MASKS, step: 1 },
  { key: "radiusScale", label: "Mask size (% of pupil)", type: "number", default: DEFAULTS.radiusScale, min: 100, max: 250, step: 5, hint: "Padding around the detected pupil" },
  { key: "feather", label: "Default feather (%)", type: "number", default: DEFAULTS.feather, min: 0, max: 100, step: 5 },
  { key: "strength", label: "Default desaturation (%)", type: "number", default: DEFAULTS.strength, min: 0, max: 100, step: 5 },
  { key: "darken", label: "Default darken (0-100)", type: "number", default: DEFAULTS.darken, min: 0, max: 100, step: 5 },
  {
    key: "analyzeEdge", label: "Analysis resolution", type: "select", default: DEFAULTS.analyzeEdge,
    options: [
      { value: "800", label: "Fast (800 px)" },
      { value: "1200", label: "Balanced (1200 px)" },
      { value: "1600", label: "Accurate (1600 px)" },
    ],
    hint: "Long edge the photo is downscaled to before scanning",
  },
  { key: "autoCommit", label: "Add history step after detect", type: "boolean", default: DEFAULTS.autoCommit },
];

// ---------------------------------------------------------------------------
// Detection: redness score -> binary mask -> connected components -> filters
// ---------------------------------------------------------------------------

/**
 * Scan RGBA pixels for compact, strongly red blobs.
 * Returns up to maxCount blobs as { cx, cy, radius } in *pixels* of the
 * analyzed image, sorted by confidence, overlaps deduplicated.
 */
function detectRedEyes(data, w, h, opts) {
  const n = w * h;
  // Higher sensitivity lowers the redness threshold (range ~0.8 .. 2.2).
  const thr = 2.2 - (opts.sensitivity / 100) * 1.4;
  const mask = new Uint8Array(n); // 0 = no, 1 = red, 2 = visited
  const score = new Float32Array(n);

  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const r = data[p];
    if (r < 50) continue; // too dark to be a flash red eye
    const g = data[p + 1];
    const b = data[p + 2];
    // Red dominance: r^2 / (g^2 + b^2 + noise floor). Bright saturated reds
    // score >> 1; skin tones and neutrals stay below the threshold.
    const s = (r * r) / (g * g + b * b + 1400);
    if (s > thr) {
      mask[i] = 1;
      score[i] = s;
    }
  }

  const minR = (opts.minPupil / 100) * h;
  const maxR = (opts.maxPupil / 100) * h;
  const stack = new Int32Array(n);
  const blobs = [];

  for (let seed = 0; seed < n; seed++) {
    if (mask[seed] !== 1) continue;
    // Iterative 4-neighbour flood fill.
    let top = 0;
    stack[top++] = seed;
    mask[seed] = 2;
    let area = 0, sx = 0, sy = 0, weight = 0;
    let minX = w, maxX = 0, minY = h, maxY = 0;
    while (top > 0) {
      const q = stack[--top];
      const x = q % w;
      const y = (q / w) | 0;
      area++;
      sx += x;
      sy += y;
      weight += score[q];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x > 0 && mask[q - 1] === 1) { mask[q - 1] = 2; stack[top++] = q - 1; }
      if (x < w - 1 && mask[q + 1] === 1) { mask[q + 1] = 2; stack[top++] = q + 1; }
      if (y > 0 && mask[q - w] === 1) { mask[q - w] = 2; stack[top++] = q - w; }
      if (y < h - 1 && mask[q + w] === 1) { mask[q + w] = 2; stack[top++] = q + w; }
    }
    const radius = Math.sqrt(area / Math.PI);
    if (radius < minR || radius > maxR) continue;
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    const aspect = bw / bh;
    if (aspect < 0.4 || aspect > 2.5) continue; // pupils are roughly round
    if (area / (bw * bh) < 0.4) continue; // reject sparse / stringy blobs
    blobs.push({ cx: sx / area, cy: sy / area, radius, weight });
  }

  blobs.sort((a, b) => b.weight - a.weight);
  const out = [];
  for (const b of blobs) {
    if (out.length >= opts.maxCount) break;
    if (out.some((o) => Math.hypot(o.cx - b.cx, o.cy - b.cy) < o.radius + b.radius)) continue;
    out.push(b);
  }
  return out;
}

/** Decode the photo the same way the app does (no EXIF re-orientation, so
 *  coordinates line up with mask source-UV space). RAW falls back to the
 *  thumbnail — UV coordinates are scale-invariant, so that still works. */
async function loadBitmap(photo) {
  if (photo.fileHandle) {
    try {
      const file = await photo.fileHandle.getFile();
      return await createImageBitmap(file, { imageOrientation: "none" });
    } catch {
      /* RAW or unreadable -> thumbnail */
    }
  }
  if (photo.thumbnailBlob) {
    try {
      return await createImageBitmap(photo.thumbnailBlob, { imageOrientation: "none" });
    } catch {
      /* fall through */
    }
  }
  return null;
}

/** Downscale to the analysis resolution and return ImageData. */
function readPixels(bitmap, maxEdge) {
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = typeof OffscreenCanvas !== "undefined"
    ? new OffscreenCanvas(w, h)
    : Object.assign(document.createElement("canvas"), { width: w, height: h });
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

// ---------------------------------------------------------------------------
// Mask helpers
// ---------------------------------------------------------------------------

const isRedEyeMask = (m) => m.type === "radial" && m.name.startsWith(NAME_PREFIX);

function zeroAdj() {
  return {
    exposure: 0, contrast: 0, highlights: 0, shadows: 0,
    saturation: 0, temperature: 0, tint: 0, clarity: 0, sharpness: 0,
  };
}

/** darken 0..100 -> exposure 0..-2.5 EV */
const darkenToEV = (d) => -(d / 100) * 2.5;
const evToDarken = (ev) => Math.round((-ev / 2.5) * 100);

function buildMask(index, geo, settings) {
  return {
    id: `redeye-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    type: "radial",
    name: `${NAME_PREFIX} ${index}`,
    invert: false,
    opacity: 100,
    panels: ["basic"],
    adj: {
      ...zeroAdj(),
      exposure: darkenToEV(settings.darken),
      saturation: -settings.strength,
    },
    radial: { ...geo, feather: settings.feather / 100, angle: 0 },
  };
}

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

export function activate(api) {
  const { react: React, stores, components } = api;
  const { useDevelopStore, useCatalogStore } = stores;
  const { Panel, Slider } = components;
  const h = React.createElement;

  const S = (key) => api.settings.get(key, DEFAULTS[key]);

  api.registerSettings({ fields: SETTINGS_FIELDS });

  /** Next free "Red Eye N" suffix so names stay unique-ish. */
  function nextIndex(masks) {
    let max = 0;
    for (const m of masks) {
      if (!isRedEyeMask(m)) continue;
      const n = parseInt(m.name.slice(NAME_PREFIX.length), 10);
      if (n > max) max = n;
    }
    return max + 1;
  }

  /** Aspect (w/h) of the active photo, for keeping manual masks circular. */
  function photoAspect() {
    const dev = useDevelopStore.getState();
    const photo = useCatalogStore.getState().photos.find((p) => p.id === dev.photoId);
    return photo && photo.width > 0 && photo.height > 0 ? photo.width / photo.height : 1.5;
  }

  async function runDetection(setStatus) {
    const dev = useDevelopStore.getState();
    if (!dev.photoId) return setStatus("Open a photo in Develop first.");
    const photo = useCatalogStore.getState().photos.find((p) => p.id === dev.photoId);
    if (!photo) return setStatus("Active photo not found in catalog.");

    const slots = APP_MAX_MASKS - dev.params.masks.length;
    if (slots <= 0) return setStatus(`Mask limit reached (${APP_MAX_MASKS}). Remove a mask first.`);

    const bitmap = await loadBitmap(photo);
    if (!bitmap) return setStatus("Could not decode this photo.");

    let img;
    try {
      img = readPixels(bitmap, parseInt(S("analyzeEdge"), 10) || 1200);
    } finally {
      bitmap.close?.();
    }

    const blobs = detectRedEyes(img.data, img.width, img.height, {
      sensitivity: S("sensitivity"),
      minPupil: S("minPupil"),
      maxPupil: S("maxPupil"),
      maxCount: Math.min(S("maxDetections"), slots),
    });
    if (blobs.length === 0) {
      return setStatus("No red eyes found. Try raising sensitivity in ⚙ settings.");
    }

    const settings = { radiusScale: S("radiusScale"), feather: S("feather"), strength: S("strength"), darken: S("darken") };
    const store = useDevelopStore.getState();
    let index = nextIndex(store.params.masks);
    let lastId = null;
    for (const b of blobs) {
      const r = b.radius * (settings.radiusScale / 100);
      const mask = buildMask(index++, {
        cx: b.cx / img.width,
        cy: b.cy / img.height,
        rx: r / img.width, // rx/ry are per-axis UV radii -> circular on screen
        ry: r / img.height,
      }, settings);
      lastId = mask.id;
      store.addMask(mask);
    }
    if (lastId) useDevelopStore.getState().selectMask(lastId);
    if (S("autoCommit")) await useDevelopStore.getState().commitEdit("Red eye correction");
    setStatus(`Corrected ${blobs.length} red eye${blobs.length === 1 ? "" : "s"}.`);
  }

  // -------------------------------------------------------------------------
  // Panel component
  // -------------------------------------------------------------------------

  function RedEyePanel() {
    const masks = useDevelopStore((s) => s.params.masks);
    const photoId = useDevelopStore((s) => s.photoId);
    const selectedMaskId = useDevelopStore((s) => s.selectedMaskId);
    const [busy, setBusy] = React.useState(false);
    const [status, setStatus] = React.useState("");
    const [, bump] = React.useReducer((n) => n + 1, 0);
    React.useEffect(() => api.settings.onChange(bump), []); // live ⚙ edits

    const redEyes = masks.filter(isRedEyeMask);
    const selected = redEyes.find((m) => m.id === selectedMaskId) || null;
    const slotsLeft = APP_MAX_MASKS - masks.length;
    const st = () => useDevelopStore.getState();
    const commit = () => void st().commitEdit("Red eye correction");

    const detect = async () => {
      setBusy(true);
      setStatus("Scanning…");
      try {
        await runDetection(setStatus);
      } catch (err) {
        setStatus(`Detection failed: ${err?.message ?? err}`);
      } finally {
        setBusy(false);
      }
    };

    const addManual = () => {
      const ry = 0.02;
      const mask = buildMask(nextIndex(masks), {
        cx: 0.5, cy: 0.5, rx: ry / photoAspect(), ry,
      }, { feather: S("feather"), strength: S("strength"), darken: S("darken") });
      st().addMask(mask);
      st().selectMask(mask.id);
      st().setActiveTool("mask"); // hand off to the mask overlay for dragging
      setStatus("Drag the new mask over the eye.");
    };

    const clearAll = () => {
      for (const m of redEyes) st().removeMask(m.id);
      st().setActiveTool("none");
      commit();
      setStatus("");
    };

    const btn = "rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-text-secondary hover:text-text-primary";

    // Per-correction sliders, mirroring Lightroom's pupil size / darken.
    const editor = selected && h("div", { className: "space-y-0.5 rounded bg-surface-2/50 p-1.5", key: "editor" },
      h(Slider, {
        label: "Size", value: +(selected.radial.ry * 100).toFixed(2),
        min: 0.2, max: 10, step: 0.1, defaultValue: 2,
        onChange: (v) => {
          const ry = v / 100;
          const rx = selected.radial.ry > 0 ? selected.radial.rx * (ry / selected.radial.ry) : ry / photoAspect();
          st().updateMask(selected.id, { radial: { ...selected.radial, rx, ry } });
        },
        onCommit: commit,
      }),
      h(Slider, {
        label: "Darken", value: evToDarken(selected.adj.exposure),
        min: 0, max: 100, step: 1, defaultValue: DEFAULTS.darken,
        onChange: (v) => st().updateMaskAdj(selected.id, { exposure: darkenToEV(v) }),
        onCommit: commit,
      }),
      h(Slider, {
        label: "Desaturate", value: -selected.adj.saturation,
        min: 0, max: 100, step: 1, defaultValue: DEFAULTS.strength,
        onChange: (v) => st().updateMaskAdj(selected.id, { saturation: -v }),
        onCommit: commit,
      }),
      h(Slider, {
        label: "Feather", value: Math.round(selected.radial.feather * 100),
        min: 0, max: 100, step: 1, defaultValue: DEFAULTS.feather,
        onChange: (v) => st().updateMask(selected.id, { radial: { ...selected.radial, feather: v / 100 } }),
        onCommit: commit,
      }),
    );

    return h(Panel, { title: "Red Eye" },
      h("div", { className: "space-y-2" },
        h("div", { className: "flex gap-1" },
          h("button", { className: btn, disabled: busy || !photoId, onClick: detect },
            busy ? "Scanning…" : "Detect red eyes"),
          h("button", { className: btn, disabled: !photoId || slotsLeft <= 0, onClick: addManual }, "Add manually"),
          redEyes.length > 0 && h("button", { className: btn, onClick: clearAll }, "Clear"),
        ),
        status && h("div", { className: "text-[10px] text-text-muted" }, status),
        slotsLeft <= 0 && h("div", { className: "text-[10px] text-label-red" },
          `Mask limit (${APP_MAX_MASKS}) reached — new corrections can't be added.`),
        redEyes.length > 0 && h("div", { className: "space-y-0.5" },
          redEyes.map((m) =>
            h("div", {
              key: m.id,
              className: "flex items-center gap-1.5 px-0.5 text-[11px] " +
                (m.id === selectedMaskId ? "text-text-primary" : "text-text-secondary"),
            },
              h("button", {
                className: "flex-1 truncate text-left hover:text-text-primary",
                onClick: () => { st().selectMask(m.id); st().setActiveTool("mask"); },
              }, m.name),
              h("button", {
                className: "rounded px-1 text-text-muted hover:text-label-red",
                title: "Remove",
                onClick: () => { st().removeMask(m.id); commit(); },
              }, "✕"),
            ),
          ),
        ),
        editor,
        redEyes.length === 0 && !status &&
          h("div", { className: "text-[10px] text-text-muted" },
            "Detect scans the photo and corrects each red eye with an editable radial mask."),
      ),
    );
  }

  api.registerPanel({
    id: "redeye.panel",
    title: "Red Eye",
    component: RedEyePanel,
    defaultDock: { module: "develop", direction: "right", order: 6, width: 280, height: 220 },
  });
}

export function deactivate() {
  // Contributions are auto-swept by the host; nothing else to clean up.
}
