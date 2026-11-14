/**
 * The Worker's entry point: the request handler, and the Durable Object class
 * the USER_STORE binding refers to.
 *
 * They are joined here, not in server.js, so that the tests can load the
 * server in Node, where `cloudflare:workers` (which store.js needs) does not
 * exist.
 */

import server from './server.js';

export { UserStore } from './store.js';

export default {
  fetch: server.fetch,
};
