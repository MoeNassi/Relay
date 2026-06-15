/** Boot screen: a pencil jots a few notes, then it all clears — and repeats. */
export function Splash({ leaving }: { leaving?: boolean }) {
  return (
    <div className={`splash ${leaving ? 'leaving' : ''}`}>
      <div className="splash-inner">
        <div className="notepad">
          <span className="note-line l1" />
          <span className="note-line l2" />
          <span className="note-line l3" />
          <span className="pencil">✏️</span>
        </div>
        <div className="splash-word">Relay</div>
        <div className="splash-tag">Project pipeline tracking</div>
      </div>
    </div>
  );
}
