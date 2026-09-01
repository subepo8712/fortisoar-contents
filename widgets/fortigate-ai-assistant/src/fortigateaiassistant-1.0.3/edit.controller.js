/* Copyright start
  Copyright (C) 2008 - 2026 Fortinet Inc.
  All rights reserved.
  FORTINET CONFIDENTIAL & FORTINET PROPRIETARY SOURCE CODE
  Copyright end */
'use strict';
(function () {
    angular
        .module('cybersponse')
        .controller('editFortigateaiassistant103Ctrl', editFortigateaiassistant103Ctrl);

    editFortigateaiassistant103Ctrl.$inject = ['$scope', '$uibModalInstance', 'config', 'widgetUtilityService', '$timeout'];

    function editFortigateaiassistant103Ctrl($scope, $uibModalInstance, config, widgetUtilityService, $timeout) {
        $scope.cancel = cancel;
        $scope.save = save;
        $scope.config = config || {};

        // 재사용 가능한 기본값만 지정하고 환경별 Config ID는 비워 둔다.
        if (!$scope.config.fortigateVersion) { $scope.config.fortigateVersion = '5.4.0'; }
        if (!$scope.config.vdom) { $scope.config.vdom = 'root'; }
        if (!$scope.config.fortiaiVersion) { $scope.config.fortiaiVersion = '2.0.0'; }

        function _handleTranslations() {
          let widgetNameVersion = widgetUtilityService.getWidgetNameVersion($scope.$resolve.widget, $scope.$resolve.widgetBasePath);
          if (widgetNameVersion) {
            widgetUtilityService.checkTranslationMode(widgetNameVersion).then(function () {
              $scope.viewWidgetVars = {};
            });
          } else {
            $timeout(function() { $scope.cancel(); });
          }
        }

        function init() { _handleTranslations(); }
        init();

        function cancel() { $uibModalInstance.dismiss('cancel'); }
        function save() { $uibModalInstance.close(angular.copy($scope.config)); }
    }
})();
