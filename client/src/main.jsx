import React, { useEffect, useMemo, useState, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { 
  Ban, Download, Plus, QrCode, RefreshCw, Search, ShieldCheck, 
  Lock, Printer, BarChart3, Database, FileText, ChevronRight,
  TrendingUp, Activity, MapPin, Globe, AlertTriangle, LogOut, CheckCircle2,
  Calendar, Layers, Cpu, Compass
} from 'lucide-react';
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
  const height = 240;

  return points.map((point) => ({
    ...point,
    x: padding + ((point.longitude - minLon) / lonRange) * (width - padding * 2),
    y: padding + ((maxLat - point.latitude) / latRange) * (height - padding * 2),
    radius: Math.min(16, 6 + Math.log(point.count + 1) * 4)
  }));
}

function ScanHeatmap({ logs }) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);

  const points = useMemo(() => {
    const list = [];
    logs.forEach((log) => {
      const lat = log.location?.latitude ?? log.location?._latitude ?? log.location?.lat;
      const lng = log.location?.longitude ?? log.location?._longitude ?? log.location?.lng;
      if (typeof lat === 'number' && typeof lng === 'number') {
        list.push({ lat, lng, serial: log.serialCode, result: log.result, time: log.createdAt });
      }
    });
    return list;
  }, [logs]);

  useEffect(() => {
    if (points.length === 0) return;
    if (!mapContainerRef.current) return;
    if (!window.L) {
      console.error('Leaflet is not loaded.');
      return;
    }

    const defaultCenter = points.length > 0 ? [points[0].lat, points[0].lng] : [54.5, -2.0];
    const defaultZoom = points.length > 0 ? 6 : 5;

    const map = window.L.map(mapContainerRef.current, {
      center: defaultCenter,
      zoom: defaultZoom,
      zoomControl: true
    });

    window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap'
    }).addTo(map);

    mapInstanceRef.current = map;

    points.forEach((pt) => {
      let markerColor = '#10b981'; // Genuine
      if (pt.result === 'SUSPICIOUS') markerColor = '#f59e0b';
      if (pt.result === 'INVALID') markerColor = '#ef4444';

      const markerHtml = `
        <div style="
          background-color: ${markerColor};
          width: 14px;
          height: 14px;
          border-radius: 50%;
          border: 2px solid white;
          box-shadow: 0 0 4px rgba(0,0,0,0.4);
        "></div>
      `;

      const customIcon = window.L.divIcon({
        html: markerHtml,
        className: 'custom-map-marker',
        iconSize: [14, 14],
        iconAnchor: [7, 7]
      });

      const marker = window.L.marker([pt.lat, pt.lng], { icon: customIcon }).addTo(map);
      marker.bindPopup(`
        <div style="font-family: 'Plus Jakarta Sans', sans-serif; font-size: 0.8rem; line-height: 1.4;">
          <strong style="display: block; font-size: 0.85rem; margin-bottom: 4px;">Code: ${pt.serial}</strong>
          <span style="display: inline-block; padding: 2px 6px; border-radius: 99px; font-size: 0.7rem; font-weight: 700; color: white; background-color: ${markerColor}; text-transform: uppercase;">
            ${pt.result}
          </span>
          <div style="color: #64748b; margin-top: 6px; font-size: 0.75rem;">
            ${formatDateTime(pt.time)}
          </div>
        </div>
      `);
    });

    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize();
    });
    resizeObserver.observe(mapContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapInstanceRef.current = null;
    };
  }, [points]);

  if (points.length === 0) {
    return <div className="heatmap-empty">No scan logs with location coordinates are available for this period.</div>;
  }

  return (
    <div className="heatmap-card" style={{ padding: '12px' }}>
      <div 
        ref={mapContainerRef} 
        className="leaflet-map-container"
        style={{ height: '260px', width: '100%', borderRadius: '10px', zIndex: 1 }}
      />
      <div className="heatmap-legend" style={{ marginTop: '10px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
        Showing {points.length} verification events on the live map
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
        <h1>Product Authenticity Check</h1>
        <p className="muted">Verify your Water Purification Chemical authenticity</p>
        {children}
      </section>
    </main>
  );
}

function ResultView({ result }) {
  if (!result) return null;

  const isGenuine = result.result === 'GENUINE';
  const isSuspicious = result.result === 'SUSPICIOUS';

  return (
    <div className="result-box">
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
        {isGenuine ? (
          <CheckCircle2 size={54} color="var(--success)" />
        ) : (
          <AlertTriangle size={54} color={isSuspicious ? 'var(--warning)' : 'var(--danger)'} />
        )}
      </div>
      <Badge result={result.result} />
      <p className="result-message">{result.message}</p>
      
      {result.code ? (
        <dl className="product-details">
          <div>
            <dt>Product Name</dt>
            <dd>{result.code.productName}</dd>
          </div>
          <div>
            <dt>Batch Number</dt>
            <dd>{result.code.batchNumber}</dd>
          </div>
          <div>
            <dt>Manufactured</dt>
            <dd>{result.code.manufactureDate ? formatDateTime(result.code.manufactureDate) : 'Not provided'}</dd>
          </div>
          <div>
            <dt>Expires</dt>
            <dd>{result.code.expiryDate ? formatDateTime(result.code.expiryDate) : 'Not provided'}</dd>
          </div>
        </dl>
      ) : null}
      
      <p className="instruction">
        {isGenuine
          ? 'Confirm the batch seal is fully intact and has not been tampered with before usage.'
          : 'Do not use this product. Report this scan to your distributor or contact customer support.'}
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
      {state.loading ? <p className="muted spacious">Checking verification token...</p> : null}
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
          Serial Code
          <input 
            value={serialCode} 
            onChange={(event) => setSerialCode(event.target.value)} 
            placeholder="WPC001-00001-ABC123" 
          />
        </label>
        <button type="submit" disabled={loading}>
          <Search size={18} />
          {loading ? 'Verifying...' : 'Verify Product'}
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
        <p className="muted">Authorize with passcode to manage verification dashboard</p>
        <form className="stack" onSubmit={handleSubmit}>
          <label>
            Dashboard Passcode
            <input 
              type="password" 
              value={localPasscode} 
              onChange={(event) => setLocalPasscode(event.target.value)} 
              placeholder="Enter admin passcode" 
            />
          </label>
          <button type="submit">
            <Lock size={18} />
            Unlock Console
          </button>
        </form>
        {error ? <p className="error">{error}</p> : null}
        <Link className="link-button" href="/verify">Return to manual verification</Link>
      </section>
    </main>
  );
}

function AdminLayout({ children, passcode, setPasscode, currentPath }) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  const handleLogout = () => {
    localStorage.removeItem(ADMIN_KEY);
    setPasscode('');
    window.history.pushState(null, '', '/admin');
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  const isLinkActive = (href) => {
    return currentPath === href;
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const clickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', clickOutside);
    return () => document.removeEventListener('mousedown', clickOutside);
  }, []);

  return (
    <main className="admin-shell">
      {/* Top Header Navigation */}
      <header className="admin-navbar">
        <div className="navbar-left">
          <div className="navbar-brand">
            <ShieldCheck size={22} />
            <span>Fumman Control</span>
          </div>
          <nav className="navbar-nav">
            <Link href="/admin" className={`navbar-link ${isLinkActive('/admin') ? 'active' : ''}`}>
              Dashboard
            </Link>
            <Link href="/admin/batches" className={`navbar-link ${isLinkActive('/admin/batches') ? 'active' : ''}`}>
              Batches
            </Link>
            <Link href="/admin/generate" className={`navbar-link ${isLinkActive('/admin/generate') ? 'active' : ''}`}>
              Generate
            </Link>
            <Link href="/admin/codes" className={`navbar-link ${isLinkActive('/admin/codes') ? 'active' : ''}`}>
              Codes
            </Link>
            <Link href="/admin/logs" className={`navbar-link ${isLinkActive('/admin/logs') ? 'active' : ''}`}>
              Scan Logs
            </Link>
          </nav>
        </div>
        
        <div className="navbar-right">
          <div className="navbar-search">
            <Search size={14} />
            <input type="text" placeholder="Quick search..." />
          </div>
          
          <div className="navbar-user-dropdown" ref={dropdownRef}>
            <button className="avatar-button" onClick={() => setDropdownOpen(!dropdownOpen)}>
              AD
            </button>
            
            {dropdownOpen && (
              <div className="dropdown-menu">
                <div className="dropdown-header">
                  <p>Administrator</p>
                  <span>admin@fumman.com</span>
                </div>
                <button className="dropdown-item" onClick={() => { setDropdownOpen(false); window.location.reload(); }}>
                  <RefreshCw size={14} />
                  Refresh Server
                </button>
                <button className="dropdown-item danger" onClick={handleLogout}>
                  <LogOut size={14} />
                  Lock Dashboard
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Environment Status bar */}
      <div className="env-status-bar">
        <div className="status-left">
          <span className="status-indicator"></span>
        </div>
        <div className="status-right">
          <Link href="/verify" className="status-btn">
            View Public Site
          </Link>
        </div>
      </div>

      <section className="admin-content">{children}</section>
    </main>
  );
}

// Custom SVG Line Chart
function ScanTrendChart({ filteredLogs }) {
  const chartData = useMemo(() => {
    const dates = [];
    const counts = [];
    const uniqueSerials = [];
    
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      dates.push(d);
      
      const dayLogs = filteredLogs.filter(log => {
        const logDate = new Date(log.createdAt).toISOString().split('T')[0];
        return logDate === dateStr;
      });
      
      counts.push(dayLogs.length);
      
      const serials = new Set(dayLogs.map(l => l.serialCode).filter(Boolean));
      uniqueSerials.push(serials.size);
    }
    
    return { dates, counts, uniqueSerials };
  }, [filteredLogs]);

  const maxVal = Math.max(...chartData.counts, ...chartData.uniqueSerials, 5);
  
  const width = 440;
  const height = 240;
  const paddingLeft = 32;
  const paddingRight = 10;
  const paddingTop = 10;
  const paddingBottom = 25;
  
  const chartW = width - paddingLeft - paddingRight;
  const chartH = height - paddingTop - paddingBottom;
  
  const points = chartData.counts.map((val, i) => {
    const x = paddingLeft + (i / 6) * chartW;
    const y = paddingTop + chartH - (val / maxVal) * chartH;
    return { x, y };
  });

  const uniquePoints = chartData.uniqueSerials.map((val, i) => {
    const x = paddingLeft + (i / 6) * chartW;
    const y = paddingTop + chartH - (val / maxVal) * chartH;
    return { x, y };
  });
  
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaPath = points.length > 0 
    ? `${linePath} L ${points[points.length-1].x} ${paddingTop + chartH} L ${points[0].x} ${paddingTop + chartH} Z`
    : '';

  const uniqueLinePath = uniquePoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  const formatDay = (dateObj) => {
    return dateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  return (
    <div className="chart-container-inner">
      <svg viewBox={`0 0 ${width} ${height}`} className="svg-line-chart">
        <defs>
          <linearGradient id="blue-gradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.25"/>
            <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.0"/>
          </linearGradient>
        </defs>
        
        {/* Horizontal grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((r, idx) => {
          const y = paddingTop + chartH * r;
          const valLabel = Math.round(maxVal * (1 - r));
          return (
            <g key={idx} className="svg-chart-grid">
              <line x1={paddingLeft} y1={y} x2={width - paddingRight} y2={y} />
              <text x={paddingLeft - 8} y={y + 3} textAnchor="end" className="svg-chart-axis-label">
                {valLabel}
              </text>
            </g>
          );
        })}
        
        {/* Shaded Area */}
        {areaPath && <path d={areaPath} className="svg-area-primary" />}
        
        {/* Scan count line */}
        {linePath && <path d={linePath} className="svg-line-primary" />}
        
        {/* Unique serials line */}
        {uniqueLinePath && (
          <path 
            d={uniqueLinePath} 
            fill="none" 
            stroke="var(--success)" 
            strokeWidth="2" 
            strokeDasharray="4 3" 
            strokeLinecap="round"
          />
        )}
        
        {/* Scan points */}
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="3.5" className="svg-line-point" />
        ))}
        
        {/* X Axis Labels */}
        {chartData.dates.map((d, i) => {
          const x = paddingLeft + (i / 6) * chartW;
          return (
            <text 
              key={i} 
              x={x} 
              y={height - 2} 
              textAnchor="middle" 
              className="svg-chart-axis-label"
              style={{ fontSize: '8px' }}
            >
              {formatDay(d)}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

// Custom SVG Doughnut Chart
function ScanResultDoughnut({ genuine, suspicious, invalid }) {
  const total = genuine + suspicious + invalid;
  const gPct = total > 0 ? (genuine / total) * 100 : 0;
  const sPct = total > 0 ? (suspicious / total) * 100 : 0;
  const iPct = total > 0 ? (invalid / total) * 100 : 0;
  
  const r = 36;
  const C = 2 * Math.PI * r; 
  
  const gStroke = (gPct / 100) * C;
  const sStroke = (sPct / 100) * C;
  const iStroke = (iPct / 100) * C;
  
  const gOffset = 0;
  const sOffset = -gStroke;
  const iOffset = -(gStroke + sStroke);

  return (
    <div className="doughnut-layout">
      <div className="doughnut-chart-svg-wrap">
        <svg viewBox="0 0 100 100" width="180" height="180">
          {total === 0 ? (
            <circle
              cx="50"
              cy="50"
              r={r}
              fill="transparent"
              stroke="#e2e8f0"
              strokeWidth="9"
            />
          ) : (
            <>
              {genuine > 0 && (
                <circle
                  cx="50"
                  cy="50"
                  r={r}
                  fill="transparent"
                  stroke="var(--success)"
                  strokeWidth="9"
                  strokeDasharray={`${gStroke} ${C}`}
                  strokeDashoffset={gOffset}
                  strokeLinecap={gPct === 100 ? 'butt' : 'round'}
                />
              )}
              {suspicious > 0 && (
                <circle
                  cx="50"
                  cy="50"
                  r={r}
                  fill="transparent"
                  stroke="var(--warning)"
                  strokeWidth="9"
                  strokeDasharray={`${sStroke} ${C}`}
                  strokeDashoffset={sOffset}
                  strokeLinecap={sPct === 100 ? 'butt' : 'round'}
                />
              )}
              {invalid > 0 && (
                <circle
                  cx="50"
                  cy="50"
                  r={r}
                  fill="transparent"
                  stroke="var(--danger)"
                  strokeWidth="9"
                  strokeDasharray={`${iStroke} ${C}`}
                  strokeDashoffset={iOffset}
                  strokeLinecap={iPct === 100 ? 'butt' : 'round'}
                />
              )}
            </>
          )}
        </svg>
        <div className="doughnut-center-label">
          <span>Scans</span>
          <strong>{total}</strong>
        </div>
      </div>
      <div className="doughnut-legend">
        <div className="legend-item">
          <div className="legend-left">
            <span className="legend-dot genuine" />
            <span>Genuine</span>
          </div>
          <div className="legend-right">
            <span className="legend-percent">{gPct.toFixed(0)}%</span>
            <span className="legend-count">{genuine} logs</span>
          </div>
        </div>
        <div className="legend-item">
          <div className="legend-left">
            <span className="legend-dot suspicious" />
            <span>Suspicious</span>
          </div>
          <div className="legend-right">
            <span className="legend-percent">{sPct.toFixed(0)}%</span>
            <span className="legend-count">{suspicious} logs</span>
          </div>
        </div>
        <div className="legend-item">
          <div className="legend-left">
            <span className="legend-dot invalid" />
            <span>Invalid</span>
          </div>
          <div className="legend-right">
            <span className="legend-percent">{iPct.toFixed(0)}%</span>
            <span className="legend-count">{invalid} logs</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// Progress list for top locations
function TopLocationsList({ locations }) {
  const totalCount = useMemo(() => {
    return locations.reduce((sum, item) => sum + item.count, 0);
  }, [locations]);

  if (!locations || locations.length === 0) {
    return <div className="heatmap-empty">No scan logs with location data are available for the selected period.</div>;
  }

  return (
    <div className="locations-grid">
      <div className="top-location-highlight-card">
        <span className="label">Primary Target</span>
        <div className="top-location-flag-badge">
          <Globe size={28} />
        </div>
        <h4>{locations[0]?.name || 'No geolocation logs'}</h4>
        <div className="percentage-pill">
          {locations[0] && totalCount > 0 ? ((locations[0].count / totalCount) * 100).toFixed(0) : 0}% scans
        </div>
      </div>
      <div className="locations-progress-list">
        {locations.slice(0, 5).map((loc, idx) => {
          const percent = totalCount > 0 ? (loc.count / totalCount) * 100 : 0;
          return (
            <div key={idx} className="progress-list-item">
              <div className="progress-label-row">
                <div>
                  <span className="loc-rank">{idx + 1}</span>
                  <span>{loc.name}</span>
                </div>
                <span className="progress-percentage">{percent.toFixed(0)}%</span>
              </div>
              <div className="progress-bar-bg">
                <div 
                  className="progress-bar-fill" 
                  style={{ width: `${percent}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RecentScansMiniTable({ logs, onInspect }) {
  if (logs.length === 0) {
    return <div className="heatmap-empty">No scan logs available.</div>;
  }
  return (
    <div className="table-wrap" style={{ border: '0', boxShadow: 'none' }}>
      <table style={{ minWidth: 'auto' }}>
        <thead>
          <tr>
            <th>Serial Code</th>
            <th>Batch</th>
            <th>Result</th>
            <th>Scan Date</th>
            <th>Inspector</th>
          </tr>
        </thead>
        <tbody>
          {logs.slice(0, 5).map((log, idx) => (
            <tr key={log.id || idx}>
              <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>{log.serialCode}</td>
              <td>{log.batchNumber}</td>
              <td><Badge result={log.result} /></td>
              <td>{formatDateTime(log.createdAt)}</td>
              <td>
                <button 
                  className="small outline-btn" 
                  onClick={() => onInspect(log.serialCode)}
                  style={{ minHeight: '28px', padding: '0 8px', fontSize: '0.78rem' }}
                >
                  Inspect
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const getFriendlyLocation = (lat, lng) => {
  const coordsMap = {
    '51.51|-0.13': 'London, UK',
    '53.48|-2.24': 'Manchester, UK',
    '53.41|-2.99': 'Liverpool, UK',
    '51.75|-1.26': 'Oxford, UK',
    '54.98|-1.61': 'Newcastle, UK'
  };
  
  const match = coordsMap[`${lat.toFixed(2)}|${lng.toFixed(2)}`] || coordsMap[`${lat.toFixed(1)}|${lng.toFixed(1)}`];
  if (match) return match;
  
  return `${lat.toFixed(3)}°N, ${lng.toFixed(3)}°E`;
};

const geocodeCache = {};

function useGeocodedLocations(logs) {
  const [resolvedLocations, setResolvedLocations] = useState({});

  useEffect(() => {
    if (!logs || logs.length === 0) return;
    
    const uniqueCoords = [];
    logs.forEach(log => {
      const lat = log.location?.latitude ?? log.location?._latitude ?? log.location?.lat;
      const lng = log.location?.longitude ?? log.location?._longitude ?? log.location?.lng;
      if (typeof lat === 'number' && typeof lng === 'number') {
        const key = `${lat.toFixed(4)}|${lng.toFixed(4)}`;
        if (!uniqueCoords.some(c => c.key === key)) {
          uniqueCoords.push({ key, lat, lng });
        }
      }
    });

    let delay = 0;
    uniqueCoords.forEach(coord => {
      if (resolvedLocations[coord.key]) return;
      if (geocodeCache[coord.key]) {
        setResolvedLocations(prev => ({ ...prev, [coord.key]: geocodeCache[coord.key] }));
        return;
      }

      setTimeout(async () => {
        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${coord.lat}&lon=${coord.lng}&format=json`, {
            headers: { 'User-Agent': 'FummanQRVerifyDemo/1.0' }
          });
          if (!res.ok) throw new Error();
          const data = await res.json();
          const addr = data.address || {};
          
          const street = addr.road || addr.pedestrian || addr.suburb || addr.neighbourhood || '';
          const city = addr.city || addr.town || addr.village || addr.county || '';
          const country = addr.country || '';
          
          let resolved = '';
          if (street && city) resolved = `${street}, ${city}`;
          else if (city && country) resolved = `${city}, ${country}`;
          else resolved = data.display_name ? data.display_name.split(',').slice(0, 2).join(',') : `${coord.lat.toFixed(3)}, ${coord.lng.toFixed(3)}`;

          geocodeCache[coord.key] = resolved.trim();
          setResolvedLocations(prev => ({ ...prev, [coord.key]: resolved.trim() }));
        } catch (err) {
          // ignore errors and keep showing coordinates as fallback
        }
      }, delay);
      
      delay += 1000; // 1s spacing to respect rate-limiting rules politely
    });
  }, [logs]);

  return resolvedLocations;
}

// Admin Dashboard page
function AdminHome({ passcode, selectedCode, setSelectedCode }) {
  const [counts, setCounts] = useState({ batches: 0, codes: 0, logs: 0 });
  const [scanLogs, setScanLogs] = useState([]);
  const [allCodes, setAllCodes] = useState([]);
  const [scanStats, setScanStats] = useState({ total: 0, genuine: 0, suspicious: 0, invalid: 0, locationCount: 0 });
  const [error, setError] = useState('');
  
  const [dateFilter, setDateFilter] = useState('Month'); // Today, Yesterday, Month, All
  const [bottomTab, setBottomTab] = useState('locations'); // locations, heatmap, recent

  const resolvedLocations = useGeocodedLocations(scanLogs);

  const loadData = () => {
    if (!passcode) return;
    Promise.all([
      request('/api/admin/batches', { headers: adminHeaders(passcode) }),
      request('/api/admin/codes', { headers: adminHeaders(passcode) }),
      request('/api/admin/scan-summary', { headers: adminHeaders(passcode) })
    ])
      .then(([batches, codes, summary]) => {
        setCounts({ batches: batches.length, codes: codes.length, logs: summary.total });
        setAllCodes(codes);
        setScanLogs(summary.logs || []);
        setScanStats(summary);
      })
      .catch((err) => setError(err.message));
  };

  useEffect(() => {
    loadData();
  }, [passcode]);

  // Handle selected code binding
  useEffect(() => {
    if (selectedCode) return;
    
    // Default to the code from the most recent scan log
    if (scanLogs.length > 0 && scanLogs[0].serialCode) {
      const match = allCodes.find(c => c.serialCode === scanLogs[0].serialCode);
      if (match) {
        setSelectedCode(match);
        return;
      }
    }
    
    // Secondary fallback to first generated code
    if (allCodes.length > 0) {
      setSelectedCode(allCodes[0]);
    }
  }, [scanLogs, allCodes, selectedCode]);

  // Date range filtering
  const filteredLogs = useMemo(() => {
    const now = new Date();
    return scanLogs.filter(log => {
      const logDate = new Date(log.createdAt);
      if (dateFilter === 'Today') {
        return logDate.toDateString() === now.toDateString();
      }
      if (dateFilter === 'Yesterday') {
        const yesterday = new Date();
        yesterday.setDate(now.getDate() - 1);
        return logDate.toDateString() === yesterday.toDateString();
      }
      if (dateFilter === 'Month') {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(now.getDate() - 30);
        return logDate >= thirtyDaysAgo;
      }
      return true; // All
    });
  }, [scanLogs, dateFilter]);

  // Stats for filtered range
  const filteredStats = useMemo(() => {
    return computeScanStats(filteredLogs);
  }, [filteredLogs]);

  // Extract friendly location metrics
  const locations = useMemo(() => {
    const list = [];
    const countsMap = {};
    
    filteredLogs.forEach(log => {
      const lat = log.location?.latitude ?? log.location?._latitude ?? log.location?.lat;
      const lng = log.location?.longitude ?? log.location?._longitude ?? log.location?.lng;
      if (typeof lat === 'number' && typeof lng === 'number') {
        const key = `${lat.toFixed(4)}|${lng.toFixed(4)}`;
        const name = resolvedLocations[key] || getFriendlyLocation(lat, lng);
        countsMap[name] = (countsMap[name] || 0) + 1;
      }
    });
    
    Object.entries(countsMap).forEach(([name, count]) => {
      list.push({ name, count });
    });
    
    list.sort((a, b) => b.count - a.count);
    
    // No fallback - only pull data available in scan logs
    
    return list;
  }, [filteredLogs, resolvedLocations]);

  const handleInspectBySerial = (serial) => {
    const match = allCodes.find(c => c.serialCode === serial);
    if (match) {
      setSelectedCode(match);
      window.scrollTo({ top: 120, behavior: 'smooth' });
    } else {
      alert(`Code ${serial} details not found. It might be blocked or invalid.`);
    }
  };

  const handleBlockSelectedCode = async () => {
    if (!selectedCode) return;
    if (!confirm(`Are you sure you want to block code ${selectedCode.serialCode}?`)) return;
    try {
      await request(`/api/admin/codes/${selectedCode.id}/block`, {
        method: 'PATCH',
        headers: adminHeaders(passcode)
      });
      setSelectedCode(prev => prev ? { ...prev, status: 'BLOCKED' } : null);
      loadData();
      alert('Code blocked successfully.');
    } catch (err) {
      alert('Failed to block code: ' + err.message);
    }
  };

  const handleExportCSV = () => {
    if (filteredLogs.length === 0) {
      alert('No scan logs to export for this range.');
      return;
    }
    const headers = ['serialCode', 'batchNumber', 'result', 'reason', 'location', 'createdAt'];
    const csv = [
      headers.join(','),
      ...filteredLogs.map((log) => {
        const lat = log.location?.latitude ?? log.location?._latitude ?? log.location?.lat ?? '';
        const lng = log.location?.longitude ?? log.location?._longitude ?? log.location?.lng ?? '';
        const locStr = lat && lng ? `${lat};${lng}` : '';
        return [
          `"${log.serialCode || ''}"`,
          `"${log.batchNumber || ''}"`,
          `"${log.result || ''}"`,
          `"${log.reason || ''}"`,
          `"${locStr}"`,
          `"${log.createdAt || ''}"`
        ].join(',');
      })
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `scan-logs-export-${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      {/* Header with Date selectors & actions */}
      <header className="page-header">
        <div className="header-info">
          <h1>Code Analytics</h1>
          <p>Analyze scan records, geographical distributions, and manage individual verification credentials.</p>
        </div>
        
        <div className="header-actions">
          <div className="date-filters">
            {['Today', 'Yesterday', 'Month', 'All'].map((filter) => (
              <button
                key={filter}
                onClick={() => setDateFilter(filter)}
                className={`date-filter-btn ${dateFilter === filter ? 'active' : ''}`}
              >
                {filter}
              </button>
            ))}
          </div>
          
          <button onClick={handleExportCSV} className="outline-btn small" style={{ minHeight: '38px' }}>
            <Download size={16} />
            Export CSV
          </button>
        </div>
      </header>

      {error ? <p className="error">{error}</p> : null}
      
      {/* Metric Cards */}
      <div className="cards">
        <article className="metric-card">
          <span>Total Scans</span>
          <strong>{filteredStats.total}</strong>
        </article>
        <article className="metric-card success">
          <span>Genuine Scans</span>
          <strong>{filteredStats.genuine}</strong>
        </article>
        <article className="metric-card warning">
          <span>Suspicious Scans</span>
          <strong>{filteredStats.suspicious}</strong>
        </article>
        <article className="metric-card danger">
          <span>Invalid Scans</span>
          <strong>{filteredStats.invalid}</strong>
        </article>
      </div>

      {/* Main Grid: Left QR Inspector, Middle Line Chart, Right Doughnut */}
      <div className="dashboard-grid">
        {/* Left Card: Selected QR Inspector */}
        <div className="dashboard-card">
          <div className="dashboard-card-title">
            <h3>QR Inspector</h3>
            <QrCode size={16} className="dots" />
          </div>
          
          {selectedCode ? (
            <div>
              <div className="inspector-qr-wrap">
                <QRCode value={selectedCode.verificationUrl} size={150} level="H" includeMargin={true} />
              </div>
              <div className="inspector-info">
                <h4>{selectedCode.serialCode}</h4>
                <p className="sub-text">Product: {selectedCode.productName}</p>
                <p className="sub-text">Batch: {selectedCode.batchNumber}</p>
                <span className={`badge ${selectedCode.status === 'BLOCKED' ? 'suspicious' : 'genuine'}`}>
                  {selectedCode.status}
                </span>
                <div className="url-box" title={selectedCode.verificationUrl}>
                  {selectedCode.verificationUrl}
                </div>
              </div>
              
              <div className="inspector-stats-title">Label Scans</div>
              <div className="inspector-metrics">
                <div className="inspector-stat-box">
                  <span>Scan Count</span>
                  <strong>{selectedCode.scanCount || 0}</strong>
                </div>
                <div className="inspector-stat-box">
                  <span>Expiration</span>
                  <strong style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    {selectedCode.expiryDate ? selectedCode.expiryDate.split('T')[0] : 'N/A'}
                  </strong>
                </div>
              </div>
              
              <button 
                onClick={handleBlockSelectedCode} 
                disabled={selectedCode.status === 'BLOCKED'}
                className="danger inspector-action-btn small"
              >
                <Ban size={14} />
                {selectedCode.status === 'BLOCKED' ? 'Code is Blocked' : 'Block Code'}
              </button>
            </div>
          ) : (
            <div className="inspector-empty">
              <QrCode size={40} />
              <p>No code selected for inspection.<br />Click inspect on any list to view details.</p>
            </div>
          )}
        </div>

        {/* Middle Card: SVG Line Trend Chart */}
        <div className="dashboard-card" style={{ gridColumn: 'span 1' }}>
          <div className="dashboard-card-title">
            <h3>Daily Activity Trend</h3>
            <BarChart3 size={16} className="dots" />
          </div>
          <div className="chart-metrics-header">
            <div className="chart-header-stat">
              <strong>{filteredStats.total}</strong>
              <span>Scans</span>
            </div>
            <div className="chart-header-stat">
              <strong style={{ color: '#10b981' }}>{locations.length}</strong>
              <span>Locations</span>
            </div>
          </div>
          <ScanTrendChart filteredLogs={filteredLogs} />
        </div>

        {/* Right Card: Doughnut Chart */}
        <div className="dashboard-card">
          <div className="dashboard-card-title">
            <h3>Authenticity Distribution</h3>
            <Activity size={16} className="dots" />
          </div>
          <ScanResultDoughnut 
            genuine={filteredStats.genuine} 
            suspicious={filteredStats.suspicious} 
            invalid={filteredStats.invalid} 
          />
        </div>
      </div>

      {/* Bottom Layout: Heatmap & Tab panels */}
      <div className="heatmap-section">
        <div className="heatmap-intro">
          <div className="heatmap-intro-left">
            <h2>Location & Verification Activity</h2>
            <p>Track spatial coordinates and verify client verification centers.</p>
          </div>
          <div className="date-filters">
            <button 
              onClick={() => setBottomTab('locations')} 
              className={`date-filter-btn ${bottomTab === 'locations' ? 'active' : ''}`}
            >
              Top Locations
            </button>
            <button 
              onClick={() => setBottomTab('heatmap')} 
              className={`date-filter-btn ${bottomTab === 'heatmap' ? 'active' : ''}`}
            >
              Heatmap
            </button>
            <button 
              onClick={() => setBottomTab('recent')} 
              className={`date-filter-btn ${bottomTab === 'recent' ? 'active' : ''}`}
            >
              Recent Scans
            </button>
          </div>
        </div>

        {bottomTab === 'locations' && <TopLocationsList locations={locations} />}
        {bottomTab === 'heatmap' && <ScanHeatmap logs={filteredLogs} />}
        {bottomTab === 'recent' && (
          <RecentScansMiniTable logs={filteredLogs} onInspect={handleInspectBySerial} />
        )}
      </div>

      <div className="demo-flow">
        <h2>Developer Walkthrough Flow</h2>
        <p>Ensure smooth demo delivery: Go to <strong>Batches</strong>, input code properties, navigate to <strong>Generate</strong> to issue verification cards, download batch metrics (CSV), and use the simulated link to perform mock authenticity check.</p>
      </div>
    </>
  );
}

function Header({ title, subtitle }) {
  return (
    <header className="page-header" style={{ marginBottom: '22px' }}>
      <div className="header-info">
        <h1 style={{ fontFamily: 'Outfit', fontSize: '1.75rem', fontWeight: 700 }}>{title}</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.92rem', margin: '6px 0 0' }}>{subtitle}</p>
      </div>
    </header>
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
      alert('Batch created successfully.');
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <>
      <Header title="Batches Management" subtitle="Create and monitor product manufacturing groups." />
      {error ? <p className="error">{error}</p> : null}
      
      <form className="form-grid" onSubmit={submit}>
        <label>
          Product Name
          <input value={form.productName} onChange={(event) => setForm({ ...form, productName: event.target.value })} />
        </label>
        <label>
          Batch Number Identifier
          <input value={form.batchNumber} onChange={(event) => setForm({ ...form, batchNumber: event.target.value })} />
        </label>
        <label>
          Manufacture Date
          <input type="date" value={form.manufactureDate} onChange={(event) => setForm({ ...form, manufactureDate: event.target.value })} />
        </label>
        <label>
          Expiry Date
          <input type="date" value={form.expiryDate} onChange={(event) => setForm({ ...form, expiryDate: event.target.value })} />
        </label>
        <label className="wide">
          Batch Specific Notes
          <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
        </label>
        
        <div className="wide">
          <button type="submit">
            <Plus size={18} />
            Create Batch Group
          </button>
        </div>
      </form>

      <DataTable
        columns={['productName', 'batchNumber', 'manufactureDate', 'expiryDate', 'createdAt', 'actions']}
        rows={batches}
        renderCell={(row, column) => {
          if (column === 'createdAt') return formatDateTime(row[column]);
          if (column === 'actions') {
            return (
              <button className="small outline-btn" type="button" onClick={() => downloadBatchCsv(row.id)}>
                <Download size={14} />
                Download CSV
              </button>
            );
          }
          return row[column] || '-';
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
      <Header title="Generate Verification Labels" subtitle="Create serial identifier codes and QR coordinates for batch distribution." />
      {error ? <p className="error">{error}</p> : null}
      
      <form className="inline-form" onSubmit={submit}>
        <label>
          Product Batch
          <select value={batchId} onChange={(event) => setBatchId(event.target.value)}>
            <option value="" disabled>Select target batch</option>
            {batches.map((batch) => (
              <option key={batch.id} value={batch.id}>
                {batch.batchNumber} - {batch.productName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Issue Quantity
          <input type="number" min="1" max="500" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
        </label>
        <button type="submit">
          <Plus size={18} />
          Generate Credentials
        </button>
      </form>
      
      {generated.length > 0 ? (
        <div className="table-actions">
          <button type="button" onClick={() => downloadCsv(generated)} className="outline-btn">
            <Download size={16} />
            Download CSV Sheet
          </button>
          <button type="button" onClick={() => setShowQrCodes(!showQrCodes)} className="outline-btn">
            <QrCode size={16} />
            {showQrCodes ? 'Hide' : 'Review'} QR Labels
          </button>
          {showQrCodes ? (
            <button type="button" onClick={() => window.print()}>
              <Printer size={16} />
              Print Sticker Sheets
            </button>
          ) : null}
        </div>
      ) : null}
      
      {showQrCodes && generated.length > 0 ? (
        <div className="qr-grid">
          {generated.map((code) => (
            <div key={code.id} className="qr-item">
              <QRCode value={code.verificationUrl} size={130} level="H" includeMargin={true} />
              <p className="qr-serial">{code.serialCode}</p>
            </div>
          ))}
        </div>
      ) : null}
      
      <DataTable columns={['serialCode', 'verificationUrl', 'batchNumber', 'productName']} rows={generated} />
    </>
  );
}

function CodesPage({ passcode, setSelectedCode }) {
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
    if (!confirm('Are you sure you want to block this verification code?')) return;
    setError('');
    try {
      await request(`/api/admin/codes/${id}/block`, {
        method: 'PATCH',
        headers: adminHeaders(passcode)
      });
      await load();
      alert('Code blocked successfully.');
    } catch (err) {
      setError(err.message);
    }
  }

  const handleInspectRow = (code) => {
    setSelectedCode(code);
    window.history.pushState(null, '', '/admin');
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  return (
    <>
      <Header title="Verification Credentials" subtitle="Browse, audit, and block suspicious verification codes." />
      <div className="table-actions">
        <button type="button" onClick={load} className="outline-btn">
          <RefreshCw size={16} />
          Reload
        </button>
      </div>
      {error ? <p className="error">{error}</p> : null}
      
      <DataTable
        columns={['serialCode', 'batchNumber', 'status', 'scanCount', 'lastScannedAt', 'actions']}
        rows={codes}
        renderCell={(row, column) => {
          if (column === 'status') {
            return <Badge result={row.status === 'BLOCKED' ? 'SUSPICIOUS' : 'GENUINE'}>{row.status}</Badge>;
          }
          if (column === 'lastScannedAt') return formatDateTime(row.lastScannedAt);
          if (column === 'actions') {
            return (
              <div style={{ display: 'flex', gap: '8px' }}>
                <button 
                  className="small outline-btn" 
                  type="button" 
                  onClick={() => handleInspectRow(row)}
                >
                  Inspect
                </button>
                <button 
                  className="small danger" 
                  type="button" 
                  onClick={() => blockCode(row.id)} 
                  disabled={row.status === 'BLOCKED'}
                >
                  <Ban size={14} />
                  Block
                </button>
              </div>
            );
          }
          return row[column] || '-';
        }}
      />
    </>
  );
}

function LogsPage({ passcode, setSelectedCode }) {
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState('');

  const resolvedLocations = useGeocodedLocations(logs);

  const load = () =>
    request('/api/admin/scan-logs', { headers: adminHeaders(passcode) })
      .then(setLogs)
      .catch((err) => setError(err.message));

  useEffect(() => {
    if (passcode) load();
  }, [passcode]);

  const handleInspectLog = async (serialCode) => {
    try {
      const codes = await request('/api/admin/codes', { headers: adminHeaders(passcode) });
      const code = codes.find(c => c.serialCode === serialCode);
      if (code) {
        setSelectedCode(code);
        window.history.pushState(null, '', '/admin');
        window.dispatchEvent(new PopStateEvent('popstate'));
      } else {
        alert('Could not find detailed information for serial: ' + serialCode);
      }
    } catch (err) {
      alert('Error fetching code details: ' + err.message);
    }
  };

  return (
    <>
      <Header title="Auditing Logs" subtitle="Chronological tracking of each consumer checking attempt." />
      <div className="table-actions">
        <button type="button" onClick={load} className="outline-btn">
          <RefreshCw size={16} />
          Reload
        </button>
      </div>
      {error ? <p className="error">{error}</p> : null}
      
      <DataTable
        columns={['serialCode', 'batchNumber', 'result', 'reason', 'location', 'createdAt', 'inspect']}
        rows={logs}
        renderCell={(row, column) => {
          if (column === 'result') return <Badge result={row.result} />;
          if (column === 'createdAt') return formatDateTime(row.createdAt);
          if (column === 'inspect') {
            return (
              <button 
                className="small outline-btn" 
                type="button" 
                onClick={() => handleInspectLog(row.serialCode)}
              >
                Inspect
              </button>
            );
          }
          if (column === 'location') {
            if (!row.location) return '-';
            const latitude = row.location.latitude ?? row.location._latitude ?? row.location.lat;
            const longitude = row.location.longitude ?? row.location._longitude ?? row.location.lng;
            if (typeof latitude !== 'number' || typeof longitude !== 'number') return '-';
            const key = `${latitude.toFixed(4)}|${longitude.toFixed(4)}`;
            const name = resolvedLocations[key] || getFriendlyLocation(latitude, longitude);
            return (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`}
                target="_blank"
                rel="noopener noreferrer"
                className="location-link"
                title={`Coordinates: ${latitude}, ${longitude}`}
              >
                <MapPin size={12} />
                {name}
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
                No database records returned.
              </td>
            </tr>
          ) : (
            rows.map((row, idx) => (
              <tr key={row.id || row.serialCode || idx}>
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
  const [selectedCode, setSelectedCode] = useState(null);

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

      let content = (
        <AdminHome 
          passcode={passcode} 
          selectedCode={selectedCode} 
          setSelectedCode={setSelectedCode} 
        />
      );
      
      if (currentPath === '/admin/batches') {
        content = <BatchesPage passcode={passcode} />;
      }
      if (currentPath === '/admin/generate') {
        content = <GeneratePage passcode={passcode} />;
      }
      if (currentPath === '/admin/codes') {
        content = (
          <CodesPage 
            passcode={passcode} 
            setSelectedCode={setSelectedCode} 
          />
        );
      }
      if (currentPath === '/admin/logs') {
        content = (
          <LogsPage 
            passcode={passcode} 
            setSelectedCode={setSelectedCode} 
          />
        );
      }

      return (
        <AdminLayout passcode={passcode} setPasscode={setPasscode} currentPath={currentPath}>
          {content}
        </AdminLayout>
      );
    }

    return <ManualVerifyPage />;
  }, [currentPath, passcode, selectedCode]);

  return page;
}

createRoot(document.getElementById('root')).render(<App />);
