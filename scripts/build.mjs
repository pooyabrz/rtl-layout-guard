import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
await build({
  entryPoints: ['src/extension.ts'], outfile: 'dist/extension.cjs', bundle: true,
  platform: 'node', format: 'cjs', target: 'node20', external: ['vscode'],
  sourcemap: false, minify: true, legalComments: 'eof'
});
await build({
  entryPoints: ['src/core/index.ts'], outfile: 'dist/core.cjs', bundle: true,
  platform: 'node', format: 'cjs', target: 'node20', sourcemap: false
});
