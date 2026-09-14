-- EmployeeHub HRIS schema (MySQL / MariaDB, InnoDB, utf8mb4).
-- Converted from an earlier SQLite version. Key differences from that
-- version: explicit FOREIGN KEY clauses (MySQL ignores inline column-level
-- REFERENCES unless paired with one), DATETIME/TIMESTAMP instead of TEXT
-- timestamps, TINYINT(1) for booleans, VARCHAR(36) for UUID primary keys.
-- Compatible with a plain MySQL/MariaDB server OR XAMPP's bundled MariaDB.
-- The original SQLite schema is kept at schema.sqlite.sql.bak for reference.

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS departments (
  id            VARCHAR(36) PRIMARY KEY,
  name          VARCHAR(150) NOT NULL UNIQUE,
  description   TEXT,
  manager_id    VARCHAR(36),
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at    DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS positions (
  id             VARCHAR(36) PRIMARY KEY,
  title          VARCHAR(150) NOT NULL,
  department_id  VARCHAR(36),
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (department_id) REFERENCES departments(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS locations (
  id             VARCHAR(36) PRIMARY KEY,
  name           VARCHAR(150) NOT NULL,
  address        TEXT,
  latitude       DOUBLE NOT NULL,
  longitude      DOUBLE NOT NULL,
  radius_meters  INT NOT NULL DEFAULT 100
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS shifts (
  id                     VARCHAR(36) PRIMARY KEY,
  name                   VARCHAR(100) NOT NULL,
  start_time             VARCHAR(5) NOT NULL,
  end_time               VARCHAR(5) NOT NULL,
  grace_period_minutes   INT NOT NULL DEFAULT 15
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS employees (
  id                       VARCHAR(36) PRIMARY KEY,
  employee_code            VARCHAR(50) NOT NULL UNIQUE,
  full_name                VARCHAR(150) NOT NULL,
  nickname                 VARCHAR(100),
  photo_url                VARCHAR(255),
  birth_place              VARCHAR(150),
  birth_date               DATE,
  gender                   VARCHAR(10),
  address                  TEXT,
  city                     VARCHAR(100),
  province                 VARCHAR(100),
  phone                    VARCHAR(30),
  email                    VARCHAR(150),
  marital_status           VARCHAR(20),
  emergency_contact_name   VARCHAR(150),
  emergency_contact_phone  VARCHAR(30),
  department_id            VARCHAR(36),
  position_id              VARCHAR(36),
  location_id              VARCHAR(36),
  shift_id                 VARCHAR(36),
  manager_id               VARCHAR(36),
  status                   VARCHAR(20) NOT NULL DEFAULT 'active',
  hire_date                DATE,
  end_date                 DATE,
  contract_type            VARCHAR(20),
  contract_number          VARCHAR(100),
  npwp                     VARCHAR(50),
  bpjs_number              VARCHAR(50),
  bank_account             VARCHAR(50),
  created_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at               DATETIME NULL,
  FOREIGN KEY (department_id) REFERENCES departments(id),
  FOREIGN KEY (position_id) REFERENCES positions(id),
  FOREIGN KEY (location_id) REFERENCES locations(id),
  FOREIGN KEY (shift_id) REFERENCES shifts(id),
  FOREIGN KEY (manager_id) REFERENCES employees(id),
  INDEX idx_employees_department (department_id),
  INDEX idx_employees_status (status),
  INDEX idx_employees_manager (manager_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE departments ADD CONSTRAINT fk_departments_manager FOREIGN KEY (manager_id) REFERENCES employees(id);

CREATE TABLE IF NOT EXISTS users (
  id              VARCHAR(36) PRIMARY KEY,
  email           VARCHAR(150) NOT NULL UNIQUE,
  password        VARCHAR(255) NOT NULL,
  role            VARCHAR(20) NOT NULL,
  is_active       TINYINT(1) NOT NULL DEFAULT 1,
  must_change_pw  TINYINT(1) NOT NULL DEFAULT 0,
  last_login_at   DATETIME NULL,
  employee_id     VARCHAR(36) UNIQUE,
  totp_secret     VARCHAR(64),
  totp_enabled    TINYINT(1) NOT NULL DEFAULT 0,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS login_history (
  id          VARCHAR(36) PRIMARY KEY,
  user_id     VARCHAR(36),
  ip_address  VARCHAR(64),
  user_agent  VARCHAR(255),
  success     TINYINT(1) NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS attendance (
  id                  VARCHAR(36) PRIMARY KEY,
  employee_id         VARCHAR(36) NOT NULL,
  date                DATE NOT NULL,
  check_in_at         DATETIME NULL,
  check_in_lat        DOUBLE,
  check_in_lng        DOUBLE,
  check_in_ip         VARCHAR(64),
  check_in_device     VARCHAR(255),
  check_in_photo_url  VARCHAR(255),
  check_out_at        DATETIME NULL,
  check_out_lat       DOUBLE,
  check_out_lng       DOUBLE,
  check_out_ip        VARCHAR(64),
  check_out_device    VARCHAR(255),
  check_out_photo_url VARCHAR(255),
  status              VARCHAR(20) NOT NULL,
  is_late             TINYINT(1) NOT NULL DEFAULT 0,
  late_minutes        INT NOT NULL DEFAULT 0,
  worked_minutes      INT,
  location_id         VARCHAR(36),
  source              VARCHAR(10) NOT NULL DEFAULT 'app',
  notes               TEXT,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_attendance_emp_date (employee_id, date),
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  FOREIGN KEY (location_id) REFERENCES locations(id),
  INDEX idx_attendance_date (date),
  INDEX idx_attendance_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS leave_types (
  id             VARCHAR(36) PRIMARY KEY,
  name           VARCHAR(100) NOT NULL UNIQUE,
  default_quota  INT NOT NULL DEFAULT 12
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS leave_balances (
  id            VARCHAR(36) PRIMARY KEY,
  employee_id   VARCHAR(36) NOT NULL,
  leave_type_id VARCHAR(36) NOT NULL,
  year          INT NOT NULL,
  quota         INT NOT NULL,
  used          INT NOT NULL DEFAULT 0,
  UNIQUE KEY uniq_leave_balance (employee_id, leave_type_id, year),
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  FOREIGN KEY (leave_type_id) REFERENCES leave_types(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS leave_requests (
  id              VARCHAR(36) PRIMARY KEY,
  employee_id     VARCHAR(36) NOT NULL,
  leave_type_id   VARCHAR(36),
  type            VARCHAR(30) NOT NULL,
  start_date      DATE NOT NULL,
  end_date        DATE NOT NULL,
  reason          TEXT,
  attachment_url  VARCHAR(255),
  status          VARCHAR(20) NOT NULL DEFAULT 'pending',
  reviewed_by_id  VARCHAR(36),
  reviewed_at     DATETIME NULL,
  review_note     TEXT,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  FOREIGN KEY (leave_type_id) REFERENCES leave_types(id),
  FOREIGN KEY (reviewed_by_id) REFERENCES users(id),
  INDEX idx_leave_employee (employee_id),
  INDEX idx_leave_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS overtime_requests (
  id              VARCHAR(36) PRIMARY KEY,
  employee_id     VARCHAR(36) NOT NULL,
  date            DATE NOT NULL,
  start_time      VARCHAR(5) NOT NULL,
  end_time        VARCHAR(5) NOT NULL,
  total_minutes   INT NOT NULL,
  reason          TEXT,
  status          VARCHAR(20) NOT NULL DEFAULT 'pending',
  reviewed_by_id  VARCHAR(36),
  reviewed_at     DATETIME NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  FOREIGN KEY (reviewed_by_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS holidays (
  id   VARCHAR(36) PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  date DATE NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS schedules (
  id           VARCHAR(36) PRIMARY KEY,
  employee_id  VARCHAR(36) NOT NULL,
  shift_id     VARCHAR(36) NOT NULL,
  date         DATE NOT NULL,
  UNIQUE KEY uniq_schedule_emp_date (employee_id, date),
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  FOREIGN KEY (shift_id) REFERENCES shifts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS notifications (
  id           VARCHAR(36) PRIMARY KEY,
  employee_id  VARCHAR(36),
  title        VARCHAR(200) NOT NULL,
  message      TEXT NOT NULL,
  type         VARCHAR(30) NOT NULL,
  is_read      TINYINT(1) NOT NULL DEFAULT 0,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  INDEX idx_notif_employee (employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS announcements (
  id                   VARCHAR(36) PRIMARY KEY,
  title                VARCHAR(200) NOT NULL,
  content              TEXT NOT NULL,
  image_url            VARCHAR(255),
  target_department_id VARCHAR(36),
  target_role          VARCHAR(20),
  publish_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expired_at           DATETIME NULL,
  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (target_department_id) REFERENCES departments(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS documents (
  id           VARCHAR(36) PRIMARY KEY,
  employee_id  VARCHAR(36) NOT NULL,
  type         VARCHAR(30) NOT NULL,
  file_name    VARCHAR(255) NOT NULL,
  file_url     VARCHAR(255) NOT NULL,
  uploaded_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS qr_codes (
  id           VARCHAR(36) PRIMARY KEY,
  token        VARCHAR(64) NOT NULL UNIQUE,
  location_id  VARCHAR(36) NOT NULL,
  expires_at   DATETIME NOT NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (location_id) REFERENCES locations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS audit_logs (
  id           VARCHAR(36) PRIMARY KEY,
  user_id      VARCHAR(36),
  action       VARCHAR(100) NOT NULL,
  object_type  VARCHAR(50),
  object_id    VARCHAR(36),
  ip_address   VARCHAR(64),
  device       VARCHAR(255),
  metadata     TEXT,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_audit_created (created_at),
  INDEX idx_audit_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS employment_history (
  id                 VARCHAR(36) PRIMARY KEY,
  employee_id        VARCHAR(36) NOT NULL,
  type               VARCHAR(30) NOT NULL,
  from_department_id VARCHAR(36),
  to_department_id   VARCHAR(36),
  from_position_id   VARCHAR(36),
  to_position_id     VARCHAR(36),
  note               TEXT,
  effective_date     DATE NOT NULL,
  created_by         VARCHAR(36),
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  FOREIGN KEY (from_department_id) REFERENCES departments(id),
  FOREIGN KEY (to_department_id) REFERENCES departments(id),
  FOREIGN KEY (from_position_id) REFERENCES positions(id),
  FOREIGN KEY (to_position_id) REFERENCES positions(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_emp_history_employee (employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS permissions (
  code         VARCHAR(60) PRIMARY KEY,
  label        VARCHAR(255) NOT NULL,
  category     VARCHAR(50) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS role_permissions (
  role            VARCHAR(20) NOT NULL,
  permission_code VARCHAR(60) NOT NULL,
  PRIMARY KEY (role, permission_code),
  FOREIGN KEY (permission_code) REFERENCES permissions(code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS shift_rotations (
  id          VARCHAR(36) PRIMARY KEY,
  name        VARCHAR(150) NOT NULL,
  pattern     TEXT NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS shift_rotation_assignments (
  id           VARCHAR(36) PRIMARY KEY,
  rotation_id  VARCHAR(36) NOT NULL,
  employee_id  VARCHAR(36) NOT NULL UNIQUE,
  start_date   DATE NOT NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (rotation_id) REFERENCES shift_rotations(id),
  FOREIGN KEY (employee_id) REFERENCES employees(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          VARCHAR(36) PRIMARY KEY,
  user_id     VARCHAR(36) NOT NULL,
  token_hash  VARCHAR(64) NOT NULL UNIQUE,
  expires_at  DATETIME NOT NULL,
  used_at     DATETIME NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_reset_tokens_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS settings (
  id                     VARCHAR(20) PRIMARY KEY DEFAULT 'singleton',
  company_name           VARCHAR(200) NOT NULL DEFAULT '',
  logo_url               VARCHAR(255),
  timezone               VARCHAR(50) NOT NULL DEFAULT 'Asia/Jakarta',
  gps_mode               VARCHAR(20) NOT NULL DEFAULT 'optional',
  grace_period_minutes   INT NOT NULL DEFAULT 15,
  default_radius_meters  INT NOT NULL DEFAULT 100
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
