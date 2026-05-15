export const CLIENT_ID    = '841845991664-tv8cprdafsultcodf21f40k1fda7kv97.apps.googleusercontent.com';
export const SHEET_ID     = '19XGP8YC1U4vwKnfxeBFxY78aBNUjJKMX3wPApBYmiog';
export const SCOPES       = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file';
export const USER_KEY     = 'cnstr_usr_v1';
export const SW_VERSION   = 'cnstr-v7';
export const BUSINESS_NAME = 'כיאן הנדסה';

export const MN       = ['','ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
export const DAYS_HE  = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];

export const HDR = {
  Sites:           ['SiteID','SiteName','Address','Status','Notes'],
  Employees:       ['EmployeeID','EmployeeName','Phone','Profession','ActiveStatus','Notes','DailyRate'],
  Equipment:       ['EquipmentID','EquipmentName','EquipmentType','ActiveStatus','Notes'],
  Suppliers:       ['SupplierID','SupplierName','Phone','Notes','Status'],
  DailyLogs:       ['LogID','Date','SiteID','SiteName','ManagerEmail','Act_Digging','Act_Base','Act_Formwork','Act_Casting','Act_Stripping','Act_Other','Notes','CreatedAt','Version','UpdatedAt','UpdatedBy'],
  Attendance:      ['AttendanceID','LogID','EmployeeID','EmployeeName','Date','SiteID'],
  LogEquipment:    ['LogEquipmentID','LogID','EquipmentID','EquipmentName','Date','SiteID'],
  Deliveries:      ['DeliveryID','LogID','SupplierID','SupplierName','MaterialName','Quantity','Notes'],
  MonthLocks:      ['MonthLockID','Month','Year','StatusLocked','LockedBy','LockedAt','UnlockedBy','UnlockedAt'],
  SitePhotos:      ['PhotoID','SiteID','SiteName','Date','Description','DriveFileID','ThumbnailURL','UploadedBy','UploadedAt','LogID'],
  AuditLog:        ['AuditID','Timestamp','UserEmail','UserName','Action','EntityType','EntityID','Summary'],
  Users:           ['UserID','Email','Name','Role','AddedAt','AddedBy'],
  SiteAssignments: ['AssignmentID','UserEmail','SiteID','SiteName','AddedAt','AddedBy'],
};

export const ROLES = {
  GeneralManager: [
    'create_log','edit_log','delete_log','view_logs',
    'manage_employees','manage_sites','manage_suppliers','manage_equipment',
    'view_reports','export_reports','lock_month','upload_photos',
    'manage_users','manage_site_assignments','override_duplicate',
    'view_payroll','export_payroll',
  ],
  SiteManager: [
    'create_log','edit_log','view_logs','upload_photos',
  ],
  // Legacy role migration (treated as equivalents)
  Admin:   ['create_log','edit_log','delete_log','view_logs','manage_employees','manage_sites','manage_suppliers','manage_equipment','view_reports','export_reports','lock_month','upload_photos','manage_users','manage_site_assignments','override_duplicate','view_payroll','export_payroll'],
  Manager: ['create_log','edit_log','view_logs','upload_photos'],
  Viewer:  [],
};
