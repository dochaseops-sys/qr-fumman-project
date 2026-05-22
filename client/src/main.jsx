import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Ban, Download, FlaskConical, KeyRound, MapPin, Plus, QrCode, RefreshCw, Search, ShieldCheck, Lock, Printer } from 'lucide-react';
import { QRCodeCanvas as QRCode } from 'qrcode.react';
import './styles.css';

const API_BASE = '';
const ADMIN_KEY = 'qr_admin_passcode';

function Link({ href, children, ...props }) {
  const handleClick = (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }
    e.preventDefault();
    window.history.pushState(null, '', href);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  return (
    <a href={href} onClick={handleClick} {...props}>
      {children}
    </a>
  );
}

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

async function getUserLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy
        });
      },
      () => {
        resolve(null);
      },
      { timeout: 5000 }
    );
  });
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

function computeScanStats(logs) {
  const stats = { total: 0, genuine: 0, suspicious: 0, invalid: 0, locationCount: 0 };
  const locations = new Set();

  logs.forEach((log) => {
    stats.total += 1;
    const result = String(log.result || '').toUpperCase();
    if (result === 'GENUINE') stats.genuine += 1;
    if (result === 'SUSPICIOUS') stats.suspicious += 1;
    if (result === 'INVALID') stats.invalid += 1;

    const latitude = log.location?.latitude ?? log.location?._latitude ?? log.location?.lat;
    const longitude = log.location?.longitude ?? log.location?._longitude ?? log.location?.lng;

    if (typeof latitude === 'number' && typeof longitude === 'number') {
      locations.add(`${latitude.toFixed(4)}|${longitude.toFixed(4)}`);
    }
  });

  stats.locationCount = locations.size;
  return stats;
}

function normalizeScanLocations(logs) {
  const locationCounts = {};

  logs.forEach((log) => {
    const latitude = log.location?.latitude ?? log.location?._latitude ?? log.location?.lat;
    const longitude = log.location?.longitude ?? log.location?._longitude ?? log.location?.lng;

    if (typeof latitude !== 'number' || typeof longitude !== 'number') return;

    const key = `${latitude.toFixed(4)}|${longitude.toFixed(4)}`;
    locationCounts[key] = (locationCounts[key] || 0) + 1;
  });

  const points = Object.entries(locationCounts).map(([key, count]) => {
    const [latitude, longitude] = key.split('|').map(Number);
    return { latitude, longitude, count };
  });

  if (points.length === 0) return [];

  const minLat = Math.min(...points.map((point) => point.latitude));
  const maxLat = Math.max(...points.map((point) => point.latitude));
  const minLon = Math.min(...points.map((point) => point.longitude));
  const maxLon = Math.max(...points.map((point) => point.longitude));
  const latRange = Math.max(maxLat - minLat, 0.0001);
  const lonRange = Math.max(maxLon - minLon, 0.0001);
  const padding = 24;
  const width = 560;
  const height = 260;

  return points.map((point) => ({
    ...point,
    x: padding + ((point.longitude - minLon) / lonRange) * (width - padding * 2),
    y: padding + ((maxLat - point.latitude) / latRange) * (height - padding * 2),
    radius: Math.min(16, 6 + Math.log(point.count + 1) * 4)
  }));
}

function ScanHeatmap({ logs }) {
  const points = normalizeScanLocations(logs);

  if (points.length === 0) {
    return <div className="heatmap-empty">No location data is available yet. Scan a code from a device with geolocation enabled to populate the heatmap.</div>;
  }

  return (
    <div className="heatmap-card">
      <svg viewBox="0 0 560 260" className="heatmap-chart" aria-label="Scan location heatmap">
        <defs>
          <radialGradient id="heat" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ff7a59" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#ff7a59" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect x="0" y="0" width="560" height="260" fill="#f5f7f9" rx="18" />
        {points.map((point, index) => (
          <circle key={`${point.latitude}-${point.longitude}-${index}`} cx={point.x} cy={point.y} r={point.radius} fill="url(#heat)" />
        ))}
      </svg>
      <div className="heatmap-legend">
        {logs.length} recent scans · {points.length} unique locations
      </div>
    </div>
  );
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
    
    (async () => {
      try {
        const location = await getUserLocation();
        const response = await fetch(`${API_BASE}/api/verify/${token}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ location })
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'Request failed.');
        }
        if (active) setState({ loading: false, result: data, error: '' });
      } catch (error) {
        if (active) setState({ loading: false, result: null, error: error.message });
      }
    })();
    
    return () => {
      active = false;
    };
  }, [token]);

  return (
    <PublicShell>
      {state.loading ? <p className="muted spacious">Checking code...</p> : null}
      {state.error ? <p className="error">{state.error}</p> : null}
      <ResultView result={state.result} />
      <Link className="link-button" href="/verify">Enter serial manually</Link>
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
      const location = await getUserLocation();
      const data = await request('/api/verify-serial', {
        method: 'POST',
        body: JSON.stringify({ serialCode, location })
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

function AdminLogin({ setPasscode }) {
  const [localPasscode, setLocalPasscode] = useState('');
  const [error, setError] = useState('');

  function handleSubmit(event) {
    event.preventDefault();
    if (!localPasscode.trim()) {
      setError('Passcode is required.');
      return;
    }
    localStorage.setItem(ADMIN_KEY, localPasscode.trim());
    setPasscode(localPasscode.trim());
  }

  return (
    <main className="public-shell">
      <section className="verify-panel auth-panel">
        <div className="brand-mark">
          <KeyRound size={30} />
        </div>
        <h1>Admin Portal</h1>
        <p className="muted">Enter authorization passcode to access dashboard</p>
        <form className="stack" onSubmit={handleSubmit}>
          <label>
            Passcode
            <input 
              type="password" 
              value={localPasscode} 
              onChange={(event) => setLocalPasscode(event.target.value)} 
              placeholder="Enter passcode" 
            />
          </label>
          <button type="submit">
            <ShieldCheck size={18} />
            Unlock Dashboard
          </button>
        </form>
        {error ? <p className="error">{error}</p> : null}
        <Link className="link-button" href="/verify">Back to customer verification</Link>
      </section>
    </main>
  );
}

function AdminLayout({ children, passcode, setPasscode, currentPath }) {
  const handleLogout = () => {
    localStorage.removeItem(ADMIN_KEY);
    setPasscode('');
    window.history.pushState(null, '', '/admin');
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  const isLinkActive = (href) => {
    return currentPath === href;
  };

  return (
    <main className="admin-shell">
      <aside className="sidebar">
        <div className="sidebar-title">
          <QrCode size={24} />
          <strong>QR Verify MVP</strong>
        </div>
        <nav>
          <Link href="/admin" className={isLinkActive('/admin') ? 'active' : ''}>Dashboard</Link>
          <Link href="/admin/batches" className={isLinkActive('/admin/batches') ? 'active' : ''}>Batches</Link>
          <Link href="/admin/generate" className={isLinkActive('/admin/generate') ? 'active' : ''}>Generate</Link>
          <Link href="/admin/codes" className={isLinkActive('/admin/codes') ? 'active' : ''}>Codes</Link>
          <Link href="/admin/logs" className={isLinkActive('/admin/logs') ? 'active' : ''}>Scan logs</Link>
        </nav>
        <div className="logout-box">
          <button onClick={handleLogout} className="small danger outline-btn">
            <Lock size={16} />
            Lock Dashboard
          </button>
        </div>
      </aside>
      <section className="admin-content">{children}</section>
    </main>
  );
}

function AdminHome({ passcode }) {
  const [counts, setCounts] = useState({ batches: 0, codes: 0, logs: 0 });
  const [scanLogs, setScanLogs] = useState([]);
  const [scanStats, setScanStats] = useState({ total: 0, genuine: 0, suspicious: 0, invalid: 0, locationCount: 0 });
  const [error, setError] = useState('');

  useEffect(() => {
    if (!passcode) return;
    Promise.all([
      request('/api/admin/batches', { headers: adminHeaders(passcode) }),
      request('/api/admin/codes', { headers: adminHeaders(passcode) }),
      request('/api/admin/scan-summary', { headers: adminHeaders(passcode) })
    ])
      .then(([batches, codes, summary]) => {
        setCounts({ batches: batches.length, codes: codes.length, logs: summary.total });
        setScanLogs(summary.logs || []);
        setScanStats({
          total: summary.total,
          genuine: summary.genuine,
          suspicious: summary.suspicious,
          invalid: summary.invalid,
          locationCount: summary.locationCount
        });
      })
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
        <Metric label="Scan locations" value={scanStats.locationCount} />
      </div>
      <div className="cards overview-cards">
        <Metric label="Genuine scans" value={scanStats.genuine} />
        <Metric label="Suspicious scans" value={scanStats.suspicious} />
        <Metric label="Invalid scans" value={scanStats.invalid} />
      </div>
      <div className="heatmap-section">
        <div className="heatmap-intro">
          <h2>Scan activity overview</h2>
          <p className="muted">This dashboard shows recent scan counts and geolocation distribution from verified devices.</p>
        </div>
        <ScanHeatmap logs={scanLogs} />
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

  async function downloadBatchCsv(batchId) {
    setError('');
    try {
      const data = await request(`/api/admin/codes?batchId=${batchId}`, {
        headers: adminHeaders(passcode)
      });
      if (data.length === 0) {
        alert('No codes have been generated for this batch yet.');
        return;
      }
      downloadCsv(data);
    } catch (err) {
      setError('Failed to download batch CSV: ' + err.message);
    }
  }

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
        columns={['productName', 'batchNumber', 'manufactureDate', 'expiryDate', 'createdAt', 'actions']}
        rows={batches}
        renderCell={(row, column) => {
          if (column === 'createdAt') return formatDateTime(row[column]);
          if (column === 'actions') {
            return (
              <button className="small" type="button" onClick={() => downloadBatchCsv(row.id)}>
                <Download size={14} />
                CSV
              </button>
            );
          }
          return row[column];
        }}
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
  const [showQrCodes, setShowQrCodes] = useState(false);

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
    setShowQrCodes(false);
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
          <button type="button" onClick={() => setShowQrCodes(!showQrCodes)}>
            <QrCode size={18} />
            {showQrCodes ? 'Hide' : 'View'} QR Codes
          </button>
          {showQrCodes ? (
            <button type="button" onClick={() => window.print()}>
              <Printer size={18} />
              Print Labels
            </button>
          ) : null}
        </div>
      ) : null}
      {showQrCodes && generated.length > 0 ? (
        <div className="qr-grid">
          {generated.map((code) => (
            <div key={code.id} className="qr-item">
              <QRCode value={code.verificationUrl} size={256} level="H" includeMargin={true} />
              <p className="qr-serial">{code.serialCode}</p>
            </div>
          ))}
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
        columns={['serialCode', 'batchNumber', 'result', 'reason', 'location', 'createdAt']}
        rows={logs}
        renderCell={(row, column) => {
          if (column === 'result') return <Badge result={row.result} />;
          if (column === 'createdAt') return formatDateTime(row.createdAt);
          if (column === 'location') {
            if (!row.location) return '-';
            const latitude = row.location.latitude ?? row.location._latitude ?? row.location.lat;
            const longitude = row.location.longitude ?? row.location._longitude ?? row.location.lng;
            if (typeof latitude !== 'number' || typeof longitude !== 'number') return '-';
            return (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`}
                target="_blank"
                rel="noopener noreferrer"
                className="location-link"
              >
                <MapPin size={14} />
                {latitude.toFixed(4)}, {longitude.toFixed(4)}
              </a>
            );
          }
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
  const [currentPath, setCurrentPath] = useState(window.location.pathname);
  const [passcode, setPasscode] = useState(localStorage.getItem(ADMIN_KEY) || '');

  useEffect(() => {
    const handlePopState = () => {
      setCurrentPath(window.location.pathname);
    };
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  const page = useMemo(() => {
    if (currentPath.startsWith('/verify/') && currentPath.split('/')[2]) {
      return <TokenVerifyPage token={currentPath.split('/')[2]} />;
    }

    if (currentPath === '/verify') return <ManualVerifyPage />;

    if (currentPath.startsWith('/admin')) {
      if (!passcode) {
        return <AdminLogin setPasscode={setPasscode} />;
      }

      let content = <AdminHome passcode={passcode} />;
      if (currentPath === '/admin/batches') content = <BatchesPage passcode={passcode} />;
      if (currentPath === '/admin/generate') content = <GeneratePage passcode={passcode} />;
      if (currentPath === '/admin/codes') content = <CodesPage passcode={passcode} />;
      if (currentPath === '/admin/logs') content = <LogsPage passcode={passcode} />;

      return (
        <AdminLayout passcode={passcode} setPasscode={setPasscode} currentPath={currentPath}>
          {content}
        </AdminLayout>
      );
    }

    return <ManualVerifyPage />;
  }, [currentPath, passcode]);

  return page;
}

createRoot(document.getElementById('root')).render(<App />);
