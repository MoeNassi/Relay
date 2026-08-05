import { useState } from 'react';
import type { StageDef, StageKey, Team } from '../types';
import { STAGES, TEAM_LABELS, stageDef } from '../types';

interface Props {
  projectName: string;
  envName: string;
  /** Stages this environment actually runs (envStages) — defaults to all. */
  stages?: StageDef[];
  initialStage: StageKey;
  onClose: () => void;
  onSubmit: (stage: StageKey, team: Team, note: string) => void;
}

/** Change one environment's pipeline status with an optional comment for the log. */
export function StatusChangeModal({ projectName, envName, stages = STAGES, initialStage, onClose, onSubmit }: Props) {
  // keep a legacy current stage selectable even if this env no longer runs it
  const options = stages.some(s => s.key === initialStage)
    ? stages
    : [stageDef(initialStage), ...stages];
  const [stage, setStage] = useState<StageKey>(initialStage);
  const [team, setTeam] = useState<Team>(stageDef(initialStage).defaultTeam);
  const [note, setNote] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(stage, team, note);
  };

  return (
    <div className="overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <form className="modal status-modal" onSubmit={submit}>
        <h1>Change status — {projectName} <span className="env-pill">{envName}</span></h1>
        <div className="row" style={{ marginBottom: 14 }}>
          <div className="field">
            <label>Move to stage</label>
            <select
              value={stage}
              onChange={e => {
                const s = e.target.value as StageKey;
                setStage(s);
                setTeam(stageDef(s).defaultTeam);
              }}
            >
              {options.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Ball at</label>
            <select value={team} onChange={e => setTeam(e.target.value as Team)}>
              {(Object.keys(TEAM_LABELS) as Team[]).map(t => (
                <option key={t} value={t}>{TEAM_LABELS[t]}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label>Comment (optional) — saved to the activity log</label>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={3}
            placeholder="e.g. waiting on firewall rule approval from the network team"
          />
        </div>
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary">Update status</button>
        </div>
      </form>
    </div>
  );
}
