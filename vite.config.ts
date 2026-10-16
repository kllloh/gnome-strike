import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The build is a single self-contained index.html (script and styles inlined), so the game also
// runs when you just double-click dist/index.html - browsers refuse separate module files on file://.
// Relative base keeps it working from any sub-path (GitHub Pages, itch.io, ...).
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
});
