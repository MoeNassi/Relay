import { useEffect, useState } from 'react';
import { apiListKeys, apiCreateKey, apiRevokeKey, type ApiKeyInfo } from '../store';
import { TopBar } from './TopBar';

interface Props {
  presence?: React.ReactNode;
  onBack: () => void;
}

export function Settings({ presence, onBack }: Props) {
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [name, setName] = useState('');
  const [created, setCreated] = useState<{ name: string; key: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const refresh = () => apiListKeys().then(setKeys).catch(e => setError(String(e.message ?? e)));
  useEffect(() => { refresh(); }, []);

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    apiCreateKey(name.trim())
      .then(k => {
        setCreated({ name: k.name, key: k.key });
        setCopied(false);
        setName('');
        refresh();
      })
      .catch(e => setError(String(e.message ?? e)));
  };

  const revoke = (k: ApiKeyInfo) => {
    if (!confirm(`Revoke and delete “${k.name}”? Agents using it lose access immediately.`)) return;
    apiRevokeKey(k.id).then(refresh).catch(e => setError(String(e.message ?? e)));
  };

  const copy = (text: string) => {
    navigator.clipboard?.writeText(text).then(() => setCopied(true)).catch(() => {});
  };

  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : 'never');

  return (
    <>
      <TopBar
        crumbs={[
          { label: 'Relay Workspace' },
          { label: 'Projects', onClick: onBack },
          { label: 'Settings' },
        ]}
        right={presence}
      />
      <div className="page">
        <div className="page-title-block">
          <h1 className="page-title">Settings</h1>
          <div className="title-meta">
            <span className="meta-text">API keys grant agents write access to projects and statuses.</span>
          </div>
        </div>

        {error && <div className="key-error">{error}</div>}

        <div className="card">
          <h2>Create API key<span className="hint">one per agent or integration, so you can revoke individually</span></h2>
          <form className="key-create" onSubmit={create}>
            <div className="field" style={{ flex: 1 }}>
              <label>Key name (who will use it?)</label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. CI pipeline, Claude agent, scan-bot"
              />
            </div>
            <button className="btn primary" type="submit" disabled={!name.trim()}>Create key</button>
          </form>

          {created && (
            <div className="key-reveal">
              <div className="key-reveal-head">
                Key “{created.name}” created — copy it now, it won't be shown again.
              </div>
              <div className="key-reveal-row">
                <code className="mono">{created.key}</code>
                <button className="btn sm" type="button" onClick={() => copy(created.key)}>
                  {copied ? 'Copied ✓' : 'Copy'}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="card">
          <h2>Active keys</h2>
          <table className="table">
            <thead>
              <tr><th>Name</th><th>Key</th><th>Created</th><th>Last used</th><th></th></tr>
            </thead>
            <tbody>
              {keys.map(k => (
                <tr key={k.id} style={{ cursor: 'default' }}>
                  <td className="name">
                    {k.name}
                    {k.internal && <span className="sub"> (used by this web app)</span>}
                  </td>
                  <td className="mono">{k.prefix}</td>
                  <td className="sub">{fmt(k.createdAt)}</td>
                  <td className="sub">{fmt(k.lastUsedAt)}</td>
                  <td style={{ textAlign: 'right' }}>
                    {!k.internal && (
                      <button className="btn sm danger" onClick={() => revoke(k)}>Revoke</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h2>Usage</h2>
          <pre className="key-usage mono">{`curl -X PATCH http://localhost:5181/api/projects/<id>/status \\
  -H "X-API-Key: <your key>" -H 'Content-Type: application/json' \\
  -d '{ "stage": "scan" }'`}</pre>
          <div className="sub" style={{ marginTop: 8 }}>
            Full endpoint reference in <code>API.md</code>. Revoking deletes the key — it is refused instantly and removed from this list; “last used” updates on every authenticated call.
          </div>
        </div>
      </div>
    </>
  );
}
