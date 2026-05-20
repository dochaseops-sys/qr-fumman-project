import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import router from './routes.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());
app.use('/api', router);

app.listen(port, () => {
  console.log(`QR verification API running on http://localhost:${port}`);
});
