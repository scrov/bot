/**
 * The Activity's front end. Bundled by `npm run build:client` into
 * public/assets/app.js, which public/index.html loads.
 */

import { connect } from './connect.js';
import { createApp } from './ui.js';

const app = createApp();
const { store, message, name } = await connect();
await app.start(store, { message, name });
