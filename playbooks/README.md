# Playbooks

플레이북은 업무/제품 단위로 분리해 다음 형태로 등록합니다.

```text
playbooks/<slug>/
├── README.md
├── content.json
├── src/       # 편집 가능한 설명, 템플릿 또는 분할 JSON
└── dist/      # FortiSOAR에서 import 가능한 JSON
```

README에는 필요한 커넥터와 최소 버전, 트리거/입력, 예상 출력, 롤백 방법을 기록합니다. 환경 고유 UUID와 자격 증명은 제거하거나 명확한 플레이스홀더로 바꿉니다.

