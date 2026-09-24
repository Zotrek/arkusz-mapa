import { proxyToWorker } from '../_proxy.js';

export async function onRequest(context) {
  return proxyToWorker(context, '/api/transport');
}
