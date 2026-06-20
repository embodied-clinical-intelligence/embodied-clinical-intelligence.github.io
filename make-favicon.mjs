// Regenerate favicon.png from the rendered ASCII MP4 (cross_bot pipeline).
//
// Pulls a frame straight out of ascii_light.mp4 so the favicon matches the
// hero animation pixel-for-pixel, finds the ink bounding box, and crops a
// centered square (white padding if the square spills past the frame).

import { spawn } from 'child_process';

const INPUT = 'ascii_light.mp4';
const FRAME = Number(process.argv[2] ?? 40);
const OUT = process.argv[3] ?? 'favicon.png';
const SIZE = 512;
const MARGIN = 24;          // white border around content, in source px
const WHITE_CUTOFF = 245;   // pixels brighter than this count as background

const probe = spawn('ffmpeg', [
  '-i', INPUT,
  '-vf', `select=eq(n\\,${FRAME})`,
  '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-v', 'quiet', '-'
], { stdio: ['ignore', 'pipe', 'inherit'] });

const chunks = [];
probe.stdout.on('data', (c) => chunks.push(c));
probe.on('close', () => {
  const raw = Buffer.concat(chunks);
  // ascii_light.mp4 is 1920x1064 (COLS*cellW x ROWS*cellH). Derive W from len.
  const W = 1920, H = raw.length / 3 / W;
  if (!Number.isInteger(H)) {
    console.error(`unexpected frame size: ${raw.length} bytes`);
    process.exit(1);
  }

  let minX = W, maxX = -1, minY = H, maxY = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      const lum = (raw[i] + raw[i + 1] + raw[i + 2]) / 3;
      if (lum < WHITE_CUTOFF) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  minX -= MARGIN; minY -= MARGIN; maxX += MARGIN; maxY += MARGIN;
  const side = Math.max(maxX - minX + 1, maxY - minY + 1);
  let cropX = Math.round((minX + maxX) / 2 - side / 2);
  let cropY = Math.round((minY + maxY) / 2 - side / 2);

  // Pad with white if the square spills past the frame so the content stays
  // centered instead of shifting when ffmpeg clamps the crop.
  const padL = Math.max(0, -cropX);
  const padT = Math.max(0, -cropY);
  const padR = Math.max(0, cropX + side - W);
  const padB = Math.max(0, cropY + side - H);

  const vf = [
    `select=eq(n\\,${FRAME})`,
    `pad=${W + padL + padR}:${H + padT + padB}:${padL}:${padT}:white`,
    `crop=${side}:${side}:${cropX + padL}:${cropY + padT}`,
    `scale=${SIZE}:${SIZE}:flags=lanczos`,
  ].join(',');

  const enc = spawn('ffmpeg', [
    '-y', '-i', INPUT, '-vf', vf, '-frames:v', '1', '-update', '1', OUT, '-v', 'error'
  ], { stdio: ['ignore', 'inherit', 'inherit'] });
  enc.on('close', (code) => {
    console.log(code === 0
      ? `Wrote ${OUT} (frame ${FRAME}, ${SIZE}x${SIZE}, crop ${side}x${side} @ ${cropX},${cropY})`
      : 'encode failed');
  });
});
