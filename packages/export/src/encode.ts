// ffmpeg mux (SPEC §2, §6.3): consecutive PNG frames → H.264 MP4. Pinned encode
// settings — libx264, yuv420p, crf 16, preset slow (SPEC §2). ffmpeg spawned with
// array args (no shell interpolation, §7). ffmpeg-static supplies the pinned binary.

import ffmpegStatic from 'ffmpeg-static';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

export async function encodeMp4(opts: {
  pngDir: string;
  fps: number;
  startNumber: number;
  outPath: string;
}): Promise<void> {
  const ffmpegPath = ffmpegStatic as unknown as string | null;
  if (!ffmpegPath) throw new Error('encodeMp4: ffmpeg-static binary not found');
  const args = [
    '-y',
    '-framerate',
    String(opts.fps),
    '-start_number',
    String(opts.startNumber),
    '-i',
    resolve(opts.pngDir, 'frame-%05d.png'),
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-crf',
    '16',
    '-preset',
    'slow',
    opts.outPath,
  ];
  await new Promise<void>((res, rej) => {
    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    proc.stderr.on('data', (d: Buffer) => (err += d.toString()));
    proc.on('error', rej);
    proc.on('close', (code) =>
      code === 0 ? res() : rej(new Error(`ffmpeg exited ${code}:\n${err.slice(-800)}`)),
    );
  });
}
