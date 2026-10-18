# LyricFlow Studio 편집 기능 조사 및 적용 범위

2026-09-18 기준으로 Premiere, CapCut, Movavi의 공식 기능 문서를 비교해 현재 앱에 필요한 공통 기능을 정리했다.

## 조사한 공통 기능

| 기능 | 상용 편집기에서의 용도 | LyricFlow 적용 |
| --- | --- | --- |
| 멀티트랙 타임라인·레이어 | 영상, 자막, 오디오를 독립적으로 편집 | 가사 레이어와 복사 블록, 원본 파형을 유지 |
| 선택·범위 선택·복사·삭제 | 여러 클립을 한 번에 이동·복제·삭제 | 기존 기능을 유지하고 합치기·분할을 추가 |
| 트림·스플릿·리플 편집 | 클립의 시작/끝과 분할 지점 조정 | 가사 구간 트림, 재생 위치 분할, 더블클릭 추가 |
| 스냅·줌·재생 위치 추적 | 타이밍 정밀 조정 | 끝점 맞춤, 확대, 재생 따라가기 |
| 마커 | 비트·장면·검수 지점 표시 | 트랙 마커 추가·이름 변경·삭제·이동 |
| 자막·텍스트 스타일 | 표시 문구, 위치, 외곽선, SRT/번인 출력 | 가사 타이밍·스타일·SRT·동일 Remotion 출력 |
| 파형·오디오 확인 | 소리와 편집 지점 동기화 | 원본 파형과 구간 듣기 |
| 검색·필터·검수 상태 | 긴 시퀀스에서 필요한 항목 찾기 | 가사 검색, 의심/제외 필터, 잠금·검수 상태 |
| 실행 취소·다시 실행 | 실수 복구 | 트랙 단위 undo/redo |
| 키보드 조작 | 반복 작업 속도 향상 | I/O, 화살표, Space, J/K/L, Home/End, M |

## 공식 자료

- [Adobe Premiere 기능](https://www.adobe.com/products/premiere/features.html), [키보드 단축키](https://helpx.adobe.com/premiere/desktop/get-started/keyboard-shortcuts/default-keyboard-shortcuts.html), [캡션 개요](https://helpx.adobe.com/ph_fil/premiere/desktop/add-text-images/insert-captions/about-captions.html)
- [CapCut 자동 영상 편집기](https://www.capcut.com/tools/auto-video-editor), [자르기·분할](https://www.capcut.com/resource/crop-and-trim-video), [키프레임](https://www.capcut.com/tools/keyframe-animation)
- [Movavi Video Editor](https://www.movavi.com/video-editor-plus/), [MOV 편집 기능](https://www.movavi.com/tools/mov-editor/), [자동 자막](https://www.movavi.com/support/how-to/how-to-add-subtitles-to-video-automatically/)

## 이번 적용

- 트랙별 마커를 프로젝트에 저장하고 undo/redo에 포함했다. 현재 위치에서 `M` 또는 `마커 추가 (M)`으로 만들고, 이름을 바로 고치거나 삭제할 수 있다.
- 타임라인 멀티선택 메뉴에 `합치기`와 `현재 위치에서 분할`을 추가했다. 합치기는 연속된 시간 지정 가사를 한 줄로 묶고, 분할은 선택 줄의 재생 위치를 공백 경계로 나눈다. 둘 다 수동 편집 플래그를 남긴다.
- 가사 목록 검색과 `Ctrl/Cmd+F` 포커스를 추가했다.
- `Home/End`, `J/K/L`, `M` 단축키를 추가했다. 기존 `I/O`, 화살표, `Space`도 유지한다.

## 적용하지 않은 기능과 이유

일반 영상 편집기의 전환 효과, 색보정, 키프레임, 스티커, TTS, 자동 생성, 클라우드 협업은 조사에서 확인했지만 현재 제품의 입력이 원본 음원·이미지와 가사 타이밍으로 제한된 로컬 작업대와 직접 맞지 않는다. 이를 억지로 붙이면 원본 보존, 가사 검수, 동일 미리보기/출력이라는 현재 계약을 흔들 수 있다. 필요성이 확인되는 항목은 별도 설계 후 추가한다.
