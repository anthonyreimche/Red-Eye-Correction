// Under Preferences ▸ Interface scale the <body> is CSS-zoomed: clientX and the
// bounding rect are in zoomed visual pixels, while toImage, toScreen and the
// rings take layout pixels. Run: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { frameLocalPoint } from "../dist/index.js";

const apiAt = (uiScale) => ({ stores: { useSettings: { getState: () => ({ uiScale }) } } });
const pointer = (clientX, clientY) => ({
  clientX,
  clientY,
  currentTarget: { getBoundingClientRect: () => ({ left: 100, top: 50, width: 1000, height: 750 }) },
});

test("maps the pointer into layout pixels at Interface scale 125 %", () => {
  const layout = { x: 400, y: 300 };
  const e = pointer(100 + layout.x * 1.25, 50 + layout.y * 1.25);
  assert.deepEqual(frameLocalPoint(apiAt(1.25), e), layout);
});

test("is the plain offset at Interface scale 100 %", () => {
  assert.deepEqual(frameLocalPoint(apiAt(1), pointer(340, 170)), { x: 240, y: 120 });
});
