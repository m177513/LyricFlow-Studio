"""Optional live-browser smoke test. Requires separately installed Playwright.
Not an ASR test, and not a substitute for Remotion Player/render runtime tests.
Run the local server and create the included synthetic demo first.
"""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
base = os.environ.get('LYRICFLOW_TEST_URL', 'http://127.0.0.1:4173')
checks = []
errors = []

def check(label, condition):
    if not condition:
        raise AssertionError(label)
    checks.append({'test': label, 'passed': True})

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('LYRICFLOW_TEST_CHROME', '/usr/bin/chromium'), headless=True, args=['--no-sandbox'])
    page = browser.new_page(viewport={'width':1600,'height':1100}, device_scale_factor=1)
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(base, wait_until='networkidle')
    check('한국어 로컬 작업 화면 로드', page.title() == 'LyricFlow Studio')
    page.locator('#open-demo').click()
    page.wait_for_function("document.querySelectorAll('.track-card').length === 2")
    page.wait_for_timeout(250)
    check('실제 데모 폴더 음원 2곡 스캔', page.locator('.track-card').count() == 2)
    check('합성 신호 데모임을 명시', page.locator('#demo-warning').is_visible())
    check('가사 줄 3개 표시', page.locator('#lines tr[data-line]').count() == 3)
    check('미설치 Remotion을 성공 미리보기로 위장하지 않음', page.locator('.static-label').is_visible())
    page.screenshot(path=str(root/'verification'/'browser-desktop.png'), full_page=True)
    row = page.locator('#lines tr[data-line]').nth(1)
    initial = float(row.locator('[data-time="startMs"]').input_value())
    row.locator('[data-select]').check()
    page.locator('#shift-plus').click()
    page.wait_for_function(f"Number(document.querySelectorAll('[data-time=\"startMs\"]')[1].value) === {round(initial+.1,3)}")
    check('선택 줄 0.1초 이동', abs(float(page.locator('[data-time="startMs"]').nth(1).input_value())-initial-.1)<.001)
    check('수동 수정 자동 잠금', '수동 잠금' in page.locator('#lines tr[data-line]').nth(1).inner_text())
    page.locator('#review-selected').click()
    page.wait_for_function("document.querySelectorAll('#lines tr[data-line]')[1].innerText.includes('검수 완료')")
    check('선택 줄 검수 완료 저장', True)
    page.reload(wait_until='networkidle')
    check('새로고침 후 수정값 보존', abs(float(page.locator('[data-time="startMs"]').nth(1).input_value())-initial-.1)<.001)
    page.locator('#lines tr[data-line]').nth(1).locator('[data-listen]').click()
    page.wait_for_timeout(200)
    check('선택 구간 실제 오디오 재생', page.locator('#audio').evaluate('(el) => !el.paused'))
    page.locator('#play').click()
    with page.expect_download() as info:
        page.locator('#export-srt').click()
    download = info.value
    download.save_as(str(root/'verification'/'browser-generated.srt'))
    check('브라우저에서 실제 SRT 파일 생성', (root/'verification'/'browser-generated.srt').stat().st_size > 0)
    page.locator('#suspicious').check()
    check('검수 완료 후 의심 줄 필터', page.locator('#lines tr[data-line]').count() == 0)
    page.locator('#suspicious').uncheck()
    page.locator('#render-one').click()
    page.wait_for_function("document.querySelector('.job.failed') !== null", timeout=15000)
    check('실제 Remotion 패키지 부재 오류를 UI에 표시', 'Remotion' in page.locator('.job.failed').first.inner_text())
    # Unsubmitted style edits should not be reset by SSE job events.
    page.locator('#font-size').fill('64')
    page.locator('#bottom').fill('15')
    page.wait_for_timeout(200)
    check('적용 전 스타일 입력 보존', page.locator('#font-size').input_value() == '64')
    page.locator('#save-style').click()
    page.wait_for_function("document.querySelector('#notice').textContent.includes('스타일을 적용')")
    page.reload(wait_until='networkidle')
    check('스타일 저장 및 다시 불러오기', page.locator('#font-size').input_value() == '64' and page.locator('#bottom').input_value() == '15')
    original = page.locator('#source-lyrics').input_value()
    page.locator('#source-lyrics').fill(original+'\n(보존되는 애드리브)')
    page.wait_for_timeout(1000)
    page.locator('#source-lyrics').blur()
    page.reload(wait_until='networkidle')
    check('원문 자동 저장과 괄호 보존', page.locator('#source-lyrics').input_value().endswith('(보존되는 애드리브)'))
    check('추가 가사에 임의 시간을 부여하지 않음', page.locator('[data-time="startMs"]').last.input_value() == '')
    page.set_viewport_size({'width':900,'height':1000})
    page.screenshot(path=str(root/'verification'/'browser-compact.png'), full_page=True)
    check('좁은 화면의 가로 넘침 없음', page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'))
    check('브라우저 JavaScript 런타임 오류 없음', len(errors) == 0)
    browser.close()

report = {'scope':'실제 Node 서버 + 기본 브라우저 검수 UI. Remotion 및 Whisper 추론 검증이 아님.', 'passed':len(checks), 'checks':checks, 'pageErrors':errors}
(root/'verification'/'browser-tests.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False,indent=2))
