// A fake host for the extension: a React stand-in whose hooks keep their state
// across renders, the stores and the official canvas-tool seams it uses.
import { activate } from "../../dist/index.js";

let current = null;

function hookSlot(init) {
  const inst = current;
  const k = inst.i++;
  if (!(k in inst.hooks)) inst.hooks[k] = init();
  return { inst, k };
}

export const React = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() }),
  useState(init) {
    const { inst, k } = hookSlot(() => (typeof init === "function" ? init() : init));
    return [inst.hooks[k], (v) => { inst.hooks[k] = typeof v === "function" ? v(inst.hooks[k]) : v; }];
  },
  useReducer(reduce, init) {
    const { inst, k } = hookSlot(() => init);
    return [inst.hooks[k], (a) => { inst.hooks[k] = reduce(inst.hooks[k], a); }];
  },
  useRef(init) {
    const { inst, k } = hookSlot(() => ({ current: init }));
    return inst.hooks[k];
  },
  useEffect(fn, deps) {
    const inst = current;
    const k = inst.i++;
    const prev = inst.hooks[k];
    if (prev && deps && deps.every((d, j) => d === prev.deps[j])) return;
    inst.effects.push(() => {
      prev?.cleanup?.();
      inst.hooks[k] = { deps, cleanup: fn() };
    });
  },
};

/** Renders `Component` as often as asked, keeping its hook state. */
export function mount(Component, props = {}) {
  const inst = { hooks: [], i: 0, effects: [] };
  return () => {
    inst.i = 0;
    current = inst;
    let out;
    try {
      out = Component(props);
    } finally {
      current = null;
    }
    for (const fx of inst.effects.splice(0)) fx();
    return out;
  };
}

/** Every element node under `tree` that `match` accepts. */
export function findAll(tree, match) {
  const out = [];
  const walk = (n) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== "object") return;
    if (match(n)) out.push(n);
    walk(n.children);
  };
  walk(tree);
  return out;
}

const textOf = (n) => (n.children ?? []).filter((c) => typeof c === "string").join("");

export const byText = (tree, type, text) => findAll(tree, (n) => n.type === type && textOf(n) === text)[0];

function store(initial) {
  let state = initial;
  const listeners = new Set();
  const hook = (select = (s) => s) => select(state);
  hook.getState = () => state;
  hook.setState = (patch) => {
    state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
    for (const l of listeners) l(state);
  };
  hook.subscribe = (l) => {
    hook.subscribed++;
    listeners.add(l);
    return () => listeners.delete(l);
  };
  hook.subscribed = 0;
  return hook;
}

// A stand-in for core's brush step table, with its ranges.
const STEPS = {
  "brush.smaller": { key: "size", by: -0.01, min: 0.01, max: 0.5 },
  "brush.larger": { key: "size", by: 0.01, min: 0.01, max: 0.5 },
  "brush.featherDown": { key: "feather", by: -0.05, min: 0, max: 1 },
  "brush.featherUp": { key: "feather", by: 0.05, min: 0, max: 1 },
  "brush.opacityDown": { key: "opacity", by: -0.1, min: 0.01, max: 1 },
  "brush.opacityUp": { key: "opacity", by: 0.1, min: 0.01, max: 1 },
  "brush.flowDown": { key: "flow", by: -0.1, min: 0.01, max: 1 },
  "brush.flowUp": { key: "flow", by: 0.1, min: 0.01, max: 1 },
};

function stepBrush(action, brush, range) {
  const s = STEPS[action];
  const now = s ? brush[s.key] : undefined;
  if (!s || now === undefined) return null;
  const min = range?.[s.key]?.min ?? s.min;
  const max = range?.[s.key]?.max ?? s.max;
  const stepped = Math.max(min, Math.min(max, Math.round((now + s.by) * 1000) / 1000));
  return { key: s.key, value: s.by < 0 ? Math.min(now, stepped) : Math.max(now, stepped) };
}

/** Interface scale the fake framePoint undoes, so a test can tell it was used. */
export const UI_SCALE = 1.25;

export const tokens = { white: "var(--color-white)", labelRed: "var(--color-label-red)" };

export function BrushCursor() {
  return null;
}

/** An overlay element whose box starts at (100, 50) on the page. */
export const element = () => ({
  getBoundingClientRect: () => ({ left: 100, top: 50, width: 1000, height: 750 }),
  setPointerCapture() {},
});

/** A pointer event at the page point (clientX, clientY) on `el`. */
export const pointer = (el, clientX, clientY) => ({
  button: 0,
  pointerId: 1,
  clientX,
  clientY,
  currentTarget: el,
  preventDefault() {},
  stopPropagation() {},
});

export function rig({ settings = {}, paramBag = {} } = {}) {
  const windowListeners = [];
  globalThis.window = { addEventListener: (type) => windowListeners.push(type), removeEventListener() {} };
  globalThis.requestAnimationFrame = (fn) => (fn(), 1);
  globalThis.cancelAnimationFrame = () => {};

  const values = { ...settings };
  const settingsListeners = new Set();
  const setSettings = [];
  const commits = [];
  const develop = store({
    paramBag: { ...paramBag },
    photoId: "p",
    setDynParams: (patch) => develop.setState((s) => ({ paramBag: { ...s.paramBag, ...patch } })),
    commitEdit: (label) => commits.push(label),
  });
  const canvas = { held: null };
  const slots = [];
  const panels = [];

  const Button = () => null;
  const api = {
    react: React,
    stores: {
      useDevelopStore: develop,
      useCatalogStore: store({ photos: [] }),
      create: (init) => {
        const hook = store(undefined);
        const set = (patch) => hook.setState(patch);
        hook.setState(init(set, () => hook.getState()));
        return hook;
      },
    },
    components: { Panel: () => null, Slider: () => null },
    settings: {
      get: (k, d) => (k in values ? values[k] : d),
      set: (k, v) => {
        values[k] = v;
        setSettings.push([k, v]);
        for (const l of settingsListeners) l(k, v);
      },
      onChange: (l) => (settingsListeners.add(l), () => settingsListeners.delete(l)),
    },
    registerSettings() {},
    registerProcessingStage() {},
    registerPanel: (c) => panels.push(c),
    registerSlot: (c) => slots.push(c),
    cursors: { resolve: (token) => `cursor:${token}` },
    ui: { Button, Row: () => null, tokens },
    develop: {
      useDevelopOverlay: () => ({
        rect: { x: 0, y: 0, w: 1000, h: 1000 },
        imageRect: { x: 0, y: 0, w: 1000, h: 1000 },
        toScreen: (u, v) => ({ x: u * 1000, y: v * 1000 }),
        toImage: (x, y) => ({ x: x / 1000, y: y / 1000 }),
        radiusToScreen: (r) => r * 1000,
        radiusToImage: (r) => r / 1000,
      }),
      setCanvasTool: (tool) => { canvas.held = tool; },
      useCanvasToolHeld: () => canvas.held !== null,
      brush: { defaults: { size: 0.08, feather: 0.5, opacity: 1, flow: 1 }, actions: Object.keys(STEPS), step: stepBrush },
      BrushCursor,
      framePoint: (el, clientX, clientY) => {
        const r = el.getBoundingClientRect();
        return { x: (clientX - r.left) / UI_SCALE, y: (clientY - r.top) / UI_SCALE };
      },
    },
  };
  activate(api);
  return {
    api,
    Button,
    slots,
    canvas,
    develop,
    commits,
    setSettings,
    windowListeners,
    panel: () => mount(panels[0].component),
  };
}
