# SafeLight Red Eye Correction

Automatic and manual red eye removal for [SafeLight](https://github.com/anthonyreimche/SafeLight). Corrections are non-destructive radial masks (desaturate + darken), so every fix is individually editable, undoable, and lives in the normal edit history.

## Install

Extensions panel (**View ▸ Extensions**) → enter `owner/safelight-redeye` (or the github.com URL). No restart needed.

## Use

Open a photo in **Develop**. The **Red Eye** panel docks in the right rail.

- **Detect red eyes** — scans the photo for compact, strongly red blobs and drops a corrective radial mask on each (named `Red Eye N`).
- **Add manually** — places a mask at the image center and switches to the mask tool; drag it over the eye, resize with its handles.
- Click a correction in the list to select it and tune **Size**, **Darken**, **Desaturate**, and **Feather**. ✕ removes one; **Clear** removes all.

Corrections are ordinary masks — they also appear in the Masks panel, count toward the app's 8-mask limit, and export with the photo.

## Extension settings (⚙ in the Extensions panel)

| Setting | Default | Effect |
|---|---|---|
| Detection sensitivity | 60 | Higher finds fainter red eyes; risks false positives |
| Min / max pupil size | 0.3% / 4% | Accepted blob radius, as % of image height |
| Max detections per run | 6 | Cap per Detect click (≤ 8) |
| Mask size (% of pupil) | 135 | Padding around the detected pupil |
| Default feather / desaturation / darken | 40 / 85 / 55 | Applied to new corrections |
| Analysis resolution | 1200 px | Long edge for scanning; lower = faster |
| Add history step after detect | on | Commits an undoable snapshot |

Settings apply live — no reload.

## How detection works

The photo is decoded (RAW falls back to the cached thumbnail), downscaled to the analysis resolution, and scored per pixel for red dominance (`r² / (g² + b² + floor)`). Pixels above the sensitivity threshold are flood-filled into connected components, which are filtered by size, aspect ratio (~round), and compactness, deduplicated by overlap, and ranked by confidence. Blob centroids/radii convert directly to mask UV coordinates, so results are resolution-independent.

## Repo layout

- `safelight.json` — manifest
- `dist/index.js` — the ESM bundle (hand-written, dependency-free; React, components, and stores come from the `SafelightAPI`, so there is no build step)

Tag the repo with the `safelight-extension` topic to appear in the in-app browser.

## License

MIT
