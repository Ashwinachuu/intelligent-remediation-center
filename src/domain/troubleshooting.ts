import type { Answer, Category, Knowledge, Troubleshooting } from './types';

/**
 * Structured, adaptive troubleshooting (V1.2 §6). Not a chatbot: every flow is a small decision tree,
 * one question or step at a time, and the next node depends on the previous answer. Employees are only
 * ever asked to perform safe actions themselves — nothing here touches the device.
 */
export type Next = string | 'RESOLVED' | 'ESCALATE';
export interface Option { label: string; answer: Answer; next: Next; finding?: string; fail?: boolean; unsure?: boolean; signal?: Signal }
export type Signal = 'NETWORK_WIDE' | 'ONE_APP' | 'RESTART_TRIED';
export interface FlowNode { id: string; kind: 'QUESTION' | 'STEP' | 'CHECK'; text: string; help?: string; options: Option[]; source?: string }
export interface Flow { start: string; nodes: Record<string, FlowNode> }

const YES = 'Yes', NO = 'No', UNSURE = 'Not sure';
const q = (id: string, text: string, options: Option[], help?: string): FlowNode => ({ id, kind: 'QUESTION', text, options, help });
const step = (id: string, text: string, next: Next, help?: string): FlowNode => ({ id, kind: 'STEP', text, help, options: [
  { label: 'Completed', answer: 'COMPLETED', next },
  { label: 'Unable to complete', answer: 'UNABLE', next, fail: true, finding: `Could not complete: ${text}` },
] });
const check = (id: string, text: string, persists: Next, finding: string): FlowNode => ({ id, kind: 'CHECK', text, options: [
  { label: 'Issue resolved', answer: 'RESOLVED', next: 'RESOLVED' },
  { label: 'Issue still persists', answer: 'PERSISTS', next: persists, fail: true, finding },
] });
const yn = (yes: Next, no: Next, unsure: Next, f: { yes?: string; no?: string; unsure?: string; yesSignal?: Signal; noSignal?: Signal } = {}): Option[] => [
  { label: YES, answer: 'YES', next: yes, finding: f.yes, signal: f.yesSignal },
  { label: NO, answer: 'NO', next: no, finding: f.no, signal: f.noSignal },
  { label: UNSURE, answer: 'NOT_SURE', next: unsure, finding: f.unsure, unsure: true },
];
const flow = (start: string, ...nodes: FlowNode[]): Flow => ({ start, nodes: Object.fromEntries(nodes.map((n) => [n.id, n])) });

export const FLOWS: Record<Category, Flow> = {
  WIFI: flow('w1',
    q('w1', 'Is Wi-Fi turned on on your laptop?', yn('w2', 'w1s', 'w1s', { yes: 'Wi-Fi is turned on', no: 'Wi-Fi was turned off' }), 'Look for the Wi-Fi icon in the bottom-right of your screen.'),
    step('w1s', 'Turn Wi-Fi on from the network icon in the taskbar.', 'w1c'),
    check('w1c', 'Can you connect now?', 'w2', 'Turning Wi-Fi on did not help'),
    q('w2', 'Can you see available Wi-Fi networks in the list?', yn('w3', 'w2s', 'w2s', { yes: 'Networks are visible', no: 'No networks visible' })),
    step('w2s', 'Turn Airplane mode on, wait 10 seconds, then turn it off again.', 'w2c'),
    check('w2c', 'Can you connect now?', 'w3', 'Toggling Airplane mode did not help'),
    q('w3', 'Are other devices (for example your phone) able to connect to the same network?', [
      { label: YES, answer: 'YES', next: 'w4', finding: 'Other devices connect fine — problem is specific to this laptop' },
      { label: NO, answer: 'NO', next: 'ESCALATE', finding: 'Other devices also fail — likely a network-side problem, not this laptop', signal: 'NETWORK_WIDE' },
      { label: UNSURE, answer: 'NOT_SURE', next: 'w4', finding: 'Unknown whether other devices are affected', unsure: true },
    ]),
    q('w4', 'Have you restarted your laptop since the problem started?', yn('ESCALATE', 'w4s', 'w4s', { yes: 'Restart already tried', yesSignal: 'RESTART_TRIED' })),
    step('w4s', 'Save your work, then restart your laptop.', 'w4c'),
    check('w4c', 'After the restart, can you connect to Wi-Fi?', 'ESCALATE', 'Restart did not fix Wi-Fi'),
  ),
  SERVICE: flow('s1',
    q('s1', 'When did the slowness start?', [
      { label: 'Today', answer: 'TODAY', next: 's2', finding: 'Started today' },
      { label: 'A few days ago', answer: 'DAYS', next: 's2', finding: 'Started a few days ago' },
      { label: UNSURE, answer: 'NOT_SURE', next: 's2', unsure: true },
    ]),
    q('s2', 'Is the whole laptop slow, or only one application?', [
      { label: 'Whole laptop', answer: 'WHOLE', next: 's3', finding: 'Whole laptop is slow' },
      { label: 'Only one application', answer: 'ONE_APP', next: 's2s', finding: 'Only one application is slow', signal: 'ONE_APP' },
      { label: UNSURE, answer: 'NOT_SURE', next: 's3', unsure: true },
    ]),
    step('s2s', 'Close that application completely and open it again.', 's2c'),
    check('s2c', 'Is the application working normally now?', 's3', 'Reopening the application did not help'),
    q('s3', 'Have you restarted your laptop in the last 24 hours?', yn('s4', 's4', 's4', { yes: 'Restarted in the last 24 hours', no: 'Not restarted recently', yesSignal: 'RESTART_TRIED' })),
    q('s4', 'Are many applications open at the same time?', yn('s5', 's5', 's5', { yes: 'Many applications open', no: 'Few applications open' })),
    step('s5', 'Save your ongoing work.', 's6'),
    step('s6', 'Close applications you are not using.', 's7'),
    step('s7', 'Restart your laptop.', 's8'),
    check('s8', 'Has performance improved?', 'ESCALATE', 'Still slow after closing apps and restarting'),
  ),
  STORAGE: flow('d1',
    q('d1', 'Do you see a "low disk space" warning?', yn('d2', 'd2', 'd2', { yes: 'Low disk space warning shown' })),
    step('d2', 'Empty the Recycle Bin.', 'd3'),
    step('d3', 'Delete large files you no longer need from your Downloads folder.', 'd4'),
    check('d4', 'Do you have enough space now?', 'ESCALATE', 'Still low on space after cleaning up personal files'),
  ),
  RESTART: flow('r1',
    q('r1', 'Have you seen a "restart required" message?', yn('r2', 'r2', 'r2', { yes: 'Restart message shown' })),
    step('r2', 'Save your work and restart your laptop.', 'r3'),
    check('r3', 'Has the restart message gone?', 'ESCALATE', 'Restart message keeps coming back'),
  ),
  APP_UPDATE: flow('a1',
    q('a1', 'Does the app show an "update required" message?', yn('a2', 'a2', 'a2', { yes: 'Update-required message shown' })),
    step('a2', 'Close the app and open it again.', 'a3'),
    step('a3', 'Open Software Center and click Update next to the app.', 'a4'),
    check('a4', 'Is the app updated and working?', 'ESCALATE', 'Self-service update did not succeed'),
  ),
  OS_UPDATE: flow('o1',
    q('o1', 'Is your laptop plugged into power?', yn('o2', 'o1s', 'o1s', { yes: 'On mains power' })),
    step('o1s', 'Plug your laptop into power.', 'o2'),
    step('o2', 'Open Settings → Windows Update and click "Check for updates".', 'o3'),
    check('o3', 'Did the update install successfully?', 'ESCALATE', 'Windows Update did not complete'),
  ),
  CRASH: flow('c1',
    q('c1', 'Does the application freeze every time, or only sometimes?', [
      { label: 'Every time', answer: 'ALWAYS', next: 'c2', finding: 'Freezes every time' },
      { label: 'Only sometimes', answer: 'SOMETIMES', next: 'c2', finding: 'Freezes intermittently' },
      { label: UNSURE, answer: 'NOT_SURE', next: 'c2', unsure: true },
    ]),
    step('c2', 'Force-close the app (Ctrl + Shift + Esc → select it → End task).', 'c3'),
    step('c3', 'Open the app again.', 'c4'),
    check('c4', 'Is the app responding now?', 'ESCALATE', 'App still not responding after restart'),
  ),
  DNS: flow('n1',
    step('n1', 'Restart your laptop.', 'n2'),
    check('n2', 'Can you open internal sites now?', 'ESCALATE', 'Internal sites still not loading'),
  ),
  UNKNOWN: flow('u1',
    q('u1', 'Did the problem start after a change (new accessory, update or move)?', yn('u2', 'u2', 'u2', { yes: 'Started after a change', no: 'No recent change' })),
    step('u2', 'Disconnect and reconnect any external devices (dock, monitor, USB).', 'u3'),
    step('u3', 'Restart your laptop.', 'u4'),
    check('u4', 'Is the problem gone?', 'ESCALATE', 'Generic steps did not resolve the problem'),
  ),
};

/** Build the flow for a ticket: a validated reusable resolution (if one matches) is tried first. */
export function flowFor(category: Category, k?: Knowledge): Flow {
  const base = FLOWS[category];
  if (!k) return base;
  const nodes: Record<string, FlowNode> = { ...base.nodes };
  const ids: string[] = [];
  k.diagnosticQuestions.forEach((text, i) => { const id = `k_q${i}`; ids.push(id); nodes[id] = { id, kind: 'QUESTION', text, source: k.id, options: [] }; });
  k.employeeSteps.forEach((text, i) => { const id = `k_s${i}`; ids.push(id); nodes[id] = { id, kind: 'STEP', text, source: k.id, options: [] }; });
  const checkId = 'k_check';
  nodes[checkId] = { ...check(checkId, 'Did that fix the problem?', base.start, `Validated fix ${k.id} did not resolve it`), source: k.id };
  ids.forEach((id, i) => {
    const next = ids[i + 1] ?? checkId;
    const n = nodes[id];
    nodes[id] = n.kind === 'QUESTION'
      ? { ...n, options: yn(next, next, next, { yes: `${n.text} — yes`, no: `${n.text} — no` }) }
      : { ...step(id, n.text, next), source: k.id };
  });
  return { start: ids[0] ?? checkId, nodes };
}

export function newTroubleshooting(start: string, knowledgeId?: string): Troubleshooting {
  return { state: 'ACTIVE', entries: [], findings: [], failedAttempts: 0, current: start, signals: [], knowledgeId };
}
