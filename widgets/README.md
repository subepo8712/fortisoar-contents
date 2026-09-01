# Widgets

각 위젯은 `widgets/<slug>`에 보관합니다. 편집 가능한 버전별 소스는 `src/`, Content Hub 업로드 패키지는 `dist/`에 둡니다.

위젯 버전은 FortiSOAR의 DB 식별자 역할을 하므로 단순 버그 수정 중 임의로 올리지 않습니다. TGZ 내부 루트 디렉터리, `info.json`의 `name`과 `version`, HTML의 정적 자산 경로가 서로 일치해야 합니다.

