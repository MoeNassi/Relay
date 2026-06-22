/** Boot screen: a pulse travelling across the pipeline's stage dots. */
export function Splash({ leaving }: { leaving?: boolean }) {
  return (
    <div className={`splash ${leaving ? 'leaving' : ''}`}>
      <div className="splash-inner">
        <div className="pipe-loader">
          <span className="pipe-track" />
          <span className="pipe-dot d1" />
          <span className="pipe-dot d2" />
          <span className="pipe-dot d3" />
          <span className="pipe-dot d4" />
          <span className="pipe-dot d5" />
          <span className="pipe-dot d6" />
        </div>
        <div className="splash-word">Relay</div>
        <div className="splash-tag">Project pipeline tracking</div>
      </div>
    </div>
  );
}
