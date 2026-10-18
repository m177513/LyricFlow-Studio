# GPU 렌더 기본값 (2026-09-14)

worker/render.mjs는 이제 매 출력 전에 Remotion과 같은 FFmpeg로 GPU 인코딩을 시험한다. 지원하면 NVENC(Windows/Linux) 또는 VideoToolbox(macOS)를 required 모드로 사용한다. GPU가 없거나 드라이버 시험이 실패하면 CPU libx264로 전환하며 이유를 로그에 표시한다. GPU 사용을 조용히 포기하지 않도록 실제 FFmpeg 인코더를 확인하고 render-performance.json에 기록한다.

GPU 화질은 1080p30 기준 12Mbps 목표 비트레이트이며 해상도/fps에 맞춰 증가한다. GPU와 호환되지 않는 CRF는 GPU 경로에서 전달하지 않는다. CPU 경로는 기존 CRF18을 유지한다. H264/AAC320k/yuv420p, 해상도, 가사, 음원 및 전환 시간은 동일하다.

동시 처리는 CPU 스레드 절반, 최대8, 가용 메모리를 기준으로 정한다. 이번 PC(Ryzen7500F,32GB,RTX4060Ti)에서는6으로 선택됐다. LYRICFLOW_RENDER_DEVICE=auto(기본)/gpu/cpu, LYRICFLOW_RENDER_CONCURRENCY=1~16으로 명시할 수 있다. gpu 직접 선택에서 시험 실패 시 오류로 종료한다.

## 실제 검증
- NVIDIA 드라이버560.94에서 bundled FFmpeg NVENC 실제 인코딩 성공.
- 동일한12초 1920x1080 자막 fixture: 기존 CPU2 전체19.1558초, GPU6 전체15.0058초(약22% 감소). 두 실행 모두1443초 기존 합본 렌더와 동시 실행 중이었으므로 장시간 속도 보장이나 GPU만의 기여도로 해석하지 않는다.
- GPU 렌더 단계10.9497초, 실제 인코더h264_nvenc 기록 확인.
- 두 파일 H264/AAC,12.053333초,전체 디코딩 PASS. 실제 GPU MP4의 긴 두줄 자막 화면 직접 확인 PASS.
- Chrome ANGLE 옵션 별도 비교10.6554초로 차이가 작아 추가옵션은 채택하지 않았다.
- npm test57 PASS. GPU실패 fallback,강제GPU 실패,CRF상충 방지,메모리/병렬처리 제한 포함.
- 이미 실행 중이던 합본은 기존 프로세스로 계속 출력한다. 이후 시작되는 작업은 서버 재시작 없이 수정된worker를 읽는다.

증거: acceptance/render-gpu-20260914/comparison.json, gpu/render-performance.json, gpu/actual-caption.png.
공식 설정: https://www.remotion.dev/docs/renderer/render-media (hardwareAcceleration, crf, concurrency), https://www.remotion.dev/docs/gpu
