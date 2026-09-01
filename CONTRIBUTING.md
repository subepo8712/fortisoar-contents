# 콘텐츠 등록 가이드

## 공통 원칙

- 콘텐츠마다 고유한 소문자 `slug` 디렉터리를 사용합니다.
- 원본 소스와 FortiSOAR에 업로드할 배포 산출물을 함께 보관합니다.
- `content.json`에는 현재 배포 버전과 검증된 플랫폼을 기록합니다.
- 루트 `catalog.json`의 `path`는 콘텐츠 디렉터리를 가리켜야 합니다.
- 생성 파일이나 패키지에 자격 증명과 환경별 비밀값이 없는지 확인합니다.

## 권장 디렉터리

```text
<category>/<slug>/
├── README.md
├── content.json
├── src/       # 편집 가능한 원본
├── dist/      # FortiSOAR 업로드/임포트 산출물
└── examples/  # 선택: 비밀값이 제거된 예제 설정
```

콘텐츠별 세부 규칙은 각 카테고리의 README를 따릅니다. 위젯은 `scripts/validate_repository.py`가 자동으로 엄격하게 검사합니다. 커넥터와 플레이북 검사는 향후 해당 콘텐츠가 추가될 때 같은 검증기에 확장합니다.

