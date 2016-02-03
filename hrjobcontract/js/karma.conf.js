module.exports = function (config) {
    var civicrmPath = '../../../../../';
    var civihrPath = 'tools/extensions/civihr/';

    config.set({
        basePath: civicrmPath,
        browsers: ['Chrome'],
        frameworks: ['jasmine'],
        files: [
            // the global dependencies
            'packages/jquery/jquery-1.11.1.js',
            'packages/jquery/jquery-ui/jquery-ui.js',
            'packages/backbone/lodash.compat.js',
            'packages/jquery/plugins/jquery.mousewheel.js',
            'packages/jquery/plugins/select2/select2.js',
            'packages/jquery/plugins/jquery.blockUI.js',
            'js/Common.js',

            // manual loading of requirejs as to avoid interference with the global dependencies above
            civihrPath + 'hrjobcontract/node_modules/requirejs/require.js',
            civihrPath + 'hrjobcontract/node_modules/karma-requirejs/lib/adapter.js',

            // all the common/ dependencies
            civihrPath + 'org.civicrm.reqangular/dist/reqangular.min.js',

            // the application modules
            { pattern: civihrPath + 'hrjobcontract/js/src/job-contract/**/*.js', included: false },

            // the mocked components files
            { pattern: civihrPath + 'hrjobcontract/js/test/mocks/**/*.js', included: false },

            // the test files
            { pattern: civihrPath + 'hrjobcontract/js/test/**/*_test.js', included: false },

            // angular templates
            civihrPath + 'hrjobcontract/views/**/*.html',

            // the requireJS config file that bootstraps the whole test suite
            civihrPath + 'hrjobcontract/js/test/test-main.js'
        ],
        exclude: [
            civihrPath + 'hrjobcontract/js/src/job-contract.js'
        ],
        // Used to transform angular templates in JS strings
        preprocessors: (function (obj) {
            obj[civihrPath + 'hrjobcontract/views/**/*.html'] = ['ng-html2js'];
            return obj;
        })({}),
        ngHtml2JsPreprocessor: {
            prependPrefix: '/base/',
            moduleName: 'job-contract.templates'
        }
    });
};