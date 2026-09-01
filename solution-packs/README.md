# Solution Packs

위젯, 커넥터, 플레이북과 데이터 모델을 묶어 배포해야 할 때 사용합니다.

```text
solution-packs/<slug>/
├── README.md
├── content.json
├── src/       # 구성 목록과 편집 가능한 원본
└── dist/      # FortiSOAR export/import 패키지
```

README에는 포함 콘텐츠와 버전, 설치 순서, 대상 FortiSOAR 버전, 업그레이드 및 제거 시 주의사항을 기록합니다.

`content.json`에는 솔루션 팩이 제공하는 기능, 실제 검증한 FortiSOAR 버전/빌드, 적용 가이드 경로를 기록합니다. 적용 가이드는 Import 순서, 의존성, 설치 후 검증, 업그레이드와 롤백을 포함해야 합니다.
