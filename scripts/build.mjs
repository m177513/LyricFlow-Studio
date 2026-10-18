import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  const {build} = await import('esbuild');
  await build({entryPoints:[path.join(root,'video/player.tsx')], outfile:path.join(root,'web/dist/player.js'), bundle:true, platform:'browser', format:'esm', target:'es2022', jsx:'automatic', minify:true, sourcemap:true, define:{'process.env.NODE_ENV':'"production"'}});
  console.log('Remotion Player bundle built: web/dist/player.js');
} catch(error) { console.error('Player build failed. Run npm install first.\n'+error.message); process.exitCode=1; }
