const { z } = require('zod');

const ROLES = ['super_admin', 'hr', 'manager', 'employee'];
const EMP_STATUS = ['active', 'inactive', 'resigned', 'terminated'];
const CONTRACT_TYPES = ['permanent', 'contract', 'intern', 'probation'];
const LEAVE_REQUEST_TYPES = ['izin', 'sakit', 'dinas_luar', 'wfh', 'cuti', 'keperluan_pribadi'];
const GPS_MODES = ['required', 'optional', 'disabled'];

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const employeeSchema = z.object({
  employeeCode: z.string().min(1),
  fullName: z.string().min(1),
  nickname: z.string().optional().nullable(),
  birthPlace: z.string().optional().nullable(),
  birthDate: z.string().optional().nullable(),
  gender: z.enum(['male', 'female']).optional().nullable(),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  province: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  maritalStatus: z.enum(['single', 'married', 'divorced', 'widowed']).optional().nullable(),
  emergencyContactName: z.string().optional().nullable(),
  emergencyContactPhone: z.string().optional().nullable(),
  departmentId: z.string().optional().nullable(),
  positionId: z.string().optional().nullable(),
  locationId: z.string().optional().nullable(),
  shiftId: z.string().optional().nullable(),
  managerId: z.string().optional().nullable(),
  status: z.enum(EMP_STATUS).optional(),
  hireDate: z.string().optional().nullable(),
  endDate: z.string().optional().nullable(),
  contractType: z.enum(CONTRACT_TYPES).optional().nullable(),
  contractNumber: z.string().optional().nullable(),
  npwp: z.string().optional().nullable(),
  bpjsNumber: z.string().optional().nullable(),
  bankAccount: z.string().optional().nullable(),
});

const checkInSchema = z.object({
  latitude: z.number().optional().nullable(),
  longitude: z.number().optional().nullable(),
  photoDataUrl: z.string().optional().nullable(),
});

const leaveRequestSchema = z.object({
  type: z.enum(LEAVE_REQUEST_TYPES),
  startDate: z.string(),
  endDate: z.string(),
  reason: z.string().optional().nullable(),
});

const overtimeRequestSchema = z.object({
  date: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  reason: z.string().optional().nullable(),
});

const departmentSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  managerId: z.string().optional().nullable(),
});

const announcementSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
  targetDepartmentId: z.string().optional().nullable(),
  targetRole: z.enum(ROLES).optional().nullable(),
  expiredAt: z.string().optional().nullable(),
});

module.exports = {
  ROLES,
  EMP_STATUS,
  CONTRACT_TYPES,
  LEAVE_REQUEST_TYPES,
  GPS_MODES,
  loginSchema,
  employeeSchema,
  checkInSchema,
  leaveRequestSchema,
  overtimeRequestSchema,
  departmentSchema,
  announcementSchema,
};
