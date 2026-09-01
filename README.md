# FortiSOAR Contents

FortiSOAR에서 재사용할 수 있는 커스텀 콘텐츠의 소스와 배포 패키지를 함께 관리하는 저장소입니다.

## 콘텐츠 구조

| 디렉터리 | 콘텐츠 | 기본 산출물 |
|---|---|---|
| `widgets/` | Dashboard/Drawer 위젯 | 버전별 소스 + `.tgz` |
| `connectors/` | 커스텀 커넥터 | 버전별 소스 + `.tgz` |
| `playbooks/` | 플레이북 컬렉션 | FortiSOAR import JSON |
| `solution-packs/` | 여러 콘텐츠를 묶은 솔루션 팩 | export/import 패키지 |

등록된 콘텐츠는 루트의 [`catalog.json`](catalog.json)에서 찾을 수 있습니다. 각 콘텐츠 디렉터리는 `content.json`, 사용 설명서, 원본 소스와 배포 산출물을 포함해야 합니다.

## 위젯 추가 절차

```text
widgets/<slug>/
├── README.md
├── content.json
├── src/<widget-name>-<version>/
│   ├── info.json
│   ├── view.html
│   ├── view.controller.js
│   ├── edit.html
│   └── edit.controller.js
└── dist/<widget-name>-<version_with_underscores>.tgz
```

1. `src/` 아래에 FortiSOAR 원본 디렉터리를 추가합니다.
2. `scripts/package_widget.py`로 TGZ를 만듭니다.
3. `content.json`에 버전, 호환 플랫폼, 패키지 SHA-256을 기록합니다.
4. `catalog.json`에 콘텐츠 항목을 추가합니다.
5. 저장소 검증기를 실행합니다.

```bash
python3 scripts/package_widget.py \
  widgets/<slug>/src/<widget-name>-<version> \
  widgets/<slug>/dist/<widget-name>-<version_with_underscores>.tgz

python3 scripts/validate_repository.py
```

## 운영 규칙

- FortiSOAR 위젯의 `info.json`, `view.html`, `view.controller.js`, `edit.html`, `edit.controller.js`는 필수입니다.
- TGZ의 최상위 디렉터리는 `<info.json name>-<version>`과 정확히 일치해야 합니다.
- macOS의 `._*`, `.DS_Store`, xattr/PAX 메타데이터를 패키지에 넣지 않습니다.
- 반복 개발과 UI 수정은 기존 버전을 유지하고 Content Hub의 **Replace existing version**으로 교체합니다.
- 버전 증가는 공식 릴리스 또는 설정 호환성이 깨지는 변경에만 사용합니다.
- 비밀번호, API 키, 세션 토큰, 실제 운영 자격 증명은 커밋하지 않습니다.
- 설치 전 대상 FortiSOAR 버전과 `metadata.compatibility`를 확인합니다.

GitHub Actions는 커밋과 Pull Request마다 카탈로그, 소스, TGZ 구조, 체크섬과 JavaScript 문법을 검사합니다.

