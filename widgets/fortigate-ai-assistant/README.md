# Fortigate Ai Assistant 1.0.3

FortiGate 커넥터와 FortiAI `create_responses`를 사용해 여러 방화벽을 읽기 전용으로 조회·비교하는 FortiSOAR Drawer 위젯입니다.

## 지원 기능

- **다국어 UI/설정**: 한국어, 영어, 중국어 선택에 따라 본문과 커넥터 설정 문구가 함께 변경됩니다.
- **다중 FortiGate 관리**: 여러 커넥터 Config를 등록하고 활성 장비를 선택하거나 상태를 비교합니다.
- **대규모 장비 UI**: 6대 초과 시 목록을 자동으로 접고 검색, 선택/상태 요약과 반응형 카드 그리드를 제공합니다.
- **상태 점검 부하 제어**: Health Check를 동시에 최대 5개만 실행해 수십 대 환경의 요청 폭주를 제한합니다.
- **읽기 전용 분석**: 정책, 연결성, 로그, 외부 노출, 주소/서비스 그룹 확장과 방화벽 간 비교를 지원합니다.
- **자연어 답변**: FortiAI `create_responses`가 읽기 전용 도구를 선택하고 결과를 사용자가 선택한 언어로 요약합니다.

제약: 이 위젯은 방화벽 설정 변경 operation을 제공하지 않으며, Connector Config ID와 VDOM 접근 권한이 별도로 필요합니다.

## 검증된 FortiSOAR 버전

| FortiSOAR | 검증일 | 결과 | 검증 범위 |
|---|---|---|---|
| 8.0.0-6034 | 2026-09-01 | 통과 | TGZ/JS 검사, 동일 버전 적용, Content Hub 인식과 Preview, 설치 자산 HTTP 200, 다국어 설정, 24대 장비 컨트롤러 동작 |

`info.json`은 FortiSOAR `8.0.0` 호환성을 선언합니다. 위 표에 없는 버전은 호환성 선언 또는 코드 검토와 별개로 실제 적용 검증이 완료되지 않은 상태입니다.

## 파일

- 소스: `src/fortigateaiassistant-1.0.3/`
- 배포 패키지: `dist/fortigateaiassistant-1_0_3.tgz`
- 패키지 SHA-256: `c55c7fde1be2304c5fd957b2252a510e59f28cd38279507d7f3ad81447c90cc3`

저장소 배포본은 다른 환경에서 바로 설정할 수 있도록 FortiGate/FortiAI Config ID 기본값을 비워 두었습니다.

## 적용 가이드

### 1. 사전 요구사항

- FortiSOAR 8.0.0
- `fortigate-firewall` 커넥터 5.4.0
- FortiAI 커넥터/프록시 설정
- Widgets 모듈 Usage 권한 및 커넥터 설정 조회 권한

### 2. 신규 설치 또는 동일 버전 교체

1. Content Hub의 **Upload Widget**에서 `dist/fortigateaiassistant-1_0_3.tgz`를 선택합니다.
2. 같은 1.0.3이 이미 설치되어 있으면 **Replace existing version**을 선택합니다.
3. 설치 후 브라우저에서 `Cmd/Ctrl + Shift + R`로 캐시를 갱신합니다.

단순 수정 중 버전을 올리면 기존 배치 인스턴스의 설정이 고아화될 수 있으므로 1.0.3을 유지해 교체합니다. 신규 버전은 설정 호환성이 깨지거나 공식 릴리스로 분리할 때만 만듭니다.

### 3. 초기 설정

1. 위젯 Preview 또는 Drawer에서 초기 설정을 엽니다.
2. FortiGate Connector Config ID, Connector Version `5.4.0`, VDOM을 입력합니다.
3. FortiAI Config ID와 버전 `2.0.0`을 입력합니다.
4. 위젯 우측 상단 설정에서 추가 FortiGate를 등록하고 필요한 장비를 선택합니다.

저장소 배포본에는 환경별 Config ID가 포함되지 않으므로 대상 환경의 값을 직접 지정해야 합니다.

### 4. 적용 확인

1. Content Hub Manage에서 `Fortigate Ai Assistant 1.0.3`이 설치 상태인지 확인합니다.
2. Drawer를 열어 언어를 변경하고 커넥터 선택/로딩/오류 문구도 같은 언어로 바뀌는지 확인합니다.
3. FortiGate 카드의 선택, 검색, 전체 점검과 활성 장비 전환을 확인합니다.
4. 브라우저 Network에서 다음 자산이 HTTP 200인지 확인합니다.

```text
/widgets/installed/fortigateaiassistant-1.0.3/view.controller.js
/widgets/installed/fortigateaiassistant-1.0.3/view.html
```

5. 읽기 전용 질문 한 건을 실행해 FortiGate/FortiAI 커넥터 호출과 답변 생성을 확인합니다.

### 5. 롤백

- Content Hub에서 배포 전 동일 버전 TGZ를 **Replace existing version**으로 다시 업로드하고 캐시를 강제 갱신합니다.
- 서버 파일만 삭제하면 DB 고아 레코드가 남을 수 있으므로 설치 제거는 Content Hub의 **Uninstall**을 사용합니다.
- 운영 설정을 보존해야 하면 Content Hub 교체 전에 기존 TGZ와 위젯 설정을 백업합니다.

## 재패키징 및 검증

저장소 루트에서 실행합니다.

```bash
python3 scripts/package_widget.py \
  widgets/fortigate-ai-assistant/src/fortigateaiassistant-1.0.3 \
  widgets/fortigate-ai-assistant/dist/fortigateaiassistant-1_0_3.tgz

python3 scripts/validate_repository.py
```

`content.json`의 SHA-256은 패키지를 다시 만들 때 새 값으로 갱신해야 합니다.
