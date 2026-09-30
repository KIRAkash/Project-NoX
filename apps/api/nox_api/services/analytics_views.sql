-- NoX flight recorder: BigQuery tables and views. `{ds}` is `<project>.<dataset>`; scripts/deploy_gcp.sh
-- substitutes it and runs this file with `bq query --use_legacy_sql=false`. Safe to re-run.
-- Tables are partitioned by day on `at` and clustered by org_id. Payloads are JSON text (read with JSON_VALUE).

CREATE TABLE IF NOT EXISTS `{ds}.mission_events` (
  event_id STRING, at TIMESTAMP, org_id STRING, mission_id STRING, mission_key STRING,
  type STRING, actor_role STRING, stage STRING, payload STRING
) PARTITION BY DATE(at) CLUSTER BY org_id;

CREATE TABLE IF NOT EXISTS `{ds}.kb_events` (
  event_id STRING, at TIMESTAMP, org_id STRING, kb_id STRING, app STRING, type STRING, payload STRING
) PARTITION BY DATE(at) CLUSTER BY org_id;

CREATE TABLE IF NOT EXISTS `{ds}.ai_usage` (
  event_id STRING, at TIMESTAMP, org_id STRING, mission_id STRING, kb_id STRING, label STRING,
  calls INT64, input_tokens INT64, cached_tokens INT64, output_tokens INT64, thinking_tokens INT64,
  embedded_tokens INT64, tool_calls INT64, seconds FLOAT64, models STRING, citations INT64
) PARTITION BY DATE(at) CLUSTER BY org_id;

CREATE TABLE IF NOT EXISTS `{ds}.shield_findings` (
  event_id STRING, at TIMESTAMP, org_id STRING, kb_id STRING, mission_id STRING, `where` STRING,
  source STRING, category STRING, confidence STRING, excerpt_sha STRING, action STRING
) PARTITION BY DATE(at) CLUSTER BY org_id;

-- Every mission event carries the stage the mission is in after it, so stage changes are where it differs.
CREATE OR REPLACE VIEW `{ds}.mission_stage_durations` AS
WITH changes AS (
  SELECT org_id, mission_id, at, stage, LAG(stage) OVER (PARTITION BY mission_id ORDER BY at) AS prev
  FROM `{ds}.mission_events` WHERE stage IS NOT NULL
), segments AS (
  SELECT org_id, mission_id, stage, at AS started_at, LEAD(at) OVER (PARTITION BY mission_id ORDER BY at) AS ended_at
  FROM changes WHERE prev IS NULL OR prev != stage
)
SELECT org_id, mission_id, stage, started_at, ended_at, TIMESTAMP_DIFF(ended_at, started_at, SECOND) AS seconds
FROM segments WHERE ended_at IS NOT NULL AND stage != 'done';

CREATE OR REPLACE VIEW `{ds}.mission_send_backs` AS
SELECT org_id, mission_id, at, type, from_stage FROM (
  SELECT org_id, mission_id, at, type, LAG(stage) OVER (PARTITION BY mission_id ORDER BY at) AS from_stage
  FROM `{ds}.mission_events` WHERE stage IS NOT NULL
) WHERE type IN ('mission.sent_back', 'verify.not_met');

-- Sentence to verified code, per mission.
CREATE OR REPLACE VIEW `{ds}.mission_flow` AS
SELECT org_id, mission_id, ANY_VALUE(mission_key) AS mission_key,
  MIN(IF(type = 'mission.created', at, NULL)) AS created_at,
  MIN(IF(stage = 'done', at, NULL)) AS verified_at,
  TIMESTAMP_DIFF(MIN(IF(stage = 'done', at, NULL)), MIN(IF(type = 'mission.created', at, NULL)), SECOND) AS seconds_to_verified,
  COUNTIF(type IN ('mission.sent_back', 'verify.not_met')) AS send_backs
FROM `{ds}.mission_events` GROUP BY org_id, mission_id;

-- Share of Ask answers and drafted spec files that cite at least one source.
CREATE OR REPLACE VIEW `{ds}.grounding` AS
SELECT day, org_id, COUNT(*) AS answers, COUNTIF(citations > 0) AS grounded FROM (
  SELECT DATE(at) AS day, org_id, citations FROM `{ds}.ai_usage` WHERE label = 'ask' AND citations IS NOT NULL
  UNION ALL
  SELECT DATE(at), org_id, SAFE_CAST(JSON_VALUE(payload, '$.citations') AS INT64)
  FROM `{ds}.mission_events` WHERE type = 'file.drafted' AND JSON_VALUE(payload, '$.citations') IS NOT NULL
) GROUP BY day, org_id;

-- Tokens and an estimated cost per mission and per KB build.
-- Price table: USD per million tokens, Gemini Flash-class list prices as read on 2026-09-29 (an estimate;
-- keep in step with PRICE_PER_MTOK in services/analytics.py).
CREATE OR REPLACE VIEW `{ds}.ai_cost` AS
WITH price AS (SELECT 0.30 AS input, 0.03 AS cached, 2.50 AS output, 2.50 AS thinking)
SELECT org_id, mission_id, kb_id, MIN(at) AS first_at, SUM(calls) AS calls,
  SUM(input_tokens) AS input_tokens, SUM(cached_tokens) AS cached_tokens, SUM(output_tokens) AS output_tokens,
  SUM(thinking_tokens) AS thinking_tokens,
  SUM((GREATEST(input_tokens - cached_tokens, 0) * p.input + cached_tokens * p.cached
       + output_tokens * p.output + thinking_tokens * p.thinking) / 1e6) AS usd
FROM `{ds}.ai_usage`, price AS p
GROUP BY org_id, mission_id, kb_id;

-- Flow B: a source push (the gatekeeper starts) to the patch PR that keeps the KB in step.
CREATE OR REPLACE VIEW `{ds}.kb_freshness` AS
WITH e AS (
  SELECT org_id, kb_id, type, at, LEAD(type) OVER w AS next_type, LEAD(at) OVER w AS next_at
  FROM `{ds}.kb_events` WHERE type IN ('gatekeeper_evaluation_started', 'pr_opened')
  WINDOW w AS (PARTITION BY kb_id ORDER BY at)
)
SELECT org_id, kb_id, at AS pushed_at, next_at AS pr_at, TIMESTAMP_DIFF(next_at, at, SECOND) AS seconds
FROM e WHERE type = 'gatekeeper_evaluation_started' AND next_type = 'pr_opened';
