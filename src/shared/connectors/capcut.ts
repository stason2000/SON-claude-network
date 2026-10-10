import type { UnavailableConnector } from './types';

/**
 * CapCut — GUI video editor. As of 2026-10-10 no official, documented public API
 * for automatically driving CapCut editing was found: capcut.com exposes no
 * developer/API page (/developer → 404), developer.capcut.com / open.capcut.com did
 * not resolve, and every "CapCut API" search hit was a third-party / unofficial
 * project (draft-file generators, reverse-engineered tools). Automating the GUI
 * (clicks / keystrokes) would be fragile and is not offered.
 * verified:false — the ABSENCE of an official API could not be positively confirmed
 * from an official source; re-check if ByteDance publishes one.
 */
const capcut: UnavailableConnector = {
  id: 'capcut',
  label: 'CapCut',
  kind: 'unavailable',
  needsKey: false,
  strengths: ['video'],
  docsUrl: 'https://www.capcut.com/',
  verified: false,
  verifiedNote: 'No official automation API found on capcut.com or via search (2026-10-10); only unofficial third-party tools exist.',
  reason: {
    ko: '공식 자동 실행 방법(API·CLI)이 없는 화면 전용 프로그램입니다. 비공식 도구나 화면 조작 흉내는 불안정해서 연결하지 않습니다.',
    en: 'GUI-only app with no official automation API or CLI. Unofficial tools and simulated clicks are unreliable, so it is not connected.'
  }
};

export default capcut;
