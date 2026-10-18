# 구조와 데이터 계약

```text
로컬 브라우저
  web/index.html + app.js + styles.css
        │ HTTP JSON + SSE (127.0.0.1)
  server/main.mjs ─ store.mjs ─ 프로젝트 JSON/캐시/이력
        │
  jobs.mjs (한 작업씩 실행, 입력 스냅샷)
        ├─ suno.mjs: 공개 원문 가져오기
        ├─ worker/align.py → faster-whisper → alignment.py → 선택 stable-ts
        └─ worker/render.mjs → 동일 LyricVideo → MP4 / 검증 / SRT / 챕터

브라우저 Player: video/player.tsx → video/LyricVideo.tsx
최종 영상:      video/Root.tsx  → video/LyricVideo.tsx
```

UI 전체를 React 빌드에 종속시키지 않았습니다. Node 표준 라이브러리의 서버와 가벼운 HTML/JS 검수 셸은 설치 전에도 점검 가능하고, Remotion Player 부분만 React 번들입니다. 아직 설치되지 않은 Player는 명확한 정지 이미지/기본 오디오 대체 화면으로 표시합니다.

## 프로젝트 스키마 1

곡마다 UUID, 제목, `{name, size, mtimeMs, sha256, durationMs}` 음원 정보, 이미지 이름, Suno URL/메타데이터, `sourceLyrics`, `lines`, `analysis`, `history`, `instrumental`을 저장합니다. 실제 정확한 필드는 `server/store.mjs`의 생성 코드를 기준으로 확인하세요. 프로젝트 자체에 revision, 스타일, 순서, 작업 기록을 저장합니다.

줄에는 ID, 원문 기반 표시 텍스트, 발생 순서, `startMs/endMs`(둘 다 null 또는 유효한 쌍), `locked`, `reviewed`, `flags`, 어휘 대응 정보가 있습니다. 모호한 줄의 null을 0으로 치환하지 않습니다. 인식된 추가 애드리브 등은 원문을 고치지 않고 분석 근거에 남깁니다.

Remotion으로 전달되는 자막은 `@remotion/captions`의 Caption 계약인 text/startMs/endMs/timestampMs/confidence입니다. confidence는 null로 둡니다. 어휘 비율을 시간 정확도의 확률로 오인시키지 않습니다.

## 주요 API

| 방법·경로 | 기능 |
|---|---|
| GET `/api/session` | 로컬 세션 token, 마지막 폴더, Player 설치 여부 |
| GET `/api/events` | SSE 실제 상태 이벤트 |
| POST `/api/project/open` | `{folder}` 등록/다시 읽기 |
| GET `/api/project` | 현재 공개 프로젝트 데이터 |
| PATCH `/api/tracks/:id` | `{revision, patch}` 가사/제목/타이밍 수정 |
| POST `/api/tracks/:id/undo` | `{revision}` 이전 원문·줄 복구 |
| PATCH `/api/style` | `{revision, style}` 영상 스타일 |
| PATCH `/api/order` | `{revision, ids}` 곡 순서 |
| GET `/api/tracks/:id/preview` | 실제 공용 Remotion 입력 데이터 |
| GET `/api/tracks/:id/srt` | 검사 통과한 SRT |
| POST `/api/jobs` | `{type, trackIds, settings}` align/suno/render/playlist |
| GET `/api/jobs` | 작업 목록 |
| POST `/api/jobs/:id/cancel` | `{}` 작업 취소 |
| GET `/api/jobs/:id/output/:index` | 성공한 출력 파일 |
| GET `/api/doctor` | 실행 파일·패키지 실제 확인 |
| POST `/api/folder-picker` | `{}` 사용자가 요청한 네이티브 폴더 선택 |

수정 요청은 `/api/session`에서 받은 `X-LyricFlow-Token`과 JSON Content-Type이 필요합니다. Origin/Host 검사도 유지합니다. 악성 외부 페이지가 로컬 파일 경로를 지시하도록 CORS를 열지 마세요. 파일을 주는 엔드포인트는 등록된 원본·출력 경계만 허용합니다.

## 캐시와 동시성

ASR 캐시는 원본 음원 해시, 모델·언어·장치·설치 환경에 종속됩니다. 정렬 캐시는 원문/설정까지 반영하며, 이미지·색상만 바뀌면 인식을 다시 하지 않습니다. 결과 적용 전 현재 음원·원문의 fingerprint를 확인하고 잠긴 수동 줄을 병합합니다. 원문 편집 중 들어온 이전 작업 결과는 적용하지 않습니다.

클라이언트 수정에는 revision을 사용합니다. 잘못된 입력은 사본에서 검사해 부분 변경을 막습니다. JSON은 임시 파일 fsync 후 rename으로 바꾸며, 파손된 JSON을 빈 프로젝트로 간주해 조용히 덮어쓰지 않습니다. 단일 서버/개인 사용을 전제로 하며 다중 프로세스 쓰기 잠금은 없습니다.

음원 스냅샷은 렌더링 시 복사 후 해시를 다시 확인합니다. 취소/실패한 부분 출력이 성공 다운로드로 등록되지 않으며 다음 큐 작업은 계속합니다. 실패한 부분 폴더는 원인 확인을 위해 남을 수 있습니다.
