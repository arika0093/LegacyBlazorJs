import { readFile } from 'node:fs/promises';

async function readJsonConfig(relativePath) {
  const fileUrl = new URL(`../${relativePath}`, import.meta.url);
  return JSON.parse(await readFile(fileUrl, 'utf8'));
}

export async function readMajorsConfig() {
  return readJsonConfig('config/majors.json');
}

export async function readTargetsConfig() {
  return readJsonConfig('config/targets.json');
}

export async function getSupportedMajors() {
  const { supportedMajors } = await readMajorsConfig();
  return supportedMajors.map(Number);
}

export async function getTargetProfiles() {
  return Object.keys(await readTargetsConfig());
}
