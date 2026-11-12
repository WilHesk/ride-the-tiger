// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { rttLocalCmsPlugin } from './src/utils/localCmsPlugin.mjs';

// https://astro.build/config
export default defineConfig({
  site: "https://ride-the-tiger.netlify.app",
  integrations: [react(), sitemap()],

  vite: {
    plugins: [tailwindcss(), rttLocalCmsPlugin()]
  }
});
