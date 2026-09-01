# Fortigate Ai Assistant 1.0.3

FortiGate 커넥터와 FortiAI `create_responses`를 사용해 여러 방화벽을 읽기 전용으로 조회·비교하는 FortiSOAR Drawer 위젯입니다.

## 주요 기능

- 한국어, 영어, 중국어를 포함한 다국어 UI와 설정 문구
- 다수 FortiGate 등록, 선택, 상태 확인 및 비교
- 6대 초과 시 자동 접힘, 검색, 선택/상태 요약과 반응형 카드 그리드
- 상태 점검 요청을 최대 5개로 제한해 대규모 환경에서의 부하 제어
- 정책, 연결성, 로그, 외부 노출, 그룹 확장과 방화벽 비교용 읽기 전용 도구

## 파일

- 소스: `src/fortigateaiassistant-1.0.3/`
- 배포 패키지: `dist/fortigateaiassistant-1_0_3.tgz`
- 패키지 SHA-256: `c55c7fde1be2304c5fd957b2252a510e59f28cd38279507d7f3ad81447c90cc3`

저장소 배포본은 다른 환경에서 바로 설정할 수 있도록 FortiGate/FortiAI Config ID 기본값을 비워 두었습니다.

## 요구사항

- FortiSOAR 8.0.0
- `fortigate-firewall` 커넥터 5.4.0
- FortiAI 커넥터/프록시 설정
- Widgets 모듈 Usage 권한 및 커넥터 설정 조회 권한

## 설치

1. Content Hub의 **Upload Widget**에서 `dist/fortigateaiassistant-1_0_3.tgz`를 선택합니다.
2. 같은 1.0.3이 이미 설치되어 있으면 **Replace existing version**을 선택합니다.
3. 설치 후 브라우저에서 `Cmd/Ctrl + Shift + R`로 캐시를 갱신합니다.
4. 초기 FortiGate Config ID, Connector Version, VDOM과 FortiAI Config ID를 설정합니다.

단순 수정 중 버전을 올리면 기존 배치 인스턴스의 설정이 고아화될 수 있으므로 1.0.3을 유지해 교체합니다.

## 재패키징 및 검증

저장소 루트에서 실행합니다.

```bash
python3 scripts/package_widget.py \
  widgets/fortigate-ai-assistant/src/fortigateaiassistant-1.0.3 \
  widgets/fortigate-ai-assistant/dist/fortigateaiassistant-1_0_3.tgz

python3 scripts/validate_repository.py
```

`content.json`의 SHA-256은 패키지를 다시 만들 때 새 값으로 갱신해야 합니다.
