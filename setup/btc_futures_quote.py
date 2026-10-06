"""바이낸스 BTCUSDT 선물 시세 조회 (읽기 전용, API 키 불필요, 표준 라이브러리만 사용).
주문/거래 기능 없음. 사용: python btc_futures_quote.py [심볼]"""
import json, sys, urllib.request

BASE = "https://fapi.binance.com"
sym = sys.argv[1] if len(sys.argv) > 1 else "BTCUSDT"

def get(path):
    with urllib.request.urlopen(f"{BASE}{path}", timeout=10) as r:
        return json.load(r)

t = get(f"/fapi/v1/ticker/24hr?symbol={sym}")
f = get(f"/fapi/v1/premiumIndex?symbol={sym}")
print(f"{sym} 현재가 {float(t['lastPrice']):,.1f} | 24h {t['priceChangePercent']}% | 거래대금 {float(t['quoteVolume'])/1e9:.2f}B USDT")
print(f"펀딩비 {float(f['lastFundingRate'])*100:.4f}% | 마크가 {float(f['markPrice']):,.1f}")
