# QR / Serial Verification MVP

This is a true MVP for verifying plastic kegs of water purification chemical by QR URL or manual serial code.

## What It Does

- Admin creates product batches in Firestore.
- Admin generates unique serial codes and QR verification URLs.
- Admin downloads a CSV with `serialCode`, `verificationUrl`, `batchNumber`, and `productName`.
- Customers verify by opening `/verify/{token}` or entering a serial at `/verify`.
- The backend returns `GENUINE`, `INVALID`, or `SUSPICIOUS`.
- Every scan is logged.
- Admin can view batches, codes, scan history, and block a code.

## Project Structure

```text
server/   Express API and Firebase Admin SDK
client/   React + Vite frontend
```

## Firebase Setup

1. Create a Firebase project.
2. Create a Firestore database.
3. Create a service account key:
   - Firebase Console
   - Project settings
   - Service accounts
   - Generate new private key
4. Copy the project ID, client email, and private key into `server/.env`.

The app uses these Firestore collections:

- `batches`
- `codes`
- `scanLogs`

Tokens are stored as `tokenHash` for the MVP. Verification URLs still contain the raw one-time token path needed for QR labels.

## Environment Variables

Create `server/.env`:

```bash
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project-id.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
PUBLIC_VERIFY_BASE_URL=http://localhost:5173
ADMIN_PASSCODE=demo123
PORT=4000
```

`PUBLIC_VERIFY_BASE_URL` should be changed to the deployed frontend URL when sharing real QR labels.

## Install

```bash
npm run install:all
```

Or install each app separately:

```bash
npm install
npm --prefix server install
npm --prefix client install
```

## Run Backend

```bash
npm run dev:server
```

Backend URL:

```text
http://localhost:4000
```

## Run Frontend

```bash
npm run dev:client
```

Frontend URL:

```text
http://localhost:5173
```

You can also run both with:

```bash
npm run dev
```

## Admin Usage

1. Open `http://localhost:5173/admin`.
2. Enter the same passcode as `ADMIN_PASSCODE`.
3. Go to `Batches`.
4. Create a batch:
   - Product: `Water Purification Chemical`
   - Batch: `WPC-001`
5. Go to `Generate`.
6. Select the batch and generate `10` codes.
7. Click `Download CSV`.

## Test Verification Flow

1. Open one `verificationUrl` from the CSV.
2. The first scan should show `GENUINE`.
3. Refresh the verification URL until the scan count reaches the repeat-scan threshold.
4. The result changes to `SUSPICIOUS`.
5. Go to `Admin > Codes`.
6. Block another code manually.
7. Open that blocked code verification URL. It should show `SUSPICIOUS`.
8. Open a random invalid URL such as:

```text
http://localhost:5173/verify/not-a-real-token
```

It should show `INVALID` and no batch information.

## API Endpoints

Public:

- `GET /api/verify/:token`
- `POST /api/verify-serial`

Admin, protected by `x-admin-passcode`:

- `POST /api/admin/batches`
- `GET /api/admin/batches`
- `POST /api/admin/generate-codes`
- `GET /api/admin/codes`
- `PATCH /api/admin/codes/:id/block`
- `GET /api/admin/scan-logs`
