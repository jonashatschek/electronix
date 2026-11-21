import { useEditor } from './store';

const ICON = { error: '✖', warn: '!', success: '✔', info: 'i' } as const;

export function LabNotes() {
  const notes = useEditor((s) => s.sim.notes);
  const banner = useEditor((s) => s.banner);
  const dismiss = useEditor((s) => s.dismissBanner);
  const select = useEditor((s) => s.select);

  return (
    <section className="panel notes">
      <h2>Lab notes</h2>
      {banner && (
        <div className="note note-intro">
          <p>{banner}</p>
          <button className="link" onClick={dismiss}>
            Got it
          </button>
        </div>
      )}
      {notes.map((n, i) => (
        <div
          key={i}
          className={`note note-${n.severity} ${n.partId ? 'clickable' : ''}`}
          onClick={() => n.partId && select({ type: 'part', id: n.partId })}
        >
          <span className="note-icon">{ICON[n.severity]}</span>
          <div>
            <strong>{n.title}</strong>
            <p>{n.text}</p>
          </div>
        </div>
      ))}
    </section>
  );
}
