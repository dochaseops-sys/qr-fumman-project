import express from 'express';
import { FieldValue, getDb } from './firebase.js';
import { generateSerialCode, generateToken, hashToken, toVerificationUrl } from './codes.js';
import { requireAdmin } from './auth.js';

const router = express.Router();

const resultCopy = {
  GENUINE: 'This product appears genuine.',
  INVALID: 'This code was not found. Please contact the company.',
  SUSPICIOUS: 'This code has already been scanned multiple times or has been blocked. Please verify before use.'
};

function serializeDoc(doc) {
  const data = doc.data();
  return {
    id: doc.id,
    ...data,
    createdAt: data.createdAt?.toDate?.().toISOString?.() || data.createdAt || null,
    lastScannedAt: data.lastScannedAt?.toDate?.().toISOString?.() || data.lastScannedAt || null,
    manufactureDate: data.manufactureDate || '',
    expiryDate: data.expiryDate || ''
  };
}

function codeBatchInfo(code) {
  return {
    productName: code.productName,
    batchNumber: code.batchNumber,
    manufactureDate: code.manufactureDate || '',
    expiryDate: code.expiryDate || ''
  };
}

function computeScanSummary(logs) {
  const summary = {
    total: 0,
    genuine: 0,
    suspicious: 0,
    invalid: 0,
    locationCount: 0
  };
  const locations = new Set();

  logs.forEach((log) => {
    summary.total += 1;
    const result = String(log.result || '').toUpperCase();
    if (result === 'GENUINE') summary.genuine += 1;
    else if (result === 'SUSPICIOUS') summary.suspicious += 1;
    else if (result === 'INVALID') summary.invalid += 1;

    const latitude = log.location?.latitude ?? log.location?._latitude ?? log.location?.lat;
    const longitude = log.location?.longitude ?? log.location?._longitude ?? log.location?.lng;

    if (typeof latitude === 'number' && typeof longitude === 'number') {
      locations.add(`${latitude.toFixed(4)}|${longitude.toFixed(4)}`);
    }
  });

  summary.locationCount = locations.size;
  return summary;
}

async function logScan(db, codeDoc, code, result, reason, location) {
  await db.collection('scanLogs').add({
    codeId: codeDoc?.id || null,
    serialCode: code?.serialCode || null,
    batchNumber: code?.batchNumber || null,
    result,
    reason,
    location: location || null,
    createdAt: FieldValue.serverTimestamp()
  });
}

async function verifyCodeSnapshot(codeDoc, reasonPrefix = 'Code', location) {
  const db = getDb();

  if (!codeDoc || !codeDoc.exists) {
    await logScan(db, null, null, 'INVALID', 'Code was not found.', location);
    return {
      result: 'INVALID',
      message: resultCopy.INVALID,
      reason: 'Code was not found.'
    };
  }

  const code = codeDoc.data();
  let result = 'GENUINE';
  let reason = `${reasonPrefix} is active and below repeat-scan threshold.`;

  if (code.status === 'BLOCKED') {
    result = 'SUSPICIOUS';
    reason = `${reasonPrefix} is blocked.`;
  } else if ((code.scanCount || 0) >= 2) {
    result = 'SUSPICIOUS';
    reason = `${reasonPrefix} has already been scanned multiple times.`;
  }

  await codeDoc.ref.update({
    scanCount: FieldValue.increment(1),
    lastScannedAt: FieldValue.serverTimestamp()
  });
  await logScan(db, codeDoc, code, result, reason, location);

  return {
    result,
    message: resultCopy[result],
    reason,
    code: {
      id: codeDoc.id,
      serialCode: code.serialCode,
      status: code.status,
      scanCountBeforeThisScan: code.scanCount || 0,
      ...codeBatchInfo(code)
    }
  };
}

router.get('/health', (req, res) => {
  res.json({ ok: true });
});

router.post('/verify/:token', async (req, res, next) => {
  try {
    const db = getDb();
    const tokenHash = hashToken(req.params.token);
    const snapshot = await db.collection('codes').where('tokenHash', '==', tokenHash).limit(1).get();
    const codeDoc = snapshot.empty ? null : snapshot.docs[0];
    const response = await verifyCodeSnapshot(codeDoc, 'QR code', req.body.location);
    res.json(response);
  } catch (error) {
    next(error);
  }
});

// Keep GET endpoint for backwards compatibility
router.get('/verify/:token', async (req, res, next) => {
  try {
    const db = getDb();
    const tokenHash = hashToken(req.params.token);
    const snapshot = await db.collection('codes').where('tokenHash', '==', tokenHash).limit(1).get();
    const codeDoc = snapshot.empty ? null : snapshot.docs[0];
    const response = await verifyCodeSnapshot(codeDoc, 'QR code');
    res.json(response);
  } catch (error) {
    next(error);
  }
});

router.post('/verify-serial', async (req, res, next) => {
  try {
    const serialCode = String(req.body.serialCode || '').trim().toUpperCase();

    if (!serialCode) {
      return res.status(400).json({ error: 'serialCode is required.' });
    }

    const db = getDb();
    const snapshot = await db.collection('codes').where('serialCode', '==', serialCode).limit(1).get();
    const codeDoc = snapshot.empty ? null : snapshot.docs[0];
    const response = await verifyCodeSnapshot(codeDoc, 'Serial code', req.body.location);
    res.json(response);
  } catch (error) {
    next(error);
  }
});

router.post('/admin/batches', requireAdmin, async (req, res, next) => {
  try {
    const { productName, batchNumber, manufactureDate, expiryDate, notes } = req.body;

    if (!productName || !batchNumber) {
      return res.status(400).json({ error: 'productName and batchNumber are required.' });
    }

    const db = getDb();
    const docRef = await db.collection('batches').add({
      productName: String(productName).trim(),
      batchNumber: String(batchNumber).trim(),
      manufactureDate: manufactureDate || '',
      expiryDate: expiryDate || '',
      notes: notes || '',
      createdAt: FieldValue.serverTimestamp()
    });

    const created = await docRef.get();
    res.status(201).json(serializeDoc(created));
  } catch (error) {
    next(error);
  }
});

router.get('/admin/batches', requireAdmin, async (req, res, next) => {
  try {
    const db = getDb();
    const snapshot = await db.collection('batches').orderBy('createdAt', 'desc').get();
    res.json(snapshot.docs.map(serializeDoc));
  } catch (error) {
    next(error);
  }
});

router.post('/admin/generate-codes', requireAdmin, async (req, res, next) => {
  try {
    const { batchId, quantity } = req.body;
    const parsedQuantity = Number(quantity);

    if (!batchId || !Number.isInteger(parsedQuantity) || parsedQuantity < 1 || parsedQuantity > 500) {
      return res.status(400).json({ error: 'batchId and quantity between 1 and 500 are required.' });
    }

    const db = getDb();
    const batchDoc = await db.collection('batches').doc(batchId).get();

    if (!batchDoc.exists) {
      return res.status(404).json({ error: 'Batch was not found.' });
    }

    const batch = batchDoc.data();
    const batchWrite = db.batch();
    const generatedCodes = [];

    for (let index = 0; index < parsedQuantity; index += 1) {
      const token = generateToken();
      const codeRef = db.collection('codes').doc();
      const serialCode = generateSerialCode(batch.batchNumber, index + 1);
      const verificationUrl = toVerificationUrl(token);

      batchWrite.set(codeRef, {
        batchId,
        productName: batch.productName,
        batchNumber: batch.batchNumber,
        manufactureDate: batch.manufactureDate || '',
        expiryDate: batch.expiryDate || '',
        serialCode,
        tokenHash: hashToken(token),
        verificationUrl,
        status: 'ACTIVE',
        scanCount: 0,
        createdAt: FieldValue.serverTimestamp(),
        lastScannedAt: null
      });

      generatedCodes.push({
        id: codeRef.id,
        serialCode,
        verificationUrl,
        batchNumber: batch.batchNumber,
        productName: batch.productName,
        status: 'ACTIVE',
        scanCount: 0
      });
    }

    await batchWrite.commit();
    res.status(201).json({ generatedCodes });
  } catch (error) {
    next(error);
  }
});

router.get('/admin/codes', requireAdmin, async (req, res, next) => {
  try {
    const db = getDb();
    const { batchId } = req.query;
    
    if (batchId) {
      const snapshot = await db.collection('codes').where('batchId', '==', batchId).get();
      res.json(snapshot.docs.map(serializeDoc));
    } else {
      const snapshot = await db.collection('codes').orderBy('createdAt', 'desc').limit(500).get();
      res.json(snapshot.docs.map(serializeDoc));
    }
  } catch (error) {
    next(error);
  }
});

router.get('/admin/scan-summary', requireAdmin, async (req, res, next) => {
  try {
    const db = getDb();
    const snapshot = await db.collection('scanLogs').orderBy('createdAt', 'desc').limit(500).get();
    const logs = snapshot.docs.map(serializeDoc);
    const summary = computeScanSummary(logs);
    res.json({ ...summary, logs });
  } catch (error) {
    next(error);
  }
});

router.patch('/admin/codes/:id/block', requireAdmin, async (req, res, next) => {
  try {
    const db = getDb();
    const codeRef = db.collection('codes').doc(req.params.id);
    const codeDoc = await codeRef.get();

    if (!codeDoc.exists) {
      return res.status(404).json({ error: 'Code was not found.' });
    }

    await codeRef.update({ status: 'BLOCKED' });
    const updated = await codeRef.get();
    res.json(serializeDoc(updated));
  } catch (error) {
    next(error);
  }
});

router.get('/admin/scan-logs', requireAdmin, async (req, res, next) => {
  try {
    const db = getDb();
    const snapshot = await db.collection('scanLogs').orderBy('createdAt', 'desc').limit(500).get();
    res.json(snapshot.docs.map(serializeDoc));
  } catch (error) {
    next(error);
  }
});

router.post('/reports', async (req, res, next) => {
  try {
    const { serialCode, userName, userPhone, vendorPhone, vendorAddress, productName, batchNumber } = req.body;
    if (!serialCode || !userName || !userPhone || !vendorPhone || !vendorAddress) {
      return res.status(400).json({ error: 'All fields are required.' });
    }
    const db = getDb();
    await db.collection('reports').add({
      serialCode: String(serialCode).trim().toUpperCase(),
      userName: String(userName).trim(),
      userPhone: String(userPhone).trim(),
      vendorPhone: String(vendorPhone).trim(),
      vendorAddress: String(vendorAddress).trim(),
      productName: productName ? String(productName).trim() : '',
      batchNumber: batchNumber ? String(batchNumber).trim() : '',
      createdAt: FieldValue.serverTimestamp()
    });
    res.status(201).json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.get('/admin/reports', requireAdmin, async (req, res, next) => {
  try {
    const db = getDb();
    const snapshot = await db.collection('reports').orderBy('createdAt', 'desc').limit(500).get();
    res.json(snapshot.docs.map(serializeDoc));
  } catch (error) {
    next(error);
  }
});

router.use((error, req, res, next) => {
  console.error(error);
  let message = error.message || 'Server error.';
  
  // If private key decoding fails, append safe debug info about the environment variable
  if (message.includes('DECODER') || message.includes('unsupported') || message.includes('metadata')) {
    const rawKey = process.env.FIREBASE_PRIVATE_KEY || '';
    message += ` [Debug key: len=${rawKey.length}, starts='${rawKey.substring(0, 30)}', ends='${rawKey.substring(Math.max(0, rawKey.length - 30))}', hasNewlines=${rawKey.includes('\n')}, hasEscapedNewlines=${rawKey.includes('\\n')}]`;
  }
  
  res.status(500).json({ error: message });
});

export default router;
