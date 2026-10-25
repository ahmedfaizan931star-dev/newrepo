import { handleRequest } from '../server.js';

export default async function handler(req, res) {
  const rawUrl = req.url || '/';
  const parsed = new URL(rawUrl, `http://${req.headers.host || 'localhost'}`);
  const requestedPath = (req.query && req.query.__path) || parsed.searchParams.get('__path') || '/';
  const target = Array.isArray(requestedPath) ? requestedPath[0] : String(requestedPath);
  const query = new URLSearchParams(parsed.searchParams);
  query.delete('__path');
  req.url = `${target}${query.size ? `?${query.toString()}` : ''}`;
  return handleRequest(req, res);
}
