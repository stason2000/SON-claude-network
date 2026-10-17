#!/usr/bin/env python3
"""명령 -> (백엔드, 모델, 추론강도) 선택 -> 실행 -> 결과 + 사용 내역 출력.

구독 기반: API 키 대신 설치된 공식 CLI(claude, codex)를 호출한다.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).parent
KINDS = ("code", "write", "analysis", "qa")

CODE_HINTS = re.compile(r"```|def |class |function|import |버그|에러|오류|리팩터|리팩토링|테스트 ?코드|구현|디버그|스택 ?트레이스|traceback|코드", re.I)
WRITE_HINTS = re.compile(r"써줘|작성|초안|번역|요약|이메일|카피|문구|블로그|다듬", re.I)
ANALYSIS_HINTS = re.compile(r"분석|비교|전략|설계|아키텍처|평가|검토|타당성|원인|계획|로드맵|손익|사업", re.I)
HARD_HINTS = re.compile(r"아키텍처|설계|전략|원인 분석|증명|최적화|보안|마이그레이션|전체 구조|트레이드오프|손익분기|여러 파일|근본", re.I)
STEP_HINTS = re.compile(r"(?:^|\n)\s*(?:\d+[.)]|[-*])\s", re.M)


def load_config(path=None):
    return json.loads(Path(path or HERE / "config.json").read_text(encoding="utf-8"))


def detect_kind(text):
    scores = {
        "code": len(CODE_HINTS.findall(text)),
        "write": len(WRITE_HINTS.findall(text)),
        "analysis": len(ANALYSIS_HINTS.findall(text)),
    }
    best = max(scores, key=scores.get)
    return best if scores[best] > 0 else "qa"


def jev_classify(text):
    """Jev 분류기 연결 지점. 연결 전에는 None을 반환해 휴리스틱을 쓴다.

    TODO: TypeSafe 문서(docs.typesafe.ai)의 /v1/systemone 요청 형식을 확인한 뒤
    tier 라벨(trivial..expert)을 돌려주도록 구현. 확인 없이 추측해서 호출하지 않는다.
    """
    return None


def heuristic_tier(text):
    n = len(text)
    score = 0
    score += 0 if n < 80 else 1 if n < 400 else 2 if n < 1500 else 3
    score += min(len(STEP_HINTS.findall(text)), 3)
    score += 2 * min(len(HARD_HINTS.findall(text)), 2)
    score += 1 if CODE_HINTS.search(text) and n > 300 else 0
    if score <= 0:
        return "trivial"
    if score <= 2:
        return "easy"
    if score <= 4:
        return "medium"
    if score <= 7:
        return "hard"
    return "expert"


def decide(text, cfg, kind=None, tier=None):
    kind = kind or detect_kind(text)
    tier = tier or jev_classify(text) or heuristic_tier(text)
    target = dict(cfg["tiers"][tier])
    target.update(cfg.get("kind_overrides", {}).get(kind, {}).get(tier, {}))
    sensitive = any(re.search(p, text, re.I) for p in cfg["sensitive_patterns"])
    if sensitive and target["backend"] == "freellmapi":
        target = dict(cfg["tiers"][tier])  # 민감정보는 무료 제공자로 보내지 않는다
    return {"kind": kind, "tier": tier, "sensitive": sensitive, **target}


def run_claude(prompt, t, timeout):
    cmd = ["claude", "-p", "--model", t["model"], "--effort", t["effort"],
           "--output-format", "json", "--no-session-persistence"]
    p = subprocess.run(cmd, input=prompt, capture_output=True, text=True, timeout=timeout)
    if p.returncode != 0:
        raise RuntimeError(p.stderr.strip() or "claude 실패")
    data = json.loads(p.stdout)
    if data.get("is_error"):
        raise RuntimeError(str(data.get("result")))
    return data["result"], {"cost_usd": data.get("total_cost_usd"), "usage": data.get("usage")}


def run_codex(prompt, t, timeout):
    with tempfile.NamedTemporaryFile(suffix=".txt", delete=False) as f:
        out = f.name
    cmd = ["codex", "exec", "--skip-git-repo-check", "-s", "read-only",
           "-c", f'model_reasoning_effort="{t["effort"]}"', "-o", out]
    if t.get("model"):
        cmd += ["-m", t["model"]]
    cmd.append("-")
    try:
        p = subprocess.run(cmd, input=prompt, capture_output=True, text=True, timeout=timeout)
        if p.returncode != 0:
            raise RuntimeError(p.stderr.strip()[-500:] or "codex 실패")
        return Path(out).read_text(encoding="utf-8").strip(), {}
    finally:
        Path(out).unlink(missing_ok=True)


def run_freellmapi(prompt, t, timeout, cfg):
    fc = cfg["freellmapi"]
    base, key = os.environ.get(fc["base_url_env"]), os.environ.get(fc["api_key_env"], "")
    if not fc.get("enabled") or not base:
        raise RuntimeError("freellmapi 비활성")
    body = json.dumps({"model": fc["model"], "messages": [{"role": "user", "content": prompt}]}).encode()
    req = urllib.request.Request(base.rstrip("/") + "/chat/completions", body,
                                 {"Content-Type": "application/json", "Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        d = json.load(r)
    return d["choices"][0]["message"]["content"], {"usage": d.get("usage")}


def execute(prompt, t, cfg):
    timeout = cfg["timeout_sec"]
    b = t["backend"]
    if b == "claude":
        return run_claude(prompt, t, timeout)
    if b == "codex":
        return run_codex(prompt, t, timeout)
    if b == "freellmapi":
        return run_freellmapi(prompt, t, timeout, cfg)
    raise RuntimeError(f"알 수 없는 백엔드: {b}")


def run_with_fallback(prompt, plan, cfg):
    """백엔드 실패(미설치/한도 초과 등) 시 claude로 대체, 그래도 실패하면 한 단계 위 tier로 재시도."""
    attempts = []
    order = cfg["escalation"]
    tier = plan["tier"]
    for _ in range(2):
        t = {**plan, **cfg["tiers"][tier]} if tier != plan["tier"] else plan
        for cand in (t, {**cfg["tiers"][tier]}):
            if cand["backend"] != "claude" and shutil.which(cand["backend"]) is None and cand["backend"] != "freellmapi":
                attempts.append(f'{cand["backend"]}: 미설치')
                continue
            try:
                text, meta = execute(prompt, cand, cfg)
                if text.strip():
                    return text, meta, cand, attempts
                attempts.append(f'{cand["backend"]}/{cand.get("model")}: 빈 응답')
            except Exception as e:  # noqa: BLE001
                attempts.append(f'{cand["backend"]}/{cand.get("model")}: {e}')
        i = order.index(tier)
        if i + 1 >= len(order):
            break
        tier = order[i + 1]
    raise RuntimeError("모든 시도 실패:\n" + "\n".join(attempts))


def log_usage(cfg, record):
    p = Path(os.path.expanduser(cfg["log_file"]))
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def main(argv=None):
    ap = argparse.ArgumentParser(description="명령에 맞는 모델/추론강도를 골라 실행")
    ap.add_argument("prompt", nargs="?", help="명령(생략 시 stdin)")
    ap.add_argument("--dry-run", action="store_true", help="실행 없이 선택 결과만 출력")
    ap.add_argument("--tier", choices=["trivial", "easy", "medium", "hard", "expert"], help="tier 강제")
    ap.add_argument("--kind", choices=KINDS, help="작업 종류 강제")
    ap.add_argument("--config")
    a = ap.parse_args(argv)
    prompt = a.prompt if a.prompt is not None else sys.stdin.read()
    if not prompt.strip():
        ap.error("명령이 비어 있습니다")
    cfg = load_config(a.config)
    plan = decide(prompt, cfg, a.kind, a.tier)
    label = f'{plan["kind"]}/{plan["tier"]} -> {plan["backend"]}:{plan.get("model") or "default"}:{plan["effort"]}'
    if a.dry_run:
        print(label + (" (민감정보 감지)" if plan["sensitive"] else ""))
        return 0
    start = time.time()
    text, meta, used, attempts = run_with_fallback(prompt, plan, cfg)
    sec = round(time.time() - start, 1)
    log_usage(cfg, {"ts": int(start), "plan": label, "used": f'{used["backend"]}:{used.get("model")}:{used["effort"]}',
                    "sec": sec, "attempts": attempts, **meta})
    print(text)
    print(f'\n---\n[{label}] 실제 실행: {used["backend"]}:{used.get("model") or "default"}:{used["effort"]} · {sec}s'
          + (f' · 대체 {len(attempts)}회' if attempts else ""), file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
