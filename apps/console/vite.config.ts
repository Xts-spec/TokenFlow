import { defineConfig } from 'vite';
export default defineConfig({root:'apps/console',base:'/',resolve:{dedupe:['react','react-dom']},build:{outDir:'../../dist/console',emptyOutDir:true}});
