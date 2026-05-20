import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Ban, Download, FlaskConical, KeyRound, Plus, QrCode, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import './styles.css';

const API_BASE = '';
const ADMIN_KEY = 'qr_admin_passcode';

async function request(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || 'Request failed.');
  }

  return data;
}

function adminHeaders(passcode) {
  return { 'x-admin-passcode': passcode };
}

function formatDateTime(value) {
  if (!value) return 'Never';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
}

function downloadCsv(rows) {
  const headers = ['serialCode', 'verificationUrl', 'batchNumber', 'productName'];
  const csv = [
    headers.join(','),
    ...rows.map((row) =>
      headers
        .map((header) => `"${String(row[header] || '').replace(/"/g, '""')}"`)
        .join(',')
    )
  ].join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `verification-codes-${Date.now()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function Badge({ result, children }) {
  return <span className={`badge ${String(result || '').toLowerCase()}`}>{children || result}</span>;
}

function PublicShell({ children }) {
  return (
    <main className="public-shell">
      <section className="verify-panel">
        <div className="brand-mark">
          <ShieldCheck size={30} />
        </div>
        <h1>Company Product Verification</h1>
        <p className="muted">Water Purification Chemical authenticity check</p>
        {children}
      </section>
    </main>
  );
}

function ResultView({ result }) {
  if (!result) return null;

  return (
    <div className="result-box">
      <Badge result={result.result} />
      <p className="result-message">{result.message}</p>
      {result.code ? (
        <dl className="product-details">
          <div>
            <dt>Product</dt>
            <dd>{result.code.productName}</dd>
          </div>
          <div>
            <dt>Batch</dt>
            <dd>{result.code.batchNumber}</dd>
          </div>
          <div>
            <dt>Manufactured</dt>
            <dd>{result.code.manufactureDate || 'Not provided'}</dd>
          </div>
          <div>
            <dt>Expires</dt>
            <dd>{result.code.expiryDate || 'Not provided'}</dd>
          </div>
        </dl>
      ) : null}
      <p className="instruction">
        {result.result === 'GENUINE'
          ? 'Confirm the keg seal is intact before use.'
          : 'Pause use and contact the company for confirmation.'}
      </p>
    </div>
  );
}

function TokenVerifyPage({ token }) {
  const [state, setState] = useState({ loading: true, result: null, error: '' });

  useEffect(() => {
    let active = true;
    setState({ loading: true, result: null, error: '' });
    request(`/api/verify/${token}`)
      .then((result) => active && setState({ loading: false, result, error: '' }))
      .catch((error) => active && setState({ loading: false, result: null, error: error.message }));
    return () => {
      active = false;
    };
  }, [token]);

  return (
    <PublicShell>
      {state.loading ? <p className="muted spacious">Checking code...</p> : null}
      {state.error ? <p className="error">{state.error}</p> : null}
      <ResultView result={state.result} />
      <a className="link-button" href="/verify">Enter serial manually</a>
    </PublicShell>
  );
}

function ManualVerifyPage() {
  const [serialCode, setSerialCode] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const data = await request('/api/verify-serial', {
        method: 'POST',
        body: JSON.stringify({ serialCode })
      });
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <PublicShell>
      <form className="stack" onSubmit={submit}>
        <label>
          Serial code
          <input value={serialCode} onChange={(event) => setSerialCode(event.target.value)} placeholder="WPC001-00001-ABC123" />
        </label>
        <button type="submit" disabled={loading}>
          <Search size={18} />
          {loading ? 'Checking' : 'Verify serial'}
        </button>
      </form>
      {error ? <p className="error">{error}</p> : null}
      <ResultView result={result} />
    </PublicShell>
  );
}

function AdminLayout({ children, passcode, setPasscode }) {
  const [draft, setDraft] = useState(passcode);

  function savePasscode(event) {
    event.preventDefault();
    localStorage.setItem(ADMIN_KEY, draft);
    setPasscode(draft);
  }

  return (
    <main className="admin-shell">
      <aside className="sidebar">
        <div className="sidebar-title">
          <QrCode size={24} />
          <strong>QR Verify MVP</strong>
        </div>
        <nav>
          <a href="/admin">Dashboard</a>
          <a href="/admin/batches">Batches</a>
          <a href="/admin/generate">Generate</a>
          <a href="/admin/codes">Codes</a>
          <a href="/admin/logs">Scan logs</a>
        </nav>
        <form className="passcode-form" onSubmit={savePasscode}>
          <label>
            Admin passcode
            <input type="password" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="ADMIN_PASSCODE" />
          </label>
          <button type="submit">
            <KeyRound size={16} />
            Save
          </button>
        </form>
      </aside>
      <section className="admin-content">{children}</section>
    </main>
  );
}

function AdminHome({ passcode }) {
  const [counts, setCounts] = useState({ batches: 0, codes: 0, logs: 0 });
  const [error, setError] = useState('');

  useEffect(() => {
    if (!passcode) return;
    Promise.all([
      request('/api/admin/batches', { headers: adminHeaders(passcode) }),
      request('/api/admin/codes', { headers: adminHeaders(passcode) }),
      request('/api/admin/scan-logs', { headers: adminHeaders(passcode) })
    ])
      .then(([batches, codes, logs]) => setCounts({ batches: batches.length, codes: codes.length, logs: logs.length }))
      .catch((err) => setError(err.message));
  }, [passcode]);

  return (
    <>
      <Header title="Admin dashboard" subtitle="Create batches, generate labels, and review verification activity." />
      {error ? <p className="error">{error}</p> : null}
      <div className="cards">
        <Metric label="Batches" value={counts.batches} />
        <Metric label="Codes" value={counts.codes} />
        <Metric label="Scan logs" value={counts.logs} />
      </div>
      <div className="demo-flow">
        <h2>Demo flow</h2>
        <p>Create batch Water Purification Chemical / WPC-001, generate 10 codes, download the CSV, then open a verification URL.</p>
      </div>
    </>
  );
}

function Header({ title, subtitle }) {
  return (
    <header className="page-header">
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </header>
  );
}

function Metric({ label, value }) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function BatchesPage({ passcode }) {
  const [form, setForm] = useState({
    productName: 'Water Purification Chemical',
    batchNumber: 'WPC-001',
    manufactureDate: '',
    expiryDate: '',
    notes: ''
  });
  const [batches, setBatches] = useState([]);
  const [error, setError] = useState('');

  const load = () =>
    request('/api/admin/batches', { headers: adminHeaders(passcode) })
      .then(setBatches)
      .catch((err) => setError(err.message));

  useEffect(() => {
    if (passcode) load();
  }, [passcode]);

  async function submit(event) {
    event.preventDefault();
    setError('');
    try {
      await request('/api/admin/batches', {
        method: 'POST',
        headers: adminHeaders(passcode),
        body: JSON.stringify(form)
      });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <>
      <Header title="Batches" subtitle="Create and list product manufacturing batches." />
      {error ? <p className="error">{error}</p> : null}
      <form className="form-grid" onSubmit={submit}>
        <label>
          Product name
          <input value={form.productName} onChange={(event) => setForm({ ...form, productName: event.target.value })} />
        </label>
        <label>
          Batch number
          <input value={form.batchNumber} onChange={(event) => setForm({ ...form, batchNumber: event.target.value })} />
        </label>
        <label>
          Manufacture date
          <input type="date" value={form.manufactureDate} onChange={(event) => setForm({ ...form, manufactureDate: event.target.value })} />
        </label>
        <label>
          Expiry date
          <input type="date" value={form.expiryDate} onChange={(event) => setForm({ ...form, expiryDate: event.target.value })} />
        </label>
        <label className="wide">
          Notes
          <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
        </label>
        <button type="submit">
          <Plus size={18} />
          Create batch
        </button>
      </form>
      <DataTable
        columns={['productName', 'batchNumber', 'manufactureDate', 'expiryDate', 'createdAt']}
        rows={batches}
        renderCell={(row, column) => (column === 'createdAt' ? formatDateTime(row[column]) : row[column])}
      />
    </>
  );
}

function GeneratePage({ passcode }) {
  const [batches, setBatches] = useState([]);
  const [batchId, setBatchId] = useState('');
  const [quantity, setQuantity] = useState(10);
  const [generated, setGenerated] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!passcode) return;
    request('/api/admin/batches', { headers: adminHeaders(passcode) })
      .then((data) => {
        setBatches(data);
        setBatchId(data[0]?.id || '');
      })
      .catch((err) => setError(err.message));
  }, [passcode]);

  async function submit(event) {
    event.preventDefault();
    setError('');
    setGenerated([]);
    try {
      const data = await request('/api/admin/generate-codes', {
        method: 'POST',
        headers: adminHeaders(passcode),
        body: JSON.stringify({ batchId, quantity })
      });
      setGenerated(data.generatedCodes);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <>
      <Header title="Generate codes" subtitle="Create unique serials and QR verification URLs for a batch." />
      {error ? <p className="error">{error}</p> : null}
      <form className="inline-form" onSubmit={submit}>
        <label>
          Batch
          <select value={batchId} onChange={(event) => setBatchId(event.target.value)}>
            {batches.map((batch) => (
              <option key={batch.id} value={batch.id}>
                {batch.batchNumber} - {batch.productName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Number of codes
          <input type="number" min="1" max="500" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
        </label>
        <button type="submit">
          <FlaskConical size={18} />
          Generate
        </button>
      </form>
      {generated.length > 0 ? (
        <div className="table-actions">
          <button type="button" onClick={() => downloadCsv(generated)}>
            <Download size={18} />
            Download CSV
          </button>
        </div>
      ) : null}
      <DataTable columns={['serialCode', 'verificationUrl', 'batchNumber', 'productName']} rows={generated} />
    </>
  );
}

function CodesPage({ passcode }) {
  const [codes, setCodes] = useState([]);
  const [error, setError] = useState('');

  const load = () =>
    request('/api/admin/codes', { headers: adminHeaders(passcode) })
      .then(setCodes)
      .catch((err) => setError(err.message));

  useEffect(() => {
    if (passcode) load();
  }, [passcode]);

  async function blockCode(id) {
    setError('');
    try {
      await request(`/api/admin/codes/${id}/block`, {
        method: 'PATCH',
        headers: adminHeaders(passcode)
      });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <>
      <Header title="Codes" subtitle="Review generated labels and manually block suspicious codes." />
      <div className="table-actions">
        <button type="button" onClick={load}>
          <RefreshCw size={18} />
          Refresh
        </button>
      </div>
      {error ? <p className="error">{error}</p> : null}
      <DataTable
        columns={['serialCode', 'batchNumber', 'status', 'scanCount', 'lastScannedAt', 'actions']}
        rows={codes}
        renderCell={(row, column) => {
          if (column === 'status') return <Badge result={row.status === 'BLOCKED' ? 'SUSPICIOUS' : 'GENUINE'}>{row.status}</Badge>;
          if (column === 'lastScannedAt') return formatDateTime(row.lastScannedAt);
          if (column === 'actions') {
            return (
              <button className="small danger" type="button" onClick={() => blockCode(row.id)} disabled={row.status === 'BLOCKED'}>
                <Ban size={16} />
                Block
              </button>
            );
          }
          return row[column];
        }}
      />
    </>
  );
}

function LogsPage({ passcode }) {
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState('');

  const load = () =>
    request('/api/admin/scan-logs', { headers: adminHeaders(passcode) })
      .then(setLogs)
      .catch((err) => setError(err.message));

  useEffect(() => {
    if (passcode) load();
  }, [passcode]);

  return (
    <>
      <Header title="Scan logs" subtitle="See each customer verification attempt." />
      <div className="table-actions">
        <button type="button" onClick={load}>
          <RefreshCw size={18} />
          Refresh
        </button>
      </div>
      {error ? <p className="error">{error}</p> : null}
      <DataTable
        columns={['serialCode', 'batchNumber', 'result', 'reason', 'createdAt']}
        rows={logs}
        renderCell={(row, column) => {
          if (column === 'result') return <Badge result={row.result} />;
          if (column === 'createdAt') return formatDateTime(row.createdAt);
          return row[column] || '-';
        }}
      />
    </>
  );
}

function DataTable({ columns, rows, renderCell }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column.replace(/([A-Z])/g, ' $1')}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="empty-cell">
                No records yet.
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.id || row.serialCode}>
                {columns.map((column) => (
                  <td key={column}>{renderCell ? renderCell(row, column) : row[column]}</td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function App() {
  const [passcode, setPasscode] = useState(localStorage.getItem(ADMIN_KEY) || '');
  const path = window.location.pathname;

  const page = useMemo(() => {
    if (path.startsWith('/verify/') && path.split('/')[2]) {
      return <TokenVerifyPage token={path.split('/')[2]} />;
    }

    if (path === '/verify') return <ManualVerifyPage />;

    if (path.startsWith('/admin')) {
      let content = <AdminHome passcode={passcode} />;
      if (path === '/admin/batches') content = <BatchesPage passcode={passcode} />;
      if (path === '/admin/generate') content = <GeneratePage passcode={passcode} />;
      if (path === '/admin/codes') content = <CodesPage passcode={passcode} />;
      if (path === '/admin/logs') content = <LogsPage passcode={passcode} />;

      return (
        <AdminLayout passcode={passcode} setPasscode={setPasscode}>
          {!passcode ? <p className="notice">Enter the admin passcode saved in ADMIN_PASSCODE to use the dashboard.</p> : content}
        </AdminLayout>
      );
    }

    return <ManualVerifyPage />;
  }, [path, passcode]);

  return page;
}

createRoot(document.getElementById('root')).render(<App />);
