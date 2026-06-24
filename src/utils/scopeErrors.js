export function handleScopeError(res, error) {
  const status = error.statusCode || 500;
  return res.status(status).json({ error: error.message || 'Request failed' });
}
