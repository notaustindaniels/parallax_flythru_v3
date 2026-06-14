// Localhost frame server (SPEC §6.4, §7): serves composition.html, the esbuild bundle,
// and the scene/palette JSON to the Playwright page. Bound to 127.0.0.1 only; the
// render context additionally blocks every non-localhost route (render.ts) so a render
// can never touch the network (§7 "no network at render time").

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCompositionJS } from './build-composition';

export interface FrameServer {
  url: string;
  close(): Promise<void>;
}

export async function startFrameServer(opts: {
  sceneJson: string;
  paletteJson: string;
}): Promise<FrameServer> {
  const here = dirname(fileURLToPath(import.meta.url));
  const html = await readFile(resolve(here, '../../renderer-svg/composition.html'), 'utf8');
  const js = await buildCompositionJS();

  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0]!;
    if (path === '/' || path === '/composition.html') {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(html);
    } else if (path === '/composition.js') {
      res.setHeader('content-type', 'text/javascript; charset=utf-8');
      res.end(js);
    } else if (path === '/scene.json') {
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(opts.sceneJson);
    } else if (path === '/palette.json') {
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(opts.paletteJson);
    } else {
      res.statusCode = 404;
      res.end('not found');
    }
  });

  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
