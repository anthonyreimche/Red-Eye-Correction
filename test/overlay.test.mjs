// The correction overlay: the pointer comes through the app's framePoint
// (Interface scale zooms the page), the cursor is the official brush ring over
// the crosshair, and Ctrl/Cmd/Space pass-through is the app's. Run: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { BrushCursor, UI_SCALE, byText, element, findAll, mount, pointer, rig, tokens } from "./support/rig.mjs";

function overlay(options) {
  const r = rig(options);
  byText(r.panel()(), r.Button, "Correct").props.onClick();
  const render = mount(r.canvas.held.overlay, { rect: { x: 0, y: 0, w: 1000, h: 1000 } });
  render();
  return { ...r, render, el: element() };
}

/** The page point of overlay layout point (x, y). */
const page = (x, y) => [100 + x * UI_SCALE, 50 + y * UI_SCALE];

test("adds no key or blur listener of its own", () => {
  assert.deepEqual(overlay().windowListeners, []);
});

test("takes the pointer, under the app's crosshair cursor", () => {
  const { render } = overlay();
  const root = render();
  assert.equal(root.props.style.pointerEvents, "auto");
  assert.equal(root.props.style.cursor, "cursor:crosshair");
});

test("draws the official brush ring at the pointer, at the size and feather a new correction takes", () => {
  const { render, el } = overlay({ settings: { size: 3, feather: 20 } });
  render().props.onPointerMove(pointer(el, ...page(400, 300)));
  const [ring] = findAll(render(), (n) => n.type === BrushCursor);
  assert.deepEqual(ring.props.at, { x: 400, y: 300 });
  assert.equal(ring.props.size, 0.03);
  assert.equal(ring.props.feather, 0.2);
});

test("redraws the ring when a shortcut changes the size", () => {
  const { render, el, canvas } = overlay({ settings: { size: 2 } });
  render().props.onPointerMove(pointer(el, ...page(400, 300)));
  canvas.held.onAction("brush.larger");
  const [ring] = findAll(render(), (n) => n.type === BrushCursor);
  assert.equal(ring.props.size, 0.03);
});

test("draws no ring before the pointer is over the photo", () => {
  const { render } = overlay();
  const [ring] = findAll(render(), (n) => n.type === BrushCursor);
  assert.equal(ring.props.at, null);
});

test("places a correction where framePoint puts the pointer, at Interface scale 125 %", () => {
  const { render, el, develop } = overlay({ settings: { size: 2 } });
  render().props.onPointerDown(pointer(el, ...page(400, 300)));
  assert.deepEqual(develop.getState().paramBag["redeye.correct.uReGeo0"], [0.4, 0.3, 0.02, 0.02]);
});

test("draws the selected eye's ring in the theme's white", () => {
  const { render, el } = overlay({ paramBag: { "redeye.correct.uReGeo0": [0.4, 0.3, 0.02, 0.02] } });
  render().props.onPointerDown(pointer(el, ...page(400, 300)));
  render().props.onPointerUp(pointer(el, ...page(400, 300)));
  const tree = render();
  assert.equal(findAll(tree, (n) => n.props.key === "e0")[0].props.stroke, tokens.white);
  assert.equal(findAll(tree, (n) => n.props.key === "d0")[0].props.fill, tokens.white);
});
