-- Track upper-limit crossing separately from existing lower-limit state.
-- The old lower-limit cycle, original owner and sent-notification history remain intact.
ALTER TABLE prepaid_alert_observations
 ADD COLUMN is_above INTEGER NOT NULL DEFAULT 0 CHECK(is_above IN (0,1));
ALTER TABLE prepaid_alert_observations
 ADD COLUMN above_cycle INTEGER NOT NULL DEFAULT 0 CHECK(above_cycle>=0);
ALTER TABLE prepaid_alert_observations
 ADD COLUMN above_triggered_on TEXT;
ALTER TABLE prepaid_alert_observations
 ADD COLUMN lower_active INTEGER NOT NULL DEFAULT 1 CHECK(lower_active IN (0,1));
ALTER TABLE prepaid_alert_observations
 ADD COLUMN upper_active INTEGER NOT NULL DEFAULT 0 CHECK(upper_active IN (0,1));
ALTER TABLE prepaid_alert_observations
 ADD COLUMN lower_threshold_jpy INTEGER CHECK(lower_threshold_jpy BETWEEN 0 AND 100000000);
ALTER TABLE prepaid_alert_observations
 ADD COLUMN upper_threshold_jpy INTEGER CHECK(upper_threshold_jpy BETWEEN 0 AND 100000000);
