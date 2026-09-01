/* Copyright start
  Copyright (C) 2008 - 2026 Fortinet Inc.
  All rights reserved.
  FORTINET CONFIDENTIAL & FORTINET PROPRIETARY SOURCE CODE
  Copyright end */
'use strict';
/* =============================================================================
 * FortiGate AI Assistant v1.0.3 hotfix - view.controller.js  (agentic / MCP-mirrored)
 *
 * 설계 배경 (실측으로 확정):
 *  - FortiSOAR 의 "Fortinet FortiGate Read Only" MCP 서버는 fortigate-firewall 커넥터의
 *    read-only 오퍼레이션 8종을 "필터 파라미터"와 함께 노출한다.
 *  - FortiAI(create_responses)는 OpenAI function-calling 을 지원한다(function_call 반환 확인).
 *  - 단, FortiAI 는 클라우드라 로컬 MCP(/mcp/...)에 직접 도달할 수 없다.
 *    => 툴 호출 루프를 "위젯이" 오케스트레이션해야 한다.
 *
 * 그래서 이 위젯은 MCP 서버의 read-only 툴셋을 create_responses 의 function tools 로
 * "미러링" 하고, 모델이 고른 툴을 /api/integration/execute/ 로 "필터를 걸어" 실행한 뒤,
 * 결과를 클라이언트에서 요약/집계(count)해서 다시 모델에 돌려준다.
 * => 정책 전량(수백KB) 덤프를 프롬프트에 넣던 기존 문제를 제거한다.
 *
 * [v1.0.1 변경점]
 *  1) 그룹 인지 매칭(정확성): 정책의 srcaddr/dstaddr/service 가 "그룹"을 참조하는 경우를
 *     상향 폐포(주소) / 재귀 전개(서비스)로 정확히 매칭. 기존의 false BLOCKED 제거.
 *  2) 질문 단위 fetch 메모이제이션: 동일 (op,config,params) 커넥터 조회를 promise 캐시로 1회화.
 *  3) 라운드 간 툴 호출 dedup: 동일 (툴+args) 반복 호출 시 재실행 없이 이전 결과 참조 유도.
 *  4) audit_policies 미사용 주소 판정을 그룹 하향 폐포 기반으로 수정(그룹 경유 사용 오탐 제거).
 *
 * [v1.0.2 변경점]
 *  1) 답변 품질: 메타 프롬프트를 영어 canonical 로 재설계(결론 우선 + 근거 표 + 주의사항 + 권고),
 *     선택 언어(ko/en/zh)로 답변을 강제. 모델-facing 문자열(툴 설명/노트/에러)도 영어로 통일.
 *  2) 3개 국어(i18n): UI 라벨/시스템 메시지/즐겨찾기 기본셋을 ko/en/zh 로 제공, 헤더에서 즉시 전환.
 *  3) 위젯 실행 시 등록된 모든 방화벽을 자동 라이브 프로브하고 결과 요약을 채팅에 표시.
 * ============================================================================= */
(function () {
  angular
    .module('cybersponse')
    .controller('fortigateaiassistant103Ctrl', fortigateaiassistant103Ctrl);

  fortigateaiassistant103Ctrl.$inject = ['$scope', '$http', '$q', '$timeout', '$sce', 'widgetUtilityService', 'connectorService'];

  function fortigateaiassistant103Ctrl($scope, $http, $q, $timeout, $sce, widgetUtilityService, connectorService) {

    var LS_KEY = 'fgai:settings:fortigateaiassistant-1.0.2';

    var DEFAULTS = {
      fortigateConnector: 'fortigate-firewall',
      // 멀티 방화벽: 여러 FortiGate 커넥터 config 를 등록하고 활성 방화벽을 선택한다.
      // (기본값은 "Fortinet FortiGate Read Only" MCP 가 바인딩한 Demo FortiGate 192.168.31.1)
      firewalls: [
        { name: 'Demo FortiGate', configId: 'e906bac0-a6bc-4053-a4ef-cded2ceb214a', version: '5.4.0', vdom: 'root' }
      ],
      activeFirewall: 'Demo FortiGate',
      selectedFirewalls: ['Demo FortiGate'],
      // 즐겨찾기 프롬프트(채팅줄 위 카드). 사용자가 편집 가능. 언어별 기본셋은 FAVORITES_BY_LANG.
      favorites: null,   // loadSettings 에서 언어 기본셋으로 채움
      language: 'ko',    // [v1.0.2] UI/답변 언어: ko | en | zh
      fortiaiConnector: 'fortinet-fortiai-proxy',
      fortiaiConfigId: 'bc2039c4-c90c-47ea-8d8f-0acfec1f108c',   // Low Reasoning
      fortiaiVersion: '2.0.0',
      model: 'AI_MODEL_MEDIUM'
    };
    // localStorage / 위젯 config 로 보존할 키
    var CONFIG_KEYS = ['firewalls', 'activeFirewall', 'selectedFirewalls', 'favorites', 'fortiaiConfigId', 'fortiaiVersion', 'model', 'language', 'fortigateConnector'];

    /* ---- [v1.0.2] 언어별 즐겨찾기 기본셋 ---------------------------------- */
    var FAVORITES_BY_LANG = {
      ko: [
        '정책 총 몇 개야?',
        '과도하게 열린(any/any/ALL) 위험 규칙 점검해줘',
        '외부(인터넷)에서 내부로 열린 위험 서비스 있어?',
        '최근 로그에 에러/경고 있었어?',
        '8.8.8.8 에서 192.168.31.1 로 443 접속 되나?'
      ],
      en: [
        'How many policies are there?',
        'Audit for overly permissive (any/any/ALL) rules',
        'Any risky services exposed to the internet?',
        'Any errors or warnings in recent logs?',
        'Can 8.8.8.8 reach 192.168.31.1 on port 443?'
      ],
      zh: [
        '一共有多少条策略？',
        '检查过度开放（any/any/ALL）的危险规则',
        '有没有向外网开放的危险服务？',
        '最近日志里有错误或警告吗？',
        '8.8.8.8 能通过 443 端口访问 192.168.31.1 吗？'
      ],
      zh_tw: [
        '共有幾條政策？',
        '檢查過度開放（any/any/ALL）的危險規則',
        '有沒有向外網開放的危險服務？',
        '最近日誌裡有錯誤或警告嗎？',
        '8.8.8.8 能透過 443 埠存取 192.168.31.1 嗎？'
      ]
    };

    /* ---- [v1.0.2] UI 3개 국어 사전 + t() ---------------------------------- */
    var L10N = {
      ko: {
        subtitle: 'read-only 분석 어시스턴트', fwSelect: '활성 방화벽 선택', langLabel: '언어',
        statusBusy: '조회 중…', statusReadOnly: '읽기 전용', devTitle: '개발용 원시 응답 보기', devAria: '개발용 디버그 패널 토글',
        settingsTitle: '설정', settingsAria: '커넥터 설정 열기',
        activeBadge: '활성', healthRefresh: '실시간 Health 확인', healthRefreshAria: 'Health 새로고침',
        selectedBadge: '선택', multiSelectHint: '질문 대상 선택', selectedCount: '선택 {n}대', selectAll: '모두 선택', clearSelection: '선택 해제',
        fwTargetsTitle: '질문 대상 방화벽', fwCountSummary: '선택 {selected}/{total}대', healthyCount: '정상 {n}', downCount: '비정상 {n}',
        fwSearchPh: '방화벽 검색', showFwList: '목록 보기', hideFwList: '목록 접기', healthLabel: '상태',
        probeAll: '전체 점검', probeAllTitle: '모든 방화벽 실시간 Health 확인',
        h_ok: '정상', h_fail: '비정상', h_unknown: '미확인', h_checking: '확인중', h_missing: '없음',
        msgProbeOk: '실시간 조회 성공', msgProbeFail: '조회 실패', msgConnFail: '연결 실패',
        msgCfgMissing: 'FortiSOAR 에 이 config 가 없습니다(ID 확인).', msgHealthNotRun: 'health check 미실행 — 새로고침으로 실시간 확인',
        setTitle: '방화벽 커넥터 설정 (멀티)',
        setHint: '여러 FortiGate 커넥터 config 를 등록하고 상단에서 활성 방화벽을 전환할 수 있습니다. 두 방화벽 비교(compare_firewalls)에도 사용됩니다.',
        connectorLabel: 'FortiGate 커넥터', reloadConfigs: 'Config 목록 새로고침', pickFromConnector: '커넥터에서 선택',
        configsLoading: '불러오는 중…', configsLoadError: '⚠ 불러오기 실패 — 커넥터 이름을 확인하세요', configChoose: '-- config 선택 --', configNone: '-- 사용 가능한 설정 없음 --',
        activeRadio: '활성', activeRadioTitle: '이 방화벽을 활성으로', del: '삭제',
        fName: '이름(별칭)', fNamePh: '예: 본사 FortiGate', fCfg: 'Config ID', fVer: 'Version', fVdom: 'VDOM',
        addFw: '+ 방화벽 추가', save: '저장', close: '닫기',
        welcome: '안녕하세요 👋 자연어로 방화벽을 물어보세요. 아래 자주 쓰는 프롬프트를 눌러 바로 시작할 수 있어요.',
        copy: '복사', typing: '응답 생성 중',
        devPanelTitle: 'DEV · 에이전트 툴 호출 & 원시 응답', devSummary: '모델에 되돌린 요약:',
        devRaw: '커넥터 원시 응답', devRounds: '라운드 요약 (create_responses)', devLastRaw: '마지막 create_responses 원시 응답',
        devEmpty: '아직 질문 전입니다. 질문을 보내면 라운드별 툴 호출·원시 응답이 여기 표시됩니다.',
        favTitle: '자주 쓰는 프롬프트', favDone: '완료', favEdit: '편집', favPh: '프롬프트 문구', favAdd: '+ 추가',
        askPh: '질문 입력 · 예: 외부에 열린 위험 서비스 있어?', send: '전송',
        errNeedCfg: '설정에서 FortiGate 커넥터 Config ID 를 입력하세요.',
        errNeedSelection: '질문할 방화벽을 하나 이상 선택하세요.',
        errParse: 'FortiAI 응답을 해석하지 못했습니다. (DEV 패널의 원시 응답 확인)',
        errGeneric: 'FortiGate 조회에 실패했습니다.',
        msgSwitch: '활성 방화벽 전환: {name} (vdom {vdom})',
        msgSelection: '질문 대상: {names}',
        msgSaved: '설정 저장됨 · 방화벽 {n}대 · 활성: {name} (vdom {vdom})',
        healthDone: '방화벽 상태 점검: {ok}/{total} 정상', healthBadList: '비정상', moreCount: '외 {n}대'
      },
      en: {
        subtitle: 'Read-only analysis assistant', fwSelect: 'Select active firewall', langLabel: 'Language',
        statusBusy: 'Querying…', statusReadOnly: 'Read Only', devTitle: 'Show raw responses (dev)', devAria: 'Toggle dev debug panel',
        settingsTitle: 'Settings', settingsAria: 'Open connector settings',
        activeBadge: 'Active', healthRefresh: 'Live health check', healthRefreshAria: 'Refresh health',
        selectedBadge: 'Selected', multiSelectHint: 'Select query targets', selectedCount: '{n} selected', selectAll: 'Select all', clearSelection: 'Clear',
        fwTargetsTitle: 'Query target firewalls', fwCountSummary: '{selected}/{total} selected', healthyCount: '{n} healthy', downCount: '{n} down',
        fwSearchPh: 'Search firewalls', showFwList: 'Show list', hideFwList: 'Hide list', healthLabel: 'Health',
        probeAll: 'Check all', probeAllTitle: 'Live health check for all firewalls',
        h_ok: 'Healthy', h_fail: 'Down', h_unknown: 'Unknown', h_checking: 'Checking', h_missing: 'Missing',
        msgProbeOk: 'Live query succeeded', msgProbeFail: 'Query failed', msgConnFail: 'Connection failed',
        msgCfgMissing: 'This config does not exist in FortiSOAR (check the ID).', msgHealthNotRun: 'Health check not run — refresh for a live check',
        setTitle: 'Firewall connector settings (multi)',
        setHint: 'Register multiple FortiGate connector configs and switch the active one from the header. Also used by compare_firewalls.',
        connectorLabel: 'FortiGate connector', reloadConfigs: 'Reload config list', pickFromConnector: 'Select from connector',
        configsLoading: 'Loading…', configsLoadError: '⚠ Load failed — check the connector name', configChoose: '-- Select config --', configNone: '-- No available configuration --',
        activeRadio: 'Active', activeRadioTitle: 'Make this firewall active', del: 'Delete',
        fName: 'Name (alias)', fNamePh: 'e.g. HQ FortiGate', fCfg: 'Config ID', fVer: 'Version', fVdom: 'VDOM',
        addFw: '+ Add firewall', save: 'Save', close: 'Close',
        welcome: 'Hi 👋 Ask about your firewall in natural language. Tap a favorite prompt below to get started.',
        copy: 'Copy', typing: 'Generating response',
        devPanelTitle: 'DEV · agent tool calls & raw responses', devSummary: 'Summary fed back to the model:',
        devRaw: 'Raw connector response', devRounds: 'Round summary (create_responses)', devLastRaw: 'Last create_responses raw response',
        devEmpty: 'No question yet. Send one and per-round tool calls and raw responses will appear here.',
        favTitle: 'Favorite prompts', favDone: 'Done', favEdit: 'Edit', favPh: 'Prompt text', favAdd: '+ Add',
        askPh: 'Ask a question · e.g. Any risky services exposed to the internet?', send: 'Send',
        errNeedCfg: 'Enter the FortiGate connector Config ID in settings.',
        errNeedSelection: 'Select at least one firewall to query.',
        errParse: 'Failed to parse the FortiAI response. (Check raw responses in the DEV panel)',
        errGeneric: 'FortiGate lookup failed.',
        msgSwitch: 'Active firewall switched: {name} (vdom {vdom})',
        msgSelection: 'Query targets: {names}',
        msgSaved: 'Settings saved · {n} firewall(s) · active: {name} (vdom {vdom})',
        healthDone: 'Firewall health check: {ok}/{total} healthy', healthBadList: 'down', moreCount: '{n} more'
      },
      zh: {
        subtitle: '只读分析助手', fwSelect: '选择当前防火墙', langLabel: '语言',
        statusBusy: '查询中…', statusReadOnly: '只读', devTitle: '查看原始响应（开发）', devAria: '切换开发调试面板',
        settingsTitle: '设置', settingsAria: '打开连接器设置',
        activeBadge: '当前', healthRefresh: '实时健康检查', healthRefreshAria: '刷新健康状态',
        selectedBadge: '已选', multiSelectHint: '选择查询目标', selectedCount: '已选 {n} 台', selectAll: '全选', clearSelection: '清除选择',
        fwTargetsTitle: '查询目标防火墙', fwCountSummary: '已选 {selected}/{total} 台', healthyCount: '正常 {n}', downCount: '异常 {n}',
        fwSearchPh: '搜索防火墙', showFwList: '显示列表', hideFwList: '收起列表', healthLabel: '健康状态',
        probeAll: '全部检查', probeAllTitle: '对所有防火墙执行实时健康检查',
        h_ok: '正常', h_fail: '异常', h_unknown: '未知', h_checking: '检查中', h_missing: '不存在',
        msgProbeOk: '实时查询成功', msgProbeFail: '查询失败', msgConnFail: '连接失败',
        msgCfgMissing: 'FortiSOAR 中不存在该 config（请检查 ID）。', msgHealthNotRun: '尚未执行健康检查 — 点击刷新进行实时检查',
        setTitle: '防火墙连接器设置（多台）',
        setHint: '可注册多个 FortiGate 连接器 config，并在顶部切换当前防火墙。compare_firewalls 也会使用这些配置。',
        connectorLabel: 'FortiGate 连接器', reloadConfigs: '重新加载 Config 列表', pickFromConnector: '从连接器中选择',
        configsLoading: '加载中…', configsLoadError: '⚠ 加载失败—请确认连接器名称', configChoose: '-- 选择 config --', configNone: '-- 无可用配置 --',
        activeRadio: '当前', activeRadioTitle: '将此防火墙设为当前', del: '删除',
        fName: '名称（别名）', fNamePh: '例：总部 FortiGate', fCfg: 'Config ID', fVer: '版本', fVdom: 'VDOM',
        addFw: '+ 添加防火墙', save: '保存', close: '关闭',
        welcome: '你好 👋 用自然语言询问你的防火墙。点击下方常用提示词即可快速开始。',
        copy: '复制', typing: '正在生成回答',
        devPanelTitle: 'DEV · Agent 工具调用与原始响应', devSummary: '返回给模型的摘要：',
        devRaw: '连接器原始响应', devRounds: '轮次摘要 (create_responses)', devLastRaw: '最后一次 create_responses 原始响应',
        devEmpty: '尚未提问。发送问题后，每轮的工具调用与原始响应会显示在这里。',
        favTitle: '常用提示词', favDone: '完成', favEdit: '编辑', favPh: '提示词内容', favAdd: '+ 添加',
        askPh: '输入问题 · 例：有没有向外网开放的危险服务？', send: '发送',
        errNeedCfg: '请在设置中填写 FortiGate 连接器的 Config ID。',
        errNeedSelection: '请至少选择一台防火墙进行查询。',
        errParse: '无法解析 FortiAI 响应。（请查看 DEV 面板的原始响应）',
        errGeneric: 'FortiGate 查询失败。',
        msgSwitch: '已切换当前防火墙：{name}（vdom {vdom}）',
        msgSelection: '查询目标：{names}',
        msgSaved: '设置已保存 · 共 {n} 台防火墙 · 当前：{name}（vdom {vdom}）',
        healthDone: '防火墙健康检查：{ok}/{total} 正常', healthBadList: '异常', moreCount: '另有 {n} 台'
      },
      zh_tw: {
        subtitle: '唯讀分析助理', fwSelect: '選擇目前防火牆', langLabel: '語言',
        statusBusy: '查詢中…', statusReadOnly: '唯讀', devTitle: '查看原始回應（開發）', devAria: '切換開發除錯面板',
        settingsTitle: '設定', settingsAria: '開啟連接器設定',
        activeBadge: '目前', healthRefresh: '即時健康檢查', healthRefreshAria: '重新整理健康狀態',
        selectedBadge: '已選', multiSelectHint: '選擇查詢目標', selectedCount: '已選 {n} 台', selectAll: '全選', clearSelection: '清除選擇',
        fwTargetsTitle: '查詢目標防火牆', fwCountSummary: '已選 {selected}/{total} 台', healthyCount: '正常 {n}', downCount: '異常 {n}',
        fwSearchPh: '搜尋防火牆', showFwList: '顯示清單', hideFwList: '收合清單', healthLabel: '健康狀態',
        probeAll: '全部檢查', probeAllTitle: '對所有防火牆執行即時健康檢查',
        h_ok: '正常', h_fail: '異常', h_unknown: '未知', h_checking: '檢查中', h_missing: '不存在',
        msgProbeOk: '即時查詢成功', msgProbeFail: '查詢失敗', msgConnFail: '連線失敗',
        msgCfgMissing: 'FortiSOAR 中不存在此 config（請確認 ID）。', msgHealthNotRun: '尚未執行健康檢查 — 點擊重新整理進行即時檢查',
        setTitle: '防火牆連接器設定（多台）',
        setHint: '可新增多個 FortiGate 連接器 config，並在頂部切換目前防火牆。compare_firewalls 也會使用這些設定。',
        connectorLabel: 'FortiGate 連接器', reloadConfigs: '重新載入 Config 清單', pickFromConnector: '從連接器選擇',
        configsLoading: '載入中…', configsLoadError: '⚠ 載入失敗—請確認連接器名稱', configChoose: '-- 選擇 config --', configNone: '-- 無可用設定 --',
        activeRadio: '目前', activeRadioTitle: '將此防火牆設為目前', del: '刪除',
        fName: '名稱（別名）', fNamePh: '例：總部 FortiGate', fCfg: 'Config ID', fVer: '版本', fVdom: 'VDOM',
        addFw: '+ 新增防火牆', save: '儲存', close: '關閉',
        welcome: '你好 👋 用自然語言詢問你的防火牆。點擊下方常用提示詞即可快速開始。',
        copy: '複製', typing: '正在產生回答',
        devPanelTitle: 'DEV · Agent 工具呼叫與原始回應', devSummary: '回傳給模型的摘要：',
        devRaw: '連接器原始回應', devRounds: '輪次摘要 (create_responses)', devLastRaw: '最後一次 create_responses 原始回應',
        devEmpty: '尚未提問。送出問題後，每輪的工具呼叫與原始回應會顯示在這裡。',
        favTitle: '常用提示詞', favDone: '完成', favEdit: '編輯', favPh: '提示詞內容', favAdd: '+ 新增',
        askPh: '輸入問題 · 例：有沒有向外網開放的危險服務？', send: '傳送',
        errNeedCfg: '請在設定中填寫 FortiGate 連接器的 Config ID。',
        errNeedSelection: '請至少選擇一台防火牆進行查詢。',
        errParse: '無法解析 FortiAI 回應。（請查看 DEV 面板的原始回應）',
        errGeneric: 'FortiGate 查詢失敗。',
        msgSwitch: '已切換目前防火牆：{name}（vdom {vdom}）',
        msgSelection: '查詢目標：{names}',
        msgSaved: '設定已儲存 · 共 {n} 台防火牆 · 目前：{name}（vdom {vdom}）',
        healthDone: '防火牆健康檢查：{ok}/{total} 正常', healthBadList: '異常', moreCount: '另有 {n} 台'
      }
    };
    function t(key) {
      var lang = ($scope.settings && $scope.settings.language) || DEFAULTS.language;
      var d = L10N[lang] || L10N.ko;
      return (d[key] !== undefined) ? d[key] : ((L10N.ko[key] !== undefined) ? L10N.ko[key] : key);
    }
    function tf(key, vars) {
      var out = t(key);
      angular.forEach(vars || {}, function (v, k) { out = out.split('{' + k + '}').join(v); });
      return out;
    }
    $scope.t = t;
    $scope.tf = tf;
    // 언어 전환: 즐겨찾기가 "언어 기본셋 그대로"면 새 언어 기본셋으로 교체(사용자 커스텀은 유지)
    $scope.setLanguage = function (lang) {
      $scope.settings.language = lang;
      var cur = JSON.stringify($scope.settings.favorites || []);
      var isDefault = Object.keys(FAVORITES_BY_LANG).some(function (k) { return JSON.stringify(FAVORITES_BY_LANG[k]) === cur; });
      if (isDefault) { $scope.settings.favorites = angular.copy(FAVORITES_BY_LANG[lang] || FAVORITES_BY_LANG.ko); }
      writeLS(pickKnown($scope.settings));
    };

    var MAX_ROUNDS = 4;     // 툴 호출 라운드 상한 (마지막 라운드는 답변 강제)
    var ITEM_CAP = 40;      // 모델에 되돌려줄 요약 배열 최대 길이

    // [v1.0.2] 메타 프롬프트는 영어 canonical(다국어 모델에서 가장 일관적), 최종 답변 언어만 강제.
    var ANSWER_LANG = { ko: 'Korean (한국어)', en: 'English', zh: 'Simplified Chinese (简体中文)', zh_tw: 'Traditional Chinese (繁體中文)' };
    function answerLang(s) { return ANSWER_LANG[(s && s.language)] || ANSWER_LANG.ko; }
    function instructions(s) {
      return 'You are a FortiGate read-only lookup assistant embedded in a FortiSOAR widget. ' +
        'Use ONLY the provided function tools to fetch exactly the data you need. ' +
        'Use filters (name/policyid/vdom, ...) aggressively; parameters you do not use MUST be set to an empty string "" (never invent values). ' +
        'All lookups are strictly read-only; never attempt any change. ' +
        'ALWAYS write your final answer in ' + answerLang(s) + ', regardless of the language of the question or the data.';
    }

    // === MCP "Fortinet FortiGate Read Only" 툴셋 미러링 (read-only 화이트리스트) ============
    // 커넥터 execute 의 params 는 flat 이므로 flat 스키마로 정의한다.
    // 주의: FortiAI 프록시는 strict:true + 모든 파라미터 required 를 강제한다.
    //  - nullable 타입(["string","null"])은 업스트림이 400 으로 거부하므로 사용 금지.
    //  - 대신 plain string 으로 두면 모델이 미사용 필터를 ""(빈 문자열)로 채운다 -> 실행 직전 cleanArgs 로 제거.
    function P(props) { return { type: 'object', properties: props, required: Object.keys(props), additionalProperties: false }; }
    var S = { type: 'string' };
    var FG_TOOLS = [
      { type: 'function', name: 'get_list_of_policies', description: '[READ ONLY] List IPv4 firewall policies. Use policyid to fetch a single policy. Unused filters must be "".', parameters: P({ vdom: S, policyid: S }) },
      { type: 'function', name: 'get_addresses',        description: '[READ ONLY] List address (IP) objects. Use name to fetch a single object. Unused filters must be "".', parameters: P({ vdom: S, address_category: S, name: S }) },
      { type: 'function', name: 'get_address_groups',   description: '[READ ONLY] List address groups. Use group_name to fetch a single group. Unused filters must be "".', parameters: P({ vdom: S, address_group_category: S, group_name: S }) },
      { type: 'function', name: 'get_firewall_services', description: '[READ ONLY] List firewall services/ports. Use name to fetch a single service. Unused filters must be "".', parameters: P({ vdom: S, name: S }) },
      { type: 'function', name: 'get_service_groups',   description: '[READ ONLY] List service groups. Unused filters must be "".', parameters: P({ vdom: S, name: S }) },
      { type: 'function', name: 'get_list_of_applications', description: '[READ ONLY] List application signatures/names. (no parameters)', parameters: P({}) },
      { type: 'function', name: 'get_users',            description: '[READ ONLY] List configured users. Unused filters must be "".', parameters: P({ vdom: S, name: S }) },
      { type: 'function', name: 'get_system_events',    description: '[READ ONLY] System logs/events. filter is a FortiGate filter string. Unused filters must be "".', parameters: P({ filter: S, location: S }) },
      { type: 'function', name: 'find_policies_by_ip', description: '[READ ONLY][computed] Exactly finds address objects containing a given IP (group references included) and every policy using them. For any question about policies related to an IP, this single tool is enough. Use "" for vdom if unused.', parameters: P({ ip: S, vdom: S }) },
      { type: 'function', name: 'check_connectivity', description: '[READ ONLY][computed] For reachability questions like "can A reach B on 443?". Evaluates src_ip->dst_ip for port/protocol against policies in order (first-match, recursive address/service group resolution) and returns ALLOWED/BLOCKED plus the deciding rule. protocol defaults to tcp; unused filters must be "". Interfaces/NAT/routing are NOT evaluated.', parameters: P({ src_ip: S, dst_ip: S, port: S, protocol: S, vdom: S }) },
      { type: 'function', name: 'audit_policies', description: '[READ ONLY][computed] Policy hygiene/security audit. Returns findings by severity (high/medium/low/info): any-any-ALL over-permissive rules, logging disabled, UTM not applied, disabled/duplicate rules, unused address objects. Use this for "audit / risky rules" questions. Use "" for vdom if unused.', parameters: P({ vdom: S }) },
      { type: 'function', name: 'analyze_logs', description: '[READ ONLY][computed] Summarizes system event logs (level/subtype/logdesc tallies + error/warning samples). Use this for "recent logs / errors / warnings / events" questions. filter is a FortiGate filter string; level narrows to one level. Unused must be "".', parameters: P({ filter: S, level: S }) },
      { type: 'function', name: 'exposure_scan', description: '[READ ONLY][computed] Internet/external exposure check. Finds accept rules whose srcintf is untrust (default sdwan/wan* etc.) or srcaddr=all, and reports exposure of risky ports (RDP/SSH/SMB/DB, ...) by severity, resolving service groups recursively. Use for "what is open to the internet" questions. untrust_interfaces is a comma-separated override ("" if unused); vdom "" if unused.', parameters: P({ vdom: S, untrust_interfaces: S }) },
      { type: 'function', name: 'expand_group', description: '[READ ONLY][computed] Recursively expands an address/service group into its actual leaf members (IPs/ports). Use for "what is inside this group" questions. group_name is required; group_type is address (default) or service; vdom "" if unused.', parameters: P({ group_name: S, group_type: S, vdom: S }) },
      { type: 'function', name: 'compare_firewalls', description: '[READ ONLY][computed] Compares policies/address objects between the current firewall and another FortiGate (config_b) to detect drift. Returns same-name-different-value address_conflicts and policies/objects present on only one side. Use for "compare two firewalls / differences" questions. config_b is the OTHER FortiGate config id (required); vdom "" if unused.', parameters: P({ config_b: S, vdom: S }) }
    ];
    var CONNECTOR_OPS = { get_list_of_policies: 1, get_addresses: 1, get_address_groups: 1, get_firewall_services: 1, get_service_groups: 1, get_list_of_applications: 1, get_users: 1, get_system_events: 1 };
    var VDOM_OPS = { get_list_of_policies: 1, get_addresses: 1, get_address_groups: 1, get_firewall_services: 1, get_service_groups: 1, get_users: 1 };

    $scope.messages = [];
    $scope.question = '';
    $scope.loading = false;
    $scope.showSettings = false;
    $scope.settings = angular.copy(DEFAULTS);
    $scope.debug = { show: false, rounds: [], toolCalls: [] };
    $scope.connectorConfigs = [];
    $scope.connectorConfigsLoading = false;
    $scope.connectorConfigsError = false;
    $scope.detectedConnectorVersion = '';
    $scope.fwPick = {};
    // 소규모 등록은 바로 표시하고, 다수 등록은 요약 바로 접어 본문 높이를 보존한다.
    $scope.firewallCompactThreshold = 6;
    $scope.firewallPanelExpanded = false;
    $scope.firewallSearch = '';
    $scope.firewallCardsVisible = function () {
      return (($scope.settings.firewalls || []).length <= $scope.firewallCompactThreshold) || $scope.firewallPanelExpanded;
    };
    $scope.toggleFirewallPanel = function () {
      $scope.firewallPanelExpanded = !$scope.firewallPanelExpanded;
      if (!$scope.firewallPanelExpanded) { $scope.firewallSearch = ''; }
    };

    /* ---- 유틸: 스크롤 ---------------------------------------------------- */
    function scrollToBottom() {
      $timeout(function () {
        var nodes = document.querySelectorAll('.fgai-messages');
        for (var i = 0; i < nodes.length; i++) { nodes[i].scrollTop = nodes[i].scrollHeight; }
      }, 0);
    }
    /* ---- 메시지: 마크다운 렌더 / 타임스탬프 / 복사 ---------------------- */
    function escapeHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
    // 어시스턴트 답변의 마크다운(굵게/리스트/표/코드/헤딩)을 안전한 HTML 로 변환.
    // 입력을 먼저 escape 한 뒤 화이트리스트 태그만 생성한다(XSS 방지).
    function renderMarkdown(src) {
      src = (src == null ? '' : String(src));
      var blocks = [];
      src = src.replace(/```[ \t]*\w*\n?([\s\S]*?)```/g, function (m, code) { blocks.push(code); return '\u0000CB' + (blocks.length - 1) + '\u0000'; });
      function inline(t) {
        t = escapeHtml(t);
        t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
        t = t.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
        t = t.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
        t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s"'<>]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
        return t;
      }
      function isSep(s) { return /^\s*\|?[\s:]*-{2,}[\s:]*(\|[\s:]*-{2,}[\s:]*)*\|?\s*$/.test(s); }
      function row(s) { return s.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(function (c) { return c.trim(); }); }
      var lines = src.split(/\r?\n/), out = [], para = [], i = 0;
      function flush() { if (para.length) { out.push('<p>' + para.join('<br>') + '</p>'); para = []; } }
      while (i < lines.length) {
        var line = lines[i];
        if (/^\s*$/.test(line)) { flush(); i++; continue; }
        var cb = line.match(/^\u0000CB(\d+)\u0000$/);
        if (cb) { flush(); out.push('<pre><code>' + escapeHtml(blocks[+cb[1]]) + '</code></pre>'); i++; continue; }
        var h = line.match(/^(#{1,3})\s+(.*)$/);
        if (h) { flush(); var lv = h[1].length + 3; out.push('<h' + lv + '>' + inline(h[2]) + '</h' + lv + '>'); i++; continue; }
        if (/\|/.test(line) && i + 1 < lines.length && isSep(lines[i + 1])) {
          flush(); var head = row(line); i += 2; var rows = [];
          while (i < lines.length && /\|/.test(lines[i]) && !/^\s*$/.test(lines[i])) { rows.push(row(lines[i])); i++; }
          var tb = '<table><thead><tr>' + head.map(function (c) { return '<th>' + inline(c) + '</th>'; }).join('') + '</tr></thead><tbody>';
          rows.forEach(function (r) { tb += '<tr>' + r.map(function (c) { return '<td>' + inline(c) + '</td>'; }).join('') + '</tr>'; });
          out.push(tb + '</tbody></table>'); continue;
        }
        if (/^\s*[-*]\s+/.test(line)) { flush(); var ul = []; while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { ul.push('<li>' + inline(lines[i].replace(/^\s*[-*]\s+/, '')) + '</li>'); i++; } out.push('<ul>' + ul.join('') + '</ul>'); continue; }
        if (/^\s*\d+\.\s+/.test(line)) { flush(); var ol = []; while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { ol.push('<li>' + inline(lines[i].replace(/^\s*\d+\.\s+/, '')) + '</li>'); i++; } out.push('<ol>' + ol.join('') + '</ol>'); continue; }
        if (/^\s*---+\s*$/.test(line)) { flush(); out.push('<hr>'); i++; continue; }
        para.push(inline(line)); i++;
      }
      flush();
      return out.join('');
    }
    function pad2(n) { return (n < 10 ? '0' : '') + n; }
    function nowHM() { var d = new Date(); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
    function toHtml(msg) {
      var body = (msg.role === 'bot') ? renderMarkdown(msg.text) : '<p>' + escapeHtml(msg.text).replace(/\n/g, '<br>') + '</p>';
      return $sce.trustAsHtml(body);
    }
    $scope.copyMessage = function (text) { try { if (navigator.clipboard) { navigator.clipboard.writeText(text || ''); } } catch (e) {} };
    function pushMessage(msg) { if (!msg.time) { msg.time = nowHM(); } msg.html = toHtml(msg); $scope.messages.push(msg); scrollToBottom(); }

    /* ---- 설정 로드/저장 -------------------------------------------------- */
    function readLS() { try { var raw = window.localStorage.getItem(LS_KEY); return raw ? JSON.parse(raw) : {}; } catch (e) { return {}; } }
    function writeLS(obj) { try { window.localStorage.setItem(LS_KEY, JSON.stringify(obj)); } catch (e) {} }
    function pickKnown(obj) { var out = {}; if (obj) { CONFIG_KEYS.forEach(function (k) { if (obj[k]) { out[k] = obj[k]; } }); } return out; }
    function modelConfig() { try { var m = $scope.$parent && $scope.$parent.model; if (m) { return m.config || m.data || m.viewData || {}; } } catch (e) {} return {}; }
    // 구버전 단일 config 포맷({fortigateConfigId,...}) -> firewalls 배열로 마이그레이션
    function migrateLegacy(raw) {
      if (raw && !raw.firewalls && raw.fortigateConfigId) {
        raw.firewalls = [{ name: 'FortiGate 1', configId: raw.fortigateConfigId, version: raw.fortigateVersion || '5.4.0', vdom: raw.vdom || 'root' }];
        raw.activeFirewall = 'FortiGate 1';
      }
      return raw;
    }
    function activeFw(s) {
      var list = (s && s.firewalls) || [];
      for (var i = 0; i < list.length; i++) { if (list[i] && list[i].name === s.activeFirewall) { return list[i]; } }
      return list[0] || null;
    }
    function selectedFwNames(s) {
      var selected = {}, out = [];
      (s.selectedFirewalls || []).forEach(function (name) { selected[name] = true; });
      (s.firewalls || []).forEach(function (fw) { if (fw && selected[fw.name]) { out.push(fw.name); } });
      return out;
    }
    function normalizeSelected(s) {
      var names = selectedFwNames(s);
      if (!names.length && activeFw(s)) { names = [activeFw(s).name]; }
      s.selectedFirewalls = names;
    }
    function selectedFws(s) {
      var selected = {}, out = [];
      normalizeSelected(s);
      (s.selectedFirewalls || []).forEach(function (name) { selected[name] = true; });
      (s.firewalls || []).forEach(function (fw) { if (fw && selected[fw.name]) { out.push(fw); } });
      return out;
    }
    // 활성 방화벽 -> compute/execute 가 쓰는 flat 필드(fortigateConfigId/Version/vdom)로 반영
    function resolveActive(s) {
      var fw = activeFw(s);
      if (fw) { s.activeFirewall = fw.name; s.fortigateConfigId = fw.configId; s.fortigateVersion = fw.version || '5.4.0'; s.vdom = fw.vdom || 'root'; }
      normalizeSelected(s);
    }
    function loadSettings() {
      $scope.settings = angular.extend({}, DEFAULTS, pickKnown(migrateLegacy(modelConfig())), pickKnown(migrateLegacy(readLS())));
      if (!angular.isArray($scope.settings.firewalls) || !$scope.settings.firewalls.length) {
        $scope.settings.firewalls = angular.copy(DEFAULTS.firewalls);
      }
      if (!L10N[$scope.settings.language]) { $scope.settings.language = DEFAULTS.language; }
      // [v1.0.2] 즐겨찾기 미설정 시 현재 언어 기본셋 사용
      if (!angular.isArray($scope.settings.favorites) || !$scope.settings.favorites.length) {
        $scope.settings.favorites = angular.copy(FAVORITES_BY_LANG[$scope.settings.language] || FAVORITES_BY_LANG.ko);
      }
      resolveActive($scope.settings);
    }
    $scope.toggleSettings = function () {
      $scope.showSettings = !$scope.showSettings;
      if ($scope.showSettings) { loadConnectorConfigs(); }
    };
    $scope.toggleDebug = function () { $scope.debug.show = !$scope.debug.show; };

    /* ---- 커넥터 설정 목록 로드 (설정 패널 빠른 선택) --------------------- */
    function loadConnectorConfigs() {
      var connector = $scope.settings.fortigateConnector || DEFAULTS.fortigateConnector;
      $scope.connectorConfigsLoading = true;
      $scope.connectorConfigsError = false;
      $scope.connectorConfigs = [];
      $scope.detectedConnectorVersion = '';
      connectorService.getConfiguredConnectors()
        .then(function (list) {
          list = list || [];
          var fg = null, ai = null;
          for (var i = 0; i < list.length; i++) {
            if (list[i].name === connector) { fg = list[i]; }
            if (list[i].name === DEFAULTS.fortiaiConnector) { ai = list[i]; }
          }
          if (fg) {
            $scope.connectorConfigs = fg.configuration || [];
            $scope.detectedConnectorVersion = fg.version || '';
          }
          // Auto-fill FortiAI settings if still at default values
          if (ai) {
            if ($scope.settings.fortiaiVersion === DEFAULTS.fortiaiVersion) {
              $scope.settings.fortiaiVersion = ai.version || DEFAULTS.fortiaiVersion;
            }
            if ($scope.settings.fortiaiConfigId === DEFAULTS.fortiaiConfigId) {
              var defCfg = null;
              for (var j = 0; j < (ai.configuration || []).length; j++) {
                if (ai.configuration[j]['default']) { defCfg = ai.configuration[j]; break; }
              }
              if (defCfg) { $scope.settings.fortiaiConfigId = defCfg.config_id; }
            }
          }
        })
        .catch(function () { $scope.connectorConfigs = []; $scope.connectorConfigsError = true; })
        ['finally'](function () { $scope.connectorConfigsLoading = false; });
    }
    $scope.reloadConnectorConfigs = loadConnectorConfigs;
    $scope.connectorConfigStatusLabel = function () {
      if ($scope.connectorConfigsLoading) { return t('configsLoading'); }
      if ($scope.connectorConfigsError) { return t('configsLoadError'); }
      return $scope.connectorConfigs.length ? t('configChoose') : t('configNone');
    };
    // 드롭다운에서 config 선택 → fw 필드 자동 채움
    $scope.pickConnectorConfig = function (idx, fw) {
      var configId = $scope.fwPick[idx];
      if (!configId) { return; }
      var found = null;
      for (var i = 0; i < $scope.connectorConfigs.length; i++) {
        if ($scope.connectorConfigs[i].config_id === configId) { found = $scope.connectorConfigs[i]; break; }
      }
      if (!found) { return; }
      fw.configId = found.config_id;
      if (!(fw.name || '').trim()) { fw.name = found.name; }
      fw.vdom = (found.config && found.config.vdom) || 'root';
      if ($scope.detectedConnectorVersion) { fw.version = $scope.detectedConnectorVersion; }
    };

    /* ---- 멀티 방화벽 관리 ------------------------------------------------ */
    $scope.addFirewall = function () {
      $scope.settings.firewalls = $scope.settings.firewalls || [];
      $scope.settings.firewalls.push({ name: '', configId: '', version: '5.4.0', vdom: 'root' });
    };
    $scope.removeFirewall = function (idx) {
      $scope.settings.firewalls.splice(idx, 1);
      if (!$scope.settings.firewalls.length) { $scope.settings.firewalls = angular.copy(DEFAULTS.firewalls); }
      if (!activeFw($scope.settings)) { $scope.settings.activeFirewall = $scope.settings.firewalls[0].name; }
      normalizeSelected($scope.settings);
    };
    // 헤더 드롭다운에서 활성 방화벽 즉시 전환(저장까지)
    $scope.setActiveFirewall = function (name) {
      $scope.settings.activeFirewall = name;
      resolveActive($scope.settings);
      writeLS(pickKnown($scope.settings));
      pushMessage({ role: 'bot', text: tf('msgSwitch', { name: $scope.settings.activeFirewall, vdom: $scope.settings.vdom }) });
    };
    $scope.isFirewallSelected = function (fw) {
      return !!(fw && selectedFwNames($scope.settings).indexOf(fw.name) >= 0);
    };
    $scope.toggleFirewallSelection = function (fw) {
      if (!fw) { return; }
      normalizeSelected($scope.settings);
      var names = angular.copy($scope.settings.selectedFirewalls || []);
      var idx = names.indexOf(fw.name);
      if (idx >= 0) { names.splice(idx, 1); } else { names.push(fw.name); }
      if (!names.length) { names = [fw.name]; }
      $scope.settings.selectedFirewalls = names;
      if (!activeFw($scope.settings)) { $scope.settings.activeFirewall = fw.name; }
      resolveActive($scope.settings);
      writeLS(pickKnown($scope.settings));
    };
    $scope.selectAllFirewalls = function () {
      $scope.settings.selectedFirewalls = ($scope.settings.firewalls || []).map(function (fw) { return fw.name; });
      resolveActive($scope.settings);
      writeLS(pickKnown($scope.settings));
    };
    $scope.clearFirewallSelection = function () {
      $scope.settings.selectedFirewalls = activeFw($scope.settings) ? [activeFw($scope.settings).name] : [];
      resolveActive($scope.settings);
      writeLS(pickKnown($scope.settings));
    };
    $scope.selectedFirewallCount = function () { return selectedFws($scope.settings).length; };
    $scope.saveSettings = function () {
      var s = $scope.settings;
      // 방화벽 목록 정리: configId 있는 항목만, 이름/버전/vdom 기본값 보정
      s.firewalls = (s.firewalls || []).filter(function (f) { return f && (f.configId || '').trim(); }).map(function (f, i) {
        return { name: (f.name || '').trim() || ('FortiGate ' + (i + 1)), configId: (f.configId || '').trim(),
          version: (f.version || '').trim() || '5.4.0', vdom: (f.vdom || '').trim() || 'root' };
      });
      if (!s.firewalls.length) { s.firewalls = angular.copy(DEFAULTS.firewalls); }
      if (!activeFw(s)) { s.activeFirewall = s.firewalls[0].name; }
      normalizeSelected(s);
      ['fortiaiConfigId', 'fortiaiVersion', 'model', 'fortigateConnector'].forEach(function (k) { s[k] = (s[k] || '').toString().trim() || DEFAULTS[k]; });
      resolveActive(s);
      writeLS(pickKnown(s));
      $scope.showSettings = false;
      pushMessage({ role: 'bot', text: tf('msgSaved', { n: s.firewalls.length, name: s.activeFirewall, vdom: s.vdom }) });
      loadConfigHealth();
    };

    /* ---- 커넥터 Health Status --------------------------------------------- */
    // config_id -> { state:'ok'|'fail'|'unknown'|'missing'|'checking', label, message, fsName, enabled, source }
    $scope.fwHealth = {};
    $scope.firewallHealthCount = function (kind) {
      var count = 0;
      ($scope.settings.firewalls || []).forEach(function (fw) {
        var state = (($scope.fwHealth[fw.configId] || {}).state || 'unknown');
        if (kind === 'fail' ? (state === 'fail' || state === 'missing') : state === kind) { count++; }
      });
      return count;
    };
    function setHealth(id, obj) { $scope.fwHealth[id] = angular.extend($scope.fwHealth[id] || {}, obj); }
    // 1차: FortiSOAR 에 저장된 health_status 조회 (네이티브 커넥터 헬스)
    function loadConfigHealth() {
      return $http.get('/api/integration/configuration/?format=json').then(function (res) {
        var list = (res.data && res.data.data) || [];
        var byId = {}; list.forEach(function (c) { byId[c.config_id] = c; });
        ($scope.settings.firewalls || []).forEach(function (fw) {
          var c = byId[fw.configId];
          if (!c) { setHealth(fw.configId, { state: 'missing', message: t('msgCfgMissing'), source: 'config' }); return; }
          var hs = c.health_status || {};
          var st;
          if (hs._status === true || String(hs.status).toLowerCase() === 'available') { st = { state: 'ok', message: hs.message || 'Available' }; }
          else if (hs._status === false || String(hs.status).toLowerCase().indexOf('disconnect') >= 0) { st = { state: 'fail', message: hs.message || hs.status || '' }; }
          else { st = { state: 'unknown', message: t('msgHealthNotRun') }; }
          st.fsName = c.name; st.enabled = c.status === 1; st.source = 'config';
          setHealth(fw.configId, st);
        });
      }).catch(function () { /* 조회 실패시 카드에서 미확인 유지 */ });
    }
    // 2차: 실시간 프로브 — 가벼운 read op(get_address_groups) 실행 성공 여부로 판정
    // [v1.0.2] promise 반환(자동 스윕에서 대기 가능), 라벨은 state 키 기반으로 뷰에서 t() 렌더
    $scope.probeHealth = function (fw) {
      setHealth(fw.configId, { state: 'checking', message: '' });
      return executeConnector($scope.settings.fortigateConnector, fw.version || '5.4.0', 'get_address_groups', fw.configId, { vdom: fw.vdom || 'root' })
        .then(function (body) {
          var c = classifyExecute(body);
          if (c.ok) { setHealth(fw.configId, { state: 'ok', message: t('msgProbeOk'), source: 'probe' }); }
          else { setHealth(fw.configId, { state: 'fail', message: c.message || t('msgProbeFail'), source: 'probe' }); }
        })
        .catch(function (e) {
          var msg = (e && e.data && e.data.message) ? e.data.message : (e && e.message) || t('msgConnFail');
          setHealth(fw.configId, { state: 'fail', message: msg, source: 'probe' });
        });
    };
    /* ---- [v1.0.2] 위젯 실행 시 자동 라이브 헬스 스윕 + 요약 메시지 -------- */
    // 다수 방화벽은 헬스 요청을 5개씩 처리해 FortiSOAR/커넥터 일시 부하를 제한한다.
    var HEALTH_PROBE_CONCURRENCY = 5;
    var allHealthPromise = null;
    $scope.healthSweepRunning = false;
    function probeHealthBatch(fws) {
      var next = 0, workers = [];
      function worker() {
        var idx = next++;
        if (idx >= fws.length) { return $q.resolve(); }
        return $scope.probeHealth(fws[idx]).then(worker);
      }
      var workerCount = Math.min(HEALTH_PROBE_CONCURRENCY, fws.length);
      for (var i = 0; i < workerCount; i++) { workers.push(worker()); }
      return $q.all(workers);
    }
    function runAllHealth() {
      if (allHealthPromise) { return allHealthPromise; }
      var fws = ($scope.settings.firewalls || []).slice();
      $scope.healthSweepRunning = true;
      allHealthPromise = probeHealthBatch(fws)['finally'](function () {
        $scope.healthSweepRunning = false;
        allHealthPromise = null;
      });
      return allHealthPromise;
    }
    function initialHealthSweep() {
      var fws = $scope.settings.firewalls || [];
      if (!fws.length) { return; }
      runAllHealth().then(function () {
        var ok = [], bad = [];
        fws.forEach(function (fw) {
          var h = $scope.fwHealth[fw.configId] || {};
          (h.state === 'ok' ? ok : bad).push(fw.name + (h.state === 'ok' ? '' : (h.message ? ' (' + h.message + ')' : '')));
        });
        var txt = tf('healthDone', { ok: ok.length, total: fws.length });
        if (bad.length) {
          var visibleBad = bad.slice(0, 8);
          if (bad.length > visibleBad.length) { visibleBad.push(tf('moreCount', { n: bad.length - visibleBad.length })); }
          txt += ' · ' + t('healthBadList') + ': ' + visibleBad.join(', ');
        }
        pushMessage({ role: bad.length ? 'error' : 'bot', text: txt });
      });
    }
    $scope.probeAllHealth = runAllHealth;
    // 카드 키보드 접근성: Enter/Space 로 쿼리 대상 선택/해제
    $scope.onCardKey = function (e, fw) { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); $scope.toggleFirewallSelection(fw); } };
    $scope.healthOf = function (fw) { return (fw && $scope.fwHealth[fw.configId]) || { state: 'unknown' }; };
    $scope.shortId = function (id) { return id ? (String(id).slice(0, 8) + '…') : ''; };

    /* ---- 즐겨찾기 프롬프트 ------------------------------------------------ */
    $scope.favEdit = false;
    $scope.toggleFavEdit = function () { $scope.favEdit = !$scope.favEdit; };
    $scope.sendFavorite = function (text) {
      if ($scope.loading || !text) { return; }
      $scope.question = text;
      $scope.ask();
    };
    $scope.addFavorite = function () { $scope.settings.favorites = $scope.settings.favorites || []; $scope.settings.favorites.push(''); };
    $scope.removeFavorite = function (idx) { $scope.settings.favorites.splice(idx, 1); };
    $scope.saveFavorites = function () {
      $scope.settings.favorites = ($scope.settings.favorites || []).map(function (t) { return (t || '').trim(); }).filter(function (t) { return t; });
      if (!$scope.settings.favorites.length) { $scope.settings.favorites = angular.copy(FAVORITES_BY_LANG[$scope.settings.language] || FAVORITES_BY_LANG.ko); }
      writeLS(pickKnown($scope.settings));
      $scope.favEdit = false;
    };

    function _handleTranslations() {
      try { widgetUtilityService.checkTranslationMode($scope.$parent.model.type).then(function () { $scope.viewWidgetVars = {}; }); } catch (e) {}
    }

    /* ---- 커넥터 실행 + 응답 status 검증 ---------------------------------- */
    function executeConnector(connector, version, operation, config, params) {
      return $http.post('/api/integration/execute/?format=json', {
        connector: connector, version: version, operation: operation, config: config || '', params: params || {}
      }).then(function (response) { return response.data; });
    }
    /* ---- [v1.0.1] 질문 단위 fetch 메모이제이션 --------------------------- */
    // 같은 질문 안에서 동일 (op, config, params) read 조회를 1회로 합친다.
    // promise 자체를 캐싱하므로 같은 라운드의 병렬 호출($q.all)도 자동 공유된다.
    // ask() 시작 시 초기화 — FortiAI(create_responses)는 캐싱하지 않는다.
    var fetchCache = {};
    function cachedFetch(op, config, params, s) {
      var key = op + '|' + (config || '') + '|' + JSON.stringify(params || {});
      if (!fetchCache[key]) { fetchCache[key] = executeConnector(s.fortigateConnector, s.fortigateVersion, op, config, params); }
      return fetchCache[key];
    }
    function classifyExecute(body) {
      var out = { ok: true, message: '', payload: body };
      if (body && angular.isObject(body) && !angular.isArray(body)) {
        if (body.status !== undefined) {
          var st = String(body.status).toLowerCase();
          if (st.indexOf('fail') >= 0 || st.indexOf('error') >= 0) { out.ok = false; }
        }
        out.message = body.message || body.error || (body.data && body.data.message) || '';
        out.payload = (body.data !== undefined) ? body.data : body;
      }
      return out;
    }

    /* ---- 결과 정규화/요약 ------------------------------------------------ */
    // FortiGate 커넥터 응답 실제 형태: data.result = [ { results:[...실데이터...], matched_count, vdom } , ... ]
    // (vdom 별로 여러 envelope 가능) -> 모든 envelope 의 results 를 이어붙인다.
    function getList(payload) {
      if (angular.isArray(payload)) { return payload; }
      if (payload && angular.isObject(payload)) {
        if (angular.isArray(payload.result) && payload.result.some(function (e) { return e && angular.isArray(e.results); })) {
          var acc = [];
          payload.result.forEach(function (e) { if (e && angular.isArray(e.results)) { acc = acc.concat(e.results); } });
          return acc;
        }
        if (angular.isArray(payload.results)) { return payload.results; }
        if (angular.isArray(payload.result)) { return payload.result; }
        if (angular.isArray(payload.data)) { return payload.data; }
      }
      return [];
    }
    // FortiGate 가 matched_count 를 주면 그것을 정확한 개수로 사용(페이지네이션/트리밍과 무관하게 신뢰).
    function matchedCount(payload, fallbackLen) {
      if (payload && angular.isArray(payload.result)) {
        var mc = 0, has = false;
        payload.result.forEach(function (e) { if (e && typeof e.matched_count === 'number') { mc += e.matched_count; has = true; } });
        if (has) { return mc; }
      }
      return fallbackLen;
    }
    function names(value) {
      if (value === null || value === undefined) { return []; }
      if (!angular.isArray(value)) { value = [value]; }
      return value.map(function (item) {
        if (item && angular.isObject(item)) { return item.name || item.q_origin_key || item.subnet || JSON.stringify(item); }
        return item;
      });
    }
    function trimPolicies(list) {
      return list.map(function (p) {
        return { policyid: p.policyid, name: p.name, status: p.status, action: p.action,
          srcintf: names(p.srcintf), dstintf: names(p.dstintf), srcaddr: names(p.srcaddr), dstaddr: names(p.dstaddr),
          service: names(p.service), schedule: p.schedule, logtraffic: p.logtraffic, nat: p.nat, utm_status: p['utm-status'],
          comments: p.comments || p.comment };
      });
    }
    function trimAddresses(list) {
      return list.map(function (a) { return { name: a.name, type: a.type, subnet: a.subnet, start_ip: a['start-ip'], end_ip: a['end-ip'], fqdn: a.fqdn, comment: a.comment }; });
    }
    function trimServices(list) {
      return list.map(function (s) { return { name: s.name, protocol: s.protocol, tcp_portrange: s['tcp-portrange'], udp_portrange: s['udp-portrange'], category: s.category }; });
    }
    function trimGeneric(list) {
      return list.map(function (o) {
        if (!o || !angular.isObject(o)) { return o; }
        return { name: o.name || o.q_origin_key || o.id, member: names(o.member), comment: o.comment || o.comments };
      });
    }
    var TRIMMERS = { get_list_of_policies: trimPolicies, get_addresses: trimAddresses, get_firewall_services: trimServices };
    function summarize(op, payload) {
      var list = getList(payload);
      var trim = TRIMMERS[op] || trimGeneric;
      var items = trim(list);
      var count = matchedCount(payload, list.length);
      return { operation: op, count: count, returned: items.length, truncated: items.length > ITEM_CAP, items: items.slice(0, ITEM_CAP) };
    }

    /* ---- IP / CIDR 매칭 (LLM 대신 JS 로 정확히) -------------------------- */
    function ipToLong(ip) {
      if (ip === null || ip === undefined) { return null; }
      var parts = String(ip).trim().split('.'); if (parts.length !== 4) { return null; }
      var n = 0; for (var i = 0; i < 4; i++) { var o = parseInt(parts[i], 10); if (isNaN(o) || o < 0 || o > 255 || !/^\d+$/.test(parts[i])) { return null; } n = (n * 256) + o; } return n >>> 0;
    }
    function maskToPrefix(mask) { var m = ipToLong(mask); if (m === null) { return null; } var c = 0; for (var i = 31; i >= 0; i--) { if (m & (1 << i)) { c++; } else { break; } } return c; }
    function parseSubnet(subnet) {
      if (!subnet) { return null; } var str = String(subnet).trim(); var net, prefix;
      if (str.indexOf('/') >= 0) { var sl = str.split('/'); net = ipToLong(sl[0]); prefix = parseInt(sl[1], 10); }
      else { var sp = str.split(/\s+/); net = ipToLong(sp[0]); prefix = (sp[1] !== undefined) ? maskToPrefix(sp[1]) : 32; }
      if (net === null || prefix === null || isNaN(prefix) || prefix < 0 || prefix > 32) { return null; } return { net: net, prefix: prefix };
    }
    function ipInSubnet(ipLong, sn) { if (sn.prefix === 0) { return true; } var mask = (sn.prefix === 32) ? 0xFFFFFFFF : (~((1 << (32 - sn.prefix)) - 1)) >>> 0; return ((ipLong & mask) >>> 0) === ((sn.net & mask) >>> 0); }
    function addressMatchesIp(addr, ipLong) {
      if (addr.subnet) { var sn = parseSubnet(addr.subnet); if (sn && ipInSubnet(ipLong, sn)) { return true; } }
      if (addr.start_ip && addr.end_ip) { var a = ipToLong(addr.start_ip), b = ipToLong(addr.end_ip); if (a !== null && b !== null && ipLong >= a && ipLong <= b) { return true; } }
      return false;
    }
    /* ---- [v1.0.1] 그룹 해석 헬퍼 ----------------------------------------- */
    // 상향 폐포: 매칭된 leaf 이름 집합을 "그 leaf 를 (재귀적으로) 포함하는 그룹 이름"까지 확장.
    // member->parents 역인덱스 1회 구축 후 BFS — O(V+E). 순환 참조에도 안전(seen=out).
    function expandUpwardWithGroups(matchedSet, groups) {
      var parentIdx = {};
      (groups || []).forEach(function (g) {
        (g.member || []).forEach(function (m) { (parentIdx[m] = parentIdx[m] || []).push(g.name); });
      });
      var out = {}, queue = [];
      angular.forEach(matchedSet, function (v, k) { out[k] = true; queue.push(k); });
      while (queue.length) {
        var n = queue.pop();
        (parentIdx[n] || []).forEach(function (gn) { if (!out[gn]) { out[gn] = true; queue.push(gn); } });
      }
      return out;
    }
    // 클라이언트 계산 툴: IP -> (JS로 정확히) 주소객체 매칭 -> 그 이름을 쓰는 정책까지 필터.
    // 주소/정책 전량은 "클라이언트에서만" 가져와 JS 로 줄이고, 모델에는 매칭된 소량만 돌려준다.
    function findPoliciesByIp(ip, s) {
      var ipLong = ipToLong(ip);
      if (ipLong === null) { return $q.resolve({ operation: 'find_policies_by_ip', ip: ip, error: 'invalid IP' }); }
      var vdom = s.vdom || 'root';
      var addrCall = cachedFetch('get_addresses', s.fortigateConfigId, { address_category: 'address', vdom: vdom }, s);
      var polCall = cachedFetch('get_list_of_policies', s.fortigateConfigId, { vdom: vdom }, s);
      var grpCall = cachedFetch('get_address_groups', s.fortigateConfigId, { vdom: vdom }, s);
      return $q.all([addrCall, polCall, grpCall]).then(function (bodies) {
        var ac = classifyExecute(bodies[0]), pc = classifyExecute(bodies[1]), gc = classifyExecute(bodies[2]);
        if (!ac.ok) { return { operation: 'find_policies_by_ip', ip: ip, error: ac.message || 'address lookup failed' }; }
        if (!pc.ok) { return { operation: 'find_policies_by_ip', ip: ip, error: pc.message || 'policy lookup failed' }; }
        var addrs = trimAddresses(getList(ac.payload));
        var matchedNames = addrs.filter(function (a) { return addressMatchesIp(a, ipLong); }).map(function (a) { return a.name; });
        var set = {}; matchedNames.forEach(function (n) { set[n] = true; });
        // [v1.0.1] 그룹 참조 정책까지 매칭: leaf 를 포함하는 그룹(중첩 포함)도 매칭 집합에 편입
        var groups = gc.ok ? trimGeneric(getList(gc.payload)) : [];
        set = expandUpwardWithGroups(set, groups);
        var matchedGroups = Object.keys(set).filter(function (n) { return matchedNames.indexOf(n) < 0; });
        var policies = trimPolicies(getList(pc.payload));
        var related = policies.filter(function (p) {
          return (p.srcaddr || []).some(function (n) { return set[n]; }) || (p.dstaddr || []).some(function (n) { return set[n]; });
        }).map(function (p) {
          return { policyid: p.policyid, name: p.name, action: p.action, status: p.status,
            matched_in: ((p.srcaddr || []).some(function (n) { return set[n]; }) ? 'srcaddr ' : '') + ((p.dstaddr || []).some(function (n) { return set[n]; }) ? 'dstaddr' : ''),
            srcaddr: p.srcaddr, dstaddr: p.dstaddr, service: p.service };
        });
        return { operation: 'find_policies_by_ip', ip: ip, vdom: vdom,
          matched_addresses: matchedNames, matched_via_groups: matchedGroups, related_policies: related,
          address_total: addrs.length, policy_total: matchedCount(pc.payload, policies.length) };
      });
    }

    /* ---- 서비스/포트 매칭 (LLM 대신 JS) --------------------------------- */
    function parsePortRanges(str) {
      if (!str) { return []; }
      return String(str).trim().split(/\s+/).map(function (tok) {
        var mm = tok.split('-'); var lo = parseInt(mm[0], 10); var hi = mm.length > 1 ? parseInt(mm[1], 10) : lo;
        if (isNaN(lo)) { return null; } if (isNaN(hi)) { hi = lo; } return [lo, hi];
      }).filter(Boolean);
    }
    // svc: trimServices 결과({name,protocol,tcp_portrange,udp_portrange}). port/proto 를 포함하면 true.
    function serviceCoversPort(svc, port, proto) {
      var name = (svc.name || '').toUpperCase();
      if (name === 'ALL') { return true; }
      if (proto === 'tcp' && name === 'ALL_TCP') { return true; }
      if (proto === 'udp' && name === 'ALL_UDP') { return true; }
      if (proto === 'icmp' && (name === 'ALL_ICMP' || name === 'PING')) { return true; }
      if (port === null || port === undefined || isNaN(port)) {
        return (svc.protocol || '').toUpperCase().indexOf(proto.toUpperCase()) >= 0;
      }
      var ranges = (proto === 'udp') ? parsePortRanges(svc.udp_portrange) : parsePortRanges(svc.tcp_portrange);
      if (!ranges.length) { return false; }
      return ranges.some(function (r) { return port >= r[0] && port <= r[1]; });
    }
    function topN(map, n) {
      return Object.keys(map).map(function (k) { return { key: k, count: map[k] }; })
        .sort(function (a, b) { return b.count - a.count; }).slice(0, n);
    }

    /* ---- [계산] check_connectivity: srcIP->dstIP:port 를 first-match 로 평가 --- */
    function checkConnectivity(a, s) {
      var src = (a.src_ip || '').trim(), dst = (a.dst_ip || '').trim();
      var proto = (a.protocol || 'tcp').toLowerCase();
      var port = (a.port !== undefined && String(a.port).trim() !== '') ? parseInt(a.port, 10) : null;
      var srcL = ipToLong(src), dstL = ipToLong(dst);
      if (srcL === null || dstL === null) { return $q.resolve({ operation: 'check_connectivity', error: 'invalid src or dst IP' }); }
      var vdom = a.vdom || s.vdom || 'root';
      return $q.all([
        cachedFetch('get_addresses', s.fortigateConfigId, { address_category: 'address', vdom: vdom }, s),
        cachedFetch('get_list_of_policies', s.fortigateConfigId, { vdom: vdom }, s),
        cachedFetch('get_firewall_services', s.fortigateConfigId, { vdom: vdom }, s),
        cachedFetch('get_address_groups', s.fortigateConfigId, { vdom: vdom }, s),
        cachedFetch('get_service_groups', s.fortigateConfigId, { vdom: vdom }, s)
      ]).then(function (b) {
        var ac = classifyExecute(b[0]), pc = classifyExecute(b[1]), sc = classifyExecute(b[2]),
            agc = classifyExecute(b[3]), sgc = classifyExecute(b[4]);
        if (!ac.ok) { return { operation: 'check_connectivity', error: ac.message || 'address lookup failed' }; }
        if (!pc.ok) { return { operation: 'check_connectivity', error: pc.message || 'policy lookup failed' }; }
        var addrs = trimAddresses(getList(ac.payload));
        var svcs = sc.ok ? trimServices(getList(sc.payload)) : [];
        var svcByName = {}; svcs.forEach(function (v) { svcByName[(v.name || '').toUpperCase()] = v; });
        var srcNames = {}, dstNames = {};
        addrs.forEach(function (x) {
          if (addressMatchesIp(x, srcL)) { srcNames[x.name] = true; }
          if (addressMatchesIp(x, dstL)) { dstNames[x.name] = true; }
        });
        // [v1.0.1] 그룹 참조 정책 매칭: leaf 집합을 포함 그룹(중첩 포함)까지 상향 확장
        var addrGroups = agc.ok ? trimGeneric(getList(agc.payload)) : [];
        srcNames = expandUpwardWithGroups(srcNames, addrGroups);
        dstNames = expandUpwardWithGroups(dstNames, addrGroups);
        function addrMatch(list, set) { return (list || []).some(function (n) { return n === 'all' || set[n]; }); }
        // [v1.0.1] 서비스 그룹 재귀 해석: 정책이 서비스 그룹을 참조해도 leaf 포트까지 내려가 판정
        var svcGrpByName = {};
        (sgc.ok ? trimGeneric(getList(sgc.payload)) : []).forEach(function (g) { svcGrpByName[(g.name || '').toUpperCase()] = (g.member || []); });
        function svcNameCovers(n, seen) {
          var up = (n || '').toUpperCase(); if (up === 'ALL') { return true; }
          var sv = svcByName[up]; if (sv) { return serviceCoversPort(sv, port, proto); }
          var g = svcGrpByName[up]; if (!g || seen[up]) { return false; }
          seen[up] = true;
          return g.some(function (m) { return svcNameCovers(m, seen); });
        }
        function svcMatch(list) { return (list || []).some(function (n) { return svcNameCovers(n, {}); }); }
        var policies = trimPolicies(getList(pc.payload));   // API 순서 = FortiGate 평가 순서
        var decided = null, evaluated = 0;
        for (var i = 0; i < policies.length; i++) {
          var p = policies[i];
          if (p.status && String(p.status).toLowerCase() !== 'enable') { continue; }
          evaluated++;
          if (!addrMatch(p.srcaddr, srcNames)) { continue; }
          if (!addrMatch(p.dstaddr, dstNames)) { continue; }
          if (!svcMatch(p.service)) { continue; }
          decided = { policyid: p.policyid, name: p.name, action: p.action, srcaddr: p.srcaddr, dstaddr: p.dstaddr,
            service: p.service, srcintf: p.srcintf, dstintf: p.dstintf, logtraffic: p.logtraffic, nat: p.nat };
          break;
        }
        var verdict = decided ? (String(decided.action).toLowerCase() === 'accept' ? 'ALLOWED' : 'BLOCKED') : 'BLOCKED';
        return { operation: 'check_connectivity', src_ip: src, dst_ip: dst, protocol: proto, port: port, vdom: vdom,
          verdict: verdict, decided_by: decided || 'implicit-deny (no matching rule)',
          matched_src_objects: Object.keys(srcNames), matched_dst_objects: Object.keys(dstNames),
          policies_evaluated: evaluated, policy_total: matchedCount(pc.payload, policies.length),
          note: 'Evaluated by address/service (recursive group resolution) and policy order (first-match). Interfaces/zones/routing/NAT are NOT evaluated — use FortiGate policy lookup for the exact forwarding path.' };
      });
    }

    /* ---- [계산] audit_policies: 정책 위생/위험 점검 --------------------- */
    function auditPolicies(a, s) {
      var vdom = a.vdom || s.vdom || 'root';
      return $q.all([
        cachedFetch('get_list_of_policies', s.fortigateConfigId, { vdom: vdom }, s),
        cachedFetch('get_addresses', s.fortigateConfigId, { address_category: 'address', vdom: vdom }, s),
        cachedFetch('get_address_groups', s.fortigateConfigId, { vdom: vdom }, s)
      ]).then(function (b) {
        var pc = classifyExecute(b[0]), ac = classifyExecute(b[1]), gc = classifyExecute(b[2]);
        if (!pc.ok) { return { operation: 'audit_policies', error: pc.message || 'policy lookup failed' }; }
        var policies = trimPolicies(getList(pc.payload));
        var addrs = ac.ok ? trimAddresses(getList(ac.payload)) : [];
        var findings = [];
        function isAll(list) { return (list || []).some(function (n) { return n === 'all'; }); }
        function svcAll(list) { return (list || []).some(function (n) { return String(n).toUpperCase() === 'ALL'; }); }
        var dupMap = {};
        policies.forEach(function (p) {
          var accept = String(p.action || '').toLowerCase() === 'accept';
          var enabled = String(p.status || '').toLowerCase() === 'enable';
          if (accept && enabled && isAll(p.srcaddr) && isAll(p.dstaddr) && svcAll(p.service)) {
            findings.push({ severity: 'high', policyid: p.policyid, name: p.name, issue: 'any/any/ALL allowed', detail: 'accept rule with src, dst and service all set to all/ALL' });
          } else if (accept && enabled && (isAll(p.srcaddr) || isAll(p.dstaddr))) {
            findings.push({ severity: 'medium', policyid: p.policyid, name: p.name, issue: 'overly broad allow', detail: (isAll(p.srcaddr) ? 'srcaddr=all ' : '') + (isAll(p.dstaddr) ? 'dstaddr=all' : '') });
          }
          if (accept && enabled && String(p.logtraffic || '').toLowerCase() === 'disable') {
            findings.push({ severity: 'medium', policyid: p.policyid, name: p.name, issue: 'logging disabled', detail: 'accept rule with logtraffic=disable' });
          }
          if (accept && enabled && String(p.utm_status || '').toLowerCase() !== 'enable') {
            findings.push({ severity: 'low', policyid: p.policyid, name: p.name, issue: 'UTM not applied', detail: 'accept rule without security profiles (IPS/AV/Web, ...) (utm-status!=enable)' });
          }
          if (!enabled) {
            findings.push({ severity: 'info', policyid: p.policyid, name: p.name, issue: 'disabled rule', detail: 'status=disable (cleanup candidate)' });
          }
          var key = [(p.srcaddr || []).slice().sort().join(','), (p.dstaddr || []).slice().sort().join(','), (p.service || []).slice().sort().join(','), p.action].join('|');
          (dupMap[key] = dupMap[key] || []).push(p.policyid);
        });
        angular.forEach(dupMap, function (ids) {
          if (ids.length > 1) { findings.push({ severity: 'medium', policyid: ids.join(','), name: '(duplicate)', issue: 'duplicate rules', detail: ids.length + ' rules with identical src/dst/service/action: ' + ids.join(', ') }); }
        });
        // [v1.0.1] 하향 폐포 기반 사용 판정: 정책 직접 참조 + 참조된 그룹의 재귀 멤버까지 "사용됨".
        // (기존: 그룹 경유로만 쓰이는 주소가 미사용으로 오탐되던 문제 수정)
        var agroups = gc.ok ? trimGeneric(getList(gc.payload)) : [];
        var grpMembers = {}; agroups.forEach(function (g) { grpMembers[g.name] = (g.member || []); });
        var used = {};
        function markUsed(n) {
          if (!n || used[n]) { return; } used[n] = 1;
          (grpMembers[n] || []).forEach(markUsed);
        }
        policies.forEach(function (p) { (p.srcaddr || []).forEach(markUsed); (p.dstaddr || []).forEach(markUsed); });
        var unused = addrs.map(function (x) { return x.name; }).filter(function (n) { return n && n !== 'all' && !used[n]; });
        var order = { high: 0, medium: 1, low: 2, info: 3 };
        findings.sort(function (x, y) { return order[x.severity] - order[y.severity]; });
        var counts = { high: 0, medium: 0, low: 0, info: 0 }; findings.forEach(function (f) { counts[f.severity]++; });
        return { operation: 'audit_policies', vdom: vdom, policy_total: matchedCount(pc.payload, policies.length),
          counts: counts, unused_address_count: unused.length, unused_addresses: unused.slice(0, ITEM_CAP),
          findings_total: findings.length, findings_returned: Math.min(findings.length, ITEM_CAP), truncated: findings.length > ITEM_CAP,
          findings: findings.slice(0, ITEM_CAP) };
      });
    }

    /* ---- [계산] analyze_logs: 시스템 이벤트 로그 요약 ------------------- */
    function analyzeLogs(a, s) {
      var params = {};
      if (a.filter && a.filter.trim()) { params.filter = a.filter.trim(); }
      return cachedFetch('get_system_events', s.fortigateConfigId, params, s).then(function (body) {
        var c = classifyExecute(body);
        if (!c.ok) { return { operation: 'analyze_logs', error: c.message || 'log lookup failed' }; }
        var ev = getList(c.payload);
        function tally(field) { var m = {}; ev.forEach(function (e) { var k = String(e[field]); m[k] = (m[k] || 0) + 1; }); return topN(m, 8); }
        var wantLevel = (a.level || '').toLowerCase();
        var attention = ev.filter(function (e) {
          var l = String(e.level || '').toLowerCase();
          return wantLevel ? (l === wantLevel) : (l === 'error' || l === 'warning' || l === 'critical' || l === 'alert');
        });
        var samples = attention.slice(0, ITEM_CAP).map(function (e) {
          return { date: e.date, time: e.time, level: e.level, subtype: e.subtype, logdesc: e.logdesc, user: e.user, msg: String(e.msg || '').slice(0, 160) };
        });
        return { operation: 'analyze_logs', event_total: ev.length, by_level: tally('level'), by_subtype: tally('subtype'),
          top_logdesc: tally('logdesc'), attention_count: attention.length, samples: samples };
      });
    }

    /* ---- 위험 포트/서비스 판정 ------------------------------------------ */
    var RISKY_PORTS = { 21: 'FTP', 22: 'SSH', 23: 'Telnet', 135: 'RPC', 139: 'NetBIOS', 445: 'SMB',
      1433: 'MSSQL', 1521: 'Oracle', 3306: 'MySQL', 3389: 'RDP', 5432: 'PostgreSQL', 5900: 'VNC',
      6379: 'Redis', 27017: 'MongoDB', 161: 'SNMP', 389: 'LDAP', 11211: 'Memcached' };
    function serviceRisk(svcName, svcByName) {
      var up = (svcName || '').toUpperCase();
      if (up === 'ALL' || up === 'ALL_TCP' || up === 'ALL_UDP') { return { risky: true, label: '전체 포트(' + up + ')' }; }
      var sv = svcByName[up]; if (!sv) { return { risky: false }; }
      var hits = [];
      [sv.tcp_portrange, sv.udp_portrange].forEach(function (pr) {
        parsePortRanges(pr).forEach(function (r) {
          angular.forEach(RISKY_PORTS, function (lbl, port) { port = parseInt(port, 10); if (port >= r[0] && port <= r[1]) { hits.push(lbl + '/' + port); } });
        });
      });
      return { risky: hits.length > 0, label: hits.join(', ') };
    }

    /* ---- [계산] exposure_scan: 외부(untrust)->내부 노출 규칙 ------------- */
    var DEFAULT_UNTRUST = ['sdwan', 'wan', 'wan1', 'wan2', 'port1', 'internet', 'ppp0', 'ssl.root'];
    function exposureScan(a, s) {
      var vdom = a.vdom || s.vdom || 'root';
      var untrust = {};
      var raw = (a.untrust_interfaces && a.untrust_interfaces.trim()) ? a.untrust_interfaces.split(',') : DEFAULT_UNTRUST;
      raw.forEach(function (x) { untrust[String(x).trim().toLowerCase()] = true; });
      return $q.all([
        cachedFetch('get_list_of_policies', s.fortigateConfigId, { vdom: vdom }, s),
        cachedFetch('get_firewall_services', s.fortigateConfigId, { vdom: vdom }, s),
        cachedFetch('get_service_groups', s.fortigateConfigId, { vdom: vdom }, s)
      ]).then(function (b) {
        var pc = classifyExecute(b[0]), sc = classifyExecute(b[1]), sgc = classifyExecute(b[2]);
        if (!pc.ok) { return { operation: 'exposure_scan', error: pc.message || 'policy lookup failed' }; }
        var svcs = sc.ok ? trimServices(getList(sc.payload)) : [];
        var svcByName = {}; svcs.forEach(function (v) { svcByName[(v.name || '').toUpperCase()] = v; });
        // [v1.0.1] 서비스 그룹 재귀 위험 판정
        var svcGrpByName = {};
        (sgc.ok ? trimGeneric(getList(sgc.payload)) : []).forEach(function (g) { svcGrpByName[(g.name || '').toUpperCase()] = (g.member || []); });
        function serviceRiskDeep(name, seen) {
          var up = (name || '').toUpperCase();
          if (svcByName[up] || up === 'ALL' || up === 'ALL_TCP' || up === 'ALL_UDP') { return serviceRisk(name, svcByName); }
          var g = svcGrpByName[up]; if (!g || seen[up]) { return { risky: false }; }
          seen[up] = true;
          var hits = [];
          g.forEach(function (m) { var rr = serviceRiskDeep(m, seen); if (rr.risky) { hits.push(rr.label); } });
          return { risky: hits.length > 0, label: hits.join(', ') };
        }
        var policies = trimPolicies(getList(pc.payload));
        var findings = [];
        policies.forEach(function (p) {
          if (String(p.action || '').toLowerCase() !== 'accept' || String(p.status || '').toLowerCase() !== 'enable') { return; }
          var fromUntrust = (p.srcintf || []).some(function (i) { return untrust[String(i).toLowerCase()] || i === 'any'; });
          var srcAny = (p.srcaddr || []).some(function (n) { return n === 'all'; });
          if (!fromUntrust && !srcAny) { return; }
          var risks = [];
          (p.service || []).forEach(function (n) { var r = serviceRiskDeep(n, {}); if (r.risky) { risks.push(r.label); } });
          var sev = risks.length ? 'high' : (fromUntrust && srcAny ? 'medium' : 'low');
          findings.push({ severity: sev, policyid: p.policyid, name: p.name,
            srcintf: p.srcintf, srcaddr: p.srcaddr, dstintf: p.dstintf, dstaddr: p.dstaddr, service: p.service,
            exposed_risky: risks.join('; ') || '(no risky ports / not port-wide)', nat: p.nat, logtraffic: p.logtraffic });
        });
        var order = { high: 0, medium: 1, low: 2 };
        findings.sort(function (x, y) { return order[x.severity] - order[y.severity]; });
        var counts = { high: 0, medium: 0, low: 0 }; findings.forEach(function (f) { counts[f.severity]++; });
        return { operation: 'exposure_scan', vdom: vdom, untrust_interfaces: Object.keys(untrust),
          counts: counts, findings_total: findings.length, findings_returned: Math.min(findings.length, ITEM_CAP),
          truncated: findings.length > ITEM_CAP, findings: findings.slice(0, ITEM_CAP),
          note: 'Accept rules whose srcintf is untrust (default: sdwan/wan*, ...) or srcaddr=all. VIP/DNAT details are NOT included because this connector exposes no VIP lookup operation.' };
      });
    }

    /* ---- [계산] expand_group: 주소/서비스 그룹 재귀 전개 ---------------- */
    function expandGroup(a, s) {
      var vdom = a.vdom || s.vdom || 'root';
      var gname = (a.group_name || '').trim();
      var gtype = (a.group_type || 'address').toLowerCase();
      if (!gname) { return $q.resolve({ operation: 'expand_group', error: 'group_name is required' }); }
      var isSvc = gtype === 'service';
      var grpOp = isSvc ? 'get_service_groups' : 'get_address_groups';
      var leafOp = isSvc ? 'get_firewall_services' : 'get_addresses';
      var leafParams = isSvc ? { vdom: vdom } : { address_category: 'address', vdom: vdom };
      return $q.all([
        cachedFetch(grpOp, s.fortigateConfigId, { vdom: vdom }, s),
        cachedFetch(leafOp, s.fortigateConfigId, leafParams, s)
      ]).then(function (b) {
        var gc = classifyExecute(b[0]), lc = classifyExecute(b[1]);
        if (!gc.ok) { return { operation: 'expand_group', error: gc.message || 'group lookup failed' }; }
        var groups = trimGeneric(getList(gc.payload));   // {name, member:[...]}
        var leaves = isSvc ? trimServices(getList(lc.payload)) : trimAddresses(getList(lc.payload));
        var grpByName = {}, leafByName = {};
        groups.forEach(function (g) { grpByName[g.name] = (g.member || []); });
        leaves.forEach(function (l) { leafByName[l.name] = l; });
        var seen = {}, leafOut = [], nested = [];
        (function walk(nm) {
          if (seen[nm]) { return; } seen[nm] = true;
          if (grpByName[nm] !== undefined) {
            if (nm !== gname) { nested.push(nm); }
            grpByName[nm].forEach(walk);
          } else if (leafByName[nm]) {
            var l = leafByName[nm];
            leafOut.push(isSvc ? { name: l.name, protocol: l.protocol, tcp: l.tcp_portrange, udp: l.udp_portrange }
              : { name: l.name, subnet: l.subnet, start_ip: l.start_ip, end_ip: l.end_ip, fqdn: l.fqdn });
          } else { leafOut.push({ name: nm, unresolved: true }); }
        })(gname);
        if (grpByName[gname] === undefined) { return { operation: 'expand_group', group: gname, type: gtype, error: 'group not found' }; }
        return { operation: 'expand_group', group: gname, type: gtype, nested_groups: nested,
          leaf_count: leafOut.length, members: leafOut.slice(0, ITEM_CAP), truncated: leafOut.length > ITEM_CAP };
      });
    }

    /* ---- [계산] compare_firewalls: 두 방화벽 정책/객체 드리프트 --------- */
    function compareFirewalls(a, s) {
      var vdom = a.vdom || s.vdom || 'root';
      var cfgB = (a.config_b || '').trim();
      if (!cfgB) { return $q.resolve({ operation: 'compare_firewalls', error: 'config_b (the second FortiGate config id) is required' }); }
      function fetchBoth(cfg) {
        return $q.all([
          cachedFetch('get_list_of_policies', cfg, { vdom: vdom }, s),
          cachedFetch('get_addresses', cfg, { address_category: 'address', vdom: vdom }, s)
        ]).then(function (b) {
          var pc = classifyExecute(b[0]), ac = classifyExecute(b[1]);
          return { ok: pc.ok, policies: trimPolicies(getList(pc.payload)), addresses: ac.ok ? trimAddresses(getList(ac.payload)) : [] };
        });
      }
      return $q.all([fetchBoth(s.fortigateConfigId), fetchBoth(cfgB)]).then(function (r) {
        var A = r[0], B = r[1];
        if (!A.ok) { return { operation: 'compare_firewalls', error: 'lookup failed for firewall A (current)' }; }
        if (!B.ok) { return { operation: 'compare_firewalls', error: 'lookup failed for firewall B (config_b) — check the config id' }; }
        function addrMap(list) { var m = {}; list.forEach(function (x) { m[x.name] = (x.subnet || '') + '|' + (x.start_ip || '') + '-' + (x.end_ip || '') + '|' + (x.fqdn || ''); }); return m; }
        var aM = addrMap(A.addresses), bM = addrMap(B.addresses);
        var onlyA = [], onlyB = [], conflict = [];
        Object.keys(aM).forEach(function (n) { if (!(n in bM)) { onlyA.push(n); } else if (aM[n] !== bM[n]) { conflict.push({ name: n, A: aM[n], B: bM[n] }); } });
        Object.keys(bM).forEach(function (n) { if (!(n in aM)) { onlyB.push(n); } });
        function polMap(list) { var m = {}; list.forEach(function (p) { m[p.name || ('#' + p.policyid)] = p; }); return m; }
        var pA = polMap(A.policies), pB = polMap(B.policies);
        var polOnlyA = [], polOnlyB = [];
        Object.keys(pA).forEach(function (n) { if (!(n in pB)) { polOnlyA.push(n); } });
        Object.keys(pB).forEach(function (n) { if (!(n in pA)) { polOnlyB.push(n); } });
        return { operation: 'compare_firewalls', vdom: vdom, config_b: cfgB,
          address_conflicts_count: conflict.length, address_conflicts: conflict.slice(0, ITEM_CAP),
          addr_only_in_A_count: onlyA.length, addr_only_in_A: onlyA.slice(0, ITEM_CAP),
          addr_only_in_B_count: onlyB.length, addr_only_in_B: onlyB.slice(0, ITEM_CAP),
          policy_only_in_A_count: polOnlyA.length, policy_only_in_A: polOnlyA.slice(0, ITEM_CAP),
          policy_only_in_B_count: polOnlyB.length, policy_only_in_B: polOnlyB.slice(0, ITEM_CAP),
          note: 'Name-based comparison. address_conflicts = same name, different value (the most dangerous drift).' };
      });
    }

    /* ---- 단일 툴 실행(화이트리스트 강제) --------------------------------- */
    function cleanArgs(args) {
      var out = {}; angular.forEach(args || {}, function (v, k) {
        if (v === null || v === undefined) { return; }
        if (typeof v === 'string' && v.trim() === '') { return; }
        out[k] = v;
      }); return out;
    }
    function runTool(name, args, s) {
      if (name === 'find_policies_by_ip') { return findPoliciesByIp((args && args.ip) || '', s); }
      if (name === 'check_connectivity') { return checkConnectivity(args || {}, s); }
      if (name === 'audit_policies') { return auditPolicies(args || {}, s); }
      if (name === 'analyze_logs') { return analyzeLogs(args || {}, s); }
      if (name === 'exposure_scan') { return exposureScan(args || {}, s); }
      if (name === 'expand_group') { return expandGroup(args || {}, s); }
      if (name === 'compare_firewalls') { return compareFirewalls(args || {}, s); }
      if (!CONNECTOR_OPS[name]) { return $q.resolve({ operation: name, error: 'operation not allowed (not read-only)' }); }
      var params = cleanArgs(args);
      if (VDOM_OPS[name] && params.vdom === undefined && s.vdom) { params.vdom = s.vdom; }
      return cachedFetch(name, s.fortigateConfigId, params, s)
        .then(function (body) {
          var cls = classifyExecute(body);
          if (!cls.ok) { return { operation: name, error: cls.message || 'connector reported failure', _rawBytes: JSON.stringify(body).length, _raw: body }; }
          var summ = summarize(name, cls.payload);
          summ._rawBytes = JSON.stringify(cls.payload).length; summ._raw = cls.payload; summ._params = params;
          return summ;
        })
        .catch(function (error) {
          var msg = (error && error.data && error.data.message) ? error.data.message : (error.message || 'operation failed');
          return { operation: name, error: msg };
        });
    }

    /* ---- create_responses 호출 + 출력 파싱 ------------------------------ */
    function callResponses(input, offerTools, s) {
      var params = {
        model: s.model || DEFAULTS.model, input_type: 'Plain Text', input: input, instructions: instructions(s),
        tools: offerTools ? FG_TOOLS : [], tool_choice: offerTools ? 'auto' : '', additional_parameters: {}
      };
      return executeConnector(s.fortiaiConnector, s.fortiaiVersion, 'create_responses', s.fortiaiConfigId, params);
    }
    function extractOutput(body) {
      var data = (body && body.data !== undefined) ? body.data : body;
      var resp = (data && data.response) ? data.response : data;
      var out = (resp && resp.output) || [];
      var calls = [], text = null;
      out.forEach(function (item) {
        if (item.type === 'function_call') { calls.push({ call_id: item.call_id, name: item.name, arguments: item.arguments }); }
        else if (item.type === 'message' && item.content) {
          item.content.forEach(function (c) { if (c && (c.type === 'output_text' || c.text)) { text = (text || '') + (c.text || ''); } });
        }
      });
      if (text === null && data && data.output_text) { text = data.output_text; }
      return { calls: calls, text: text, id: (resp && resp.id) || (data && data.id) };
    }

    /* ---- 에이전트 루프 (위젯이 오케스트레이션) --------------------------- */
    function buildInput(question, toolLog, s) {
      var vdom = (s && s.vdom) || 'root';
      if (!toolLog.length) {
        return 'User question: \"\"\"' + question + '\"\"\"\n\n' +
          'You may call FortiGate read-only function tools. Call ONLY the tools needed to answer, WITH filters. ' +
          'Never dump full lists unnecessarily; when only a count is needed, rely on the count field of the result.\n' +
          '- Default vdom is "' + vdom + '". If the user does not specify a vdom, use it without asking.\n' +
          '- For questions about policies related to a specific IP, a single find_policies_by_ip call is enough (address/policy matching, including group references, is computed exactly).\n' +
          '- For reachability questions ("can A reach B on port X?"), use check_connectivity (ordered first-match evaluation, group-aware).\n' +
          '- For policy hygiene / risky-rule / audit questions, use audit_policies (findings by severity).\n' +
          '- For recent logs / errors / warnings / events, use analyze_logs.\n' +
          '- For internet/external exposure questions, use exposure_scan.\n' +
          '- For "what is inside this group" questions, use expand_group.\n' +
          '- For comparing two firewalls, use compare_firewalls. Registered firewalls=' +
            JSON.stringify((s.firewalls || []).map(function (f) { return { name: f.name, configId: f.configId, vdom: f.vdom }; })) +
            ' / currently active="' + (s.activeFirewall || '') + '". Put the OTHER firewall\'s configId into config_b.\n' +
          '- Do not ask the user anything; investigate with tools autonomously and then present the final answer.';
      }
      var compact = toolLog.map(function (t) { return { tool: t.name, args: t.args, result: t.result }; });
      return 'User question: \"\"\"' + question + '\"\"\"\n\n' +
        'Tool results so far (summarized, relevant fields only):\n' + JSON.stringify(compact) + '\n\n' +
        'Rules:\n' +
        '- Base your answer ONLY on the results above. Never invent values. Trust result.count for totals. ' +
        'If related_policies is empty, state that there are no related policies. All lookups were read-only.\n' +
        '- If the information is sufficient, produce the FINAL answer now (never ask the user back). Otherwise call additional tools.\n\n' +
        'FINAL ANSWER quality requirements (write in ' + answerLang(s) + '):\n' +
        '- Line 1: a direct one-line verdict/answer (the conclusion first: a number, ALLOWED/BLOCKED, yes/no, or a one-sentence summary).\n' +
        '- Then the evidence: cite concrete values from the results — policy IDs, names, counts. When listing 3 or more items, use a compact markdown table.\n' +
        '- If a result contains a note about unevaluated factors (e.g., routing/NAT/interfaces) or truncation, add exactly one short caveat line.\n' +
        '- When useful, end with ONE short actionable recommendation (e.g., which policy ID to review first).\n' +
        '- Be concise and specific; no filler, no repetition of the question.';
    }
    function agentLoop(question, s) {
      var toolLog = [];
      var toolMemo = {};   // [v1.0.1] 라운드 간 동일 (툴+args) 재호출 가드 — 라운드 낭비 방지
      function turn(step) {
        var offerTools = step < MAX_ROUNDS;   // 마지막 라운드는 도구 없이 답변 강제
        var input = buildInput(question, toolLog, s);
        return callResponses(input, offerTools, s).then(function (body) {
          var o = extractOutput(body);
          $scope.debug.rounds.push({ step: step, input_chars: input.length, offeredTools: offerTools, calls: o.calls.map(function (c) { return c.name; }), answered: !!(o.text && !o.calls.length), raw: body });
          if (offerTools && o.calls.length) {
            return $q.all(o.calls.map(function (fc) {
              var args = {}; try { args = JSON.parse(fc.arguments || '{}'); } catch (e) {}
              var mkey = fc.name + '|' + JSON.stringify(cleanArgs(args));
              if (toolMemo[mkey]) {
                toolLog.push({ name: fc.name, args: cleanArgs(args), result: { cached: true, note: 'duplicate call — refer to the earlier result of the same tool in this log' } });
                $scope.debug.toolCalls.push({ step: step, name: fc.name, args: cleanArgs(args), cached: true });
                return $q.resolve();
              }
              toolMemo[mkey] = true;
              return runTool(fc.name, args, s).then(function (r) {
                var feedback = angular.copy(r); delete feedback._raw;   // 원시는 디버그에만
                toolLog.push({ name: fc.name, args: cleanArgs(args), result: feedback });
                $scope.debug.toolCalls.push({ step: step, name: fc.name, args: cleanArgs(args), rawBytes: r._rawBytes || 0, count: r.count, error: r.error, summary: feedback, raw: r._raw });
              });
            })).then(function () { return turn(step + 1); });
          }
          return o.text || t('errParse');
        });
      }
      return turn(1);
    }
    function settingsForFirewall(base, fw) {
      var s = angular.copy(base);
      s.activeFirewall = fw.name;
      s.fortigateConfigId = fw.configId;
      s.fortigateVersion = fw.version || '5.4.0';
      s.vdom = fw.vdom || 'root';
      return s;
    }
    function aggregateMultiFirewallAnswer(question, results, s) {
      var compact = results.map(function (r) {
        return { firewall: r.firewall, vdom: r.vdom, configId: r.configId, ok: !r.error, answer: r.answer, error: r.error };
      });
      var input =
        'User question: """' + question + '"""\n\n' +
        'The same read-only FortiGate investigation was run independently against multiple selected firewalls. ' +
        'Synthesize ONE final answer from these per-firewall answers. Do not call tools.\n\n' +
        'Per-firewall results:\n' + JSON.stringify(compact) + '\n\n' +
        'Requirements:\n' +
        '- Write in ' + answerLang(s) + '.\n' +
        '- Start with the cross-firewall conclusion. If the question asks for a count, include per-firewall counts and a total when the counts are explicit.\n' +
        '- Use a compact markdown table with one row per firewall whenever possible.\n' +
        '- If one firewall failed, keep successful firewall results and show the failed firewall with its error.\n' +
        '- Do not invent values that are not present in the per-firewall answers.';
      return callResponses(input, false, s).then(function (body) {
        var o = extractOutput(body);
        return o.text || t('errParse');
      });
    }
    function fallbackMultiFirewallAnswer(results) {
      var lines = ['| Firewall | Result |', '|---|---|'];
      results.forEach(function (r) {
        var text = r.error ? ('ERROR: ' + r.error) : (r.answer || '');
        lines.push('| ' + r.firewall + ' | ' + text.replace(/\n/g, '<br>') + ' |');
      });
      return lines.join('\n');
    }

    /* ---- 메인 핸들러 ----------------------------------------------------- */
    $scope.ask = function () {
      var question = ($scope.question || '').trim();
      if (!question || $scope.loading) { return; }
      loadSettings();
      var targets = selectedFws($scope.settings);
      if (!targets.length) {
        pushMessage({ role: 'error', text: t('errNeedSelection') });
        return;
      }
      if (targets.some(function (fw) { return !fw.configId; })) {
        $scope.showSettings = true;
        pushMessage({ role: 'error', text: t('errNeedCfg') });
        return;
      }
      $scope.question = '';
      $scope.loading = true;
      $scope.debug.rounds = [];
      $scope.debug.toolCalls = [];
      fetchCache = {};   // [v1.0.1] 질문 단위 fetch 캐시 초기화
      pushMessage({ role: 'user', text: question });

      var run = (targets.length === 1)
        ? agentLoop(question, settingsForFirewall($scope.settings, targets[0]))
        : $q.all(targets.map(function (fw) {
            var fwSettings = settingsForFirewall($scope.settings, fw);
            return agentLoop(question, fwSettings)
              .then(function (answer) {
                return { firewall: fw.name, vdom: fw.vdom || 'root', configId: fw.configId, answer: answer };
              })
              .catch(function (error) {
                var message = (error && error.data && error.data.message) ? error.data.message : (error.message || t('errGeneric'));
                return { firewall: fw.name, vdom: fw.vdom || 'root', configId: fw.configId, error: message };
              });
          })).then(function (results) {
            return aggregateMultiFirewallAnswer(question, results, $scope.settings)
              .catch(function () { return fallbackMultiFirewallAnswer(results); });
          });

      run
        .then(function (answer) { pushMessage({ role: 'bot', text: answer }); })
        .catch(function (error) {
          var message = (error && error.data && error.data.message) ? error.data.message : (error.message || t('errGeneric'));
          pushMessage({ role: 'error', text: message });
        })
        .finally(function () { $scope.loading = false; scrollToBottom(); });
    };

    function init() {
      _handleTranslations();
      loadSettings();
      if (!$scope.settings.fortigateConfigId) { $scope.showSettings = true; }
      // [v1.0.2] 저장된 health 로드 후, 등록된 모든 방화벽 자동 라이브 프로브 + 요약 메시지
      loadConfigHealth().finally(initialHealthSweep);
    }
    init();
  }
})();
