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

