// Correction mode is the app's canvas tool: Correct holds the canvas, Escape
// and Done let it go, and the official brush shortcuts size the ring a new
// correction takes. Run: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { byText, element, findAll, mount, pointer, rig } from "./support/rig.mjs";

function correcting(options) {
  const r = rig(options);
  const panel = r.panel();
  byText(panel(), r.Button, "Correct").props.onClick();
  return { ...r, panel };
}

test("Correct holds the canvas with a zoomable tool", () => {
  const { canvas } = correcting();
  assert.ok(canvas.held);
  assert.equal(canvas.held.zoomable, true);
  assert.equal(typeof canvas.held.overlay, "function");
});

test("registers no overlay slot and watches no core tool state", () => {
  const { slots, develop } = rig();
  assert.equal(slots.length, 0);
  assert.equal(develop.subscribed, 0);
});

test("shows Done while it holds the canvas, and Done lets it go", () => {
  const { canvas, panel, Button } = correcting();
  const done = byText(panel(), Button, "Done");
  assert.ok(done);
  done.props.onClick();
  assert.equal(canvas.held, null);
  assert.ok(byText(panel(), Button, "Correct"));
});

test("keeps its how-to in the Correct button's tooltip, not in the panel", () => {
  const r = rig();
  const tree = r.panel()();
  assert.match(byText(tree, r.Button, "Correct").props.title, /Click an eye/);
  const prose = findAll(tree, (n) => n.children.some((c) => typeof c === "string" && /Click an eye|Auto-detect scans/.test(c)));
  assert.deepEqual(prose, []);
});

test("] and Shift+] step the size and feather a new correction takes", () => {
  const { canvas, setSettings } = correcting({ settings: { size: 2, feather: 40 } });
  assert.equal(canvas.held.onAction("brush.larger"), true);
  assert.equal(canvas.held.onAction("brush.featherUp"), true);
  assert.deepEqual(setSettings, [["size", 3], ["feather", 45]]);
});

test("leaves the opacity and flow shortcuts, and other actions, to the app", () => {
  const { canvas, setSettings } = correcting();
  for (const action of ["brush.opacityUp", "brush.opacityDown", "brush.flowUp", "brush.flowDown", "view.zoomIn"]) {
    assert.equal(canvas.held.wants(action), false, action);
    assert.equal(canvas.held.onAction(action), false, action);
  }
  assert.deepEqual(setSettings, []);
});

test("wants the size and feather shortcuts without acting on them", () => {
  const { canvas, setSettings } = correcting();
  assert.equal(canvas.held.wants("brush.smaller"), true);
  assert.equal(canvas.held.wants("brush.featherDown"), true);
  assert.deepEqual(setSettings, []);
});

test("holds the size to the panel's 10 % top", () => {
  const { canvas, setSettings } = correcting({ settings: { size: 10 } });
  canvas.held.onAction("brush.larger");
  assert.deepEqual(setSettings, [["size", 10]]);
});

test("steps a ring under 1 % down to the panel's smallest, never up", () => {
  const { canvas, setSettings } = correcting({ settings: { size: 0.5 } });
  canvas.held.onAction("brush.smaller");
  assert.deepEqual(setSettings, [["size", 0.2]]);
});

test("Escape drops the selected correction", () => {
  const { canvas, develop } = correcting({ paramBag: { "redeye.correct.uReGeo0": [0.1, 0.1, 0.02, 0.02] } });
  const render = mount(canvas.held.overlay, { rect: { x: 0, y: 0, w: 1000, h: 1000 } });
  render();
  const el = element();
  // The eye sits at layout (100, 100): page (100 + 100 × 1.25, 50 + 100 × 1.25).
  render().props.onPointerDown(pointer(el, 225, 175));
  render().props.onPointerUp(pointer(el, 225, 175));
  const selected = () => findAll(render(), (n) => n.props.key === "e0")[0].props.strokeWidth === 2;
  assert.equal(selected(), true);
  canvas.held.onEscape();
  assert.equal(selected(), false);
  assert.equal(develop.getState().paramBag["redeye.correct.uReGeo0"][0], 0.1);
});
