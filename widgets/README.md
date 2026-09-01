# Widgets

각 위젯은 `widgets/<slug>`에 보관합니다. 편집 가능한 버전별 소스는 `src/`, Content Hub 업로드 패키지는 `dist/`에 둡니다.

위젯 버전은 FortiSOAR의 DB 식별자 역할을 하므로 단순 버그 수정 중 임의로 올리지 않습니다. TGZ 내부 루트 디렉터리, `info.json`의 `name`과 `version`, HTML의 정적 자산 경로가 서로 일치해야 합니다.

각 위젯의 README에는 지원 기능, 실제 검증된 FortiSOAR 버전/빌드, Content Hub 신규 설치 및 동일 버전 교체, 초기 설정, 검증과 롤백 절차를 기록합니다. `content.json`의 `features`, `verifiedOn`, `applicationGuide`와 내용이 일치해야 합니다.
