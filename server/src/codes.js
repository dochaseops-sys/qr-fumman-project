import crypto from 'crypto';

export function generateToken() {
  return crypto.randomBytes(24).toString('hex');
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateSerialCode(batchNumber, sequenceNumber) {
  const randomPart = crypto.randomBytes(3).toString('hex').toUpperCase();
  const sequence = String(sequenceNumber).padStart(5, '0');
  const cleanBatch = String(batchNumber || 'BATCH').replace(/[^A-Z0-9]/gi, '').toUpperCase();
  return `${cleanBatch}-${sequence}-${randomPart}`;
}

export function toVerificationUrl(token) {
  const baseUrl = process.env.PUBLIC_VERIFY_BASE_URL || 'http://localhost:5173';
  return `${baseUrl.replace(/\/$/, '')}/verify/${token}`;
}
