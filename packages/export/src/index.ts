// @vectorflight/export — frame server (Playwright) + ffmpeg mux + deterministic stepper.
// Drives renderer-svg's composition.html via the Seekable Composition Contract (SPEC §6.4):
// seek(frame) -> screenshot -> ffmpeg (libx264, yuv420p, crf 16, preset slow).
// Playwright context blocks all non-localhost routes (SPEC §7). Lands at P3/P6.
export {};
