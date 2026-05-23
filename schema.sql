-- ============================================================
-- CLEAN RESET SCRIPT FOR course_platform
-- Rebuilds the database from scratch with the current app schema.
-- ============================================================

CREATE DATABASE IF NOT EXISTS course_platform;
USE course_platform;

-- ============================================================
-- USERS
-- ============================================================

CREATE TABLE if not exists users (
  user_id INT NOT NULL AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL DEFAULT '',
  phone VARCHAR(32) DEFAULT NULL,
  address VARCHAR(255) DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  UNIQUE KEY ux_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- COURSES
-- ============================================================

CREATE TABLE if not exists courses (
  course_id INT NOT NULL AUTO_INCREMENT,
  title VARCHAR(255) NOT NULL,
  description TEXT DEFAULT NULL,
  price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (course_id)
  ,UNIQUE KEY ux_courses_title (title)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- ENROLLMENTS
-- ============================================================

CREATE TABLE if not exists enrollments (
  enrollment_id INT NOT NULL AUTO_INCREMENT,
  user_id INT NOT NULL,
  course_id INT NOT NULL,
  enrolled_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  access_granted TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (enrollment_id),
  UNIQUE KEY ux_enrollments_user_course (user_id, course_id),
  KEY ix_enrollments_user_id (user_id),
  KEY ix_enrollments_course_id (course_id),
  CONSTRAINT fk_enrollments_user
    FOREIGN KEY (user_id) REFERENCES users (user_id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_enrollments_course
    FOREIGN KEY (course_id) REFERENCES courses (course_id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- PAYMENTS
-- ============================================================

CREATE TABLE if not exists payments (
  payment_id INT NOT NULL AUTO_INCREMENT,
  enrollment_id INT NOT NULL,
  transaction_uuid VARCHAR(255) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  status ENUM('PENDING', 'COMPLETE', 'FAILED') NOT NULL DEFAULT 'PENDING',
  esewa_ref VARCHAR(255) DEFAULT NULL,
  paid_at TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (payment_id),
  UNIQUE KEY ux_payments_transaction_uuid (transaction_uuid),
  UNIQUE KEY ux_payments_enrollment_id (enrollment_id),
  KEY ix_payments_status (status),
  CONSTRAINT fk_payments_enrollment
    FOREIGN KEY (enrollment_id) REFERENCES enrollments (enrollment_id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- LEGACY TRANSACTIONS MIRROR
-- ============================================================

CREATE TABLE if not exists transactions (
  id INT NOT NULL AUTO_INCREMENT,
  user_id INT NOT NULL,
  course_id INT NOT NULL,
  transaction_uuid VARCHAR(255) NOT NULL,
  transaction_code VARCHAR(255) DEFAULT NULL,
  amount DECIMAL(10,2) NOT NULL,
  status ENUM('PENDING', 'COMPLETE', 'FAILED') NOT NULL DEFAULT 'PENDING',
  esewa_response JSON DEFAULT NULL,
  paid_at DATETIME DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY ux_transactions_transaction_uuid (transaction_uuid),
  KEY ix_transactions_user_id (user_id),
  KEY ix_transactions_course_id (course_id),
  CONSTRAINT fk_transactions_user
    FOREIGN KEY (user_id) REFERENCES users (user_id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_transactions_course
    FOREIGN KEY (course_id) REFERENCES courses (course_id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- SESSIONS
-- ============================================================

CREATE TABLE if not exists sessions (
  id INT NOT NULL AUTO_INCREMENT,
  user_id INT NOT NULL,
  session_token VARCHAR(128) NOT NULL,
  ip_address VARCHAR(45) DEFAULT NULL,
  user_agent VARCHAR(512) DEFAULT NULL,
  expires_at DATETIME NOT NULL,
  last_seen_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY ux_sessions_token (session_token),
  KEY ix_sessions_user_id (user_id),
  KEY ix_sessions_expires_at (expires_at),
  CONSTRAINT fk_sessions_user
    FOREIGN KEY (user_id) REFERENCES users (user_id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


INSERT IGNORE INTO courses (title, description, price) VALUES ('English', 'Fundamentals of English', 100.00);
INSERT IGNORE INTO courses (title, description, price) VALUES ('Nepali', 'Basics of Nepali', 100.00);
INSERT IGNORE INTO courses (title, description, price) VALUES ('Science', 'Introduction to Science', 100.00);


-- ============================================================
-- OPTIONAL SEED DATA
-- Uncomment if you want one starter course row.
-- ============================================================
-- INSERT INTO courses (title, description, price) VALUES ('Starter Course', 'Optional seed course', 0.00);
