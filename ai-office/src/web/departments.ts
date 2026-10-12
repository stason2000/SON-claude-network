import type { Department } from '../shared/types.js';

export interface Capability {
  name: string;
  /** 구현 예정 단계 (1~5) */
  stage: number;
  note?: string;
}

export interface DepartmentInfo {
  path: string;
  summary: string;
  capabilities: Capability[];
  warning?: string;
}

export const DEPARTMENT_INFO: Record<Exclude<Department, 'general'>, DepartmentInfo> = {
  dev: {
    path: '/dev',
    summary: '허가된 작업 폴더 안에서 코드를 분석·작성·테스트하는 부서입니다.',
    capabilities: [
      { name: '프로젝트 코드 분석', stage: 3 },
      { name: '파일 생성 및 수정 (변경 전후 diff 기록)', stage: 3 },
      { name: '테스트 실행 및 오류 분석', stage: 3 },
      { name: '코드 수정 제안', stage: 3 },
      { name: '파일 삭제·외부 배포 등 위험 작업 승인 절차', stage: 4 },
    ],
  },
  research: {
    path: '/research',
    summary: '자료를 조사하고 분석해 출처가 있는 보고서를 만드는 부서입니다.',
    capabilities: [
      { name: '웹 자료 조사', stage: 3 },
      { name: '정보 분석 및 기술 비교', stage: 3 },
      { name: '보고서 작성 및 저장', stage: 3 },
      { name: '자료 출처 기록', stage: 3 },
    ],
  },
  trading: {
    path: '/trading',
    summary: '전략 연구와 백테스트를 위한 부서입니다. 현재는 화면과 부서 구조만 준비되어 있습니다.',
    warning:
      '거래소(Binance 등) API 연결, 주문 실행, 레버리지 적용, 자동매매는 이 프로젝트의 현재 범위에 포함되어 있지 않으며 어떤 기능도 구현되어 있지 않습니다.',
    capabilities: [
      { name: 'TradingView 전략 연구', stage: 5 },
      { name: 'Binance USDT-M 선물 분석 (시장 데이터 조회)', stage: 5 },
      { name: '전략 백테스트', stage: 5 },
      { name: '모의매매 (가상 주문만)', stage: 5 },
      { name: '매매 성과 분석', stage: 5 },
    ],
  },
};
