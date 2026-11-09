/**
 * Auto-generated database schema
 * Generated: 2026-10-30T19:15:27.924Z
 */

export interface Attendance {
  attendanceid: number;
  client?: number;
  Group?: number;
  date: Date | string;
  paid?: boolean;
  groupfee?: number;
  accountpaid?: number;
  accounttotal?: number;
  voucherused?: boolean;
  type: string;
  comments?: string;
  createdby?: string;
  createdon?: Date | string;
  paymentmethod?: string;
  sessionnumber: number;
  openedby?: string;
  sessiontypeid?: number;
  provider?: string;
  coveredby?: string;
  polyvoucherawarded: boolean;
}

export interface Cashpaymentdeposits {
  transactionid: number;
  depositdate: Date | string;
  recordedby?: string;
  recordedon?: Date | string;
}

export interface Clientattachments {
  attachmentid: number;
  clientid: number;
  filename: string;
  contenttype: string;
  filesize: number;
  data: unknown;
  uploadedby?: string;
  uploadedon: Date | string;
}

export interface Clientchangelog {
  changeid: number;
  clientid: number;
  changedon: Date | string;
  changedby?: string;
  changetype: string;
  oldvalue?: string;
  newvalue?: string;
  details?: string;
  expireson?: Date | string;
}

export interface Clientdischarges {
  dischargeid: number;
  clientid: number;
  dischargedon: Date | string;
  dischargetype: string;
  subcategory?: string;
  note?: string;
  dischargedby?: string;
}

export interface Clients {
  clientid: number;
  firstname: string;
  middlename?: string;
  lastname: string;
  docnumber?: string;
  supervisingagent?: string;
  programstartdate: Date | string;
  lastdateattended?: Date | string;
  programstatus: string;
  phase: string;
  groupid?: number;
  treatmentfee?: number;
  accountbalance?: number;
  vouchers?: number;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  mainphone?: string;
  altphone?: string;
  emergencycontact?: string;
  emergencycontactphone?: string;
  comments?: string;
  programtype?: string;
  county?: string;
  polyfeevoucher: number;
  polyfeepaid: number;
  polyfee: number;
  nopolyrequired: boolean;
  pretrial: boolean;
  race?: string;
  dateofbirth?: Date | string;
  sex?: string;
  polyvouchersbeforefill?: number;
  assessor?: string;
  buspasses: number;
  buspassrefill: number;
}

export interface Employeeroles {
  employeeemail: string;
  displayname: string;
  role: string;
  location: string;
  active?: boolean;
  passwordhash?: string;
}

export interface Eventlog {
  eventid: number;
  client?: number;
  Group?: number;
  date?: Date | string;
  type: string;
  comment: string;
  createdby?: string;
  createdon?: Date | string;
  callinreason?: string;
  callindate?: Date | string;
}

export interface Financialtransactions {
  transactionid: number;
  client?: number;
  date?: Date | string;
  type: string;
  amount: number;
  feetype?: string;
  finalbalance: number;
  comments?: string;
  paymentmethod?: string;
  attendanceid?: number;
  originalamount?: number;
  adjustedby?: string;
  adjustedon?: Date | string;
  adjustmentreason?: string;
  relatedtransactionid?: number;
  disputestatus?: string;
  enteredby?: string;
}

export interface Groupdeposits {
  depositid: number;
  groupid: number;
  sessiondate: Date | string;
  sessionnumber: number;
  amountdeposited: number;
  depositdate: Date | string;
  notes?: string;
  recordedby?: string;
  recordedon?: Date | string;
}

export interface Groups {
  groupid: number;
  groupname: string;
  location: string;
  counselor: string;
  programtype: string;
  schedule: string;
  address: string;
  active: boolean;
}

export interface Librarydocuments {
  documentid: number;
  filename: string;
  contenttype: string;
  filesize: number;
  data: unknown;
  category: string;
  description?: string;
  uploadedby?: string;
  uploadedon: Date | string;
}

export interface Notes {
  noteid: number;
  client?: number;
  date?: Date | string;
  User?: string;
  comments: string;
  category: string;
  editedby?: string;
  editedon?: Date | string;
  approvalstatus?: string;
  reviewedby?: string;
  reviewedon?: Date | string;
}

export interface Opengroupsessions {
  opensessionid: number;
  groupid: number;
  sessiondate: Date | string;
  entries: unknown;
  createdby?: string;
  updatedon: Date | string;
  sessionnumber: number;
  coveredby?: string;
}

export interface Openindividualsessions {
  opensessionid: number;
  clientid: number;
  category: string;
  sessiontypeid: number;
  sessiondate: Date | string;
  fee: number;
  payment: number;
  paymentmethod?: string;
  provider?: string;
  comments?: string;
  createdby?: string;
  createdon: Date | string;
  updatedon: Date | string;
  paymentcomments?: string;
}

export interface Outsidebipassessments {
  outsideassessmentid: number;
  clientid: number;
  assessmenttype: string;
  assessmentdate: Date | string;
  providername: string;
  notes?: string;
  recordedby?: string;
  recordedon: Date | string;
}

export interface Polyfeeoverrides {
  overrideid: number;
  clientid: number;
  reducedfee: number;
  regularfee: number;
  fillsallowed: number;
  fillsused: number;
  createdby?: string;
  createdon?: Date | string;
  endedon?: Date | string;
}

export interface Polygraphappointments {
  appointmentid: number;
  slotid?: number;
  client?: number;
  scheduleddatetime: Date | string;
  polygrapher?: string;
  type: string;
  comments?: string;
  lastpolydate?: Date | string;
  status: string;
  polyvouchersused: number;
}

export interface Polygraphresults {
  resultid: number;
  appointmentid?: number;
  client?: number;
  date: Date | string;
  type: string;
  results: string;
  polygrapher?: string;
  notes?: string;
  polygraphdatetime?: Date | string;
  incentivecontinued: boolean;
}

export interface Polygraphslots {
  slotid: number;
  location: string;
  address: string;
  date: Date | string;
  time: unknown;
  polygrapher?: string;
  type: string;
  comments?: string;
  isfilled?: boolean;
  slotsavailable?: number;
}

export interface Schemamigrations {
  name: string;
  appliedon: Date | string;
  baselined: boolean;
}

export interface Sessions {
  tokenhash: string;
  employeeemail: string;
  createdon: Date | string;
  expireson: Date | string;
}

export interface Sessiontypes {
  sessiontypeid: number;
  category: string;
  name: string;
  fee: number;
  active: boolean;
  biponly: boolean;
  kind: string;
  latefee?: number;
  soonly: boolean;
}

export interface Supervisingagents {
  agentid: number;
  name: string;
  phone?: string;
  email?: string;
  region?: string;
  createdby?: string;
  createdon?: Date | string;
}

export interface Systemlogs {
  logid: number;
  timestamp?: Date | string;
  useremail?: string;
  action?: string;
  details?: string;
  type?: string;
}

export interface Temporaryfeeoverrides {
  overrideid: number;
  clientid: number;
  reducedfee: number;
  expirationdate: Date | string;
  createdby?: string;
  createdon?: Date | string;
}

export interface Testing {
  testid: number;
  client?: number;
  testtype: string;
  score?: string;
  notes?: string;
  date?: Date | string;
}

export interface Vouchers {
  voucherid: number;
  client?: number;
  date?: Date | string;
  amount: number;
  reason?: string;
  appliedtotransactionid?: number;
}

