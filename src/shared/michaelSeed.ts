/**
 * The operating-rules block appended to Michael's first prompt on a FRESH spawn
 * (useHive.ts). Pure: inputs are the text of <workspace>/michael-rules.md, the
 * resolved department table and the model policy. A resumed Michael already has
 * it in his conversation, so it is not re-sent.
 */
import { formatDepartmentTable, type DepartmentResolution, type DepartmentSpec } from './departments';
import { modelPolicySeedText } from './modelPolicy';

export const RULES_FILE_NAME = 'michael-rules.md';
/** Cap on how much of the user's rules file reaches the prompt. */
export const RULES_SEED_MAX_CHARS = 12_000;

export function capRulesText(text: string, max = RULES_SEED_MAX_CHARS): { text: string; truncated: boolean } {
  const t = String(text ?? '').trim();
  if (t.length <= max) return { text: t, truncated: false };
  return {
    text: `${t.slice(0, max)}\n\n[주의: 규칙 파일이 ${max.toLocaleString('en-US')}자를 넘어 여기서 잘렸습니다. 나머지는 ${RULES_FILE_NAME} 파일을 직접 읽으세요.]`,
    truncated: true
  };
}

export function buildMichaelSeed(input: {
  rulesText: string | null;
  rulesPath?: string;
  departments: Array<{ dept: DepartmentSpec; res: DepartmentResolution }>;
}): string {
  const parts: string[] = [];
  parts.push('=== 사용자 운영 규칙 (반드시 따를 것) ===');
  if (input.rulesText && input.rulesText.trim()) {
    const where = input.rulesPath ? ` 원본: ${input.rulesPath}` : '';
    parts.push(`아래는 사용자가 정한 규칙이다. 다른 지시와 충돌하면 이 규칙과 사용자의 직접 지시를 우선한다.${where}`);
    parts.push(capRulesText(input.rulesText).text);
  } else {
    parts.push('(규칙 파일을 읽지 못했다. 아래 부서표와 정책만 따른다.)');
  }
  parts.push('');
  parts.push('=== 현재 부서별 담당 AI (앱이 이 PC에서 확인한 실제 상태) ===');
  parts.push(formatDepartmentTable(input.departments));
  parts.push('"연결 필요"인 부서는 만들어 둔 척하지 말고 사용자에게 그대로 알린다. "연결됨"은 프로그램 설치 또는 API 키 저장만 확인한 것이며, 로그인 여부는 첫 실행에서 확인된다.');
  parts.push('');
  parts.push('=== 모델·추론 강도 ===');
  parts.push(modelPolicySeedText());
  parts.push('');
  parts.push('=== 사용자에게 알리기 전 ===');
  parts.push('모든 결과를 처음 요청과 하나씩 대조하고, 문제가 있으면 먼저 고치게 한 뒤 다시 검토한다(최대 2번). 실행해서 확인할 수 있는 것은 실행해 본 뒤에만 "완료"라고 한다.');
  parts.push('보고는 "결과:" 줄로 시작하고, 필요할 때만 "고친 것:", "내 결정 필요:", "못 한 것:" 줄을 붙인다. 과정 설명은 쓰지 않는다.');
  parts.push('돈이 드는 일, 파일 삭제·덮어쓰기, 비밀번호·API 키·토큰, 외부로 보내기·게시는 반드시 먼저 사용자에게 묻는다.');
  return parts.join('\n');
}
