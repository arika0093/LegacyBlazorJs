import test from 'node:test';
import { getHostingModel, getProfiles, runSmokeTest } from './smoke-harness.mjs';

const profiles = await getProfiles();
const hostingModel = getHostingModel();

for (const profile of profiles) {
  test(`generated script makes counter interactive (${hostingModel}, ${profile})`, async () => {
    await runSmokeTest(profile, hostingModel);
  });
}
