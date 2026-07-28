import { readFile } from 'node:fs/promises';

const manifestPath = new URL('../slack-app-manifest.json', import.meta.url);
const manifestJson = await readFile(manifestPath, 'utf8');
const createAppUrl = `https://api.slack.com/apps?new_app=1&manifest_json=${encodeURIComponent(
  manifestJson,
)}`;

console.log(createAppUrl);
