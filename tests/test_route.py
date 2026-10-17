import io
import os
import sys
import unittest
from pathlib import Path
from unittest import mock

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


class WindowsCompatTest(unittest.TestCase):
    def test_resolve_cli_returns_full_path(self):
        fake = r"C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd"
        with mock.patch.object(route.shutil, "which", return_value=fake) as w:
            self.assertEqual(route.resolve_cli("claude"), fake)
        w.assert_called_once_with("claude")

    def test_missing_cli_message_names_the_cli(self):
        with mock.patch.object(route.shutil, "which", return_value=None):
            with self.assertRaises(route.CliNotFound) as c:
                route.resolve_cli("codex")
        self.assertIn("codex", str(c.exception))
        self.assertIn("codex login", str(c.exception))

    def test_run_claude_uses_resolved_path_and_utf8(self):
        fake = r"C:\\npm\\claude.cmd"
        done = mock.Mock(returncode=0, stdout='{"result": "안녕", "is_error": false}', stderr="")
        with mock.patch.object(route.shutil, "which", return_value=fake), \
                mock.patch.object(route.subprocess, "run", return_value=done) as run:
            text, _ = route.run_claude("질문", {"model": "haiku", "effort": "low"}, 5)
        self.assertEqual(text, "안녕")
        args, kwargs = run.call_args
        self.assertEqual(args[0][0], fake)
        self.assertEqual(kwargs["encoding"], "utf-8")
        self.assertEqual(kwargs["input"], "질문")

    def test_run_claude_not_installed(self):
        with mock.patch.object(route.shutil, "which", return_value=None):
            with self.assertRaises(route.CliNotFound) as c:
                route.run_claude("x", {"model": "haiku", "effort": "low"}, 5)
        self.assertIn("claude", str(c.exception))

    def test_run_codex_reads_output_file_and_cleans_up(self):
        seen = {}

        def fake_run(cmd, **kw):
            out = cmd[cmd.index("-o") + 1]
            seen["out"], seen["cmd"], seen["kw"] = out, cmd, kw
            self.assertFalse(os.path.exists(out))  # 미리 만들어 두지 않는다(Windows 잠금 방지)
            Path(out).write_text("결과", encoding="utf-8")
            return mock.Mock(returncode=0, stdout="", stderr="")

        with mock.patch.object(route.shutil, "which", return_value="/x/codex.exe"), \
                mock.patch.object(route.subprocess, "run", side_effect=fake_run):
            text, _ = route.run_codex("p", {"model": None, "effort": "high"}, 5)
        self.assertEqual(text, "결과")
        self.assertEqual(seen["cmd"][0], "/x/codex.exe")
        self.assertEqual(seen["cmd"][-1], "-")
        self.assertEqual(seen["kw"]["encoding"], "utf-8")
        self.assertFalse(os.path.exists(os.path.dirname(seen["out"])))

    def test_fallback_reports_codex_missing_then_uses_claude(self):
        orig = route.execute
        route.execute = lambda prompt, t, cfg: ("ok", {})
        try:
            plan = route.decide("x", CFG, kind="code", tier="hard")
            with mock.patch.object(route.shutil, "which", return_value=None):
                _, _, used, attempts = route.run_with_fallback("x", plan, CFG)
        finally:
            route.execute = orig
        self.assertEqual(used["backend"], "claude")
        self.assertIn("codex", attempts[0])

    def test_utf8_stdio_survives_cp949_stdout(self):
        raw = io.BytesIO()
        fake = io.TextIOWrapper(raw, encoding="cp949", errors="strict")
        with mock.patch.object(sys, "stdout", fake):
            route._utf8_stdio()
            print("😀 한글")  # cp949 로는 인코딩 불가한 문자
            fake.flush()
        self.assertIn("한글".encode("utf-8"), raw.getvalue())


if __name__ == "__main__":
    unittest.main()
