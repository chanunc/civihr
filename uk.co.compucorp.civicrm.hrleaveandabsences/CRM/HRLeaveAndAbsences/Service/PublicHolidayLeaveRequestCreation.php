<?php

use CRM_HRLeaveAndAbsences_BAO_AbsenceType as AbsenceType;
use CRM_HRLeaveAndAbsences_BAO_LeaveRequest as LeaveRequest;
use CRM_HRLeaveAndAbsences_BAO_LeaveRequestDate as LeaveRequestDate;
use CRM_HRLeaveAndAbsences_BAO_LeaveBalanceChange as LeaveBalanceChange;
use CRM_HRLeaveAndAbsences_BAO_PublicHoliday as PublicHoliday;

class CRM_HRLeaveAndAbsences_Service_PublicHolidayLeaveRequestCreation {

  /**
   * Creates Public Holiday Leave Requests based on an AbsenceType.
   *
   * This method will get all Public Holidays in the future and then will
   * create a Leave Request for each of them, for all the contacts with
   * contracts overlapping any of the holiday dates
   *
   * @param \CRM_HRLeaveAndAbsences_BAO_AbsenceType $absenceType
   */
  public function createForAbsenceType(AbsenceType $absenceType) {
    if(!$absenceType->must_take_public_holiday_as_leave) {
      throw new InvalidArgumentException("It's not possible to create Public Holidays for Absence Types where 'Must take public holiday as leave' is false");
    }

    $futurePublicHolidays = PublicHoliday::getAllInFuture();
    $lastPublicHoliday = end($futurePublicHolidays);

    $contracts = $this->getContractsForPeriod(
      new DateTime(),
      new DateTime($lastPublicHoliday->date)
    );

    foreach($contracts as $contract) {
      foreach($futurePublicHolidays as $publicHoliday) {
        if($this->publicHolidayOverlapsContract($contract, $publicHoliday)) {
          $this->create($contract['contact_id'], $absenceType, $publicHoliday);
        }
      }
    }
  }

  /**
   * Creates a Public Holiday Leave Request for the contact with the
   * given $contactId
   *
   * @param int $contactID
   * @param \CRM_HRLeaveAndAbsences_BAO_PublicHoliday $publicHoliday
   */
  public function createForContact($contactID, PublicHoliday $publicHoliday) {
    $absenceType = AbsenceType::getOneWithMustTakePublicHolidayAsLeaveRequest();
    $this->create($contactID, $absenceType, $publicHoliday);
  }

  /**
   * Creates a Public Holiday Leave Request for the given $contactID, Absence
   * Type and Public Holiday
   *
   * @param int $contactID
   * @param \CRM_HRLeaveAndAbsences_BAO_AbsenceType $absenceType
   * @param \CRM_HRLeaveAndAbsences_BAO_PublicHoliday $publicHoliday
   */
  private function create($contactID, AbsenceType $absenceType, PublicHoliday $publicHoliday) {
    $leaveRequest = $this->createLeaveRequest($contactID, $absenceType, $publicHoliday);
    $this->createLeaveBalanceChangeRecord($leaveRequest);
  }

  /**
   * Creates a Leave Request for the given $contactID and $absenceType with the
   * date of the given Public Holiday
   *
   * @param int $contactID
   * @param \CRM_HRLeaveAndAbsences_BAO_AbsenceType $absenceType
   * @param \CRM_HRLeaveAndAbsences_BAO_PublicHoliday $publicHoliday
   *
   * @return \CRM_HRLeaveAndAbsences_BAO_LeaveRequest|NULL
   */
  private function createLeaveRequest($contactID, AbsenceType $absenceType, PublicHoliday $publicHoliday) {
    $leaveRequestStatuses = array_flip(LeaveRequest::buildOptions('status_id'));
    $leaveRequestDayTypes = array_flip(LeaveRequest::buildOptions('from_date_type'));

    return LeaveRequest::create([
      'contact_id'     => $contactID,
      'type_id'        => $absenceType->id,
      'status_id'      => $leaveRequestStatuses['Admin Approved'],
      'from_date'      => CRM_Utils_Date::processDate($publicHoliday->date),
      'from_date_type' => $leaveRequestDayTypes['All Day']
    ]);
  }

  /**
   * Creates LeaveBalanceChange records for the dates of the given $leaveRequest.
   *
   * For PublicHolidays, the deducted amount will always be -1.
   *
   * If there is already a leave request to this on the same date, the deduction
   * amount for that specific date will be updated to be 0, in order to not
   * deduct the same day twice.
   *
   * @param \CRM_HRLeaveAndAbsences_BAO_LeaveRequest $leaveRequest
   */
  private function createLeaveBalanceChangeRecord(LeaveRequest $leaveRequest) {
    $leaveBalanceChangeTypes = array_flip(LeaveBalanceChange::buildOptions('type_id'));

    $dates = $leaveRequest->getDates();
    foreach($dates as $date) {
      $this->zeroDeductionForOverlappingLeaveRequestDate($leaveRequest, $date);

      LeaveBalanceChange::create([
        'source_id'   => $date->id,
        'source_type' => LeaveBalanceChange::SOURCE_LEAVE_REQUEST_DAY,
        'type_id'     => $leaveBalanceChangeTypes['Public Holiday'],
        'amount'      => -1
      ]);
    }
  }

  /**
   * First, searches for an existing balance change for the same contact and absence
   * type of the given $leaveRequest and linked to a LeaveRequestDate with the
   * same date as $leaveRequestDate. Next, if such balance change exists, update
   * it's amount to 0.
   *
   * @param \CRM_HRLeaveAndAbsences_BAO_LeaveRequest $leaveRequest
   * @param \CRM_HRLeaveAndAbsences_BAO_LeaveRequestDate $leaveRequestDate
   */
  private function zeroDeductionForOverlappingLeaveRequestDate(LeaveRequest $leaveRequest, LeaveRequestDate $leaveRequestDate) {
    $date = new DateTime($leaveRequestDate->date);

    $leaveBalanceChange = LeaveBalanceChange::getExistingBalanceChangeForALeaveRequestDate($leaveRequest, $date);

    if($leaveBalanceChange) {
      LeaveBalanceChange::create([
        'id' => $leaveBalanceChange->id,
        'amount' => 0
      ]);
    }
  }

  /**
   * Gets all the contracts overlapping the given $startDate and $endDate
   *
   * @param \DateTime $startDate
   * @param \DateTime $endDate
   *
   * @return mixed
   */
  private function getContractsForPeriod(DateTime $startDate, DateTime $endDate) {
    $result = civicrm_api3('HRJobContract', 'getcontractswithdetailsinperiod', [
      'start_date' => $startDate->format('Y-m-d'),
      'end_date' => $endDate->format('Y-m-d'),
      'sequential' => 1
    ]);

    return $result['values'];
  }

  /**
   * Checks if the date of the given PublicHoliday overlaps the start and end
   * dates of the given $contract
   *
   * @param array $contract
   *  An contract as returned by the HRJobContract.getcontractswithdetailsinperiod API
   * @param \CRM_HRLeaveAndAbsences_BAO_PublicHoliday $publicHoliday
   *
   * @return bool
   */
  private function publicHolidayOverlapsContract($contract, PublicHoliday $publicHoliday) {
    $startDate = new DateTime($contract['period_start_date']);
    $endDate = empty($contract['period_end_date']) ? null : new DateTime($contract['period_end_date']);
    $publicHolidayDate = new DateTime($publicHoliday->date);

    return $startDate <= $publicHolidayDate && (!$endDate || $endDate >= $publicHolidayDate);
  }

}
