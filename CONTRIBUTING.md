# 콘텐츠 등록 가이드

## 공통 원칙

- 콘텐츠마다 고유한 소문자 `slug` 디렉터리를 사용합니다.
- 원본 소스와 FortiSOAR에 업로드할 배포 산출물을 함께 보관합니다.
- `content.json`에는 현재 배포 버전, 검증된 FortiSOAR 전체 버전/빌드, 검증일과 검증 범위를 기록합니다.
- 루트 `catalog.json`의 `path`는 콘텐츠 디렉터리를 가리켜야 합니다.
- 생성 파일이나 패키지에 자격 증명과 환경별 비밀값이 없는지 확인합니다.
- README에는 `지원 기능`, `검증된 FortiSOAR 버전`, `적용 가이드` 섹션을 반드시 작성합니다.

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

## content.json 필수 배포 정보

```json
{
  "features": ["지원 기능 1", "지원 기능 2"],
  "verifiedOn": [
    {
      "fortiSOARVersion": "8.0.0-6034",
      "date": "YYYY-MM-DD",
      "result": "passed",
      "scope": ["설치", "화면 로딩", "핵심 기능"]
    }
  ],
  "applicationGuide": "README.md#적용-가이드"
}
```

## 푸시 전 체크리스트

- [ ] `features`가 실제 지원 기능과 제약을 설명한다.
- [ ] `verifiedOn`이 추정 버전이 아닌 실제 검증 환경을 기록한다.
- [ ] 적용 가이드에 사전 요구사항, 설치/교체, 설정, 검증과 롤백이 있다.
- [ ] `catalog.json`의 버전·기능·가이드가 `content.json`과 일치한다.
- [ ] `python3 scripts/validate_repository.py`가 통과한다.
