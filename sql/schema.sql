-- =====================================================
-- LICOREXPERT - Database Schema
-- =====================================================

-- Extensiones necesarias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =====================================================
-- TIPOS ENUMERADOS
-- =====================================================

DO $$ BEGIN
  CREATE TYPE action_tipo AS ENUM (
    'RECOMENDAR',
    'FALLA',
    'SET'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE alcohol_scope AS ENUM (
    'ANY',
    'RON',
    'TEQUILA',
    'WHISKY',
    'GIN',
    'VODKA',
    'BRANDY',
    'NA'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- =====================================================
-- TABLAS BASE
-- =====================================================

-- Tabla de bases de licores
CREATE TABLE IF NOT EXISTS liquor_bases (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL
);

INSERT INTO liquor_bases(code, label) VALUES
('RON','Ron'),
('TEQUILA','Tequila'),
('WHISKY','Whisky'),
('GIN','Gin'),
('VODKA','Vodka'),
('BRANDY','Brandy'),
('NA','Sin alcohol')
ON CONFLICT DO NOTHING;

-- Tabla de usuarios
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  favorite_base TEXT REFERENCES liquor_bases(code),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  token_version INT NOT NULL DEFAULT 0
);

-- Tabla de refresh tokens
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  jti UUID NOT NULL,
  token_hash TEXT NOT NULL,
  user_agent TEXT,
  ip INET,
  expires_at TIMESTAMP NOT NULL,
  revoked_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- =====================================================
-- SISTEMA EXPERTO - Expert System
-- =====================================================

-- Tabla de características/features del sistema experto
CREATE TABLE IF NOT EXISTS es_features (
  key TEXT PRIMARY KEY,
  description TEXT
);

-- Tabla de reglas del sistema experto
CREATE TABLE IF NOT EXISTS es_rules (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  priority INT NOT NULL DEFAULT 0,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  alcohol_scope alcohol_scope DEFAULT 'ANY'
);

-- Tabla de condiciones de las reglas
CREATE TABLE IF NOT EXISTS es_rule_conditions (
  id SERIAL PRIMARY KEY,
  rule_id INT NOT NULL REFERENCES es_rules(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL REFERENCES es_features(key),
  op TEXT NOT NULL CHECK (op IN ('=', '!=', '>', '<', '>=', '<=', 'IN', 'NOT_IN', 'CONTAINS', 'NOT_CONTAINS')),
  value_text TEXT
);

-- Tabla de acciones de las reglas
CREATE TABLE IF NOT EXISTS es_rule_actions (
  id SERIAL PRIMARY KEY,
  rule_id INT NOT NULL REFERENCES es_rules(id) ON DELETE CASCADE,
  type action_tipo NOT NULL,
  value_text TEXT,
  severity TEXT CHECK (severity IN ('INFO', 'WARNING', 'ERROR')),
  category TEXT
);

-- Tabla de sesiones del sistema experto
CREATE TABLE IF NOT EXISTS es_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Tabla de hechos/facts de las sesiones
CREATE TABLE IF NOT EXISTS es_facts (
  session_id UUID NOT NULL REFERENCES es_sessions(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL REFERENCES es_features(key),
  value_text TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (session_id, feature_key)
);

-- =====================================================
-- ÍNDICES
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_jti ON refresh_tokens(jti);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);

CREATE INDEX IF NOT EXISTS idx_es_rules_priority ON es_rules(priority DESC);
CREATE INDEX IF NOT EXISTS idx_es_rules_enabled ON es_rules(enabled) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS idx_es_rules_alcohol_scope ON es_rules(alcohol_scope);

CREATE INDEX IF NOT EXISTS idx_es_rule_conditions_rule_id ON es_rule_conditions(rule_id);
CREATE INDEX IF NOT EXISTS idx_es_rule_conditions_feature_key ON es_rule_conditions(feature_key);

CREATE INDEX IF NOT EXISTS idx_es_rule_actions_rule_id ON es_rule_actions(rule_id);

CREATE INDEX IF NOT EXISTS idx_es_sessions_user_id ON es_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_es_sessions_created_at ON es_sessions(created_at);

CREATE INDEX IF NOT EXISTS idx_es_facts_session_id ON es_facts(session_id);
CREATE INDEX IF NOT EXISTS idx_es_facts_feature_key ON es_facts(feature_key);

-- =====================================================
-- FUNCIONES Y TRIGGERS
-- =====================================================

-- Función para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para actualizar updated_at en users
DROP TRIGGER IF EXISTS trg_users_updated ON users;
CREATE TRIGGER trg_users_updated
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- =====================================================
-- FUNCIONES DEL SISTEMA EXPERTO
-- =====================================================

-- Función para crear regla simple (sin alcohol_scope)
CREATE OR REPLACE FUNCTION create_simple_rule(
  p_name TEXT,
  p_priority INT,
  p_conditions JSONB,
  p_actions JSONB
) RETURNS INT AS $$
DECLARE
  v_rule_id INT;
  v_cond JSONB;
  v_action JSONB;
BEGIN
  INSERT INTO es_rules(name, priority) VALUES (p_name, p_priority)
  RETURNING id INTO v_rule_id;

  FOR v_cond IN SELECT * FROM jsonb_array_elements(p_conditions)
  LOOP
    INSERT INTO es_rule_conditions(rule_id, feature_key, op, value_text)
    VALUES (
      v_rule_id,
      v_cond->>'feature_key',
      v_cond->>'op',
      v_cond->>'value_text'
    );
  END LOOP;

  FOR v_action IN SELECT * FROM jsonb_array_elements(p_actions)
  LOOP
    INSERT INTO es_rule_actions(rule_id, type, value_text)
    VALUES (
      v_rule_id,
      (v_action->>'type')::action_tipo,
      v_action->>'value_text'
    );
  END LOOP;

  RETURN v_rule_id;
END;
$$ LANGUAGE plpgsql;

-- Función para crear regla con scope de alcohol
CREATE OR REPLACE FUNCTION create_scoped_rule(
  p_name TEXT,
  p_priority INT,
  p_alcohol_scope alcohol_scope,
  p_conditions JSONB,
  p_actions JSONB
) RETURNS INT AS $$
DECLARE
  v_rule_id INT;
  v_cond JSONB;
  v_action JSONB;
BEGIN
  INSERT INTO es_rules(name, priority, alcohol_scope)
  VALUES (p_name, p_priority, p_alcohol_scope)
  RETURNING id INTO v_rule_id;

  FOR v_cond IN SELECT * FROM jsonb_array_elements(p_conditions)
  LOOP
    INSERT INTO es_rule_conditions(rule_id, feature_key, op, value_text)
    VALUES (
      v_rule_id,
      v_cond->>'feature_key',
      v_cond->>'op',
      v_cond->>'value_text'
    );
  END LOOP;

  FOR v_action IN SELECT * FROM jsonb_array_elements(p_actions)
  LOOP
    INSERT INTO es_rule_actions(rule_id, type, value_text, severity, category)
    VALUES (
      v_rule_id,
      (v_action->>'type')::action_tipo,
      v_action->>'value_text',
      v_action->>'severity',
      v_action->>'category'
    );
  END LOOP;

  RETURN v_rule_id;
END;
$$ LANGUAGE plpgsql;

-- Función para iniciar sesión con usuario
CREATE OR REPLACE FUNCTION start_session_with_user(
  p_user UUID,
  p_facts JSONB
) RETURNS UUID AS $$
DECLARE
  v_session UUID;
  v_fact JSONB;
BEGIN
  v_session := uuid_generate_v4();
  INSERT INTO es_sessions(id, user_id) VALUES (v_session, p_user);

  FOR v_fact IN SELECT * FROM jsonb_array_elements(p_facts)
  LOOP
    INSERT INTO es_facts(session_id, feature_key, value_text)
    VALUES (
      v_session,
      v_fact->>'feature_key',
      v_fact->>'value_text'
    );
  END LOOP;

  RETURN v_session;
END;
$$ LANGUAGE plpgsql;

-- Función para iniciar sesión anónima
CREATE OR REPLACE FUNCTION start_session_anonymous(
  p_facts JSONB
) RETURNS UUID AS $$
DECLARE
  v_session UUID;
  v_fact JSONB;
BEGIN
  v_session := uuid_generate_v4();
  INSERT INTO es_sessions(id) VALUES (v_session);

  FOR v_fact IN SELECT * FROM jsonb_array_elements(p_facts)
  LOOP
    INSERT INTO es_facts(session_id, feature_key, value_text)
    VALUES (
      v_session,
      v_fact->>'feature_key',
      v_fact->>'value_text'
    );
  END LOOP;

  RETURN v_session;
END;
$$ LANGUAGE plpgsql;

-- Función para añadir hecho a sesión existente
CREATE OR REPLACE FUNCTION add_fact_to_session(
  p_session UUID,
  p_feature_key TEXT,
  p_value_text TEXT
) RETURNS VOID AS $$
BEGIN
  INSERT INTO es_facts(session_id, feature_key, value_text)
  VALUES (p_session, p_feature_key, p_value_text)
  ON CONFLICT (session_id, feature_key)
  DO UPDATE SET value_text = EXCLUDED.value_text, created_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- Función para añadir condición a regla
CREATE OR REPLACE FUNCTION add_condition_to_rule(
  p_rule_id INT,
  p_feature_key TEXT,
  p_op TEXT,
  p_value_text TEXT
) RETURNS VOID AS $$
BEGIN
  INSERT INTO es_rule_conditions(rule_id, feature_key, op, value_text)
  VALUES (p_rule_id, p_feature_key, p_op, p_value_text);
END;
$$ LANGUAGE plpgsql;

-- Función para añadir acción a regla
CREATE OR REPLACE FUNCTION add_action_to_rule(
  p_rule_id INT,
  p_type action_tipo,
  p_value_text TEXT,
  p_severity TEXT DEFAULT NULL,
  p_category TEXT DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
  INSERT INTO es_rule_actions(rule_id, type, value_text, severity, category)
  VALUES (p_rule_id, p_type, p_value_text, p_severity, p_category);
END;
$$ LANGUAGE plpgsql;