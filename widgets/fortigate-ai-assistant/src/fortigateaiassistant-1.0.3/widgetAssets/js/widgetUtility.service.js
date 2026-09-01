/* Copyright start
  Copyright (C) 2008 - 2026 Fortinet Inc.
  All rights reserved.
  FORTINET CONFIDENTIAL & FORTINET PROPRIETARY SOURCE CODE
  Copyright end */
'use strict';

(function () {
  angular
    .module('cybersponse')
    .factory('widgetUtilityService', widgetUtilityService);

  widgetUtilityService.$inject = ['$q', '$http', '$injector', '$interpolate', 'toaster'];

  function widgetUtilityService($q, $http, $injector, $interpolate, toaster) {
    var service;
    var translationServiceExists;
    var translationService;
    var translationData;
    var widgetNameVersion;
    service = {
      checkTranslationMode: checkTranslationMode,
      getWidgetNameVersion: getWidgetNameVersion,
      translate: translate
    };

    function getWidgetNameVersion(widget, widgetBasePath) {
      let widgetNameVersion;
      if (widget) {
        widgetNameVersion = widget.name + '-' + widget.version;
      } else if (widgetBasePath) {
        let pathData = widgetBasePath.split('/');
        widgetNameVersion = pathData[pathData.length - 1];
      } else {
        toaster.warning({
          body:'Preview is unavailable for widgets that support localization.'
        });
      }
      return widgetNameVersion;
    }

    function checkTranslationMode(widgetName) {
      widgetNameVersion = widgetName;
      try {
        translationService = $injector.get('translationService');
      } catch (error) {
        console.log('"translationService" doesn\'t exists');
      }
      var defer = $q.defer();
      translationServiceExists = typeof translationService !== 'undefined';
      if (!translationServiceExists) {
        var WIDGET_BASE_PATH;
        try {
          WIDGET_BASE_PATH = $injector.get('WIDGET_BASE_PATH');
        } catch (e) {
          WIDGET_BASE_PATH = {
            INSTALLED: 'widgets/installed/'
          };
        }
        $http.get(WIDGET_BASE_PATH.INSTALLED + widgetNameVersion + '/widgetAssets/locales/en.json').then(function(enTranslation) {
          translationData = enTranslation.data;
          defer.resolve();
        }, function(error) {
          console.log('English translation for widget doesn\'t exists');
          defer.reject(error);
        });
      } else {
        defer.resolve();
      }
      return defer.promise;
    }

    function translate(KEY, params) {
      if (translationServiceExists) {
      	return translationService.instantTranslate(KEY, params); 
      } else {
        var translationValue = angular.copy(translationData);
        var keys = KEY.split('.');
  
        for (var i = 0; i < keys.length; i++) {
          if (translationValue.hasOwnProperty(keys[i])) {
            translationValue = translationValue[keys[i]];
          } else {
            translationValue = '';
            break;
          }
        }
        if (params) {
          return $interpolate(translationValue)(params);
        }
        return translationValue;
      }
    }

    return service;
  }
})();
