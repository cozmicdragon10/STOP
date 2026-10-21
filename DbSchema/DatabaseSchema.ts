/**
 * Auto-generated database schema
 * Generated: 2026-10-20T17:49:38.863Z
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
}

export interface Clients {
  clientid: number;
  firstname: string;
  middlename?: string;
  lastname: string;
  docnumber: string;
  supervisingagent: string;
  programstartdate: Date | string;
  lastdateattended?: Date | string;
  programstatus: string;
  phase: string;
  groupid?: number;
  treatmentfee?: number;
  accountbalance?: number;
  vouchers?: number;
  polyfeevoucher?: number;
  polyfeepaid?: number;
  polyfee?: number;
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

export interface Notes {
  noteid: number;
  client?: number;
  date?: Date | string;
  User?: string;
  comments: string;
  category: string;
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

export interface Supervisingagents {
  agentid: number;
  name: string;
  phone?: string;
  email?: string;
  region?: string;
}

export interface Systemlogs {
  logid: number;
  timestamp?: Date | string;
  useremail?: string;
  action?: string;
  details?: string;
  type?: string;
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

