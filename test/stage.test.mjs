// The GPU stage's contract with the host. On process version 2 the host clips a
// display stage that declares no space to [0, 1] ahead of its block, outside its
// own gate, for as long as it is registered, so every photo would be clipped
// while the extension is enabled. Run: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildStage } from "../dist/index.js";

// The source as the host's GLSL preprocessor leaves it for a photo at
// `version`: the `#if SL_PROCESS_VERSION >= n` branches resolved and the
// directive lines gone.
function forVersion(src, version) {
  const taking = [];
  const out = [];
  for (const line of src.split("\n")) {
    const open = /^\s*#if SL_PROCESS_VERSION >= (\d+)\s*$/.exec(line);
    if (open) taking.push(version >= Number(open[1]));
    else if (/^\s*#else\s*$/.test(line)) taking.push(!taking.pop());
    else if (/^\s*#endif\s*$/.test(line)) taking.pop();
    else if (taking.every(Boolean)) out.push(line);
  }
  assert.deepEqual(taking, [], "balanced #if");
  return out.join("\n");
}

test("declares the display's own space, so the host adds no clip outside the gate", () => {
  assert.deepEqual(buildStage().space, { encoding: "perceptual" });
});

// On process version 2 the image stays full range: the redness test reads a
// clipped copy, but every pixel keeps its own value unless the correction mixes
// into it, the catchlight inside the disc included.
test("never writes a clipped value back into the image", () => {
  const helpers = forVersion(buildStage().helpers, 2);
  assert.doesNotMatch(helpers, /\bc\s*=\s*clamp\(c\b/, "reSpot doesn't clip c in place");
  const copy = helpers.match(/vec3 (\w+) = clamp\(c, 0\.0, 1\.0\);/);
  assert.ok(copy, "reSpot reads redness from a clipped copy");
  assert.match(helpers, new RegExp(`redness = ${copy[1]}\\.r - max\\(${copy[1]}\\.g, ${copy[1]}\\.b\\)`));
  assert.match(helpers, /vec3 fixedCol = c;/, "the correction starts from the full-range pixel");
  assert.match(helpers, /return mix\(c, fixedCol, eff\);/, "and mixes into it");
  for (const guard of ["if (par.w < 0.5) return c;", "if (radius <= 0.0) return c;", "if (dist > 1.0) return c;", "if (w <= 0.0) return c;", "if (eff <= 0.0) return c;"]) {
    assert.ok(helpers.includes(guard), `${guard} returns the pixel untouched`);
  }
});

// Process version 1 photos keep the correction they were edited with, which
// clipped every pixel inside a spot's disc in place before judging its redness.
test("clips the pixel in place on process version 1, as before the range fix", () => {
  const { helpers } = buildStage();
  const v1 = forVersion(helpers, 1);
  assert.match(v1, /if \(w <= 0\.0\) return c;\n\s*c = clamp\(c, 0\.0, 1\.0\);\n\s*vec3 cd = c;\n\s*float redness = cd\.r/);
  const before = forVersion(helpers, 2).replace(
    /  vec3 cd = clamp\(c, 0\.0, 1\.0\);[^\n]*\n  float redness = cd\.r - max\(cd\.g, cd\.b\);/,
    "  c = clamp(c, 0.0, 1.0);\n  float redness = c.r - max(c.g, c.b);",
  );
  const squash = (s) => s.replace(/\/\/.*$/gm, "").replace(/\s+/g, " ").trim();
  const asBefore = v1.replace(/^\s*vec3 cd = c;\n/m, "").replace(/\bcd\b/g, "c");
  assert.notEqual(squash(before), squash(forVersion(helpers, 2)));
  assert.equal(squash(asBefore), squash(before));
});

test("gives version 3 the version 2 path, one directive per line", () => {
  const { helpers } = buildStage();
  assert.ok(helpers.includes("#if SL_PROCESS_VERSION >= 2"));
  assert.equal(forVersion(helpers, 3), forVersion(helpers, 2));
  for (const line of helpers.split("\n").filter((l) => l.trim().startsWith("#"))) {
    assert.match(line, /^(#if SL_PROCESS_VERSION >= 2|#else|#endif)$/);
  }
});

test("needs Safelight 3.2.0, the first to define SL_PROCESS_VERSION", () => {
  const manifest = JSON.parse(readFileSync(new URL("../safelight.json", import.meta.url), "utf8"));
  assert.equal(manifest.minAppVersion, "3.2.0");
});
