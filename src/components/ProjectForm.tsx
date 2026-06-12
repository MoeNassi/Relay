import { useState } from 'react';
import type { Project, Environment, FlowRule, VmSpec, StageKey, Team } from '../types';
import { STAGES, TEAM_LABELS, stageDef } from '../types';
import { uid } from '../store';

interface Props {
  initial?: Project;
  onSave: (p: Project) => void;
  onClose: () => void;
}

const blankVm = (): VmSpec => ({ id: uid(), role: '', count: 1, vcpu: 2, ramGb: 4, diskGb: 60, os: 'Ubuntu 24.04' });
const blankEnv = (name = 'dev'): Environment => ({ id: uid(), name, vms: [blankVm()] });
const blankFlow = (): FlowRule => ({ id: uid(), source: '', destination: '', port: '', protocol: 'TCP', direction: 'outbound', note: '' });

export function ProjectForm({ initial, onSave, onClose }: Props) {
  const [name, setName] = useState(initial?.name ?? '');
  const [dns, setDns] = useState(initial?.dns ?? '');
  const [ownerName, setOwnerName] = useState(initial?.owner.name ?? '');
  const [ownerTitle, setOwnerTitle] = useState(initial?.owner.title ?? '');
  const [envs, setEnvs] = useState<Environment[]>(initial?.environments ?? [blankEnv()]);
  const [flows, setFlows] = useState<FlowRule[]>(initial?.flows ?? [blankFlow()]);
  const [stage, setStage] = useState<StageKey>(initial?.stage ?? 'new');
  const [team, setTeam] = useState<Team>(initial?.team ?? 'owner');

  const patchEnv = (id: string, patch: Partial<Environment>) =>
    setEnvs(es => es.map(e => (e.id === id ? { ...e, ...patch } : e)));
  const patchVm = (envId: string, vmId: string, patch: Partial<VmSpec>) =>
    setEnvs(es => es.map(e => e.id === envId
      ? { ...e, vms: e.vms.map(v => (v.id === vmId ? { ...v, ...patch } : v)) }
      : e));
  const patchFlow = (id: string, patch: Partial<FlowRule>) =>
    setFlows(fs => fs.map(f => (f.id === id ? { ...f, ...patch } : f)));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const now = new Date().toISOString();
    const cleanEnvs = envs
      .map(env => ({ ...env, vms: env.vms.filter(v => v.role.trim()) }))
      .filter(env => env.name.trim());
    const cleanFlows = flows.filter(f => f.destination.trim() || f.port.trim());
    const project: Project = initial
      ? {
          ...initial,
          name, dns,
          owner: { name: ownerName, title: ownerTitle },
          environments: cleanEnvs,
          flows: cleanFlows,
          stage, team,
          // append a history entry if the stage was changed by hand
          history: initial.stage === stage
            ? initial.history
            : [...initial.history, { stage, team, enteredAt: now }],
        }
      : {
          id: uid(),
          name, dns,
          owner: { name: ownerName, title: ownerTitle },
          environments: cleanEnvs,
          flows: cleanFlows,
          stage, team,
          history: [{ stage, team, enteredAt: now }],
          createdAt: now,
        };
    onSave(project);
  };

  return (
    <div className="overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <form className="modal" onSubmit={submit}>
        <h1>{initial ? 'Edit project' : 'New project'}</h1>

        <div className="card">
          <h2>Identity</h2>
          <div className="row" style={{ marginBottom: 12 }}>
            <div className="field">
              <label>Application name *</label>
              <input required value={name} onChange={e => setName(e.target.value)} placeholder="e.g. HR Portal" />
            </div>
            <div className="field">
              <label>DNS</label>
              <input value={dns} onChange={e => setDns(e.target.value)} placeholder="app.um6p.ma" />
            </div>
          </div>
          <div className="row">
            <div className="field">
              <label>Owner *</label>
              <input required value={ownerName} onChange={e => setOwnerName(e.target.value)} placeholder="Full name" />
            </div>
            <div className="field">
              <label>Owner title</label>
              <input value={ownerTitle} onChange={e => setOwnerTitle(e.target.value)} placeholder="e.g. HR Director" />
            </div>
          </div>
        </div>

        <div className="card">
          <h2>Environments &amp; VM specs<span className="hint">one block per environment</span></h2>
          {envs.map(env => (
            <div className="env-block" key={env.id}>
              <div className="env-head">
                <div className="field">
                  <label>Environment</label>
                  <select value={env.name} onChange={e => patchEnv(env.id, { name: e.target.value })}>
                    <option>dev</option>
                    <option>preprod</option>
                    <option>prod</option>
                  </select>
                </div>
                <button type="button" className="btn sm ghost danger" style={{ marginLeft: 'auto' }}
                  onClick={() => setEnvs(es => es.filter(e => e.id !== env.id))}>
                  Remove env
                </button>
              </div>
              <div className="subrows">
                {env.vms.map(vm => (
                  <div className="subrow" key={vm.id}>
                    <div className="field">
                      <label>Role</label>
                      <input value={vm.role} onChange={e => patchVm(env.id, vm.id, { role: e.target.value })} placeholder="app server" />
                    </div>
                    <div className="field narrow">
                      <label>Count</label>
                      <input type="number" min={1} value={vm.count} onChange={e => patchVm(env.id, vm.id, { count: +e.target.value })} />
                    </div>
                    <div className="field narrow">
                      <label>vCPU</label>
                      <input type="number" min={1} value={vm.vcpu} onChange={e => patchVm(env.id, vm.id, { vcpu: +e.target.value })} />
                    </div>
                    <div className="field narrow">
                      <label>RAM GB</label>
                      <input type="number" min={1} value={vm.ramGb} onChange={e => patchVm(env.id, vm.id, { ramGb: +e.target.value })} />
                    </div>
                    <div className="field narrow">
                      <label>Disk GB</label>
                      <input type="number" min={1} value={vm.diskGb} onChange={e => patchVm(env.id, vm.id, { diskGb: +e.target.value })} />
                    </div>
                    <div className="field">
                      <label>OS</label>
                      <input value={vm.os} onChange={e => patchVm(env.id, vm.id, { os: e.target.value })} />
                    </div>
                    <button type="button" className="rm" title="Remove VM"
                      onClick={() => patchEnv(env.id, { vms: env.vms.filter(v => v.id !== vm.id) })}>
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              <button type="button" className="btn sm" style={{ marginTop: 8 }}
                onClick={() => patchEnv(env.id, { vms: [...env.vms, blankVm()] })}>
                + Add VM
              </button>
            </div>
          ))}
          <button type="button" className="btn sm" onClick={() => setEnvs(es => [...es, blankEnv('preprod')])}>
            + Add environment
          </button>
        </div>

        <div className="card">
          <h2>Matrice de flux<span className="hint">outgoing ports &amp; destinations</span></h2>
          <div className="subrows">
            {flows.map(f => (
              <div className="subrow" key={f.id}>
                <div className="field">
                  <label>Source</label>
                  <input value={f.source} onChange={e => patchFlow(f.id, { source: e.target.value })} placeholder="app server" />
                </div>
                <div className="field">
                  <label>Destination</label>
                  <input value={f.destination} onChange={e => patchFlow(f.id, { destination: e.target.value })} placeholder="db / smtp.um6p.ma" />
                </div>
                <div className="field narrow">
                  <label>Port</label>
                  <input value={f.port} onChange={e => patchFlow(f.id, { port: e.target.value })} placeholder="443" />
                </div>
                <div className="field narrow">
                  <label>Proto</label>
                  <select value={f.protocol} onChange={e => patchFlow(f.id, { protocol: e.target.value as FlowRule['protocol'] })}>
                    <option>TCP</option>
                    <option>UDP</option>
                  </select>
                </div>
                <div className="field narrow">
                  <label>Direction</label>
                  <select value={f.direction} onChange={e => patchFlow(f.id, { direction: e.target.value as FlowRule['direction'] })}>
                    <option value="outbound">out</option>
                    <option value="inbound">in</option>
                  </select>
                </div>
                <div className="field">
                  <label>Note</label>
                  <input value={f.note} onChange={e => patchFlow(f.id, { note: e.target.value })} placeholder="PostgreSQL" />
                </div>
                <button type="button" className="rm" title="Remove rule"
                  onClick={() => setFlows(fs => fs.filter(x => x.id !== f.id))}>
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button type="button" className="btn sm" style={{ marginTop: 8 }}
            onClick={() => setFlows(fs => [...fs, blankFlow()])}>
            + Add flow rule
          </button>
        </div>

        <div className="card">
          <h2>Status</h2>
          <div className="row">
            <div className="field">
              <label>Stage</label>
              <select value={stage} onChange={e => {
                const s = e.target.value as StageKey;
                setStage(s);
                setTeam(stageDef(s).defaultTeam);
              }}>
                {STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Ball at (current team)</label>
              <select value={team} onChange={e => setTeam(e.target.value as Team)}>
                {(Object.keys(TEAM_LABELS) as Team[]).map(t => (
                  <option key={t} value={t}>{TEAM_LABELS[t]}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary">{initial ? 'Save changes' : 'Create project'}</button>
        </div>
      </form>
    </div>
  );
}
