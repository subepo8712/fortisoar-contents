# Connectors

FortiSOAR 커스텀 커넥터는 다음 구조로 등록합니다.

```text
connectors/<slug>/
├── README.md
├── content.json
├── src/<connector-name>-<version>/
│   ├── info.json
│   ├── connector.py
│   └── requirements.txt
└── dist/<connector-name>-<version_with_underscores>.tgz
```

`config` 예제에는 실제 비밀번호·API 키를 넣지 않습니다. 패키징 전 Python 문법, `info.json`, `check_health`와 operation dispatch 구조를 검증하고 macOS 메타데이터를 제거합니다.

각 커넥터 README에는 지원 operation과 인증 방식, 실제 검증한 FortiSOAR 버전/빌드, 설치·설정·Health Check·operation 검증·롤백 절차를 명시합니다. `content.json`의 `features`, `verifiedOn`, `applicationGuide`에도 같은 정보를 구조화해 기록합니다.
