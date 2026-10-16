import { defineConfig } from 'vite';

// Relative asset paths, so the built game works from any sub-path (GitHub Pages, itch.io, ...).
export default defineConfig({
  base: './',
});
