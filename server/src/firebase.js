import admin from 'firebase-admin';
import dotenv from 'dotenv';

dotenv.config();

const required = ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY'];
const missing = required.filter((key) => !process.env[key]);

if (!admin.apps.length && missing.length === 0) {
  let privateKey = process.env.FIREBASE_PRIVATE_KEY || '';
  
  // Clean quotes and spaces
  let cleaned = privateKey.trim();
  if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
    cleaned = cleaned.slice(1, -1);
  }
  if (cleaned.startsWith("'") && cleaned.endsWith("'")) {
    cleaned = cleaned.slice(1, -1);
  }
  cleaned = cleaned.trim();

  // Try to find header and footer and reconstruct PEM formatting
  let header = '';
  let footer = '';
  if (cleaned.includes('-----BEGIN PRIVATE KEY-----')) {
    header = '-----BEGIN PRIVATE KEY-----';
    footer = '-----END PRIVATE KEY-----';
  } else if (cleaned.includes('-----BEGIN RSA PRIVATE KEY-----')) {
    header = '-----BEGIN RSA PRIVATE KEY-----';
    footer = '-----END RSA PRIVATE KEY-----';
  }

  if (header && footer) {
    try {
      let middle = cleaned.split(header)[1].split(footer)[0];
      // Strip all whitespace, real newlines, literal '\n' text, and carriage returns/slashes
      middle = middle
        .replace(/\s+/g, '')
        .replace(/\\n/g, '')
        .replace(/\\r/g, '')
        .replace(/\\/g, '');
      
      // Chunk base64 content to 64 character lines
      const chunks = [];
      for (let i = 0; i < middle.length; i += 64) {
        chunks.push(middle.substring(i, i + 64));
      }
      privateKey = `${header}\n${chunks.join('\n')}\n${footer}\n`;
    } catch (e) {
      console.error('Failed to reconstruct PEM private key:', e);
      // Fallback to simple replace
      privateKey = cleaned.replace(/\\n/g, '\n');
    }
  } else {
    // If no standard headers, just replace escaped newlines
    privateKey = cleaned.replace(/\\n/g, '\n');
  }

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: privateKey
    })
  });
}

export function getDb() {
  if (missing.length > 0) {
    throw new Error(`Missing Firebase environment variables: ${missing.join(', ')}`);
  }

  return admin.firestore();
}

export const FieldValue = admin.firestore.FieldValue;
export const Timestamp = admin.firestore.Timestamp;
