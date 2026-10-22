// The GPU stage's contract with the host. On process version 2 the host clips a
// display stage that declares no space to [0, 1] ahead of its block, outside its
// own gate, for as long as it is registered, so every photo would be clipped
// while the extension is enabled. Run: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStage } from "../dist/index.js";

test("declares the display's own space, so the host adds no clip outside the gate", () => {
  assert.deepEqual(buildStage().space, { encoding: "perceptual" });
});

test("clips only pixels an enabled spot can touch", () => {
  const { helpers } = buildStage();
  const clip = helpers.indexOf("c = clamp(c, 0.0, 1.0);");
  assert.ok(clip > 0, "reSpot clips its input");
  for (const guard of ["if (par.w < 0.5) return c;", "if (radius <= 0.0) return c;", "if (dist > 1.0) return c;", "if (w <= 0.0) return c;"]) {
    const at = helpers.indexOf(guard);
    assert.ok(at > 0 && at < clip, `${guard} comes before the clip`);
  }
});
