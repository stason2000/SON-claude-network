import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "router"))
import route  # noqa: E402

CFG = route.load_config()


class DecideTest(unittest.TestCase):
    def test_short_question_is_cheap(self):
        p = route.decide("서울 인구가 몇 명이야?", CFG)
        self.assertEqual(p["tier"], "trivial")
        self.assertEqual(p["model"], "haiku")

    def test_hard_design_goes_to_top(self):
        text = "다음 서비스의 전체 구조 아키텍처 설계와 트레이드오프를 분석해줘.\n1. 인증\n2. 결제\n3. 보안\n" + "상세 요구사항. " * 80
        p = route.decide(text, CFG)
        self.assertIn(p["tier"], ("hard", "expert"))

    def test_code_hard_routes_to_codex(self):
        p = route.decide("버그 고쳐줘", CFG, kind="code", tier="hard")
        self.assertEqual(p["backend"], "codex")

    def test_sensitive_detected(self):
        self.assertTrue(route.decide("내 비밀번호 정리해줘", CFG)["sensitive"])

    def test_kind_detection(self):
        self.assertEqual(route.detect_kind("이 함수 버그 수정해줘 ```def a(): pass```"), "code")
        self.assertEqual(route.detect_kind("이메일 초안 써줘"), "write")


class FallbackTest(unittest.TestCase):
    def test_falls_back_when_backend_missing(self):
        calls = []
        orig = route.execute
        route.execute = lambda prompt, t, cfg: (calls.append(t["backend"]) or ("ok", {}))
        try:
            plan = route.decide("x", CFG, kind="code", tier="hard")
            plan["backend"] = "nonexistent-cli"
            text, _, used, attempts = route.run_with_fallback("x", plan, CFG)
        finally:
            route.execute = orig
        self.assertEqual(text, "ok")
        self.assertEqual(used["backend"], "claude")
        self.assertTrue(attempts)


if __name__ == "__main__":
    unittest.main()
