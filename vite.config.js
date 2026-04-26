import { defineConfig, normalizePath } from 'vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, rmSync } from 'node:fs';
import { transform } from 'esbuild';
import { relative } from 'node:path';
import react from '@vitejs/plugin-react-swc';
import vitePluginBundleObfuscator from 'vite-plugin-bundle-obfuscator';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { logging, server as wisp } from '@mercuryworkshop/wisp-js/server';
import { createBareServer } from '@tomphttp/bare-server-node';
import { bareModulePath } from '@mercuryworkshop/bare-as-module3';
import { libcurlPath } from '@mercuryworkshop/libcurl-transport';
import { baremuxPath } from 'bare-mux-fork/node';
import { scramjetPath } from '@mercuryworkshop/scramjet/path';
import { uvPath } from '@titaniumnetwork-dev/ultraviolet';
import dotenv from 'dotenv';

dotenv.config();
const useBare = process.env.BARE === 'true';
const isStatic = process.env.STATIC === 'true';
const gaMeasurementId = 'G-HWLK0PZVBM';

const __dirname = dirname(fileURLToPath(import.meta.url));
logging.set_level(logging.NONE);
let bare;

const PATH_OBF = {
  libcurlDir: 'x',
  baremuxDir: 'y',
  eggsDir: 'z',
  uvDir: 'q',
  uvPrefix: '/q/r/',
  sjPrefix: '/k/',
  libcurlIndex: 'a.mjs',
  baremuxWorker: 'a.js',
  sjWasm: 'a.w',
  sjAll: 'b.js',
  sjSync: 'c.js',
  uvHandler: 'a.js',
  uvClient: 'b.js',
  uvBundle: 'c.js',
  uvSw: 'd.js',
  uvCfg: 'e.js',
};

const svgDomShim = `(() => {
  const ns = 'http://www.w3.org/1999/xhtml';
  const body = document.querySelector('body');
  if (!body) return;
  const svgRoot = document.documentElement;

  const head = document.createElementNS(ns, 'head');
  body.prepend(head);

  const htmlRoot = body.parentElement && body.parentElement.namespaceURI === ns
    ? body.parentElement
    : body;

  try {
    Object.defineProperty(document, 'head', {
      configurable: true,
      get() {
        return head;
      },
    });
  } catch {}

  try {
    Object.defineProperty(document, 'body', {
      configurable: true,
      get() {
        return body;
      },
    });
  } catch {}

  try {
    Object.defineProperty(document, 'documentElement', {
      configurable: true,
      get() {
        return htmlRoot;
      },
    });
  } catch {}

  try {
    Object.defineProperty(svgRoot, 'className', {
      configurable: true,
      get() {
        return svgRoot.getAttribute('class') || '';
      },
      set(value) {
        svgRoot.setAttribute('class', value || '');
      },
    });
  } catch {}

  const originalCreateElement = document.createElement.bind(document);
  document.createElement = function createElement(tagName, options) {
    return typeof tagName === 'string'
      ? document.createElementNS(ns, tagName, options)
      : originalCreateElement(tagName, options);
  };
})();`;

const escapeCdata = (value) => value.replace(/]]>/g, ']]]]><![CDATA[>');

const createSvgEntry = (bundle) => {
  const entryChunk = Object.values(bundle).find((item) => item.type === 'chunk' && item.isEntry);
  if (!entryChunk) return null;

  const cssFiles = [...(entryChunk.viteMetadata?.importedCss ?? [])].sort();
  const preloadFiles = [...new Set(entryChunk.imports)].sort();

  const headBootstrap = [
    `const headNodes = [`,
    `  { tag: 'meta', attrs: { charset: 'UTF-8' } },`,
    `  { tag: 'link', attrs: { rel: 'icon', type: 'image/svg+xml', href: '' } },`,
    `  { tag: 'meta', attrs: { name: 'viewport', content: 'initial-scale=1, width=device-width' } },`,
    ...preloadFiles.map(
      (file) =>
        `  { tag: 'link', attrs: { rel: 'modulepreload', href: './${file}', crossorigin: '' } },`,
    ),
    ...cssFiles.map(
      (file) =>
        `  { tag: 'link', attrs: { rel: 'stylesheet', href: './${file}', crossorigin: '' } },`,
    ),
    `];`,
    `for (const nodeDef of headNodes) {`,
    `  const node = document.createElement(nodeDef.tag);`,
    `  for (const [name, value] of Object.entries(nodeDef.attrs)) node.setAttribute(name, value);`,
    `  document.head.appendChild(node);`,
    `}`,
    `const title = document.createElement('title');`,
    `title.textContent = 'DogeUB';`,
    `document.head.appendChild(title);`,
    `const analyticsLoader = document.createElement('script');`,
    `analyticsLoader.async = true;`,
    `analyticsLoader.src = 'https://www.googletagmanager.com/gtag/js?id=${gaMeasurementId}';`,
    `document.head.appendChild(analyticsLoader);`,
    `const analyticsConfig = document.createElement('script');`,
    `analyticsConfig.textContent = \"window.dataLayer = window.dataLayer || []; function gtag(){dataLayer.push(arguments);} gtag('js', new Date()); gtag('config', '${gaMeasurementId}', { send_page_view: false });\";`,
    `document.head.appendChild(analyticsConfig);`,
    `const entryScript = document.createElement('script');`,
    `entryScript.type = 'module';`,
    `entryScript.setAttribute('crossorigin', '');`,
    `entryScript.src = './${entryChunk.fileName}';`,
    `document.body.appendChild(entryScript);`,
  ].join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" style="position: fixed; inset: 0;">
  <foreignObject x="0" y="0" width="100%" height="100%">
    <body xmlns="http://www.w3.org/1999/xhtml" lang="en" style="margin: 0; width: 100%; height: 100%; min-height: 100vh; overflow: auto;">
      <div id="root"></div>
      <style><![CDATA[
html,
body,
#root {
  width: 100%;
  min-height: 100vh;
}

body {
  margin: 0;
  background-size: 24px 24px;
  opacity: 1;
}
      ]]></style>
      <script><![CDATA[
${escapeCdata(`${svgDomShim}
${headBootstrap}`)}
      ]]></script>
    </body>
  </foreignObject>
</svg>
`;
};

Object.assign(wisp.options, {
  dns_method: 'resolve',
  dns_servers: ['1.1.1.3', '1.0.0.3'],
  dns_result_order: 'ipv4first',
});

const routeRequest = (req, resOrSocket, head) => {
  if (req.url?.startsWith('/wisp/')) return wisp.routeRequest(req, resOrSocket, head);
  if (bare.shouldRoute(req))
    return head ? bare.routeUpgrade(req, resOrSocket, head) : bare.routeRequest(req, resOrSocket);
};

const obf = {
  enable: true,
  autoExcludeNodeModules: true,
  threadPool: false,
  options: {
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.6,
    deadCodeInjection: false,
    debugProtection: false,
    disableConsoleOutput: true,
    identifierNamesGenerator: 'mangled',
    selfDefending: false,
    simplify: true,
    splitStrings: true,
    stringArray: true,
    stringArrayEncoding: [],
    stringArrayCallsTransform: false,
    stringArrayThreshold: 0.5,
    transformObjectKeys: false,
    unicodeEscapeSequence: false,
    ignoreImports: true,
  },
};

export default defineConfig(({ command }) => {
  const environment = isStatic ? 'static' : command === 'serve' ? 'dev' : 'stable';

  return {
    base: isStatic ? './' : '/',
    plugins: [
      react(),
      vitePluginBundleObfuscator(obf),
      viteStaticCopy({
        targets: [
          {
            src: [normalizePath(resolve(libcurlPath, 'index.mjs'))],
            dest: PATH_OBF.libcurlDir,
            rename: PATH_OBF.libcurlIndex,
          },
          {
            src: [normalizePath(resolve(baremuxPath, 'worker.js'))],
            dest: PATH_OBF.baremuxDir,
            rename: PATH_OBF.baremuxWorker,
          },
          {
            src: [normalizePath(resolve(scramjetPath, 'scramjet.wasm.wasm'))],
            dest: PATH_OBF.eggsDir,
            rename: PATH_OBF.sjWasm,
          },
          {
            src: [normalizePath(resolve(scramjetPath, 'scramjet.all.js'))],
            dest: PATH_OBF.eggsDir,
            rename: PATH_OBF.sjAll,
          },
          {
            src: [normalizePath(resolve(scramjetPath, 'scramjet.sync.js'))],
            dest: PATH_OBF.eggsDir,
            rename: PATH_OBF.sjSync,
          },
          useBare && { src: [normalizePath(resolve(bareModulePath, '*'))], dest: 'baremod' },
          {
            src: [normalizePath(resolve(uvPath, 'uv.handler.js'))],
            dest: PATH_OBF.uvDir,
            rename: PATH_OBF.uvHandler,
          },
          {
            src: [normalizePath(resolve(uvPath, 'uv.client.js'))],
            dest: PATH_OBF.uvDir,
            rename: PATH_OBF.uvClient,
          },
          {
            src: [normalizePath(resolve(uvPath, 'uv.bundle.js'))],
            dest: PATH_OBF.uvDir,
            rename: PATH_OBF.uvBundle,
          },
          {
            src: [normalizePath(resolve(uvPath, 'uv.sw.js'))],
            dest: PATH_OBF.uvDir,
            rename: PATH_OBF.uvSw,
          },
          {
            src: [normalizePath(resolve(__dirname, 'public/portal/uv.config.js'))],
            dest: PATH_OBF.uvDir,
            rename: PATH_OBF.uvCfg,
          },
        ].filter(Boolean),
      }),
      {
        name: 'minify-public',
        apply: 'build',
        async closeBundle() {
          const publicDir = resolve(__dirname, 'public');
          const distDir = resolve(__dirname, 'dist');

          const minifyFile = async (input, output) => {
            const code = readFileSync(input, 'utf8');

            const result = await transform(code, {
              minify: true,
              minifyIdentifiers: true,
              minifySyntax: true,
              minifyWhitespace: true,
              legalComments: 'none',
              target: 'es2022',
            });

            writeFileSync(output, result.code, 'utf8');
          };

          const walkAndMinify = async (dir) => {
            for (const file of readdirSync(dir)) {
              const full = resolve(dir, file);

              if (statSync(full).isDirectory()) {
                await walkAndMinify(full);
                continue;
              }

              if (!file.endsWith('.js')) continue;

              await minifyFile(full, full);
            }
          };

          const walkPublic = async (dir) => {
            for (const file of readdirSync(dir)) {
              const full = resolve(dir, file);

              if (statSync(full).isDirectory()) {
                await walkPublic(full);
                continue;
              }

              if (!file.endsWith('.js')) continue;

              const rel = relative(publicDir, full);
              if (!useBare && normalizePath(rel).startsWith('baremod/')) continue;
              if (normalizePath(rel) === 'portal/uv.config.js') continue;
              const out = resolve(distDir, rel);

              await minifyFile(full, out);
            }
          };

          await walkPublic(publicDir);

          const minifyTargets = [
            PATH_OBF.libcurlDir,
            PATH_OBF.baremuxDir,
            PATH_OBF.eggsDir,
            PATH_OBF.uvDir,
            ...(useBare ? ['baremod'] : []),
          ];

          for (const dir of minifyTargets) {
            const target = resolve(distDir, dir);
            try {
              await walkAndMinify(target);
            } catch {}
          }

          const oldflie = resolve(distDir, 'portal/uv.config.js');
          if (existsSync(oldflie)) {
            rmSync(oldflie, { force: true });
          }
          if (!useBare) {
            const baremodDir = resolve(distDir, 'baremod');
            if (existsSync(baremodDir)) {
              rmSync(baremodDir, { recursive: true, force: true });
            }
          }
        },
      },
      isStatic && {
        name: 'replace-cdn',
        transform(code, id) {
          if (id.endsWith('apps.json') || id.endsWith('QuickLinks.jsx')) {
            return code
              .replace(
                /\/assets-fb\//g,
                'https://cdn.jsdelivr.net/gh/DogeNetwork/v5-assets/img/server/',
              )
              .replace(
                /\/assets\/img\//g,
                'https://cdn.jsdelivr.net/gh/DogeNetwork/v5-assets/img/',
              );
          }
          if (id.endsWith('Logo.jsx')) {
            return code.replace(
              /['"]\/logo\.svg['"]/g,
              "'https://cdn.jsdelivr.net/gh/DogeNetwork/v5-assets/logo.svg'",
            );
          }
          if (id.endsWith('useReg.js')) {
            return code
              .replace(
                /['"]\/z\/a\.w['"]/g,
                "'https://cdn.jsdelivr.net/gh/DogeNetwork/v5-assets/eggs/scramjet.wasm.wasm'",
              )
              .replace(
                /['"]\/z\/b\.js['"]/g,
                "'https://cdn.jsdelivr.net/gh/DogeNetwork/v5-assets/eggs/scramjet.all.js'",
              )
              .replace(
                /['"]\/z\/c\.js['"]/g,
                "'https://cdn.jsdelivr.net/gh/DogeNetwork/v5-assets/eggs/scramjet.sync.js'",
              )
              .replace(
                /['"]\/x\/a\.mjs['"]/g,
                "'https://cdn.jsdelivr.net/gh/DogeNetwork/v5-assets/libcurl/index.mjs'",
              );
          }
        },
      },
      {
        name: 'server',
        apply: 'serve',
        configureServer(server) {
          bare = createBareServer('/seal/');
          server.httpServer?.on('upgrade', (req, sock, head) => routeRequest(req, sock, head));
          server.middlewares.use((req, res, next) => routeRequest(req, res) || next());
        },
      },
      {
        name: 'search',
        apply: 'serve',
        configureServer(s) {
          s.middlewares.use('/return', async (req, res) => {
            const q = new URL(req.url, 'http://x').searchParams.get('q');
            try {
              const r = q && (await fetch(`https://duckduckgo.com/ac/?q=${encodeURIComponent(q)}`));
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify(r ? await r.json() : { error: 'query parameter?' }));
            } catch {
              res.end(JSON.stringify({ error: 'request failed' }));
            }
          });
        },
      },
      {
        name: 'redirect',
        apply: 'serve',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            if (req.url === '/ds') {
              res.writeHead(302, { Location: 'https://discord.gg/ZBef7HnAeg' });
              res.end();
            } else {
              next();
            }
          });
        },
      },
      isStatic && {
        name: 'emit-svg-entry',
        apply: 'build',
        generateBundle(_, bundle) {
          const source = createSvgEntry(bundle);
          if (!source) return;

          this.emitFile({
            type: 'asset',
            fileName: 'index.svg',
            source,
          });
        },
      },
    ].filter(Boolean),
    build: {
      target: 'es2022',
      reportCompressedSize: false,
      esbuild: {
        legalComments: 'none',
        treeShaking: true,
      },
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'index.html'),
        },
        output: {
          entryFileNames: '[hash].js',
          chunkFileNames: 'chunks/[name].[hash].js',
          assetFileNames: 'assets/[hash].[ext]',
          manualChunks(id) {
            if (!id.includes('node_modules')) return;

            const m = id.split('node_modules/')[1];
            const pkg = m.startsWith('@') ? m.split('/').slice(0, 2).join('/') : m.split('/')[0];

            if (/react|scheduler/.test(pkg)) return 'a';
            if (/router|history/.test(pkg)) return 'b';
            if (/emotion|styled|css/.test(pkg)) return 'c';
            if (/lucide|icon/.test(pkg)) return 'd';
            if (/nprogress|analytics|ga/.test(pkg)) return 'e';

            return 'f';
          },
        },
        treeshake: {
          moduleSideEffects: 'no-external',
        },
      },
      minify: 'esbuild',
      sourcemap: false,
    },
    css: {
      modules: {
        generateScopedName: () =>
          String.fromCharCode(97 + Math.floor(Math.random() * 17)) +
          Math.random().toString(36).substring(2, 8),
      },
    },
    server: {
      proxy: {
        '/assets/img': {
          target: 'https://dogeub-assets.pages.dev',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/assets\/img/, '/img'),
        },
        '/assets-fb': {
          target: 'https://dogeub-assets.pages.dev',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/assets-fb/, '/img/server'),
        },
      },
    },
    define: {
      __ENVIRONMENT__: JSON.stringify(environment),
      isStaticBuild: isStatic,
      POPUNDER_ENABLED: JSON.stringify(process.env.POPUNDER_ENABLED),
      POPUNDER_URL: JSON.stringify(process.env.POPUNDER_URL),
    },
  };
});
