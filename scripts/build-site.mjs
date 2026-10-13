import { build } from 'esbuild';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createDemo } from '../dist/demo.js';
import { renderReader } from '../dist/render.js';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--out')) throw new Error('Usage: node scripts/build-site.mjs [--out <directory>]');
const output = resolve(args[1] ?? join(project, 'dist/site'));
mkdirSync(output, { recursive: true });
// Fail rather than accidentally publish material left in the output folder.
for (const name of readdirSync(output)) if (!['index.html', 'vercel.json', 'downloads', '.vercel'].includes(name)) throw new Error(`Unexpected public output entry: ${name}`);
const downloads = join(output, 'downloads'); mkdirSync(downloads, { recursive: true });
for (const name of readdirSync(downloads)) if (name !== 'flow-review-cli.tgz') throw new Error(`Unexpected download entry: ${name}`);

const html = renderReader(createDemo());
const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
if (!csp) throw new Error('Reader is missing its content security policy.');
const config = {
  $schema: 'https://openapi.vercel.sh/vercel.json',
  framework: null, buildCommand: null, installCommand: null, outputDirectory: '.',
  headers: [{ source: '/(.*)', headers: [
    { key: 'Content-Security-Policy', value: `${csp}; frame-ancestors 'none'` },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'no-referrer' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    { key: 'Cache-Control', value: 'no-cache' },
  ] }],
};
const temporary = mkdtempSync(join(tmpdir(), 'flow-review-distribution-'));
try {
  const pack = join(temporary, 'package'); mkdirSync(join(pack, 'dist/web'), { recursive: true });
  const metadata = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8'));
  writeFileSync(join(pack, 'package.json'), JSON.stringify({ name: metadata.name, version: metadata.version, description: metadata.description, type: 'module', bin: { 'flow-review': 'dist/cli.js' }, engines: { node: '>=22' } }, null, 2) + '\n');
  await build({ entryPoints: [join(project, 'src/cli.ts')], outfile: join(pack, 'dist/cli.js'), bundle: true, platform: 'node', format: 'esm', target: 'node22',
    banner: { js: "import { createRequire as __makeRequire } from 'node:module'; import { fileURLToPath as __fileName } from 'node:url'; import { dirname as __directory } from 'node:path'; const require=__makeRequire(import.meta.url); const __filename=__fileName(import.meta.url); const __dirname=__directory(__filename);" },
  });
  chmodSync(join(pack, 'dist/cli.js'), 0o755);
  for (const name of ['client.js', 'client.css']) copyFileSync(join(project, 'dist/web', name), join(pack, 'dist/web', name));
  const dependencies = ['typescript', 'diff', 'react', 'react-dom', 'scheduler', '@phosphor-icons/react'];
  const notices = dependencies.map(name => {
    const folder = join(project, 'node_modules', name);
    const info = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8'));
    const license = readdirSync(folder).find(file => /^LICENSE(?:\..*)?$/.test(file));
    if (!license) throw new Error(`Missing bundled dependency license: ${name}`);
    const noticeFiles = readdirSync(folder).filter(file => /^NOTICE(?:\..*)?$/.test(file));
    return `${name} ${info.version}\n${readFileSync(join(folder, license), 'utf8')}\n${noticeFiles.map(file => readFileSync(join(folder, file), 'utf8')).join('\n')}`;
  }).join('\n\n====================\n\n');
  writeFileSync(join(pack, 'THIRD-PARTY-NOTICES.txt'), notices);
  writeFileSync(join(pack, 'README.txt'), 'Flow Review local analyzer\n\nRequires Node.js 22+, Git 2.52+, and GitHub CLI signed in for PR URLs.\n\nInstall the downloaded package:\n  npm install --global ./flow-review-cli.tgz\n\nGenerate an offline HTML reader and JSON report:\n  flow-review pr --url https://github.com/owner/repo/pull/123 --out review.html\n  flow-review analyze --repo /path/to/repo --base origin/main --out review.html\n\nOpen review.html offline or import review.json in the online reader. Source is read from committed Git objects without running the reviewed project.\n\nMutable/dynamic/method/callback targets remain unresolved. Private reports should be handled like the underlying source repository. This package contains tool code and illustrative demo code, not credentials or reviewed repositories.\n');
  execFileSync('tar', ['-czf', join(downloads, 'flow-review-cli.tgz'), '-C', temporary, 'package'], { stdio: 'pipe', env: { ...process.env, COPYFILE_DISABLE: '1' } });
  writeFileSync(join(output, 'index.html'), html);
  writeFileSync(join(output, 'vercel.json'), JSON.stringify(config, null, 2) + '\n');
} finally { rmSync(temporary, { recursive: true, force: true }); }
console.log(`Production reader and local analyzer package: ${output}`);
