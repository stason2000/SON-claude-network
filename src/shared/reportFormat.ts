/**
 * Boss report format check (rules §4).
 *
 *   - 결과: 완성된 것 한 줄과 파일 위치          (required)
 *   - 고친 것: …                                 (optional)
 *   - 내 결정 필요: …                             (optional)
 *   - 못 한 것: …                                 (optional)
 *
 * `checkReportFormat` is a PURE advisory validator: the app does not block or
 * rewrite Michael's messages with it (there is no safe interception point for a
 * TUI's free text). It exists so the format is defined in one testable place
 * and can be wired into a UI hint later.
 *
 * Accepted line shapes: `결과: …`, `- 결과: …`, `**결과**: …`, `- **결과:** …`.
 * A line indented by 2+ spaces (or a nested bullet) continues the previous section.
 * Any other top-level line is "stray" — the rules say no process narration.
 */

export const REPORT_SECTIONS = ['결과', '고친 것', '내 결정 필요', '못 한 것'] as const;
export type ReportSection = (typeof REPORT_SECTIONS)[number];

export interface ReportCheck {
  ok: boolean;
  errors: string[];
  sections: Partial<Record<ReportSection, string>>;
}

const LABEL_RE = /^(?:[-*•]\s*)?(?:\*\*)?([^:*：]{1,20}?)(?:\*\*)?\s*[:：]\s*(?:\*\*)?\s*(.*)$/;

export function checkReportFormat(text: string): ReportCheck {
  const errors: string[] = [];
  const sections: Partial<Record<ReportSection, string>> = {};
  const order: ReportSection[] = [];
  let current: ReportSection | null = null;
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  for (const raw of lines) {
    if (!raw.trim()) continue;
    if (/^(\s{2,}|\t)/.test(raw) && current) {
      sections[current] = `${sections[current] ?? ''}\n${raw.trim()}`.trim();
      continue;
    }
    const m = LABEL_RE.exec(raw.trim());
    const label = m?.[1]?.trim();
    if (m && label && (REPORT_SECTIONS as readonly string[]).includes(label)) {
      const sec = label as ReportSection;
      if (sections[sec] !== undefined) errors.push(`중복된 항목: ${sec}`);
      sections[sec] = m[2].trim();
      order.push(sec);
      current = sec;
      continue;
    }
    if (m && label && /^[-*•]/.test(raw.trim())) {
      errors.push(`허용되지 않은 항목: ${label}`);
    } else {
      errors.push(`형식 밖 문장: ${raw.trim().slice(0, 40)}`);
    }
    current = null;
  }
  if (sections['결과'] === undefined) errors.push('결과 줄이 없음');
  else if (!sections['결과']) errors.push('결과 내용이 비어 있음');
  else if (order[0] !== '결과') errors.push('결과가 맨 앞이 아님');
  for (const s of REPORT_SECTIONS) {
    if (s !== '결과' && sections[s] !== undefined && !sections[s]) errors.push(`비어 있는 항목: ${s} (없으면 줄을 빼야 함)`);
  }
  return { ok: errors.length === 0, errors, sections };
}
