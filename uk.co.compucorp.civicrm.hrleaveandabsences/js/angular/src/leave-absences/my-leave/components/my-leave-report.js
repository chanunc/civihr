/* eslint-env amd */
define([
  'common/lodash',
  'common/moment',
  'leave-absences/my-leave/modules/components'
], function (_, moment, components) {
  components.component('myLeaveReport', {
    bindings: {
      contactId: '<'
    },
    templateUrl: ['settings', function (settings) {
      return settings.pathTpl + 'components/my-leave-report.html';
    }],
    controllerAs: 'report',
    controller: [
      '$log', '$q', '$rootScope', 'AbsencePeriod', 'AbsenceType', 'Entitlement', 'LeaveRequest',
      'OptionGroup', 'dialog', 'HR_settings', 'shared-settings', controller
    ]
  });

  function controller ($log, $q, $rootScope, AbsencePeriod, AbsenceType, Entitlement, LeaveRequest, OptionGroup, dialog, HRSettings, sharedSettings) {
    $log.debug('Component: my-leave-report');

    var vm = Object.create(this);

    var actionMatrix = {};
    actionMatrix[sharedSettings.statusNames.awaitingApproval] = ['edit', 'cancel'];
    actionMatrix[sharedSettings.statusNames.moreInformationRequired] = ['respond', 'cancel'];
    actionMatrix[sharedSettings.statusNames.approved] = ['view', 'cancel'];
    actionMatrix[sharedSettings.statusNames.cancelled] = ['view'];
    actionMatrix[sharedSettings.statusNames.rejected] = ['view'];

    vm.absencePeriods = [];
    vm.absenceTypes = {};
    vm.absenceTypesFiltered = {};
    vm.dateFormat = HRSettings.DATE_FORMAT;
    vm.leaveRequestStatuses = {};
    vm.selectedPeriod = null;
    vm.loading = {
      content: true,
      page: true
    };
    vm.sections = {
      approved: { open: false, data: [], loading: false, loadFn: loadApprovedRequests },
      entitlements: { open: false, data: [], loading: false, loadFn: loadEntitlementsBreakdown },
      expired: { open: false, data: [], loading: false, loadFn: loadExpiredBalanceChanges },
      holidays: { open: false, data: [], loading: false, loadFn: loadPublicHolidaysRequests },
      pending: { open: false, data: [], loading: false, loadFn: loadPendingRequests },
      other: { open: false, data: [], loading: false, loadFn: loadOtherRequests }
    };

    /**
     * Returns the available actions, based on the current status
     * of the given leave request
     *
     * @param  {LeaveRequestInstance} leaveRequest
     * @return {Array}
     */
    vm.actionsFor = function (leaveRequest) {
      var statusKey = vm.leaveRequestStatuses[leaveRequest.status_id].name;

      return statusKey ? actionMatrix[statusKey] : [];
    };

    /**
     * Performs an action on a given leave request
     * TODO: refactor when adding more actions
     *
     * @param {LeaveRequestInstance} leaveRequest
     * @param {string} action
     */
    vm.action = function (leaveRequest, action) {
      if (action === 'cancel') {
        dialog.open({
          title: 'Confirm Cancellation?',
          copyCancel: 'Cancel',
          copyConfirm: 'Confirm',
          classConfirm: 'btn-danger',
          msg: 'This cannot be undone',
          onConfirm: function () {
            return leaveRequest.cancel();
          }
        })
        .then(function (response) {
          !!response && cancelRequest(leaveRequest);
        });
      }
    };

    /**
     * Checks if user is allowed to cancel leave request. It is based on following constants
     * const REQUEST_CANCELATION_NO = 1;
     * const REQUEST_CANCELATION_ALWAYS = 2;
     * const REQUEST_CANCELATION_IN_ADVANCE_OF_START_DATE = 3;
     *
     * @param  {Object} request
     * @return {Boolean}
     */
    vm.canCancel = function (request) {
      var allowRequestCancelation = vm.absenceTypes[request.type_id].allow_request_cancelation;

      if (allowRequestCancelation === '3') {
        return moment().isBefore(request.from_date);
      }

      return allowRequestCancelation === '2';
    };

    /**
     * Labels the given period according to whether it's current or not
     *
     * @param  {AbsencePeriodInstance} period
     * @return {string}
     */
    vm.labelPeriod = function (period) {
      return period.current ? 'Current Period (' + period.title + ')' : period.title;
    };

    /**
     * Refreshes all data that is dependend on the selected absence period,
     * and clears the cached data of closed sections
     */
    vm.refresh = function () {
      vm.loading.content = true;

      $q.all([
        loadEntitlements(),
        loadBalanceChanges()
      ])
      .then(function () {
        vm.loading.content = false;
      })
      .then(function () {
        return $q.all([
          loadOpenSectionsData(),
          clearClosedSectionsData()
        ]);
      });
    };

    /**
     * Opens/closes the given section. When opening it triggers the
     * load function if no cached data is present
     *
     * @param {string} sectionName
     */
    vm.toggleSection = function (sectionName) {
      var section = vm.sections[sectionName];
      section.open = !section.open;

      if (section.open && !section.data.length) {
        callSectionLoadFn(section);
      }
    };

    // Init block
    (function init () {
      $q.all([
        loadStatuses(),
        loadAbsenceTypes(),
        loadAbsencePeriods()
      ])
      .then(function () {
        vm.loading.page = false;
      })
      .then(function () {
        return $q.all([
          loadEntitlements(),
          loadBalanceChanges()
        ]);
      })
      .then(function () {
        vm.loading.content = false;
      });

      registerEvents();
    })();

    /**
     * Calls the load function of the given data, and puts the section
     * in and out of loading mode
     *
     * @param  {Object} section
     * @return {Promise}
     */
    function callSectionLoadFn (section) {
      section.loading = true;

      return section.loadFn().then(function () {
        section.loading = false;
      });
    }

    /**
     * Triggers the cancellation action, then removes the cancelled
     * leave request from either the "approved", or "pending" sections (the only
     * sections where a leave request can be cancelled), and moves it to the
     * "other" section (if it has already cached data)
     *
     * It also updates the balance change and remainder data registered on the
     * absence type that the leave request belongs to, so that the numbers add up
     *
     * @param  {LeaveRequestInstance} leaveRequest
     */
    function cancelRequest (leaveRequest) {
      var sectionBelonged;
      var sectionsAllowed = ['approved', 'pending'];

      $q.resolve()
        .then(function () {
          sectionsAllowed.forEach(function (sectionName) {
            var removed = _.remove(vm.sections[sectionName].data, function (dataEntry) {
              return dataEntry.id === leaveRequest.id;
            });

            removed.length && (sectionBelonged = sectionName);
          });
        })
        .then(function () {
          vm.sections.other.data.length && vm.sections.other.data.push(leaveRequest);
        })
        .then(function () {
          var absenceType = vm.absenceTypes[leaveRequest.type_id];
          var remainderType = (sectionBelonged === 'pending') ? 'future' : 'current';

          absenceType.balanceChanges[sectionBelonged] -= leaveRequest.balance_change;
          absenceType.remainder[remainderType] -= leaveRequest.balance_change;
        });
    }

    /**
     * Clears the cached data of all the closed sections
     */
    function clearClosedSectionsData () {
      Object.values(vm.sections)
        .filter(function (section) {
          return !section.open;
        })
        .forEach(function (section) {
          section.data = [];
        });
    }

    /**
     * NOTE: This should be just temporary, see PCHR-1810
     * Loads all the possible statuses of a leave request
     *
     * @return {Promise}
     */
    function loadStatuses () {
      return OptionGroup.valuesOf('hrleaveandabsences_leave_request_status')
        .then(function (statuses) {
          vm.leaveRequestStatuses = _.indexBy(statuses, 'value');
        });
    }

    /**
     * Loads the absence periods
     *
     * @return {Promise}
     */
    function loadAbsencePeriods () {
      return AbsencePeriod.all()
        .then(function (absencePeriods) {
          vm.absencePeriods = _.sortBy(absencePeriods, 'start_date');
          vm.selectedPeriod = _.find(vm.absencePeriods, function (period) {
            return period.current === true;
          });
        });
    }

    /**
     * Loads the absence types
     *
     * @return {Promise}
     */
    function loadAbsenceTypes () {
      return AbsenceType.all()
        .then(function (absenceTypes) {
          vm.absenceTypes = _.indexBy(absenceTypes, 'id');
        });
    }

    /**
     * Loads the approved requests
     *
     * @return {Promise}
     */
    function loadApprovedRequests () {
      return LeaveRequest.all({
        contact_id: vm.contactId,
        from_date: { from: vm.selectedPeriod.start_date },
        to_date: { to: vm.selectedPeriod.end_date },
        status_id: valueOfRequestStatus(sharedSettings.statusNames.approved)
      })
      .then(function (leaveRequests) {
        vm.sections.approved.data = leaveRequests.list;
      });
    }

    /**
     * Loads the balance changes of the various sections
     * and groups them by absence type
     *
     * @return {Promise}
     */
    function loadBalanceChanges () {
      return $q.all([
        LeaveRequest.balanceChangeByAbsenceType(vm.contactId, vm.selectedPeriod.id, null, true),
        LeaveRequest.balanceChangeByAbsenceType(vm.contactId, vm.selectedPeriod.id, [
          valueOfRequestStatus(sharedSettings.statusNames.approved)
        ]),
        LeaveRequest.balanceChangeByAbsenceType(vm.contactId, vm.selectedPeriod.id, [
          valueOfRequestStatus(sharedSettings.statusNames.awaitingApproval),
          valueOfRequestStatus(sharedSettings.statusNames.moreInformationRequired)
        ])
      ])
      .then(function (results) {
        _.forEach(vm.absenceTypes, function (absenceType) {
          absenceType.balanceChanges = {
            publicHolidays: results[0][absenceType.id],
            approved: results[1][absenceType.id],
            pending: results[2][absenceType.id]
          };
        });
      });
    }

    /**
     * Loads the entitlements, including current and future balance,
     * and groups the entitlements value and remainder by absence type
     *
     * @return {Promise}
     */
    function loadEntitlements () {
      return Entitlement.all({
        contact_id: vm.contactId,
        period_id: vm.selectedPeriod.id
      }, true)
      .then(function (entitlements) {
        vm.entitlements = entitlements;
      })
      .then(function () {
        vm.absenceTypesFiltered = _.filter(vm.absenceTypes, function (absenceType) {
          var entitlement = _.find(vm.entitlements, function (entitlement) {
            return entitlement.type_id === absenceType.id;
          });

          //set entitlement to 0 if no entitlement is present
          absenceType.entitlement = entitlement ? entitlement.value : 0;
          absenceType.remainder = entitlement ? entitlement.remainder : { current: 0, future: 0 };

          return !((absenceType.entitlement === 0) &&
          (absenceType.allow_overuse !== "1") &&
          (absenceType.allow_accruals_request !== "1"));
        });
      });
    }

    /**
     * Loads the entitlements breakdown
     *
     * @return {Promise}
     */
    function loadEntitlementsBreakdown () {
      return Entitlement.breakdown({
        contact_id: vm.contactId,
        period_id: vm.selectedPeriod.id
      }, vm.entitlements)
      .then(function () {
        return processBreakdownsList(vm.entitlements);
      })
      .then(function (breakdownListFlatten) {
        vm.sections.entitlements.data = breakdownListFlatten;
      });
    }

    /**
     * Loads the expired balance changes (Brought Forward, TOIL)
     *
     * @return {Promise}
     */
    function loadExpiredBalanceChanges () {
      return $q.all([
        Entitlement.breakdown({
          contact_id: vm.contactId,
          period_id: vm.selectedPeriod.id,
          expired: true
        }),
        LeaveRequest.all({
          contact_id: vm.contactId,
          from_date: {from: vm.selectedPeriod.start_date},
          to_date: {to: vm.selectedPeriod.end_date},
          request_type: 'toil',
          expired: true
        })
      ])
        .then(function (results) {
          return $q.all({
            expiredBalanceChangesFlatten: processBreakdownsList(results[0]),
            expiredTOILS: processExpiredTOILS(results[1].list)
          });
        })
        .then(function (results) {
          vm.sections.expired.data = results.expiredBalanceChangesFlatten.concat(results.expiredTOILS);
        });
    }

    /**
     * Loads the data of all the currently opened sections
     *
     * @return {Promise}
     */
    function loadOpenSectionsData () {
      return $q.all(Object.values(vm.sections)
        .filter(function (section) {
          return section.open;
        })
        .map(function (section) {
          return callSectionLoadFn(section);
        }));
    }

    /**
     * Loads the rejected/cancelled leave requests
     *
     * @return {Promise}
     */
    function loadOtherRequests () {
      return LeaveRequest.all({
        contact_id: vm.contactId,
        from_date: { from: vm.selectedPeriod.start_date },
        to_date: { to: vm.selectedPeriod.end_date },
        status_id: { in: [
          valueOfRequestStatus(sharedSettings.statusNames.rejected),
          valueOfRequestStatus(sharedSettings.statusNames.cancelled)
        ] }
      })
      .then(function (leaveRequests) {
        vm.sections.other.data = leaveRequests.list;
      });
    }

    /**
     * Loads the currently pending leave requests
     *
     * @return {Promise}
     */
    function loadPendingRequests () {
      return LeaveRequest.all({
        contact_id: vm.contactId,
        from_date: { from: vm.selectedPeriod.start_date },
        to_date: { to: vm.selectedPeriod.end_date },
        status_id: { in: [
          valueOfRequestStatus(sharedSettings.statusNames.awaitingApproval),
          valueOfRequestStatus(sharedSettings.statusNames.moreInformationRequired)
        ] }
      }, null, null, null, false)
      .then(function (leaveRequests) {
        vm.sections.pending.data = leaveRequests.list;
      });
    }

    /**
     * Loads the leave requests associated to public holidays
     *
     * @return {Promise}
     */
    function loadPublicHolidaysRequests () {
      return LeaveRequest.all({
        contact_id: vm.contactId,
        from_date: { from: vm.selectedPeriod.start_date },
        to_date: { to: vm.selectedPeriod.end_date },
        public_holiday: true
      })
      .then(function (leaveRequests) {
        vm.sections.holidays.data = leaveRequests.list;
      });
    }

    /**
     * For each breakdowns, it sets the absence type id to
     * each list entry (based on the entitlement they belong to)
     * and flattens the result in the end to get one single list
     *
     * @param  {Array} list
     *   each breakdown should contain `id` and `breakdown` properties
     * @return {Promise} resolves to the flatten list
     */
    function processBreakdownsList (list) {
      return $q.resolve()
        .then(function () {
          return list.map(function (listEntry) {
            var entitlement = _.find(vm.entitlements, function (entitlement) {
              return entitlement.id === listEntry.id;
            });

            return listEntry.breakdown.map(function (breakdownEntry) {
              return _.assign(_.clone(breakdownEntry), {
                type_id: entitlement.type_id
              });
            });
          });
        })
        .then(function (breakdownList) {
          return Array.prototype.concat.apply([], breakdownList);
        });
    }

    /**
     * Process each expired TOIL requests
     *
     * @param  {Array} list of expired TOIL request
     * @return {Promise} resolves to the flatten list
     */
    function processExpiredTOILS (list) {
      return $q.resolve()
        .then(function () {
          return list.map(function (listEntry) {
            return {
              'expiry_date': listEntry.to_date,
              'type': {
                'label': 'Accrued TOIL'
              }
            };
          });
        });
    }

    /**
     * Register events which will be called by other modules
     */
    function registerEvents () {
      $rootScope.$on('LeaveRequest::new', function () {
        vm.refresh();
      });

      $rootScope.$on('LeaveRequest::edit', function () {
        vm.refresh();
      });
    }

    /**
     * Returns the value of the given leave request status
     *
     * @param  {string} statusName
     * @return {integer}
     */
    function valueOfRequestStatus (statusName) {
      return _.find(vm.leaveRequestStatuses, function (status) {
        return status.name === statusName;
      })['value'];
    }

    return vm;
  }
});
