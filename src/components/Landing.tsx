import { SSO_PROVIDER } from '../config';

export function Landing({ onSignIn }: { onSignIn: () => void }) {
  return (
    <div className="landing">
      <div className="sso-card">
        <img className="logo" src="/logo-blue.png" alt="Relay" />
        <h1>Relay</h1>
        <p>Project pipeline tracking — infra, cybersec &amp; publication, in one place.</p>
        <button className="btn primary" onClick={onSignIn}>
          Sign in with {SSO_PROVIDER}
        </button>
        <div className="sso-note">Access restricted to UM6P staff accounts.</div>
      </div>
    </div>
  );
}
