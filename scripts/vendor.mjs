// Copies the SheetJS browser build into /vendor so the site works with no CDN and no build step.
import { copyFileSync, mkdirSync } from 'node:fs';
mkdirSync('vendor', { recursive: true });
copyFileSync('node_modules/xlsx/dist/xlsx.full.min.js', 'vendor/xlsx.full.min.js');
console.log('vendored xlsx.full.min.js');
