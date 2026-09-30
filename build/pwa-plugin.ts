import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';
import { cacheVersion, injectPrecache, precacheList, SW_FILE } from './pwa.ts';

const SW_SOURCE = 'src/sw/sw.ts';

/**
 * Builds the service worker (src/sw/sw.ts) as `sw.js` next to index.html, then writes into it the files to
 * precache and a version derived from their content (build/pwa.ts). Build only: the dev server runs without
 * a worker (src/app/pwa.ts registers it in production builds).
 */
export function pwa(): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'versus-pwa',
    apply: 'build',
    configResolved(resolved) {
      config = resolved;
    },
    buildStart() {
      this.emitFile({ type: 'chunk', id: resolve(config.root, SW_SOURCE), fileName: SW_FILE });
    },
    generateBundle: {
      // After the other plugins, so index.html and the generated manifest are in the bundle.
      order: 'post',
      handler(_options, bundle) {
        const files = new Map<string, string | Uint8Array>();
        for (const [name, out] of Object.entries(bundle)) files.set(name, out.type === 'chunk' ? out.code : out.source);
        // public/ is copied next to the bundle without going through it.
        if (config.publicDir) {
          for (const entry of readdirSync(config.publicDir, { withFileTypes: true })) {
            if (entry.isFile() && !files.has(entry.name)) {
              files.set(entry.name, readFileSync(join(config.publicDir, entry.name)));
            }
          }
        }
        const sw = bundle[SW_FILE];
        if (sw?.type !== 'chunk') return this.error(`${SW_FILE} is missing from the bundle`);
        const list = precacheList(files.keys());
        const body = (f: string) => files.get(f === './' ? 'index.html' : f) ?? '';
        sw.code = injectPrecache(sw.code, list, cacheVersion(list.map((f) => [f, body(f)] as const)));
      },
    },
  };
}
