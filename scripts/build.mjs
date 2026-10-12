import { build } from 'esbuild';
import { mkdir, chmod } from 'node:fs/promises';
await mkdir('dist/web', { recursive: true });
await build({ entryPoints: ['src/web/main.tsx'], bundle: true, outfile: 'dist/web/client.js', minify: true, target: ['es2022'], define: { 'process.env.NODE_ENV': '"production"' } });
await build({ entryPoints: ['src/cli.ts', 'src/analyzer.ts', 'src/git.ts', 'src/render.ts'], bundle: true, outdir: 'dist', platform: 'node', format: 'esm', packages: 'external', target: 'node22' });
await chmod('dist/cli.js', 0o755);
console.log('Built CLI and offline reader.');
