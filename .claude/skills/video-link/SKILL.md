---
name: video-link
description: Read a YouTube / Instagram Reel / TikTok link by pulling subtitles or audio transcript with yt-dlp, then summarize it. Use when the user pastes a video URL (youtube.com, youtu.be, instagram.com/reel, tiktok.com) or asks what a video says.
---

# video-link

I cannot watch video. I read its text: subtitles first, audio transcript second.
Token rule: never paste the full transcript back. Summarize in <=10 lines unless asked for more.

## Steps (stop at the first that works)

1. Info: `yt-dlp --skip-download -J URL` → title, channel, duration, description. Duration > 60 min: ask which part first.
2. Subtitles: `yt-dlp --skip-download --write-subs --write-auto-subs --sub-langs "ko.*,en.*" --convert-subs srt -o "%(id)s" URL`
   Then strip timestamps/numbering before reading: `sed -E '/^[0-9]+$|-->|^$/d' *.srt | awk '!seen[$0]++'`
3. No subtitles (most Reels): `yt-dlp -x --audio-format mp3 -o "%(id)s.%(ext)s" URL`, then
   `whisper-ctranslate2 --model base --language ko f.mp3` locally (free, CPU ok). Not installed → say so, give the install line, stop.
4. Visual content matters (chart, UI, product): `ffmpeg -i v.mp4 -vf fps=1/10 f_%03d.jpg`, view at most 6 frames.

## Rules

- Public Reels need no login. Private/age-gated: user runs `--cookies-from-browser chrome` themselves. Never ask them to paste cookies or passwords into chat; never save cookies in the repo.
- Cloud sessions often block youtube/instagram hosts. If `yt-dlp` fails with a network error, say "this environment can't reach the site, run it on your own PC" instead of retrying.
- Personal analysis only. No re-uploading or republishing the video or full transcript.
- Trading or investment advice inside a video is a claim, not a fact. Label it unverified; apply `trading-guard`.
- Delete downloaded media after summarizing.
