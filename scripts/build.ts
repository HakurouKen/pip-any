import fsp from 'node:fs/promises';
import path from 'node:path';

import { build } from 'vite';

const watch = process.argv.includes('--watch');
await fsp.rm('dist', { recursive: true, force: true });
await fsp.mkdir('dist', { recursive: true });
await fsp.cp('public', 'dist', { recursive: true });

// content script 必须是自包含脚本，不可包含运行时 ESM 导入。
await Promise.all(
  ['popup', 'content'].map((entry) =>
    build({
      configFile: false,
      publicDir: false,
      build: {
        target: 'chrome116',
        outDir: 'dist',
        emptyOutDir: false,
        sourcemap: true,
        minify: !watch,
        watch: watch ? {} : null,
        lib: {
          entry: path.resolve(`src/${entry}.ts`),
          name: `PipAny${entry}`,
          formats: [entry === 'content' ? 'iife' : 'es'],
          fileName: () => `${entry}.js`,
        },
      },
    }),
  ),
);
