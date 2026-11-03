// Bundles js/app.js (and every module it loads) into dist/editor.js, a classic
// script, so the editor also works when index.html is opened straight from
// disk (file://), where browsers refuse to load ES modules.
// Run after changing anything in js/:   node video-editor/build.mjs
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
const dir = path.dirname(fileURLToPath(import.meta.url));
execFileSync('npx', ['--yes', 'esbuild@0.24.2', 'js/app.js', '--bundle', '--format=iife', '--target=es2022',
  '--outfile=dist/editor.js', '--legal-comments=none', '--log-level=warning'], { cwd: dir, stdio: 'inherit', shell: process.platform === 'win32' });
console.log('built video-editor/dist/editor.js');
