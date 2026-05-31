import { createApp } from './app.js';
import { assertRequiredEnv, getConfig } from './config.js';
import { processDueLicenseActions } from './licenseWorkflow.js';

assertRequiredEnv();

const app = createApp();
const config = getConfig();
const host = process.env.HOST || '0.0.0.0';

app.listen(config.port, host, () => {
  console.log(`ForceMap licensing backend listening on ${host}:${config.port}`);
});

setInterval(() => {
  processDueLicenseActions().catch((error) => {
    console.error('Scheduled due-action processing failed.', error);
  });
}, 60 * 60 * 1000);
