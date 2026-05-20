export function requireAdmin(req, res, next) {
  const configuredPasscode = process.env.ADMIN_PASSCODE;

  if (!configuredPasscode) {
    return res.status(500).json({ error: 'ADMIN_PASSCODE is not configured.' });
  }

  const providedPasscode = req.header('x-admin-passcode');

  if (providedPasscode !== configuredPasscode) {
    return res.status(401).json({ error: 'Invalid admin passcode.' });
  }

  return next();
}
