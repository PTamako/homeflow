-- Shopping plans support an optional second household assignee.
-- This is a read-only reallocation of the existing verified 2-point purchase credit.
-- Never touch or duplicate the real Kakebo ledger transaction.
ALTER TABLE shopping_items ADD COLUMN second_assignee_user_id TEXT REFERENCES users(id);
CREATE INDEX idx_shopping_second_assignee
 ON shopping_items(household_id,second_assignee_user_id,due_on);

CREATE VIEW shopping_joint_credits AS
SELECT p.household_id,p.shopping_id,p.earner_user_id AS user_id,
       p.visibility,p.earned_at,-1.0 AS points
 FROM shopping_completion_points p
 JOIN shopping_items i ON i.household_id=p.household_id AND i.id=p.shopping_id
 WHERE i.second_assignee_user_id IS NOT NULL
   AND p.earner_user_id IN(i.assigned_to,i.second_assignee_user_id)
UNION ALL
SELECT p.household_id,p.shopping_id,
       CASE WHEN p.earner_user_id=i.assigned_to
            THEN i.second_assignee_user_id ELSE i.assigned_to END AS user_id,
       p.visibility,p.earned_at,1.0 AS points
 FROM shopping_completion_points p
 JOIN shopping_items i ON i.household_id=p.household_id AND i.id=p.shopping_id
 WHERE i.second_assignee_user_id IS NOT NULL
   AND p.earner_user_id IN(i.assigned_to,i.second_assignee_user_id);
