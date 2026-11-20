import { defineConfig } from 'vite';
import {readFileSync} from 'node:fs';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  define:{__APP_VERSION__:JSON.stringify(JSON.parse(readFileSync(new URL('./package.json',import.meta.url),'utf8')).version)},
  resolve: {
    // 1.2.2 exports the stylesheet via a `style` condition, not a CSS subpath.
    alias: { 'frappe-gantt/style.css': fileURLToPath(new URL('./node_modules/frappe-gantt/dist/frappe-gantt.css', import.meta.url)) },
  },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
});
