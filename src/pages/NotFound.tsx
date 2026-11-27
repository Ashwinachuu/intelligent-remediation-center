import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
export function NotFoundPage() {
  return (
    <div className="card" style={{ maxWidth: 560 }}>
      <div className="row"><Compass size={20} aria-hidden /><h1>Page not found</h1></div>
      <p className="muted" style={{ marginTop: 8 }}>This address does not match any screen in the Remediation Center.</p>
      <div className="row"><Link className="btn btn-primary" to="/overview">Go to Overview</Link><Link className="btn" to="/incidents">Open incidents</Link></div>
    </div>
  );
}
