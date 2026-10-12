import { useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage } from '../api';
import { Card, ErrorBox, Notice, PageHeader, Soon } from '../components/ui';
import { fmtDateTime, fmtUptime } from '../format';
import { useAsync } from '../hooks';
import type { SafetyLimits, SystemInfo } from '../../shared/types.js';

const ROADMAP = [
  { stage: 1, name: '기본 프로젝트 구축 — 대시보드, 프로젝트·작업 상태 관리', done: true },
  { stage: 2, name: 'AI 연결 — 제공자 1개 연결, 기본 요청, 사용량·비용 기록', done: false },
  { stage: 3, name: '실제 업무 실행 — 계획·파일 작업·코드 개발·테스트·검증', done: false },
  { stage: 4, name: '장시간 자율 실행 — 백그라운드·복구·예약·승인·알림', done: false },
  { stage: 5, name: '부서 고도화 — 개발·연구·자동매매 UI, 추가 AI 모델', done: false },
];

export function Settings() {
  const sys = useAsync(() => api.get<SystemInfo>('/api/system'), [], 10000);
  const limits = useAsync(() => api.get<SafetyLimits>('/api/settings/limits'), []);
  const [form, setForm] = useState<SafetyLimits>();
  const [msg, setMsg] = useState<{ kind: 'info' | 'error'; text: string }>();

  useEffect(() => {
    if (limits.data && !form) setForm(limits.data);
  }, [limits.data, form]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    try {
      await api.put('/api/settings/limits', form);
      setMsg({ kind: 'info', text: '저장했습니다. (실행 엔진이 구현되는 3~4단계부터 적용됩니다)' });
    } catch (err) {
      setMsg({ kind: 'error', text: errorMessage(err) });
    }
  }

  const num = (key: keyof SafetyLimits, label: string, step = 1) => (
    <label>
      {label}
      <input
        type="number"
        min={0}
        step={step}
        value={form?.[key] ?? ''}
        onChange={(e) => form && setForm({ ...form, [key]: Number(e.target.value) })}
        required
      />
    </label>
  );

  const s = sys.data;
  return (
    <>
      <PageHeader title="API 및 시스템 설정" />

      <div className="grid-2">
        <Card title="시스템 정보">
          <ErrorBox message={sys.error} />
          {s && (
            <dl className="kv">
              <dt>버전</dt><dd>{s.name} {s.version} (개발 {s.stage}단계)</dd>
              <dt>Node.js</dt><dd>{s.nodeVersion} · {s.platform}</dd>
              <dt>접속 주소</dt><dd className="mono">{s.host}:{s.port}</dd>
              <dt>시작 시각</dt><dd>{fmtDateTime(s.startedAt)} (가동 {fmtUptime(s.uptimeSec)})</dd>
              <dt>데이터 폴더</dt><dd className="mono">{s.dataDir}</dd>
              <dt>DB 파일</dt><dd className="mono">{s.dbPath}</dd>
              <dt>DB 스키마</dt><dd>v{s.schemaVersion}</dd>
            </dl>
          )}
          <p className="muted small">백업: 서버를 멈춘 뒤 데이터 폴더를 통째로 복사하세요.</p>
        </Card>

        <Card title="AI 제공자 / API 키" right={<Soon stage={2} />}>
          <ul className="checklist">
            <li><span>Anthropic (Claude)</span><span className="badge">미연결</span></li>
            <li><span>OpenAI (GPT)</span><span className="badge">미연결</span></li>
          </ul>
          <p className="muted small">
            API 키는 서버의 <code>.env</code> 파일에만 저장하고 브라우저로는 절대 전달하지 않습니다.
            2단계에서 제공자 1개를 먼저 연결해 검증한 뒤 확장합니다. 현재는 키 입력 기능이 없습니다.
          </p>
        </Card>
      </div>

      <Card title="자율 실행 안전 한도" right={<Soon stage={4} label="적용 예정" />}>
        <Notice kind="warn">값은 저장되지만, 실행 엔진이 없는 현재는 아무 작업에도 적용되지 않습니다. 자율 실행이 구현되면 이 한도를 넘는 작업은 자동으로 중단됩니다.</Notice>
        <form className="form" onSubmit={save}>
          <div className="form-row">
            {num('maxTaskMinutes', '작업당 최대 시간 (분)')}
            {num('maxIterations', '작업당 최대 반복 횟수')}
            {num('maxCostUsdPerTask', '작업당 최대 비용 (USD)', 0.1)}
            {num('maxCostUsdPerDay', '하루 최대 비용 (USD)', 0.5)}
          </div>
          {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
          <div><button className="btn primary" disabled={!form}>저장</button></div>
        </form>
      </Card>

      <Card title="개발 로드맵">
        <ul className="checklist">
          {ROADMAP.map((r) => (
            <li key={r.stage}>
              <span>{r.stage}단계 — {r.name}</span>
              {r.done ? <span className="badge status-succeeded">완료</span> : <span className="badge soon">예정</span>}
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
